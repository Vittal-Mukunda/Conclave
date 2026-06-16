import * as vscode from 'vscode';
import * as os from 'os';
import { Logger } from '../logging/Logger';
import { ErrorService } from '../errors/ErrorService';
import { ConclaveError } from '../errors/ErrorReport';
import { Capability, DegradedModeRegistry } from '../degraded/DegradedModeRegistry';
import { ingestSkill } from './ingest';
import { SkillRetriever, RetrievalResult, RetrievalInput } from './Retriever';
import { SkillStore } from './SkillStore';
import { Skill, SkillFolderInput, SourceType, TrustTier } from './types';

// vscode glue for the Skills subsystem (Phase 16: format / ingest / retrieval).
// Scans the local skill roots (.conclave/skills = project, ~/.conclave/skills =
// user), ingests + validates each folder (quarantining invalid ones, SKILL-1),
// caches the content-addressed index, and retrieves the best skill(s) for a task.
// The ingest/retrieve/store logic is pure + unit-tested; this is the disk/UI glue.
//
// Remote sources (marketplace / git) land in Phase 18. A `RemoteSkillSource` seam
// is accepted here so SKILL-6 (marketplace unreachable) degrades to LOCAL skills
// with a retry, never a dead-end — composition/injection is Phase 17, the
// security scan + script sandbox is Phase 18.

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES_PER_SKILL = 200;

/** A remote skill catalog (marketplace/git). Implemented in Phase 18. */
export interface RemoteSkillSource {
  /** Fetch ingestable folders; throws if the source is unreachable (SKILL-6). */
  fetch(): Promise<SkillFolderInput[]>;
}

export class SkillsService {
  private readonly retriever = new SkillRetriever();
  private skills: Skill[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly errors: ErrorService,
    private readonly degraded: DegradedModeRegistry,
    private readonly store?: SkillStore,
    private readonly remote?: RemoteSkillSource,
  ) {
    // Hydrate from the cached index so retrieval works before the first scan.
    if (this.store) {
      try {
        this.skills = this.store.all();
      } catch {
        this.skills = [];
      }
    }
  }

  /** Skills currently available to the retriever. */
  installed(): Skill[] {
    return this.skills;
  }

  /** Retrieve the skill(s) to activate for a task (description is primary). */
  retrieve(input: RetrievalInput): RetrievalResult {
    return this.retriever.retrieve(this.skills, input);
  }

  /**
   * (Re)scan all local roots + any remote source, validate, and refresh the
   * index. Invalid skills are quarantined (logged, not loaded). Returns the set
   * of valid skills now installed.
   */
  async refresh(): Promise<Skill[]> {
    const found = new Map<string, Skill>(); // dedupe by name+source
    const roots = this.localRoots();

    for (const root of roots) {
      const folders = await this.readSkillFolders(root.uri);
      for (const folder of folders) {
        const input: SkillFolderInput = {
          dirName: folder.dirName,
          files: folder.files,
          trust: root.trust,
          source: { source: folder.path, sourceType: root.sourceType },
        };
        const result = ingestSkill(input);
        if (result.ok) {
          found.set(`${result.skill.name}\0${input.source.source}`, result.skill);
          for (const w of result.skill.warnings) {
            this.logger.warn('skill_warning', { skill: result.skill.name, warning: w });
          }
        } else {
          // Quarantine: log + surface, never load (SKILL-1).
          this.errors.report(result.error);
          this.logger.warn('skill_quarantined', { dir: result.dirName, code: result.error.code });
        }
      }
    }

    // Optional remote source — degrade to local on failure (SKILL-6).
    if (this.remote) {
      try {
        for (const folder of await this.remote.fetch()) {
          const result = ingestSkill(folder);
          if (result.ok) {
            found.set(`${result.skill.name}\0${folder.source.source}`, result.skill);
          } else {
            this.errors.report(result.error);
          }
        }
      } catch (err) {
        this.degraded.set(Capability.Skills, 'degraded', {
          consequence: 'The skill marketplace is unreachable — only locally installed skills are available.',
          restoreAction: { label: 'Retry', kind: 'retry', command: 'conclave.refreshSkills' },
        });
        this.errors.report(
          new ConclaveError({
            category: 'skill',
            code: 'SKILL-6',
            title: 'Skill marketplace unreachable',
            detail: 'Could not reach the skill catalog; using locally installed skills only.',
            cause: err,
            canRetry: true,
            fallbackApplied: 'Local skills only.',
            recoveryActions: [{ label: 'Retry', kind: 'retry', command: 'conclave.refreshSkills' }],
          }),
        );
      }
    }

    this.skills = [...found.values()];
    if (this.store) {
      for (const s of this.skills) {
        try {
          this.store.save(s);
        } catch {
          // index persistence is best-effort; in-memory retrieval still works.
        }
      }
    }
    this.logger.info('skills_refreshed', { count: this.skills.length });
    return this.skills;
  }

  /** `conclave.refreshSkills` — rescan + report the index. */
  async refreshCommand(): Promise<void> {
    const skills = await this.refresh();
    void vscode.window.showInformationMessage(
      skills.length
        ? `conclave: indexed ${skills.length} skill(s): ${skills.map((s) => s.name).join(', ')}.`
        : 'conclave: no skills found. Add skills under .conclave/skills/ or ~/.conclave/skills/.',
    );
  }

  /** `conclave.findSkills` — show which skills would activate for a task. */
  async findSkillsCommand(): Promise<void> {
    if (!this.skills.length) {
      await this.refresh();
    }
    const taskText = await vscode.window.showInputBox({
      title: 'conclave — find skills',
      prompt: 'Describe the task; conclave picks the matching skill(s).',
      ignoreFocusOut: true,
    });
    if (!taskText) {
      return;
    }
    const result = this.retrieve({ taskText });
    if (!result.active.length) {
      void vscode.window.showInformationMessage(
        `conclave: no skill matched (best below threshold). ${this.skills.length} indexed.`,
      );
      return;
    }
    const overflow = result.dropped.filter((d) => d.reason !== 'below-threshold');
    const note = overflow.length ? ` (+${overflow.length} eligible dropped by cap/budget — SKILL-5)` : '';
    void vscode.window.showInformationMessage(
      `conclave: activating ${result.active.map((s) => s.name).join(', ')}${note}.`,
    );
  }

  private localRoots(): Array<{ uri: vscode.Uri; trust: TrustTier; sourceType: SourceType }> {
    const roots: Array<{ uri: vscode.Uri; trust: TrustTier; sourceType: SourceType }> = [];
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
      roots.push({
        uri: vscode.Uri.joinPath(ws.uri, '.conclave', 'skills'),
        trust: 'project',
        sourceType: 'local-project',
      });
    }
    roots.push({
      uri: vscode.Uri.file(`${os.homedir()}/.conclave/skills`),
      trust: 'user',
      sourceType: 'local-user',
    });
    return roots;
  }

  /** Read each immediate sub-directory of `root` as a skill folder (file map). */
  private async readSkillFolders(
    root: vscode.Uri,
  ): Promise<Array<{ dirName: string; path: string; files: Record<string, string> }>> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(root);
    } catch {
      return []; // root absent — fine.
    }
    const out: Array<{ dirName: string; path: string; files: Record<string, string> }> = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.Directory) {
        continue;
      }
      const dir = vscode.Uri.joinPath(root, name);
      const files: Record<string, string> = {};
      try {
        await this.collectFiles(dir, '', files);
      } catch (err) {
        this.logger.warn('skill_read_failed', { dir: name });
        this.errors.report(err, { category: 'skill' });
        continue;
      }
      out.push({ dirName: name, path: dir.fsPath, files });
    }
    return out;
  }

  private async collectFiles(
    dir: vscode.Uri,
    prefix: string,
    out: Record<string, string>,
  ): Promise<void> {
    if (Object.keys(out).length >= MAX_FILES_PER_SKILL) {
      return;
    }
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const child = vscode.Uri.joinPath(dir, name);
      if (type === vscode.FileType.Directory) {
        await this.collectFiles(child, rel, out);
      } else if (type === vscode.FileType.File) {
        const stat = await vscode.workspace.fs.stat(child);
        if (stat.size > MAX_FILE_BYTES) {
          continue; // skip oversize asset; SKILL.md is small.
        }
        try {
          out[rel] = Buffer.from(await vscode.workspace.fs.readFile(child)).toString('utf8');
        } catch {
          // skip unreadable/binary file.
        }
      }
    }
  }
}

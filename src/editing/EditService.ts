import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { ErrorService } from '../errors/ErrorService';
import { AtomicEditor } from './AtomicEditor';
import { CheckpointManager } from './CheckpointManager';
import { GitCli } from './GitCli';
import { RepoMemory, RepoMemoryKeys } from './RepoMemory';
import { CheckpointRef, EditPlan, EditResult, FileState } from './types';

/**
 * vscode glue for Phase 8 editing. Owns: workspace-scoped state (boundary
 * predicate + repo-memory workspace id), reading current file state from disk
 * and open buffers (EDIT-6/8), checkpoint-before-edit (EDIT-3), atomic apply
 * (EDIT-7) with rollback on write failure (EDIT-9). The decision logic it calls
 * (AtomicEditor / CheckpointManager) is vscode-free and unit-tested.
 */
export class EditService {
  private readonly editor: AtomicEditor;

  constructor(
    private readonly logger: Logger,
    private readonly errors: ErrorService,
    private readonly repoMemory?: RepoMemory,
  ) {
    this.editor = new AtomicEditor((p) => this.isInsideWorkspace(p));
  }

  /** Stable id for the open folder; repo-memory rows are scoped to it (STATE-6). */
  workspaceId(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private root(): string | undefined {
    return this.workspaceId();
  }

  private isInsideWorkspace(filePath: string): boolean {
    const folders = vscode.workspace.workspaceFolders ?? [];
    // EDIT-2: the path must resolve inside at least one open workspace folder.
    return folders.some((f) => isUnder(f.uri.fsPath, filePath));
  }

  /**
   * Read the current state of every file a plan touches, preferring an open
   * editor's (possibly unsaved) buffer over disk (EDIT-6/8). Missing files come
   * back absent so the editor can flag EDIT-9.
   */
  private async collect(plan: EditPlan): Promise<Map<string, FileState>> {
    const states = new Map<string, FileState>();
    for (const edit of plan.edits) {
      const uri = vscode.Uri.file(edit.path);
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === edit.path);
      if (open) {
        states.set(edit.path, { path: edit.path, content: open.getText(), bufferDirty: open.isDirty });
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        states.set(edit.path, { path: edit.path, content: Buffer.from(bytes).toString('utf8') });
      } catch {
        // Absent on disk: leave unset; AtomicEditor treats it as create-or-EDIT-9.
      }
    }
    return states;
  }

  /**
   * Atomically apply an edit plan: checkpoint first (EDIT-3), validate as
   * all-or-nothing (EDIT-1/2/4/7), then write. If a write fails midway
   * (EDIT-9), roll back to the checkpoint so the tree is never left partial.
   */
  async applyPlan(plan: EditPlan, label = 'edit'): Promise<EditResult> {
    const states = await this.collect(plan);
    const result = this.editor.plan(plan, states);
    if (!result.ok) {
      this.logger.warn('edit_blocked', { failures: result.failures.map((f) => f.code) });
      return result;
    }

    // Reconcile unsaved buffers before we write over them (EDIT-6).
    for (const path of result.reconciled) {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === path);
      if (doc?.isDirty) {
        await doc.save();
      }
    }

    let checkpoint: CheckpointRef | undefined;
    try {
      checkpoint = await this.checkpoint(label);
    } catch (err) {
      this.errors.report(err, { category: 'state', code: 'EDIT-5' });
      // No checkpoint -> refuse to edit rather than risk unrecoverable work.
      return { ok: false, failures: plan.edits.map((e) => ({ path: e.path, code: 'EDIT-9', message: 'could not checkpoint before editing' })) };
    }

    try {
      for (const write of result.writes) {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(write.path), Buffer.from(write.content, 'utf8'));
      }
      this.logger.info('edit_applied', { files: result.writes.length, checkpoint: checkpoint?.ref });
      return result;
    } catch (err) {
      // EDIT-9: write failed (perm/disk). Roll back to the checkpoint so we
      // never leave a partially-applied tree (EDIT-7).
      if (checkpoint) {
        try {
          await this.manager()?.rollback(checkpoint);
        } catch {
          /* rollback best-effort; original error is reported below */
        }
      }
      this.errors.report(err, { category: 'state', code: 'EDIT-9' });
      return { ok: false, failures: plan.edits.map((e) => ({ path: e.path, code: 'EDIT-9', message: 'write failed; rolled back' })) };
    }
  }

  /** Manual / pre-edit checkpoint (EDIT-3). Returns undefined when not a repo. */
  async checkpoint(label: string): Promise<CheckpointRef | undefined> {
    const mgr = this.manager();
    if (!mgr) {
      return undefined;
    }
    return mgr.before(label);
  }

  private manager(): CheckpointManager | undefined {
    const root = this.root();
    if (!root) {
      return undefined;
    }
    return new CheckpointManager(new GitCli(root));
  }

  /** `conclave.checkpoint` command. */
  async runCheckpointCommand(): Promise<void> {
    const root = this.root();
    if (!root) {
      void vscode.window.showWarningMessage('conclave: open a folder before checkpointing.');
      return;
    }
    const ref = await this.checkpoint('manual');
    if (!ref) {
      void vscode.window.showWarningMessage('conclave: no git repository — run "Initialize Git" first.');
      return;
    }
    void vscode.window.showInformationMessage(
      ref.capturedDirty
        ? `conclave: checkpointed your uncommitted work at ${ref.ref.slice(0, 8)}.`
        : `conclave: checkpoint at ${ref.ref.slice(0, 8)} (tree was clean).`,
    );
  }

  /** The remembered test command for this workspace, if any (VER-6). */
  getTestCommand(): string | undefined {
    const ws = this.workspaceId();
    if (!ws || !this.repoMemory) {
      return undefined;
    }
    return this.repoMemory.get(ws, RepoMemoryKeys.TestCommand);
  }

  /**
   * `conclave.rememberTestCommand` — ask once and persist (VER-6). Pre-fills the
   * previously remembered value so it's editable.
   */
  async rememberTestCommand(): Promise<void> {
    const ws = this.workspaceId();
    if (!ws) {
      void vscode.window.showWarningMessage('conclave: open a folder first.');
      return;
    }
    if (!this.repoMemory) {
      void vscode.window.showWarningMessage('conclave: repo memory is unavailable (storage is off).');
      return;
    }
    const value = await vscode.window.showInputBox({
      title: 'conclave — remember test command',
      prompt: 'Command conclave should run to verify this repo (e.g. "npm test").',
      value: this.repoMemory.get(ws, RepoMemoryKeys.TestCommand) ?? '',
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return; // cancelled
    }
    if (value.trim() === '') {
      this.repoMemory.delete(ws, RepoMemoryKeys.TestCommand);
      void vscode.window.showInformationMessage('conclave: cleared the remembered test command.');
      return;
    }
    this.repoMemory.set(ws, RepoMemoryKeys.TestCommand, value.trim());
    void vscode.window.showInformationMessage(`conclave: will use "${value.trim()}" to verify this repo.`);
  }
}

/** True when `child` resolves inside `root` (path-prefix check, EDIT-2 fallback). */
function isUnder(root: string, child: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const c = norm(child);
  return c === r || c.startsWith(r + '/');
}

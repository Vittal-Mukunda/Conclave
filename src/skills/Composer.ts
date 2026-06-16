import { Logger } from '../logging/Logger';
import {
  ComposedBlock,
  ComposedContext,
  Skill,
  SkillConflict,
  SubAgentRole,
} from './types';
import { byPrecedence } from './precedence';
import { categoryOf, eligibleForRole, rolePolicy } from './roles';

// Skill composition (docs/skills-spec.md "COMPOSITION + CONFLICT RESOLUTION").
// Layers the role-eligible active skills in PRECEDENCE order, each in a delimited
// source-tagged block, resolves `metadata.requires` dependencies, and resolves
// execution-affecting directive conflicts to the HIGHEST-precedence value —
// never silently merging, always surfacing the conflict reason (SKILL-4). Pure;
// the Logger is optional (conflicts are logged when present).

/** Execution-affecting directives — the highest-precedence value wins + is logged. */
export const DIRECTIVE_KEYS = [
  'test_command',
  'build_command',
  'deploy_command',
  'run_command',
  'lint_command',
] as const;

/** Parse a `metadata.requires` field into skill names. */
function parseRequires(skill: Skill): string[] {
  const raw = skill.frontmatter.metadata?.requires;
  if (!raw) {
    return [];
  }
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** Fence one skill body as a delimited, source-tagged DATA block. */
function blockFor(skill: Skill): ComposedBlock {
  // Defang a forged closing tag so a skill body can't break out of its block.
  const safe = skill.body.replace(/<\/skill>/gi, '<\\/skill>');
  const text =
    `<skill name="${skill.name}" trust="${skill.trust}" category="${categoryOf(skill)}" source="${skill.source.source}">\n` +
    `${safe.trim()}\n` +
    `</skill>`;
  return { name: skill.name, trust: skill.trust, source: skill.source.source, text };
}

export class SkillComposer {
  constructor(private readonly logger?: Logger) {}

  /**
   * Compose the active skills for one sub-agent role. `installed` is the full
   * index so `metadata.requires` dependencies can be pulled in even if they were
   * not directly retrieved.
   */
  compose(active: Skill[], role: SubAgentRole, installed: Skill[] = active): ComposedContext {
    const policy = rolePolicy(role);
    const byName = new Map(installed.map((s) => [s.name, s]));

    // 1. Role-eligible active skills.
    const selected = new Map<string, Skill>();
    for (const s of active) {
      if (eligibleForRole(s, role)) {
        selected.set(s.name, s);
      }
    }

    // 2. Resolve metadata.requires (one transitive closure, deterministic).
    const dependencies: string[] = [];
    const missingDependencies: string[] = [];
    const queue = [...selected.values()];
    while (queue.length) {
      const s = queue.shift()!;
      for (const req of parseRequires(s)) {
        if (selected.has(req)) {
          continue;
        }
        const dep = byName.get(req);
        if (!dep) {
          if (!missingDependencies.includes(req)) {
            missingDependencies.push(req);
          }
          continue;
        }
        selected.set(dep.name, dep);
        dependencies.push(dep.name);
        queue.push(dep);
      }
    }

    // 3. Layer in precedence order (highest first).
    const ordered = byPrecedence([...selected.values()]);

    // 4. Resolve execution-affecting directive conflicts.
    const directives: Record<string, string> = {};
    const conflicts: SkillConflict[] = [];
    for (const key of DIRECTIVE_KEYS) {
      const claimants = ordered
        .map((s) => ({ name: s.name, value: s.frontmatter.metadata?.[key]?.trim() }))
        .filter((c): c is { name: string; value: string } => !!c.value);
      if (!claimants.length) {
        continue;
      }
      const winner = claimants[0]; // highest precedence
      directives[key] = winner.value;
      const losers = claimants.slice(1).filter((c) => c.value !== winner.value);
      if (losers.length) {
        conflicts.push({
          kind: 'directive',
          key,
          winner: winner.name,
          losers: losers.map((l) => l.name),
          reason: `Multiple skills set ${key}; using "${winner.value}" from "${winner.name}" (highest precedence). Overridden: ${losers
            .map((l) => `${l.name}="${l.value}"`)
            .join(', ')}.`,
        });
      }
    }

    // 5. Surface duplicate-name skills from different sources (genuine conflict).
    const byBaseName = new Map<string, Skill[]>();
    for (const s of ordered) {
      const arr = byBaseName.get(s.name) ?? [];
      arr.push(s);
      byBaseName.set(s.name, arr);
    }
    for (const [name, dups] of byBaseName) {
      if (dups.length > 1) {
        conflicts.push({
          kind: 'shadowed',
          key: name,
          winner: dups[0].source.source,
          losers: dups.slice(1).map((d) => d.source.source),
          reason: `Skill "${name}" is installed from ${dups.length} sources; the ${dups[0].trust}-tier copy wins.`,
        });
      }
    }

    if (conflicts.length && this.logger) {
      this.logger.warn('skill_conflicts', {
        role,
        count: conflicts.length,
        keys: conflicts.map((c) => `${c.kind}:${c.key}`),
      });
    }

    const blocks = ordered.map(blockFor);
    return {
      role,
      blocks,
      text: blocks.map((b) => b.text).join('\n\n'),
      directives,
      conflicts,
      dependencies,
      missingDependencies,
      readOnly: policy.readOnly,
      scriptsAllowed: policy.scriptsAllowed,
    };
  }
}

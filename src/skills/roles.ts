import { Skill, SkillCategory, SubAgentRole } from './types';

// Skill categorisation + the per-sub-agent injection-point policy
// (docs/skills-spec.md "INJECTION POINTS"). A skill is classified into a
// category (from metadata.category when declared, else a keyword heuristic on
// name+description), and each sub-agent role is injected only the categories it
// should see — context-isolated, with localizer/reviewer READ-ONLY. Pure +
// deterministic.

const VALID_CATEGORIES = new Set<SkillCategory>([
  'repo-map', 'architecture', 'domain-workflow', 'plan-critique',
  'convention', 'style', 'framework', 'commit-message',
  'test', 'build', 'deploy', 'reproduction',
  'security-audit', 'code-review', 'general',
]);

/** Keyword heuristics (checked in order) when no metadata.category is declared. */
const HEURISTICS: Array<[SkillCategory, RegExp]> = [
  ['repo-map', /\b(repo map|repo-map|code search|codebase layout|file structure|navigation)\b/i],
  ['security-audit', /\b(owasp|security audit|vulnerab|cwe|sast|threat model)\b/i],
  ['code-review', /\b(code review|review checklist|pr review|lint review)\b/i],
  ['plan-critique', /\b(plan critique|critique|red team|design review)\b/i],
  ['architecture', /\b(architecture|system design|adr|service boundar|data model)\b/i],
  ['domain-workflow', /\b(workflow|domain|business rule|process|playbook)\b/i],
  ['commit-message', /\b(commit message|conventional commit)\b/i],
  ['deploy', /\b(deploy|release|rollout|ci\/cd|pipeline)\b/i],
  ['build', /\b(build command|compile|bundler|build system)\b/i],
  ['test', /\b(test|spec|coverage|pytest|jest|vitest|tdd)\b/i],
  ['reproduction', /\b(reproduce|reproduction|repro steps|bug repro)\b/i],
  ['framework', /\b(react|vue|angular|django|rails|spring|next\.js|framework)\b/i],
  ['style', /\b(style guide|formatting|naming convention|lint rules|eslint|prettier)\b/i],
  ['convention', /\b(convention|guideline|standard|house rules)\b/i],
];

/** Classify a skill into a category. */
export function categoryOf(skill: Skill): SkillCategory {
  const declared = skill.frontmatter.metadata?.category?.trim().toLowerCase();
  if (declared && VALID_CATEGORIES.has(declared as SkillCategory)) {
    return declared as SkillCategory;
  }
  const hay = `${skill.name} ${skill.description}`;
  for (const [cat, re] of HEURISTICS) {
    if (re.test(hay)) {
      return cat;
    }
  }
  return 'general';
}

export interface RolePolicy {
  /** Categories this role is allowed to receive. */
  categories: Set<SkillCategory>;
  /** Read-only roles never modify code ("report, don't modify"). */
  readOnly: boolean;
  /** Scripts are gated until the Phase 18 sandbox; off for read-only roles regardless. */
  scriptsAllowed: boolean;
}

// 'general' is admitted everywhere (a broadly-applicable skill), but a role's
// specific categories rank higher in composition (handled by precedence).
const ROLE_POLICIES: Record<SubAgentRole, RolePolicy> = {
  localizer: {
    categories: new Set(['repo-map', 'general']),
    readOnly: true,
    scriptsAllowed: false,
  },
  planner: {
    categories: new Set(['architecture', 'domain-workflow', 'plan-critique', 'general']),
    readOnly: true,
    scriptsAllowed: false,
  },
  editor: {
    categories: new Set(['convention', 'style', 'framework', 'commit-message', 'general']),
    readOnly: false,
    scriptsAllowed: false,
  },
  verifier: {
    categories: new Set(['test', 'build', 'deploy', 'reproduction', 'general']),
    readOnly: false,
    scriptsAllowed: false,
  },
  reviewer: {
    categories: new Set(['security-audit', 'code-review', 'general']),
    readOnly: true,
    scriptsAllowed: false,
  },
};

export function rolePolicy(role: SubAgentRole): RolePolicy {
  return ROLE_POLICIES[role];
}

/** Whether a skill is eligible for injection into a given sub-agent role. */
export function eligibleForRole(skill: Skill, role: SubAgentRole): boolean {
  return ROLE_POLICIES[role].categories.has(categoryOf(skill));
}

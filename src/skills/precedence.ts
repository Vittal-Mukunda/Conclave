import { Skill, TrustTier } from './types';
import { categoryOf } from './roles';

// Deterministic skill precedence (docs/skills-spec.md "PRECEDENCE"):
//   user/session > project > org/vetted > community;
//   within a tier: glob/role-specific > general;
//   newer metadata.version breaks remaining ties.
// This is the ordering used to LAYER active skills and to RESOLVE conflicts
// (SKILL-4) — community NEVER overrides user/project. Pure + total order.

const TIER_RANK: Record<TrustTier, number> = {
  user: 4, // user/session
  project: 3,
  vetted: 2,
  community: 1,
};

export function tierRank(trust: TrustTier): number {
  return TIER_RANK[trust];
}

/** A skill is "specific" if it targets globs or declares a concrete (non-general) category. */
export function isSpecific(skill: Skill): boolean {
  return skill.globs.length > 0 || categoryOf(skill) !== 'general';
}

/** Compare two dotted version strings; returns >0 if a is newer. Missing == 0. */
export function compareVersion(a?: string, b?: string): number {
  const pa = (a ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (b ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

/**
 * Comparator for Array.sort: negative => `a` has HIGHER precedence (sorts first).
 * Tier, then specificity, then version (newer first), then name for stability.
 */
export function comparePrecedence(a: Skill, b: Skill): number {
  const tier = tierRank(b.trust) - tierRank(a.trust);
  if (tier !== 0) {
    return tier;
  }
  const spec = Number(isSpecific(b)) - Number(isSpecific(a));
  if (spec !== 0) {
    return spec;
  }
  const ver = compareVersion(b.frontmatter.metadata?.version, a.frontmatter.metadata?.version);
  if (ver !== 0) {
    return ver;
  }
  return a.name.localeCompare(b.name);
}

/** Sort a copy of the skills by descending precedence (highest first). */
export function byPrecedence(skills: Skill[]): Skill[] {
  return [...skills].sort(comparePrecedence);
}

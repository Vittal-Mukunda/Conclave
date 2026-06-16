import { cosine, HashingEmbedder } from '../codeintel/embeddings';
import { LexicalIndex } from '../codeintel/lexical';
import { Embedder } from '../codeintel/types';
import { Skill, TRUST_PRIOR } from './types';

// Skill retrieval (Phase 16): pick which skill(s) to ACTIVATE for a task. The
// PRIMARY signal is the `description` field. A hybrid scorer fuses embedding
// cosine + BM25 keyword + file-glob match + a trust prior. Activation is gated by
// a threshold and capped (default <=3 active bodies under a combined token
// budget; SKILL-5). Pure + deterministic; reuses the codeintel lexical/embedding
// arms so the codebase has one retrieval idiom.

export interface RetrievalInput {
  /** The task text + plan — the routing query. */
  taskText: string;
  /** changed-file globs / paths (e.g. ['src/api/*.ts']). */
  changedGlobs?: string[];
}

export interface RetrievalWeights {
  embed: number;
  lexical: number;
  glob: number;
  trust: number;
}

export const DEFAULT_RETRIEVAL_WEIGHTS: RetrievalWeights = {
  embed: 0.4,
  lexical: 0.4,
  glob: 0.3,
  // Small multiplier on the TRUST_PRIOR values: trust is a tie-break / nudge, not
  // enough on its own to cross the activation threshold (text/glob must match).
  trust: 0.15,
};

export interface RetrievalConfig {
  /** Minimum fused score to be eligible for activation. */
  threshold: number;
  /** Max skills activated concurrently (spec default 3). */
  maxActive: number;
  /** Combined token budget across active bodies (spec ~25k). */
  tokenBudget: number;
  weights: RetrievalWeights;
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  threshold: 0.12,
  maxActive: 3,
  tokenBudget: 25_000,
  weights: DEFAULT_RETRIEVAL_WEIGHTS,
};

export interface SkillSignals {
  embed: number;
  lexical: number;
  glob: number;
  trust: number;
}

export interface ScoredSkill {
  skill: Skill;
  score: number;
  signals: SkillSignals;
}

export interface DroppedSkill {
  skill: Skill;
  reason: 'below-threshold' | 'over-cap' | 'over-budget';
}

export interface RetrievalResult {
  /** Skills to activate, highest priority first. */
  active: Skill[];
  /** Everything scored, ranked (including those not activated). */
  ranked: ScoredSkill[];
  /** Eligible skills that were dropped by the cap/budget, with the reason (SKILL-5). */
  dropped: DroppedSkill[];
}

/** Compile a glob (`*`, `**`, `?`) to a RegExp anchored over a path. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') {
          i++;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`(^|/)${re}$|^${re}$`);
}

/** 1 if any of the skill's globs match any changed path/glob (either direction). */
function globScore(skillGlobs: string[], changed: string[]): number {
  if (!skillGlobs.length || !changed.length) {
    return 0;
  }
  for (const sg of skillGlobs) {
    const sgRe = globToRegExp(sg);
    for (const ch of changed) {
      if (sgRe.test(ch) || globToRegExp(ch).test(sg)) {
        return 1;
      }
    }
  }
  return 0;
}

/** Trust precedence rank (higher = wins ties). */
function trustRank(skill: Skill): number {
  return { user: 4, project: 3, vetted: 2, community: 1 }[skill.trust];
}

export class SkillRetriever {
  constructor(
    private readonly config: RetrievalConfig = DEFAULT_RETRIEVAL_CONFIG,
    private readonly embedder: Embedder = new HashingEmbedder(),
  ) {}

  /** The text used to represent a skill for matching (description is primary). */
  private skillText(skill: Skill): string {
    const meta = skill.frontmatter.metadata
      ? Object.values(skill.frontmatter.metadata).join(' ')
      : '';
    const whenToUse =
      typeof skill.frontmatter.extra['when_to_use'] === 'string'
        ? (skill.frontmatter.extra['when_to_use'] as string)
        : '';
    return `${skill.name} ${skill.description} ${whenToUse} ${meta}`.trim();
  }

  /** Score + rank + select skills for a task. */
  retrieve(skills: Skill[], input: RetrievalInput): RetrievalResult {
    const w = this.config.weights;
    const lexIndex = new LexicalIndex();
    for (const s of skills) {
      lexIndex.add(s.name, this.skillText(s));
    }
    const lexScores = lexIndex.score(input.taskText);
    const lexMax = Math.max(1e-9, ...lexScores.values());
    const queryVec = this.embedder.embed(input.taskText);

    const ranked: ScoredSkill[] = skills.map((skill) => {
      const embed = Math.max(0, cosine(queryVec, this.embedder.embed(this.skillText(skill))));
      const lexical = (lexScores.get(skill.name) ?? 0) / lexMax;
      const glob = globScore(skill.globs, input.changedGlobs ?? []);
      const trust = TRUST_PRIOR[skill.trust];
      const score = w.embed * embed + w.lexical * lexical + w.glob * glob + w.trust * trust;
      return { skill, score, signals: { embed, lexical, glob, trust } };
    });

    // Rank by score, breaking ties on trust precedence then name (deterministic).
    ranked.sort(
      (a, b) =>
        b.score - a.score ||
        trustRank(b.skill) - trustRank(a.skill) ||
        a.skill.name.localeCompare(b.skill.name),
    );

    const active: Skill[] = [];
    const dropped: DroppedSkill[] = [];
    let tokens = 0;
    for (const s of ranked) {
      if (s.score < this.config.threshold) {
        dropped.push({ skill: s.skill, reason: 'below-threshold' });
        continue;
      }
      if (active.length >= this.config.maxActive) {
        dropped.push({ skill: s.skill, reason: 'over-cap' });
        continue;
      }
      if (tokens + s.skill.bodyTokens > this.config.tokenBudget) {
        dropped.push({ skill: s.skill, reason: 'over-budget' });
        continue;
      }
      active.push(s.skill);
      tokens += s.skill.bodyTokens;
    }

    return { active, ranked, dropped };
  }
}

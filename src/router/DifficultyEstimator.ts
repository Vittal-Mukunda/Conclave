import { DifficultySignals, Estimate, levelFromD, TaskType, Tier, TIER_INDEX } from './types';

// The "tiny model" of the OR brain (build-plan §4): a deterministic heuristic
// that maps a natural-language goal -> difficulty d + task type. It is cached
// per goal so repeated planning turns reuse one estimate, and DRIFT is logged
// when the realised difficulty (how high the cascade actually had to climb)
// disagrees with the prediction — the signal a learned estimator would train on.

const MECHANICAL = /\b(rename|reformat|re-?format|format|indent|whitespace|lint|typo|spelling|comment|rewrap|reword|capitali[sz]e|sort imports?)\b/;
const HIGH = /\b(refactor|re-?architect|architecture|redesign|rewrite|migrat\w*|concurren\w*|race condition|deadlock|thread\w*|async\w*|performance|optimi[sz]\w*|securit\w*|distributed|scal\w+)\b/;
const BUG = /\b(fix|bug|defect|crash\w*|broken|regression|error|fails?|failing|incorrect|wrong)\b/;
const FEATURE = /\b(add|implement|create|build|introduce|support|feature|new|endpoint|button|page)\b/;
const BREADTH = /\b(across|throughout|entire|everywhere|every\b|all\b|each\b|whole|codebase|project-wide|globally)\b/;

const BASE: Record<TaskType, number> = {
  mechanical: 0.1,
  bugfix: 0.45,
  feature: 0.5,
  refactor: 0.7,
  design: 0.8,
};

function classify(text: string): TaskType {
  const mech = MECHANICAL.test(text);
  const high = HIGH.test(text);
  // A pure rename/format with no hard signal is mechanical; if a high-complexity
  // verb co-occurs the task isn't really mechanical.
  if (mech && !high) return 'mechanical';
  if (high) return /\b(redesign|re-?architect|architecture|distributed|scal\w+)\b/.test(text) ? 'design' : 'refactor';
  if (BUG.test(text)) return 'bugfix';
  if (FEATURE.test(text)) return 'feature';
  return 'feature';
}

function normalize(goal: string): string {
  return goal.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface DifficultyEstimatorDeps {
  /** Optional structured log sink (drift + estimates). */
  log?: (event: string, data: Record<string, unknown>) => void;
}

/** Observed outcome of running the cascade for a goal, used to detect drift. */
export interface DifficultyOutcome {
  /** Highest tier the cascade actually used to satisfy the task. */
  finalTier: Tier;
  /** How many times the cascade had to escalate (>0 means under-estimated). */
  escalations: number;
  /** Whether the task ultimately passed verification. */
  passed: boolean;
}

export class DifficultyEstimator {
  private readonly cache = new Map<string, Estimate>();

  constructor(private readonly deps: DifficultyEstimatorDeps = {}) {}

  /** Estimate difficulty + task type for a goal. Cached per (goal, signals). */
  estimate(goal: string, signals: DifficultySignals = {}): Estimate {
    const key = this.cacheKey(goal, signals);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const text = normalize(goal);
    const taskType = classify(text);
    const reasons: string[] = [`type=${taskType}`];
    let d = BASE[taskType];

    if (BREADTH.test(text)) {
      d += 0.15;
      reasons.push('breadth-language');
    }
    const words = text ? text.split(' ').length : 0;
    if (words > 40) {
      d += 0.05;
      reasons.push('long-goal');
    }
    if (signals.scopeFiles !== undefined) {
      if (signals.scopeFiles > 3) {
        d += 0.15;
        reasons.push(`scope=${signals.scopeFiles}`);
      } else if (signals.scopeFiles > 1) {
        d += 0.07;
        reasons.push(`scope=${signals.scopeFiles}`);
      }
    }
    if (signals.localizeConfidence !== undefined) {
      if (signals.localizeConfidence < 0.4) {
        d += 0.15;
        reasons.push('low-localization');
      } else if (signals.localizeConfidence < 0.6) {
        d += 0.07;
        reasons.push('weak-localization');
      }
    }

    d = Math.min(1, Math.max(0, d));
    const estimate: Estimate = { d, level: levelFromD(d), taskType, reasons };
    this.cache.set(key, estimate);
    this.deps.log?.('difficulty_estimate', { goal: text, d, level: estimate.level, taskType });
    return estimate;
  }

  /**
   * Fold the realised outcome back in and log DRIFT when the cascade climbed
   * above (or settled below) the predicted level. The estimate itself is not
   * mutated — a learned estimator (Phase 12 bandit) consumes these records.
   */
  observe(goal: string, outcome: DifficultyOutcome, signals: DifficultySignals = {}): number {
    const predicted = this.cache.get(this.cacheKey(goal, signals));
    if (!predicted) {
      return 0;
    }
    const observedIdx = TIER_INDEX[outcome.finalTier];
    const predictedIdx = TIER_INDEX[predicted.level];
    const drift = observedIdx - predictedIdx;
    if (drift !== 0) {
      this.deps.log?.('difficulty_drift', {
        goal: normalize(goal),
        predicted: predicted.level,
        observed: outcome.finalTier,
        drift,
        escalations: outcome.escalations,
        passed: outcome.passed,
      });
    }
    return drift;
  }

  private cacheKey(goal: string, signals: DifficultySignals): string {
    return `${normalize(goal)}|${signals.scopeFiles ?? ''}|${signals.localizeConfidence ?? ''}`;
  }
}

import { RoutedCandidate } from '../router/types';
import { encode } from './features';
import { ArmState, LinUCB } from './LinUCB';
import { ConsumptionModel } from './ConsumptionModel';
import { DEFAULT_PRIOR, FEATURE_DIM, HUMAN_WEIGHT, LADDER_WEIGHT, LearnContext } from './types';

// The competence learner: given the Phase 11 routed candidates, pick the arm
// maximising (UCB − costWeight·pricedCost). UCB rewards models that have done
// well in this context (task-type/difficulty/stage); the cost term keeps it
// budget-coupled. Rewards come from the verification ladder (pass/fail) and,
// much more strongly, from human ACCEPT/REJECT — which also writes a lesson to
// repo memory so the rationale is durable.

export interface ArmScoreDetail {
  arm: string;
  ucb: number;
  mean: number;
  penalty: number;
  /** ucb − penalty — the value being maximised. */
  value: number;
}

export interface SelectResult {
  chosen?: RoutedCandidate;
  scores: ArmScoreDetail[];
}

export interface SelectOptions {
  /** Weight on the pricedCost penalty. Raise it under budget pressure. */
  costWeight?: number;
}

export interface CompetenceLearnerDeps {
  /** Benchmark competence priors per arm id (warm start). */
  priors?: (arm: string) => number | undefined;
  /** Persist an arm after an update (BanditStore in the host). */
  onUpdate?: (arm: string, state: ArmState, rho: number | undefined) => void;
  /** Write a durable lesson from human feedback (repo memory). */
  lesson?: (text: string) => void;
  /** Forgetting factor (sliding window). 1 = no forgetting. */
  gamma?: number;
  bandit?: LinUCB;
  consumption?: ConsumptionModel;
}

export class CompetenceLearner {
  private readonly bandit: LinUCB;
  private readonly consumption: ConsumptionModel;
  private readonly defaultCostWeight = 1;

  constructor(private readonly deps: CompetenceLearnerDeps = {}) {
    this.bandit = deps.bandit ?? new LinUCB({ dim: FEATURE_DIM });
    this.consumption = deps.consumption ?? new ConsumptionModel();
  }

  /** Choose among routed candidates, warm-starting any unseen arm from priors. */
  select(context: LearnContext, candidates: RoutedCandidate[], opts: SelectOptions = {}): SelectResult {
    const x = encode(context);
    const costWeight = opts.costWeight ?? this.defaultCostWeight;
    const scores: ArmScoreDetail[] = [];

    for (const c of candidates) {
      const arm = armId(c);
      if (!this.bandit.has(arm)) {
        this.bandit.warmStart(arm, this.priorFor(arm));
      }
      const s = this.bandit.score(arm, x);
      const penalty = costWeight * c.cost;
      scores.push({ arm, ucb: s.ucb, mean: s.mean, penalty, value: s.ucb - penalty });
    }

    let chosen: RoutedCandidate | undefined;
    let best = -Infinity;
    for (let i = 0; i < candidates.length; i++) {
      if (scores[i].value > best) {
        best = scores[i].value;
        chosen = candidates[i];
      }
    }
    return { chosen, scores };
  }

  /** Reward from the verification ladder (binary pass/fail). */
  recordLadder(context: LearnContext, candidate: RoutedCandidate, passed: boolean): void {
    this.reward(armId(candidate), context, passed ? 1 : 0, LADDER_WEIGHT);
  }

  /** Reward from a human ACCEPT/REJECT — weighted heavily; writes a lesson. */
  recordHuman(context: LearnContext, candidate: RoutedCandidate, accepted: boolean): void {
    const arm = armId(candidate);
    this.reward(arm, context, accepted ? 1 : 0, HUMAN_WEIGHT);
    this.deps.lesson?.(
      `${accepted ? 'ACCEPT' : 'REJECT'} ${arm} for ${context.taskType}/${context.role} ` +
        `at difficulty ${context.difficulty.toFixed(2)}`,
    );
  }

  /** Fold observed token usage into the consumption regressor for an arm. */
  observeConsumption(candidate: RoutedCandidate, tokens: number): void {
    const arm = armId(candidate);
    const rho = this.consumption.observe(arm, tokens);
    this.deps.onUpdate?.(arm, this.bandit.export(arm)!, rho);
  }

  /** Expected token consumption for an arm (rho), used to refine pricedCost. */
  expectedConsumption(candidate: RoutedCandidate, fallback: number): number {
    return this.consumption.expected(armId(candidate), fallback);
  }

  /** Hydrate persisted arm state (host calls this on startup). */
  restore(arm: string, state: ArmState, rho?: number): void {
    this.bandit.import(arm, state);
    if (rho !== undefined) {
      this.consumption.set(arm, rho);
    }
  }

  private reward(arm: string, context: LearnContext, value: number, weight: number): void {
    if (!this.bandit.has(arm)) {
      this.bandit.warmStart(arm, this.priorFor(arm));
    }
    if (this.deps.gamma !== undefined && this.deps.gamma < 1) {
      this.bandit.forget(arm, this.deps.gamma);
    }
    this.bandit.update(arm, encode(context), value, weight);
    this.deps.onUpdate?.(arm, this.bandit.export(arm)!, this.consumption.get(arm));
  }

  private priorFor(arm: string): number {
    return this.deps.priors?.(arm) ?? DEFAULT_PRIOR;
  }
}

/** Stable arm identity: provider/model (a model is the bandit arm). */
export function armId(c: RoutedCandidate): string {
  return `${c.model.providerId}/${c.model.modelId}`;
}

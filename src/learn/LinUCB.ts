import { addOuter, dot, identity, Mat, quadFormInv, solve, Vec } from './linalg';

// Disjoint LinUCB (one linear model per arm). For arm a with ridge matrix A and
// vector b: theta = A⁻¹ b, predicted competence = theta·x, and an optimism bonus
// alpha·sqrt(xᵀA⁻¹x) that shrinks as the arm is tried more in similar contexts.
// The selector maximises (UCB − cost penalty), so exploration is cost-coupled.
//
// Warm-start folds a benchmark prior in as a pseudo-observation on the bias
// feature; a forgetting factor gives a sliding window so stale competence decays.

export interface ArmState {
  A: Mat;
  b: Vec;
  n: number;
}

export interface ArmScore {
  /** theta·x — the predicted mean competence. */
  mean: number;
  /** alpha·sqrt(xᵀA⁻¹x) — the exploration bonus. */
  width: number;
  /** mean + width — optimism, used to EXPLORE (selection). */
  ucb: number;
  /** mean − width — the conservative Lower Confidence Bound, used to ASSIGN
   *  (the solver maximises LCB so a council only seats models we trust). */
  lcb: number;
}

export interface LinUCBConfig {
  dim: number;
  /** Exploration weight (higher = more optimistic about untried arms). */
  alpha?: number;
  /** Ridge prior — A starts at lambda·I. */
  lambda?: number;
}

export class LinUCB {
  private readonly arms = new Map<string, ArmState>();
  private readonly dim: number;
  private readonly alpha: number;
  private readonly lambda: number;

  constructor(cfg: LinUCBConfig) {
    this.dim = cfg.dim;
    this.alpha = cfg.alpha ?? 1.0;
    this.lambda = cfg.lambda ?? 1.0;
  }

  has(arm: string): boolean {
    return this.arms.has(arm);
  }

  private ensure(arm: string): ArmState {
    let s = this.arms.get(arm);
    if (!s) {
      s = { A: identity(this.dim, this.lambda), b: new Array(this.dim).fill(0), n: 0 };
      this.arms.set(arm, s);
    }
    return s;
  }

  /** Seed an arm's competence prior (e.g. a benchmark score) before any data. */
  warmStart(arm: string, prior: number, strength = 1): void {
    const s = this.ensure(arm);
    if (s.n > 0) {
      return; // never overwrite learned data with a prior
    }
    const e0 = new Array(this.dim).fill(0);
    e0[0] = 1; // bias feature
    addOuter(s.A, e0, strength);
    s.b[0] += strength * prior;
  }

  /** theta = A⁻¹ b for an arm. */
  theta(arm: string): Vec {
    const s = this.ensure(arm);
    return solve(s.A, s.b);
  }

  /** Score one arm in context x. */
  score(arm: string, x: Vec): ArmScore {
    const s = this.ensure(arm);
    const mean = dot(solve(s.A, s.b), x);
    const width = this.alpha * Math.sqrt(quadFormInv(s.A, x));
    return { mean, width, ucb: mean + width, lcb: mean - width };
  }

  /** Fold an observed reward in: A += x xᵀ, b += reward·x. `weight` repeats it. */
  update(arm: string, x: Vec, reward: number, weight = 1): void {
    const s = this.ensure(arm);
    addOuter(s.A, x, weight);
    for (let i = 0; i < this.dim; i++) {
      s.b[i] += weight * reward * x[i];
    }
    s.n += 1;
  }

  /**
   * Forgetting factor gamma∈(0,1] for drift: A ← gamma·A + (1−gamma)·lambda·I,
   * b ← gamma·b. gamma=1 is no forgetting; smaller weights recent data more.
   */
  forget(arm: string, gamma: number): void {
    const s = this.arms.get(arm);
    if (!s) {
      return;
    }
    const keep = (1 - gamma) * this.lambda;
    for (let i = 0; i < this.dim; i++) {
      s.b[i] *= gamma;
      for (let j = 0; j < this.dim; j++) {
        s.A[i][j] *= gamma;
      }
      s.A[i][i] += keep;
    }
  }

  /** Snapshot for persistence. */
  export(arm: string): (ArmState & { dim: number }) | undefined {
    const s = this.arms.get(arm);
    return s ? { dim: this.dim, A: s.A, b: s.b, n: s.n } : undefined;
  }

  /** Restore a persisted arm (replaces any in-memory state). */
  import(arm: string, state: ArmState): void {
    this.arms.set(arm, { A: state.A.map((r) => [...r]), b: [...state.b], n: state.n });
  }
}

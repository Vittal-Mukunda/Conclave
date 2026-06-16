import { SqlDb } from '../storage/SqlDb';
import { ConclaveError } from '../errors/ErrorReport';
import { CostMode } from './CostPolicy';

// The spend guard. When any paid key is present it enforces, in order:
//   COST-1 free ceiling hit         -> offer add key / add paid / wait
//   COST-2 paid spend nears the cap -> warn ONCE at 50/80/100%
//   COST-3 cap reached              -> HARD STOP (no paid call may issue)
//   COST-4 expensive single task    -> pre-flight estimate + explicit confirm
// All state (cap, running spend, mode, last warned threshold) is persisted in the
// single-row `budget` table so guards survive a reload. Invariant: spend cap is
// never exceeded.

export type WarnLevel = 0 | 50 | 80 | 100;

const THRESHOLDS: readonly WarnLevel[] = [50, 80, 100];

/** Above this estimated $, a single task needs explicit confirmation (COST-4). */
export const DEFAULT_CONFIRM_THRESHOLD_USD = 0.5;

export interface BudgetState {
  capUsd: number | null;
  spentUsd: number;
  mode: CostMode;
  warnedLevel: WarnLevel;
}

export interface PreflightDecision {
  /** False = HARD STOP: issuing would exceed the cap (COST-3). */
  allowed: boolean;
  /** True = caller must get explicit user confirmation first (COST-4). */
  requiresConfirm: boolean;
  estimatedUsd: number;
  /** A surfaceable error/warning when the call is blocked or needs a confirm. */
  report?: ConclaveError;
}

interface BudgetRow {
  cap_usd: number | null;
  spent_usd: number;
  mode: string;
  warned_level: number;
}

export class BudgetManager {
  constructor(
    private readonly db: SqlDb,
    private readonly confirmThresholdUsd = DEFAULT_CONFIRM_THRESHOLD_USD,
  ) {}

  state(): BudgetState {
    const row = this.db.get<BudgetRow>('SELECT cap_usd, spent_usd, mode, warned_level FROM budget WHERE id = 1');
    return {
      capUsd: row?.cap_usd ?? null,
      spentUsd: row?.spent_usd ?? 0,
      mode: (row?.mode as CostMode) ?? 'free-only',
      warnedLevel: (row?.warned_level as WarnLevel) ?? 0,
    };
  }

  setCap(capUsd: number | null): void {
    // Lowering the cap can re-arm warnings the user should see again.
    this.db.run('UPDATE budget SET cap_usd = ?, warned_level = 0 WHERE id = 1', [capUsd]);
  }

  setMode(mode: CostMode): void {
    this.db.run('UPDATE budget SET mode = ? WHERE id = 1', [mode]);
  }

  /** Reset the running spend (e.g. new billing period). */
  resetSpend(now = Date.now()): void {
    this.db.run('UPDATE budget SET spent_usd = 0, warned_level = 0, period_start = ? WHERE id = 1', [now]);
  }

  /** True once spend has reached the cap — gates every paid candidate (COST-3). */
  capReached(): boolean {
    const { capUsd, spentUsd } = this.state();
    return capUsd !== null && spentUsd >= capUsd;
  }

  /** Percent of cap consumed (0 when uncapped). */
  percentUsed(): number {
    const { capUsd, spentUsd } = this.state();
    if (capUsd === null || capUsd <= 0) {
      return 0;
    }
    return (spentUsd / capUsd) * 100;
  }

  /**
   * Fold a real paid spend into the running total. Returns the warning threshold
   * newly crossed (COST-2), or undefined. Each threshold warns at most once.
   */
  record(spendUsd: number): { warn?: WarnLevel } {
    if (spendUsd <= 0) {
      return {};
    }
    const before = this.state();
    const spent = before.spentUsd + spendUsd;
    this.db.run('UPDATE budget SET spent_usd = ? WHERE id = 1', [spent]);
    if (before.capUsd === null || before.capUsd <= 0) {
      return {};
    }
    const pct = (spent / before.capUsd) * 100;
    let crossed: WarnLevel | undefined;
    for (const t of THRESHOLDS) {
      if (pct >= t && before.warnedLevel < t) {
        crossed = t;
      }
    }
    if (crossed !== undefined) {
      this.db.run('UPDATE budget SET warned_level = ? WHERE id = 1', [crossed]);
    }
    return { warn: crossed };
  }

  /**
   * Pre-flight a proposed paid task. HARD STOP (COST-3) if it would exceed the
   * cap; otherwise flag COST-4 confirm for an expensive single task.
   */
  preflight(estimatedUsd: number): PreflightDecision {
    const { capUsd, spentUsd } = this.state();
    if (capUsd !== null && spentUsd + estimatedUsd > capUsd) {
      return {
        allowed: false,
        requiresConfirm: false,
        estimatedUsd,
        report: this.capReachedReport(estimatedUsd),
      };
    }
    if (estimatedUsd >= this.confirmThresholdUsd) {
      return {
        allowed: true,
        requiresConfirm: true,
        estimatedUsd,
        report: this.confirmReport(estimatedUsd),
      };
    }
    return { allowed: true, requiresConfirm: false, estimatedUsd };
  }

  // ---- surfaceable reports (caller throws or shows) ----

  /** COST-1: a free tier hit its ceiling. */
  freeCeilingReport(detail = 'Free-tier quota is exhausted for now.'): ConclaveError {
    return new ConclaveError({
      category: 'cost',
      severity: 'warning',
      code: 'COST-1',
      title: 'Free quota reached',
      detail,
      canRetry: true,
      recoveryActions: [
        { label: 'Add another free key', kind: 'add', command: 'conclave.manageKeys' },
        { label: 'Add paid key', kind: 'add', command: 'conclave.manageKeys' },
        { label: 'Wait for reset', kind: 'wait' },
      ],
    });
  }

  /** COST-2: paid spend is nearing the cap. */
  warnReport(level: WarnLevel): ConclaveError {
    const { spentUsd, capUsd } = this.state();
    return new ConclaveError({
      category: 'cost',
      severity: 'warning',
      code: 'COST-2',
      title: `Spend at ${level}% of cap`,
      detail: `Used $${spentUsd.toFixed(2)} of $${(capUsd ?? 0).toFixed(2)}.`,
      canRetry: false,
      recoveryActions: [
        { label: 'Raise cap', kind: 'configure', command: 'conclave.setBudget' },
        { label: 'Switch to free', kind: 'switch', command: 'conclave.setBudget' },
      ],
    });
  }

  /** COST-3: the cap is (or would be) reached — hard stop. */
  capReachedReport(estimatedUsd = 0): ConclaveError {
    const { spentUsd, capUsd } = this.state();
    const detail =
      estimatedUsd > 0
        ? `This task (~$${estimatedUsd.toFixed(2)}) would exceed your $${(capUsd ?? 0).toFixed(2)} cap (used $${spentUsd.toFixed(2)}).`
        : `Spend cap of $${(capUsd ?? 0).toFixed(2)} reached.`;
    return new ConclaveError({
      category: 'cost',
      severity: 'error',
      code: 'COST-3',
      title: 'Spend cap reached',
      detail,
      canRetry: false,
      recoveryActions: [
        { label: 'Raise cap', kind: 'configure', command: 'conclave.setBudget' },
        { label: 'Switch to free', kind: 'switch', command: 'conclave.setBudget' },
      ],
    });
  }

  /** COST-4: an expensive single task needs confirmation. */
  confirmReport(estimatedUsd: number): ConclaveError {
    return new ConclaveError({
      category: 'cost',
      severity: 'warning',
      code: 'COST-4',
      title: 'Confirm an expensive task',
      detail: `This task is estimated to cost ~$${estimatedUsd.toFixed(2)} in paid usage.`,
      canRetry: false,
      recoveryActions: [
        { label: 'Proceed', kind: 'continue' },
        { label: 'Switch to free', kind: 'switch', command: 'conclave.setBudget' },
        { label: 'Cancel', kind: 'dismiss' },
      ],
    });
  }
}

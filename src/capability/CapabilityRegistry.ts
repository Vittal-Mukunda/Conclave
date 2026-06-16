import { SqlDb } from '../storage/SqlDb';
import { Provider } from '../providers/types';
import { defaultLimitsFor } from '../scheduler/rateLimits';

export interface ModelRow {
  provider: string;
  model: string;
  kind: string | null;
  published_rpm: number | null;
  published_tpm: number | null;
  published_rpd: number | null;
  probed_rpm: number | null;
  probed_tpm: number | null;
  latency_ms: number;
  throughput_tps: number;
  success: number;
  errors: number;
  rate_limits: number;
  benchmark_prior: number;
  available: number;
  last_probed: number;
  input_price: number;
  output_price: number;
}

export type QuotaWindow = 'minute' | 'day';

export interface QuotaState {
  used: number;
  remaining: number;
  resetAt: number;
}

const LATENCY_ALPHA = 0.2; // EWMA smoothing for rolling latency.

/**
 * Persistent per-(provider,model) registry: published/probed limits, rolling
 * latency/throughput, success/error/429 counts, availability, prices, and a
 * persisted quota meter with correct lazy resets.
 */
export class CapabilityRegistry {
  constructor(private readonly db: SqlDb) {}

  /** Insert built-in models without clobbering accumulated stats on restart. */
  seed(providers: Provider[]): void {
    for (const p of providers) {
      const limits = defaultLimitsFor(p);
      for (const m of p.defaultModels) {
        this.db.run(
          `INSERT OR IGNORE INTO model
             (provider, model, kind, published_rpm, published_tpm, published_rpd,
              input_price, output_price, available, benchmark_prior)
           VALUES (?,?,?,?,?,?,?,?,1,0)`,
          [
            p.id,
            m.id,
            p.kind,
            limits.rpm ?? null,
            limits.tpm ?? null,
            limits.rpd ?? null,
            m.inputPricePerMTok ?? 0,
            m.outputPricePerMTok ?? 0,
          ],
        );
      }
    }
  }

  getModel(provider: string, model: string): ModelRow | undefined {
    return this.db.get<ModelRow>('SELECT * FROM model WHERE provider = ? AND model = ?', [provider, model]);
  }

  listModels(): ModelRow[] {
    return this.db.all<ModelRow>('SELECT * FROM model ORDER BY provider, model');
  }

  /** Update availability + latency from a live capacity probe. */
  setProbe(provider: string, model: string, info: { available: boolean; latencyMs?: number; at: number }): void {
    const existing = this.getModel(provider, model);
    if (!existing) {
      this.db.run(
        `INSERT OR IGNORE INTO model (provider, model, available, last_probed) VALUES (?,?,?,?)`,
        [provider, model, info.available ? 1 : 0, info.at],
      );
    }
    const latency = info.latencyMs ?? existing?.latency_ms ?? 0;
    this.db.run('UPDATE model SET available = ?, last_probed = ?, latency_ms = ? WHERE provider = ? AND model = ?', [
      info.available ? 1 : 0,
      info.at,
      latency,
      provider,
      model,
    ]);
  }

  /** Fold a completed call into the rolling stats. */
  recordOutcome(
    provider: string,
    model: string,
    outcome: { ok: boolean; rateLimited?: boolean; latencyMs?: number; tokensOut?: number },
  ): void {
    const row = this.getModel(provider, model);
    if (!row) {
      this.db.run('INSERT OR IGNORE INTO model (provider, model) VALUES (?,?)', [provider, model]);
    }
    const prev = this.getModel(provider, model);
    const latency =
      outcome.latencyMs !== undefined && prev
        ? prev.latency_ms === 0
          ? outcome.latencyMs
          : prev.latency_ms * (1 - LATENCY_ALPHA) + outcome.latencyMs * LATENCY_ALPHA
        : prev?.latency_ms ?? 0;
    const tps =
      outcome.latencyMs && outcome.latencyMs > 0 && outcome.tokensOut
        ? outcome.tokensOut / (outcome.latencyMs / 1000)
        : prev?.throughput_tps ?? 0;

    this.db.run(
      `UPDATE model SET
         success = success + ?,
         errors = errors + ?,
         rate_limits = rate_limits + ?,
         latency_ms = ?,
         throughput_tps = ?
       WHERE provider = ? AND model = ?`,
      [
        outcome.ok ? 1 : 0,
        outcome.ok ? 0 : 1,
        outcome.rateLimited ? 1 : 0,
        latency,
        tps,
        provider,
        model,
      ],
    );
  }

  // ---- persisted quota meter (survives reloads; lazy resets) ----

  private windowMs(window: QuotaWindow): number {
    return window === 'minute' ? 60_000 : 86_400_000;
  }

  /** Consume `amount` from a window, resetting first if the window elapsed. */
  consumeQuota(
    provider: string,
    model: string,
    window: QuotaWindow,
    amount: number,
    now: number,
    limit?: number,
  ): QuotaState {
    const row = this.db.get<{ used: number; reset_at: number; lim: number | null }>(
      'SELECT used, reset_at, lim FROM quota WHERE provider = ? AND model = ? AND window = ?',
      [provider, model, window],
    );
    let used = row?.used ?? 0;
    let resetAt = row?.reset_at ?? 0;
    if (!row || now >= resetAt) {
      used = 0;
      resetAt = now + this.windowMs(window);
    }
    used += amount;
    const lim = limit ?? row?.lim ?? null;
    this.db.run(
      `INSERT INTO quota (provider, model, window, used, reset_at, lim) VALUES (?,?,?,?,?,?)
       ON CONFLICT(provider, model, window) DO UPDATE SET used = excluded.used, reset_at = excluded.reset_at, lim = excluded.lim`,
      [provider, model, window, used, resetAt, lim],
    );
    return { used, remaining: lim !== null ? Math.max(0, lim - used) : Number.POSITIVE_INFINITY, resetAt };
  }

  /** Read remaining quota, applying a lazy reset if the window has elapsed. */
  remainingQuota(provider: string, model: string, window: QuotaWindow, now: number): QuotaState {
    const row = this.db.get<{ used: number; reset_at: number; lim: number | null }>(
      'SELECT used, reset_at, lim FROM quota WHERE provider = ? AND model = ? AND window = ?',
      [provider, model, window],
    );
    if (!row || now >= row.reset_at) {
      return { used: 0, remaining: row?.lim ?? Number.POSITIVE_INFINITY, resetAt: now + this.windowMs(window) };
    }
    return {
      used: row.used,
      remaining: row.lim !== null ? Math.max(0, row.lim - row.used) : Number.POSITIVE_INFINITY,
      resetAt: row.reset_at,
    };
  }
}

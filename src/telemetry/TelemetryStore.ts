import { SqlDb } from '../storage/SqlDb';

export interface CallRecord {
  ts: number;
  provider: string;
  model: string;
  stage?: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  ok: boolean;
  status: string;
  costUsd: number;
  savedUsd: number;
  estimated: boolean;
}

export interface CostTotals {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  spendUsd: number;
  savedUsd: number;
}

export interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  tokens: number;
  spendUsd: number;
  savedUsd: number;
}

/** Per-call telemetry + cost aggregation, persisted in SQLite. */
export class TelemetryStore {
  constructor(private readonly db: SqlDb) {}

  record(rec: CallRecord): void {
    this.db.run(
      `INSERT INTO call
         (ts, provider, model, stage, tokens_in, tokens_out, latency_ms, ok, status, cost_usd, saved_usd, estimated)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        rec.ts,
        rec.provider,
        rec.model,
        rec.stage ?? null,
        rec.tokensIn,
        rec.tokensOut,
        rec.latencyMs,
        rec.ok ? 1 : 0,
        rec.status,
        rec.costUsd,
        rec.savedUsd,
        rec.estimated ? 1 : 0,
      ],
    );
  }

  recent(limit = 50): CallRecord[] {
    const rows = this.db.all<{
      ts: number;
      provider: string;
      model: string;
      stage: string | null;
      tokens_in: number;
      tokens_out: number;
      latency_ms: number;
      ok: number;
      status: string;
      cost_usd: number;
      saved_usd: number;
      estimated: number;
    }>('SELECT * FROM call ORDER BY id DESC LIMIT ?', [limit]);
    return rows.map((r) => ({
      ts: r.ts,
      provider: r.provider,
      model: r.model,
      stage: r.stage ?? undefined,
      tokensIn: r.tokens_in,
      tokensOut: r.tokens_out,
      latencyMs: r.latency_ms,
      ok: r.ok === 1,
      status: r.status,
      costUsd: r.cost_usd,
      savedUsd: r.saved_usd,
      estimated: r.estimated === 1,
    }));
  }

  totals(): CostTotals {
    const row = this.db.get<{
      calls: number;
      tin: number;
      tout: number;
      spend: number;
      saved: number;
    }>(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(tokens_in),0) AS tin,
              COALESCE(SUM(tokens_out),0) AS tout,
              COALESCE(SUM(cost_usd),0) AS spend,
              COALESCE(SUM(saved_usd),0) AS saved
       FROM call`,
    );
    return {
      calls: row?.calls ?? 0,
      tokensIn: row?.tin ?? 0,
      tokensOut: row?.tout ?? 0,
      spendUsd: row?.spend ?? 0,
      savedUsd: row?.saved ?? 0,
    };
  }

  /** Per-model usage ranking, busiest first ("which used most"). */
  rankings(limit = 10): ModelUsage[] {
    return this.db
      .all<{
        provider: string;
        model: string;
        calls: number;
        tokens: number;
        spend: number;
        saved: number;
      }>(
        `SELECT provider, model,
                COUNT(*) AS calls,
                COALESCE(SUM(tokens_in + tokens_out),0) AS tokens,
                COALESCE(SUM(cost_usd),0) AS spend,
                COALESCE(SUM(saved_usd),0) AS saved
         FROM call
         GROUP BY provider, model
         ORDER BY tokens DESC
         LIMIT ?`,
        [limit],
      )
      .map((r) => ({
        provider: r.provider,
        model: r.model,
        calls: r.calls,
        tokens: r.tokens,
        spendUsd: r.spend,
        savedUsd: r.saved,
      }));
  }
}

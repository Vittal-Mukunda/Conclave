import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { TelemetryStore, CallRecord } from '../../src/telemetry/TelemetryStore';
import { CostCalculator } from '../../src/cost/CostCalculator';
import { ProviderRegistry } from '../../src/providers/registry';

function rec(over: Partial<CallRecord>): CallRecord {
  return {
    ts: 1,
    provider: 'groq',
    model: 'm',
    tokensIn: 10,
    tokensOut: 5,
    latencyMs: 100,
    ok: true,
    status: 'ok',
    costUsd: 0,
    savedUsd: 0,
    estimated: false,
    ...over,
  };
}

describe('TelemetryStore', () => {
  it('records calls and totals spend (paid) + saved (free) separately', () => {
    const t = new TelemetryStore(Storage.memory().db);
    t.record(rec({ provider: 'groq', model: 'm', savedUsd: 0.001 }));
    t.record(rec({ provider: 'openai', model: 'gpt', tokensIn: 100, tokensOut: 50, costUsd: 0.05 }));
    const totals = t.totals();
    expect(totals.calls).toBe(2);
    expect(totals.spendUsd).toBeCloseTo(0.05);
    expect(totals.savedUsd).toBeCloseTo(0.001);
  });

  it('ranks models by token usage ("which used most")', () => {
    const t = new TelemetryStore(Storage.memory().db);
    t.record(rec({ model: 'small', tokensIn: 5, tokensOut: 5 }));
    t.record(rec({ model: 'big', tokensIn: 500, tokensOut: 500 }));
    const ranks = t.rankings();
    expect(ranks[0].model).toBe('big');
  });

  it('returns recent calls newest-first', () => {
    const t = new TelemetryStore(Storage.memory().db);
    t.record(rec({ ts: 1, model: 'a' }));
    t.record(rec({ ts: 2, model: 'b' }));
    expect(t.recent(10)[0].model).toBe('b');
  });
});

describe('CostCalculator', () => {
  const cost = new CostCalculator(new ProviderRegistry());

  it('computes real spend for a paid model', () => {
    const b = cost.price('openai', 'gpt-4.1', 1_000_000, 1_000_000); // $2 in + $8 out
    expect(b.paid).toBe(true);
    expect(b.spendUsd).toBeCloseTo(10);
    expect(b.savedUsd).toBe(0);
  });

  it('computes money saved for a free model', () => {
    const b = cost.price('groq', 'llama-3.3-70b-versatile', 1_000_000, 1_000_000);
    expect(b.paid).toBe(false);
    expect(b.spendUsd).toBe(0);
    expect(b.savedUsd).toBeCloseTo(18); // reference $3 in + $15 out
  });
});

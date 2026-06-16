import { describe, it, expect } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { BudgetManager } from '../../src/cost/BudgetManager';

function mgr(confirm?: number): BudgetManager {
  return new BudgetManager(Storage.memory().db, confirm);
}

describe('BudgetManager', () => {
  it('defaults: uncapped, free-only, zero spend', () => {
    const b = mgr();
    expect(b.state()).toEqual({ capUsd: null, spentUsd: 0, mode: 'free-only', warnedLevel: 0 });
    expect(b.capReached()).toBe(false);
  });

  it('persists cap, mode, and spend across new instances on the same db', () => {
    const db = Storage.memory().db;
    const b1 = new BudgetManager(db);
    b1.setCap(10);
    b1.setMode('free-first');
    b1.record(3);
    const b2 = new BudgetManager(db);
    expect(b2.state()).toMatchObject({ capUsd: 10, spentUsd: 3, mode: 'free-first' });
  });

  it('COST-2: warns once at each crossed threshold (50/80/100)', () => {
    const b = mgr();
    b.setCap(10);
    expect(b.record(4).warn).toBeUndefined(); // 40%
    expect(b.record(1.5).warn).toBe(50); // 55%
    expect(b.record(0.5).warn).toBeUndefined(); // 60%, no new threshold
    expect(b.record(2.5).warn).toBe(80); // 85%
    expect(b.record(2).warn).toBe(100); // 105%
  });

  it('COST-3: capReached once spend hits the cap', () => {
    const b = mgr();
    b.setCap(5);
    b.record(5);
    expect(b.capReached()).toBe(true);
  });

  it('COST-3: preflight HARD STOP when a task would exceed the cap', () => {
    const b = mgr();
    b.setCap(5);
    b.record(4);
    const d = b.preflight(2); // 4 + 2 > 5
    expect(d.allowed).toBe(false);
    expect(d.report?.code).toBe('COST-3');
  });

  it('COST-4: expensive task requires confirm but is allowed under cap', () => {
    const b = mgr(0.5);
    b.setCap(100);
    const d = b.preflight(0.75);
    expect(d.allowed).toBe(true);
    expect(d.requiresConfirm).toBe(true);
    expect(d.report?.code).toBe('COST-4');
  });

  it('cheap task: allowed, no confirm', () => {
    const b = mgr(0.5);
    b.setCap(100);
    const d = b.preflight(0.01);
    expect(d).toMatchObject({ allowed: true, requiresConfirm: false });
    expect(d.report).toBeUndefined();
  });

  it('COST-1: free ceiling report carries add-key/add-paid/wait actions', () => {
    const r = mgr().freeCeilingReport();
    expect(r.code).toBe('COST-1');
    expect(r.recoveryActions.map((a) => a.kind)).toEqual(['add', 'add', 'wait']);
  });

  it('lowering the cap re-arms warnings; resetSpend clears spend', () => {
    const b = mgr();
    b.setCap(10);
    b.record(6); // crosses 50
    b.setCap(8); // re-arm
    expect(b.state().warnedLevel).toBe(0);
    b.resetSpend();
    expect(b.state().spentUsd).toBe(0);
  });

  it('uncapped: never warns, never blocks', () => {
    const b = mgr();
    expect(b.record(1000).warn).toBeUndefined();
    expect(b.preflight(1000).allowed).toBe(true);
    expect(b.capReached()).toBe(false);
  });
});

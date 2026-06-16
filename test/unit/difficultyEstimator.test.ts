import { describe, it, expect, vi } from 'vitest';
import { DifficultyEstimator } from '../../src/router/DifficultyEstimator';

describe('DifficultyEstimator', () => {
  it('scores a rename/format goal as mechanical and very low difficulty', () => {
    const est = new DifficultyEstimator();
    const e = est.estimate('rename the variable foo to bar and reformat the file');
    expect(e.taskType).toBe('mechanical');
    expect(e.level).toBe('L0');
    expect(e.d).toBeLessThan(0.25);
  });

  it('scores an architecture/concurrency goal as design and high difficulty', () => {
    const est = new DifficultyEstimator();
    const e = est.estimate('redesign the scheduler architecture to remove the race condition');
    expect(e.taskType).toBe('design');
    expect(e.level).toBe('L3');
    expect(e.d).toBeGreaterThanOrEqual(0.75);
  });

  it('classifies a refactor (high signal, not redesign) as refactor', () => {
    const est = new DifficultyEstimator();
    const e = est.estimate('refactor the auth module to use async tokens');
    expect(e.taskType).toBe('refactor');
  });

  it('classifies a fix as bugfix and an add as feature', () => {
    const est = new DifficultyEstimator();
    expect(est.estimate('fix the broken login flow').taskType).toBe('bugfix');
    expect(est.estimate('add a logout button to the navbar').taskType).toBe('feature');
  });

  it('breadth language and wide scope raise difficulty', () => {
    const est = new DifficultyEstimator();
    const narrow = est.estimate('fix the date parser');
    const broad = est.estimate('fix the date parser across the entire codebase', { scopeFiles: 9 });
    expect(broad.d).toBeGreaterThan(narrow.d);
  });

  it('low localization confidence raises difficulty', () => {
    const est = new DifficultyEstimator();
    const placed = est.estimate('add a cache layer', { localizeConfidence: 0.9 });
    const unplaced = est.estimate('add a cache layer', { localizeConfidence: 0.2 });
    expect(unplaced.d).toBeGreaterThan(placed.d);
  });

  it('caches per (goal, signals) — same object returned', () => {
    const est = new DifficultyEstimator();
    const a = est.estimate('fix the parser', { scopeFiles: 2 });
    const b = est.estimate('fix the parser', { scopeFiles: 2 });
    expect(b).toBe(a); // identity, not just equality
  });

  it('logs drift when the cascade climbed above the predicted level', () => {
    const log = vi.fn();
    const est = new DifficultyEstimator({ log });
    est.estimate('rename foo to bar'); // predicts L0
    const drift = est.observe('rename foo to bar', { finalTier: 'L2', escalations: 2, passed: true });
    expect(drift).toBe(2);
    expect(log).toHaveBeenCalledWith('difficulty_drift', expect.objectContaining({ predicted: 'L0', observed: 'L2', drift: 2 }));
  });

  it('does not log drift when realised tier matches the prediction', () => {
    const log = vi.fn();
    const est = new DifficultyEstimator({ log });
    est.estimate('redesign the distributed scheduler architecture'); // L3
    const drift = est.observe('redesign the distributed scheduler architecture', { finalTier: 'L3', escalations: 0, passed: true });
    expect(drift).toBe(0);
    expect(log).not.toHaveBeenCalledWith('difficulty_drift', expect.anything());
  });

  it('observe on an unseen goal is a no-op', () => {
    const est = new DifficultyEstimator();
    expect(est.observe('never estimated', { finalTier: 'L3', escalations: 1, passed: false })).toBe(0);
  });
});

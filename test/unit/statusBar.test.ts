import { describe, it, expect } from 'vitest';
import { formatStatusBar } from '../../src/statusbar/format';

describe('formatStatusBar', () => {
  it('free-only and idle: shows the mode, no dollar figure', () => {
    const { text } = formatStatusBar({ mode: 'free-only', spentUsd: 0, capUsd: null, activityKind: 'idle' });
    expect(text).toContain('conclave: free');
    expect(text).not.toMatch(/\$\d/); // no dollar amount when nothing spent and uncapped
    expect(text).toContain('$(zap)');
  });

  it('a running agent takes over the item with a spinner', () => {
    const { text, tooltip } = formatStatusBar({ mode: 'best-quality', spentUsd: 5, capUsd: 10, activityKind: 'working' });
    expect(text).toBe('$(sync~spin) conclave: working');
    expect(tooltip).toContain('running');
  });

  it('needs-input is distinct from working', () => {
    const { text } = formatStatusBar({ mode: 'free-only', spentUsd: 0, capUsd: null, activityKind: 'needs-input' });
    expect(text).toContain('needs input');
    expect(text).not.toContain('working');
  });

  it('with a cap, shows spend over cap', () => {
    const { text, tooltip } = formatStatusBar({ mode: 'best-quality', spentUsd: 2.5, capUsd: 10, activityKind: 'idle' });
    expect(text).toContain('conclave: best');
    expect(text).toContain('$2.50/$10.00');
    expect(tooltip).toContain('25% used');
  });

  it('switches to a warning icon at >= 80% of cap', () => {
    const { text } = formatStatusBar({ mode: 'free-first', spentUsd: 8, capUsd: 10, activityKind: 'idle' });
    expect(text).toContain('$(warning)');
    expect(text).not.toContain('$(zap)');
  });

  it('stays on the zap icon below the warn threshold', () => {
    const { text } = formatStatusBar({ mode: 'free-first', spentUsd: 7.99, capUsd: 10, activityKind: 'idle' });
    expect(text).toContain('$(zap)');
    expect(text).not.toContain('$(warning)');
  });

  it('done/idle after a run falls back to the cost glance', () => {
    const { text } = formatStatusBar({ mode: 'free-only', spentUsd: 0, capUsd: null, activityKind: 'done' });
    expect(text).toContain('conclave: free');
  });
});

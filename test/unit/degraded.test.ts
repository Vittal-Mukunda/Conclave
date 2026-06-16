import { describe, it, expect, vi } from 'vitest';
import { Capability, DegradedModeRegistry } from '../../src/degraded/DegradedModeRegistry';

describe('DegradedModeRegistry (degrade transitions expose consequence + action)', () => {
  it('transitions and exposes the right consequence and restore action', () => {
    const reg = new DegradedModeRegistry();
    reg.register(Capability.Sandbox, 'full');

    const change = vi.fn();
    reg.onChange(change);

    reg.set(Capability.Sandbox, 'unavailable', {
      consequence: 'Running without Docker — confidence is lowered.',
      restoreAction: { label: 'Install Docker', kind: 'install', url: 'https://docker.com' },
    });

    const status = reg.get(Capability.Sandbox)!;
    expect(status.state).toBe('unavailable');
    expect(status.consequence).toContain('confidence is lowered');
    expect(status.restoreAction?.label).toBe('Install Docker');

    expect(change).toHaveBeenCalledOnce();
    const arg = change.mock.calls[0][0];
    expect(arg.previous).toBe('full');
    expect(arg.current).toBe('unavailable');
    expect(arg.status.restoreAction?.kind).toBe('install');
  });

  it('does not emit when state is unchanged', () => {
    const reg = new DegradedModeRegistry();
    reg.register(Capability.Lsp, 'full');
    const change = vi.fn();
    reg.onChange(change);
    reg.set(Capability.Lsp, 'full');
    expect(change).not.toHaveBeenCalled();
  });

  it('isAvailable treats degraded as usable but unavailable as not', () => {
    const reg = new DegradedModeRegistry();
    reg.set(Capability.TreeSitter, 'degraded');
    expect(reg.isAvailable(Capability.TreeSitter)).toBe(true);
    reg.set(Capability.TreeSitter, 'unavailable');
    expect(reg.isAvailable(Capability.TreeSitter)).toBe(false);
  });
});

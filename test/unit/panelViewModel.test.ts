import { describe, it, expect } from 'vitest';
import {
  toErrorCard,
  connectivityView,
  degradedView,
  isSafePanelCommand,
} from '../../src/panel/PanelViewModel';
import { ErrorReport } from '../../src/errors/ErrorReport';
import { CapabilityStatus } from '../../src/degraded/DegradedModeRegistry';

function report(over: Partial<ErrorReport> = {}): ErrorReport {
  return {
    id: 'e1',
    timestamp: 0,
    severity: 'error',
    category: 'provider',
    title: 'Rate limited',
    detail: 'Too many requests.',
    recoveryActions: [{ label: 'Add key', kind: 'add', command: 'conclave.manageKeys' }],
    canRetry: true,
    ...over,
  };
}

describe('toErrorCard (UX-1)', () => {
  it('maps a report to a card with its actions', () => {
    const card = toErrorCard(report({ code: 'PROV-1', cause: 'HTTP 429' }));
    expect(card.title).toBe('Rate limited');
    expect(card.code).toBe('PROV-1');
    expect(card.cause).toBe('HTTP 429');
    expect(card.actions).toEqual([{ label: 'Add key', kind: 'add', command: 'conclave.manageKeys', url: undefined }]);
  });

  it('guarantees at least one action even if the report has none', () => {
    const card = toErrorCard(report({ recoveryActions: [] }));
    expect(card.actions.length).toBeGreaterThanOrEqual(1);
    expect(card.actions[0].kind).toBe('report'); // the universal Report-issue fallback
  });

  it('carries fallbackApplied + retryAfterMs through', () => {
    const card = toErrorCard(report({ fallbackApplied: 'switched to free tier', retryAfterMs: 5000 }));
    expect(card.fallbackApplied).toBe('switched to free tier');
    expect(card.retryAfterMs).toBe(5000);
  });
});

describe('connectivityView (UX-4)', () => {
  it('is silent when online with nothing queued', () => {
    expect(connectivityView(true, 0)).toEqual({ online: true, queued: 0, message: '' });
  });

  it('explains the offline state and queued count', () => {
    const vm = connectivityView(false, 3);
    expect(vm.online).toBe(false);
    expect(vm.message).toContain('3 actions queued');
  });

  it('singularises one queued action', () => {
    expect(connectivityView(false, 1).message).toContain('1 action queued');
  });

  it('announces resuming when back online with queued work', () => {
    expect(connectivityView(true, 2).message).toContain('resuming 2 queued');
  });
});

describe('degradedView', () => {
  const full: CapabilityStatus = { capability: 'network', state: 'full' };
  const sandbox: CapabilityStatus = {
    capability: 'sandbox',
    state: 'degraded',
    consequence: 'Process sandbox only.',
    restoreAction: { label: 'Start Docker', kind: 'start', command: 'conclave.openPanel' },
  };
  const paid: CapabilityStatus = { capability: 'paid', state: 'unavailable' };

  it('surfaces only the not-full capabilities, with restore actions', () => {
    const vm = degradedView([full, sandbox, paid]);
    expect(vm.items.map((i) => i.capability)).toEqual(['sandbox', 'paid']);
    expect(vm.items[0].restore?.label).toBe('Start Docker');
    expect(vm.items[1].restore).toBeUndefined();
  });

  it('is empty when everything is full', () => {
    expect(degradedView([full]).items).toEqual([]);
  });
});

describe('isSafePanelCommand (deny-by-default)', () => {
  it('accepts conclave commands', () => {
    expect(isSafePanelCommand('conclave.manageKeys')).toBe(true);
    expect(isSafePanelCommand('conclave.cancelAgent')).toBe(true);
  });

  it('rejects non-conclave or malformed commands', () => {
    expect(isSafePanelCommand('workbench.action.reloadWindow')).toBe(false);
    expect(isSafePanelCommand('conclave.evil; rm -rf')).toBe(false);
    expect(isSafePanelCommand('')).toBe(false);
    expect(isSafePanelCommand(undefined)).toBe(false);
    expect(isSafePanelCommand(42)).toBe(false);
  });
});

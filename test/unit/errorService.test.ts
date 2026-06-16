import { describe, it, expect, vi } from 'vitest';
import { ErrorService } from '../../src/errors/ErrorService';
import { ConclaveError } from '../../src/errors/ErrorReport';
import { SecretRedactor } from '../../src/logging/redaction';

function service(): ErrorService {
  return new ErrorService({ redactor: new SecretRedactor() });
}

describe('ErrorService (UX-1: every failure -> actionable ErrorReport)', () => {
  it('turns a plain Error into a valid report with >=1 action', () => {
    const r = service().report(new Error('boom'));
    expect(r.severity).toBe('error');
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.detail).toContain('boom');
    expect(r.recoveryActions.length).toBeGreaterThanOrEqual(1);
    expect(r.id).toBeTruthy();
  });

  it.each([['a weird string'], [{ shape: 'object' }], [42], [null], [undefined]])(
    'never throws and always returns >=1 action for arbitrary value %o',
    (value) => {
      const r = service().report(value as unknown);
      expect(r.recoveryActions.length).toBeGreaterThanOrEqual(1);
      expect(r.title.length).toBeGreaterThan(0);
    },
  );

  it('preserves fields from a typed ConclaveError', () => {
    const r = service().report(
      new ConclaveError({
        category: 'provider',
        code: 'PROV-1',
        title: 'Rate limited',
        detail: 'Groq returned 429',
        recoveryActions: [{ label: 'Wait (resets in 2h)', kind: 'wait' }],
        canRetry: true,
      }),
    );
    expect(r.category).toBe('provider');
    expect(r.code).toBe('PROV-1');
    expect(r.canRetry).toBe(true);
    expect(r.recoveryActions[0].label).toContain('Wait');
  });

  it('marks fatal and guarantees a Report issue action', () => {
    const r = service().report(new Error('catastrophe'), { fatal: true });
    expect(r.severity).toBe('fatal');
    expect(r.recoveryActions.some((a) => a.kind === 'report')).toBe(true);
  });

  it('redacts secrets out of the report detail', () => {
    const redactor = new SecretRedactor();
    redactor.registerSecret('sk-live-DEADBEEF');
    const svc = new ErrorService({ redactor });
    const r = svc.report(new Error('failed with key sk-live-DEADBEEF in body'));
    expect(r.detail).not.toContain('sk-live-DEADBEEF');
  });

  it('emits to subscribers', () => {
    const svc = service();
    const spy = vi.fn();
    svc.onReport(spy);
    svc.report(new Error('x'));
    expect(spy).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { installGlobalCapture } from '../../src/errors/globalCapture';
import { ErrorService } from '../../src/errors/ErrorService';
import { SecretRedactor } from '../../src/logging/redaction';

type Evt = 'unhandledRejection' | 'uncaughtException';

/**
 * Run `body` with all pre-existing listeners for `evt` detached (e.g. vitest's
 * own handlers) so a synthetic emit reaches ONLY the handler under test, then
 * restore them. Keeps the test isolated from the runner.
 */
function withIsolatedEvent(evt: Evt, body: () => void): void {
  const saved = process.listeners(evt);
  process.removeAllListeners(evt);
  try {
    body();
  } finally {
    process.removeAllListeners(evt);
    for (const l of saved) {
      process.on(evt, l as never);
    }
  }
}

describe('installGlobalCapture (unhandled errors -> fatal report, no crash)', () => {
  it('captures unhandledRejection as a fatal ErrorReport', () => {
    withIsolatedEvent('unhandledRejection', () => {
      const errors = new ErrorService({ redactor: new SecretRedactor() });
      const onFatal = vi.fn();
      const handle = installGlobalCapture(errors, onFatal);

      process.emit('unhandledRejection', new Error('async boom'), Promise.resolve());

      expect(onFatal).toHaveBeenCalledOnce();
      const report = onFatal.mock.calls[0][0];
      expect(report.severity).toBe('fatal');
      expect(report.recoveryActions.some((a: { kind: string }) => a.kind === 'report')).toBe(true);
      handle.dispose();
    });
  });

  it('captures uncaughtException as a fatal ErrorReport', () => {
    withIsolatedEvent('uncaughtException', () => {
      const errors = new ErrorService({ redactor: new SecretRedactor() });
      const onFatal = vi.fn();
      const handle = installGlobalCapture(errors, onFatal);

      process.emit('uncaughtException', new Error('sync boom'));

      expect(onFatal).toHaveBeenCalledOnce();
      expect(onFatal.mock.calls[0][0].severity).toBe('fatal');
      handle.dispose();
    });
  });

  it('dispose removes the handlers', () => {
    withIsolatedEvent('unhandledRejection', () => {
      const errors = new ErrorService({ redactor: new SecretRedactor() });
      const onFatal = vi.fn();
      const handle = installGlobalCapture(errors, onFatal);
      handle.dispose();

      process.emit('unhandledRejection', new Error('after dispose'), Promise.resolve());
      expect(onFatal).not.toHaveBeenCalled();
    });
  });
});

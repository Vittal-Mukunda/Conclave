import { ErrorService } from './ErrorService';
import { ErrorReport } from './ErrorReport';

export interface GlobalCaptureHandle {
  dispose(): void;
}

/**
 * Install process-level handlers so an unhandled rejection or uncaught exception
 * becomes a 'fatal' ErrorReport instead of crashing the extension host. We do
 * NOT rethrow — reaching a VS Code crash dialog is the failure we are preventing
 * (Error & Recovery Contract: never a raw crash).
 */
export function installGlobalCapture(
  errorService: ErrorService,
  onFatal: (report: ErrorReport) => void,
): GlobalCaptureHandle {
  const onRejection = (reason: unknown): void => {
    onFatal(errorService.report(reason, { fatal: true }));
  };
  const onException = (err: Error): void => {
    onFatal(errorService.report(err, { fatal: true }));
  };

  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);

  return {
    dispose(): void {
      process.off('unhandledRejection', onRejection);
      process.off('uncaughtException', onException);
    },
  };
}

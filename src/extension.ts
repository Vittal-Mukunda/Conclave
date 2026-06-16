import * as vscode from 'vscode';
import { ConclaveViewProvider } from './ConclaveViewProvider';
import { Services } from './core/Services';
import { ErrorService } from './errors/ErrorService';
import { SecretRedactor } from './logging/redaction';

let services: Services | undefined;

// Extension host entry point. Every entry point below is wrapped so a failure
// becomes an ErrorReport surfaced to the user, never an unhandled crash.
export function activate(context: vscode.ExtensionContext): void {
  try {
    services = new Services(context);
    context.subscriptions.push(services);

    const provider = new ConclaveViewProvider(context.extensionUri, services.keyManager);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ConclaveViewProvider.viewType, provider),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'conclave.openPanel',
        guard(async () => {
          await vscode.commands.executeCommand(`${ConclaveViewProvider.viewType}.focus`);
          provider.reveal();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.reportIssue',
        guard(async () => {
          services?.showOutput();
          // Fire-and-forget: awaiting a notification would block until the user
          // dismisses it (and hangs headless tests).
          void vscode.window.showInformationMessage(
            'conclave: issue reporting opens the tracker in a later phase. Logs are in the conclave output channel.',
          );
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.checkConnectivity',
        guard(async () => {
          const online = (await services?.connectivity.check()) ?? false;
          void vscode.window.showInformationMessage(
            online ? 'conclave: you are online.' : 'conclave: still offline — actions are queued.',
          );
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.manageKeys',
        guard(async () => {
          await services?.keyManager.manage();
          await provider.postProviders();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.setBudget',
        guard(async () => {
          await services?.manageBudget();
        }),
      ),
    );

    services.connectivity.start();
    void services.connectivity.check();
  } catch (err) {
    // Activation itself must not crash the host.
    const svc = services?.errors ?? new ErrorService({ redactor: new SecretRedactor() });
    const report = svc.report(err, { fatal: true, category: 'state' });
    void vscode.window.showErrorMessage(`conclave failed to start: ${report.title}`);
  }
}

export function deactivate(): void {
  services = undefined;
}

/** Wrap a command callback so thrown errors become surfaced ErrorReports. */
function guard(fn: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (err) {
      const report = services?.errors.report(err);
      if (report) {
        const labels = report.recoveryActions.map((a) => a.label);
        void vscode.window.showErrorMessage(report.title, ...labels);
      }
    }
  };
}

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

    const provider = new ConclaveViewProvider(
      context.extensionUri,
      services.keyManager,
      services.onboarding,
    );
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
      vscode.commands.registerCommand(
        'conclave.startOnboarding',
        guard(async () => {
          await services?.onboarding.run(async () => {
            await provider.postProviders();
            await provider.postOnboarding();
          });
          await provider.postOnboarding();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.initGit',
        guard(async () => {
          await services?.onboarding.initGit();
          await provider.postOnboarding();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.localize',
        guard(async () => {
          const query = await vscode.window.showInputBox({
            title: 'conclave — localize',
            prompt: 'Describe the change; conclave finds the code to edit.',
            ignoreFocusOut: true,
          });
          if (!query) {
            return;
          }
          const result = await services?.codeIntel.localize(query);
          if (!result) {
            return;
          }
          const top = result.candidates[0];
          const summary = top
            ? `${result.action.toUpperCase()} (conf ${result.confidence.toFixed(2)}): ${top.file}:${top.startLine}-${top.endLine}${top.symbol ? ` [${top.symbol}]` : ''}`
            : `${result.action.toUpperCase()}: ${result.note ?? 'no candidates'}`;
          void vscode.window.showInformationMessage(`conclave: ${summary}`);
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.checkpoint',
        guard(async () => {
          await services?.editing.runCheckpointCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.rememberTestCommand',
        guard(async () => {
          await services?.editing.rememberTestCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.verify',
        guard(async () => {
          await services?.verify.runVerifyCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.runAgent',
        guard(async () => {
          await services?.agent.runAgentCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.estimateDifficulty',
        guard(async () => {
          await services?.router.estimateDifficultyCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.recordFeedback',
        guard(async () => {
          await services?.competence.recordFeedbackCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.planCouncil',
        guard(async () => {
          await services?.council.planCouncilCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.bestOfN',
        guard(async () => {
          await services?.bestOfN.statusCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.toggleSensitiveRepo',
        guard(async () => {
          await services?.security.toggleSensitiveRepoCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.refreshSkills',
        guard(async () => {
          await services?.skills.refreshCommand();
        }),
      ),
      vscode.commands.registerCommand(
        'conclave.findSkills',
        guard(async () => {
          await services?.skills.findSkillsCommand();
        }),
      ),
    );

    services.connectivity.start();
    void services.connectivity.check();

    // Index installed skills in the background (non-blocking; headless-safe).
    void services.skills.refresh().catch(() => undefined);

    // First-run nudge — non-blocking; the wizard opens only on user action.
    void services.onboarding.notifyIfIncomplete(async () => {
      await provider.postProviders();
      await provider.postOnboarding();
    });
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

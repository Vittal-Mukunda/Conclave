import * as vscode from 'vscode';
import { ConclaveViewProvider } from './ConclaveViewProvider';

// Extension host entry point. Phase 0 wires the sidebar webview view and the
// `conclave.openPanel` command. Later phases hang the agent engine off here.
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ConclaveViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ConclaveViewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('conclave.openPanel', async () => {
      // VS Code auto-registers `<viewId>.focus`; focusing the view reveals the
      // activity-bar container and resolves the webview if not yet open.
      await vscode.commands.executeCommand(`${ConclaveViewProvider.viewType}.focus`);
      provider.reveal();
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up yet; subscriptions are disposed by VS Code.
}

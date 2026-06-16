import * as vscode from 'vscode';
import { ErrorService } from '../errors/ErrorService';
import { PanelHost } from '../panel/PanelHost';
import { ProviderService, ProviderStatusView } from '../providers/ProviderService';

/**
 * Interactive key management (the per-provider entry/update/clear UI) using
 * native VS Code dialogs. Keys are entered through a password-masked input and
 * go straight to SecretStorage via the KeyStore — never logged or echoed.
 * Implements PanelHost so the webview buttons drive the same flows.
 */
export class KeyManager implements PanelHost {
  constructor(
    private readonly providers: ProviderService,
    private readonly errors: ErrorService,
  ) {}

  getProviderStatus(): Promise<ProviderStatusView[]> {
    return this.providers.status();
  }

  /** `conclave.manageKeys` command: pick a provider, then an action. */
  async manage(): Promise<void> {
    const status = await this.providers.status();
    const pick = await vscode.window.showQuickPick(
      status.map((s) => ({
        label: s.label,
        description: `${s.kind}${s.hasKey ? '  ✓ key set' : '  — no key'}`,
        id: s.id,
      })),
      { title: 'conclave — manage provider keys', placeHolder: 'Select a provider' },
    );
    if (!pick) {
      return;
    }
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(key) Set / update key', action: 'set' as const },
        { label: '$(plug) Test connection', action: 'test' as const },
        { label: '$(trash) Clear key', action: 'clear' as const },
      ],
      { title: `conclave — ${pick.label}`, placeHolder: 'Choose an action' },
    );
    if (!action) {
      return;
    }
    if (action.action === 'set') {
      await this.addOrUpdateKey(pick.id);
    } else if (action.action === 'clear') {
      await this.clearKey(pick.id);
    } else {
      const result = await this.testConnection(pick.id);
      void vscode.window.showInformationMessage(result.message);
    }
  }

  async addOrUpdateKey(providerId: string): Promise<void> {
    const provider = this.providers.registry.get(providerId);
    if (!provider) {
      return;
    }
    const value = await vscode.window.showInputBox({
      title: `conclave — ${provider.label} API key`,
      prompt: provider.keyUrl
        ? `Get a key at ${provider.keyUrl}`
        : `Enter your ${provider.label} API key`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: provider.kind === 'paid' ? 'Paid key (billed by the provider)' : 'Free-tier key',
    });
    if (value === undefined || value.trim() === '') {
      return;
    }
    await this.providers.setKey(providerId, value);

    const test = await vscode.window.showInformationMessage(
      `${provider.label}: key saved.`,
      'Test connection',
    );
    if (test === 'Test connection') {
      const result = await this.testConnection(providerId);
      void vscode.window.showInformationMessage(result.message);
    }
  }

  async clearKey(providerId: string): Promise<void> {
    const provider = this.providers.registry.get(providerId);
    if (!provider) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove the ${provider.label} key?`,
      { modal: true },
      'Remove',
    );
    if (confirm === 'Remove') {
      await this.providers.clearKey(providerId);
      void vscode.window.showInformationMessage(`${provider.label}: key removed.`);
    }
  }

  async testConnection(providerId: string): Promise<{ ok: boolean; message: string }> {
    const provider = this.providers.registry.get(providerId);
    const label = provider?.label ?? providerId;
    try {
      const res = await this.providers.testConnection(providerId);
      return { ok: true, message: `${label}: connected (${res.latencyMs} ms, ${res.model}).` };
    } catch (err) {
      const report = this.errors.report(err);
      return { ok: false, message: `${label}: ${report.title}` };
    }
  }
}

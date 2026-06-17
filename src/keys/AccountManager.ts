import * as vscode from 'vscode';
import { KeyStore } from './KeyStore';
import { ProviderRegistry } from '../providers/registry';
import { AccountRegistry } from '../scheduler/AccountRegistry';
import { Scheduler } from '../scheduler/Scheduler';
import { buildAccount } from '../scheduler/accountPool';

/**
 * Phase 21 — manage MULTIPLE keys (accounts) per provider so their free-tier
 * quota pools. A key still lives only in SecretStorage (per account slot); the
 * AccountRegistry tracks which accounts exist + their health/latency. Adding or
 * removing an account updates the live scheduler pool immediately (no reload).
 */
export class AccountManager {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyStore,
    private readonly scheduler: Scheduler,
    private readonly accountRegistry?: AccountRegistry,
  ) {}

  /** `conclave.manageAccounts` — pool extra keys per provider. */
  async manageAccountsCommand(): Promise<void> {
    if (!this.accountRegistry) {
      void vscode.window.showWarningMessage('conclave: account pooling is unavailable (storage is off).');
      return;
    }
    const provider = await this.pickProvider();
    if (!provider) {
      return;
    }
    const accounts = await this.accountsFor(provider.id);
    const items: (vscode.QuickPickItem & { action: 'add' | 'remove'; accountId?: string })[] = [
      { label: '$(add) Add another account', description: 'pool an extra key for more quota', action: 'add' },
      ...accounts.map((a) => ({
        label: `$(trash) Remove ${a.label}`,
        description: a.accountId + (a.healthy ? '' : '  ⚠ marked unhealthy'),
        action: 'remove' as const,
        accountId: a.accountId,
      })),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: `conclave — ${provider.label} accounts (${accounts.length} pooled)`,
      placeHolder: 'Add or remove a pooled account',
    });
    if (!pick) {
      return;
    }
    if (pick.action === 'add') {
      await this.addAccount(provider.id);
    } else if (pick.accountId) {
      await this.removeAccount(provider.id, pick.accountId);
    }
  }

  private async addAccount(providerId: string): Promise<void> {
    const provider = this.registry.get(providerId);
    if (!provider || !this.accountRegistry) {
      return;
    }
    const existing = this.accountRegistry.list(providerId);
    const hasDefaultKey = await this.keys.hasKey(providerId, 'default');
    // First key takes the canonical 'default' slot; extras get a unique id.
    const accountId =
      existing.length === 0 && !hasDefaultKey ? 'default' : `acct-${Date.now().toString(36)}`;

    const label = await vscode.window.showInputBox({
      title: `conclave — ${provider.label} account label`,
      prompt: 'A name to tell this account apart (e.g. "work", "personal").',
      value: accountId,
      ignoreFocusOut: true,
    });
    if (label === undefined) {
      return;
    }
    const key = await vscode.window.showInputBox({
      title: `conclave — ${provider.label} API key`,
      prompt: provider.keyUrl ? `Get a key at ${provider.keyUrl}` : `Enter the ${provider.label} API key`,
      password: true,
      ignoreFocusOut: true,
    });
    if (key === undefined || key.trim() === '') {
      return;
    }

    await this.keys.setKey(providerId, key, accountId);
    this.accountRegistry.add(providerId, accountId, label.trim() || accountId);
    // Pool it live.
    this.scheduler.addAccount(buildAccount(provider, { accountName: accountId }));
    void vscode.window.showInformationMessage(
      `${provider.label}: account "${label.trim() || accountId}" added to the pool.`,
    );
  }

  private async removeAccount(providerId: string, accountId: string): Promise<void> {
    const provider = this.registry.get(providerId);
    if (!provider || !this.accountRegistry) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Remove the ${provider.label} account "${accountId}" from the pool?`,
      { modal: true },
      'Remove',
    );
    if (confirm !== 'Remove') {
      return;
    }
    await this.keys.clearKey(providerId, accountId);
    this.accountRegistry.remove(providerId, accountId);
    this.scheduler.removeAccount(`${providerId}:${accountId}`);
    void vscode.window.showInformationMessage(`${provider.label}: account removed from the pool.`);
  }

  /** Registered accounts, plus the implicit 'default' when a default key exists
   * but was never registered (an older single-key user). */
  private async accountsFor(
    providerId: string,
  ): Promise<{ accountId: string; label: string; healthy: boolean }[]> {
    const registered = this.accountRegistry?.list(providerId) ?? [];
    const out = registered.map((a) => ({ accountId: a.accountId, label: a.label, healthy: a.healthy }));
    if (!out.some((a) => a.accountId === 'default') && (await this.keys.hasKey(providerId, 'default'))) {
      out.unshift({ accountId: 'default', label: 'default', healthy: true });
    }
    return out;
  }

  private async pickProvider() {
    const pick = await vscode.window.showQuickPick(
      this.registry.list().map((p) => ({ label: p.label, description: p.kind, id: p.id })),
      { title: 'conclave — manage account pool', placeHolder: 'Select a provider' },
    );
    return pick ? this.registry.get(pick.id) : undefined;
  }
}

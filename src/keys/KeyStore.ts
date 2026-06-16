import { SecretRedactor } from '../logging/redaction';

// Minimal subset of vscode.SecretStorage so KeyStore is unit-testable with an
// in-memory fake. Keys live ONLY here (the OS keychain in production).
export interface SecretStore {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

const PREFIX = 'conclave.key';

/**
 * Stores and retrieves API keys. Every key read/written is registered with the
 * redactor so it can never appear in a log, prompt, error or the UI (SEC-4).
 * Keys are NEVER returned to the webview — only presence flags are.
 *
 * Account-scoped (default 'default') so Phase 21 multi-account pooling can add
 * more accounts per provider without changing this contract.
 */
export class KeyStore {
  constructor(
    private readonly store: SecretStore,
    private readonly redactor?: SecretRedactor,
  ) {}

  private id(providerId: string, account = 'default'): string {
    return `${PREFIX}.${providerId}.${account}`;
  }

  async setKey(providerId: string, value: string, account = 'default'): Promise<void> {
    const trimmed = value.trim();
    await this.store.store(this.id(providerId, account), trimmed);
    this.redactor?.registerSecret(trimmed);
  }

  async getKey(providerId: string, account = 'default'): Promise<string | undefined> {
    const value = await this.store.get(this.id(providerId, account));
    if (value) {
      this.redactor?.registerSecret(value);
    }
    return value ?? undefined;
  }

  async hasKey(providerId: string, account = 'default'): Promise<boolean> {
    return (await this.getKey(providerId, account)) !== undefined;
  }

  async clearKey(providerId: string, account = 'default'): Promise<void> {
    const existing = await this.store.get(this.id(providerId, account));
    if (existing) {
      this.redactor?.unregisterSecret(existing);
    }
    await this.store.delete(this.id(providerId, account));
  }
}

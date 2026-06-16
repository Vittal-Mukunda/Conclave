import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { ProviderKind } from '../providers/types';
import { RepoMemory } from '../editing/RepoMemory';
import { scanSecrets, ScanResult } from './SecretScanner';
import { sanitizeUntrusted, SanitizedUntrusted } from './injection';
import { allowsProvider } from './privacy';
import { DEFAULT_SANDBOX_POLICY, SandboxPolicy } from './SandboxPolicy';

// vscode glue for the security layer. Owns the per-workspace Sensitive-repo flag
// (SEC-2), redacts outbound repo content (SEC-1), fences untrusted content
// (SEC-3), exposes the provider-privacy gate the router consults, and hands out
// the hardened sandbox policy (SEC-5). The detection/redaction logic is pure and
// unit-tested; this assembles it and surfaces warnings.

const SENSITIVE_KEY = 'security.sensitive';

export class SecurityService {
  private memSensitive = false;

  constructor(
    private readonly logger: Logger,
    private readonly repoMemory?: RepoMemory,
  ) {}

  // ---- SEC-2: Sensitive-repo mode ----

  isSensitive(): boolean {
    const ws = this.workspaceId();
    if (ws && this.repoMemory) {
      return this.repoMemory.get(ws, SENSITIVE_KEY) === 'true';
    }
    return this.memSensitive;
  }

  setSensitive(on: boolean): void {
    const ws = this.workspaceId();
    if (ws && this.repoMemory) {
      this.repoMemory.set(ws, SENSITIVE_KEY, on ? 'true' : 'false');
    } else {
      this.memSensitive = on;
    }
    this.logger.info('security_sensitive_mode', { on });
  }

  /** Provider-privacy gate the router consults (SEC-2). */
  allowsProvider(providerId: string, kind: ProviderKind): boolean {
    return allowsProvider(providerId, kind, this.isSensitive());
  }

  // ---- SEC-1: redact secrets in outbound content ----

  /** Scan + redact repo content before it is sent to a provider. Warns on hits. */
  redactOutbound(text: string): ScanResult {
    const result = scanSecrets(text);
    if (result.total > 0) {
      this.logger.warn('security_secret_redacted', {
        total: result.total,
        types: result.findings.map((f) => f.type),
      });
      void vscode.window.showWarningMessage(
        `conclave: redacted ${result.total} secret(s) from content before sending (SEC-1).`,
      );
    }
    return result;
  }

  // ---- SEC-3: fence untrusted content ----

  /** Wrap repo/issue content as data-only and flag embedded instructions. */
  prepareUntrusted(text: string, label?: string): SanitizedUntrusted {
    const s = sanitizeUntrusted(text, label);
    if (s.injection.risk === 'high') {
      this.logger.warn('security_injection_detected', {
        findings: s.injection.findings.map((f) => f.id),
      });
    }
    return s;
  }

  // ---- SEC-5: hardened sandbox policy ----

  sandboxPolicy(): SandboxPolicy {
    return DEFAULT_SANDBOX_POLICY;
  }

  /** `conclave.toggleSensitiveRepo` — flip Sensitive-repo mode. */
  async toggleSensitiveRepoCommand(): Promise<void> {
    const now = !this.isSensitive();
    this.setSensitive(now);
    void vscode.window.showInformationMessage(
      now
        ? 'conclave: Sensitive-repo mode ON — free tiers that may train on your code are disabled; only no-train providers will be used (SEC-2).'
        : 'conclave: Sensitive-repo mode OFF — all configured providers (including free tiers) are available again.',
    );
  }

  private workspaceId(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

import * as vscode from 'vscode';
import { promises as dns } from 'dns';
import { SecretRedactor } from '../logging/redaction';
import { Logger } from '../logging/Logger';
import { ErrorService } from '../errors/ErrorService';
import { ErrorReport } from '../errors/ErrorReport';
import { installGlobalCapture, GlobalCaptureHandle } from '../errors/globalCapture';
import { Capability, DegradedModeRegistry } from '../degraded/DegradedModeRegistry';
import { ConnectivityMonitor } from '../connectivity/ConnectivityMonitor';
import { KeyStore } from '../keys/KeyStore';
import { ProviderRegistry } from '../providers/registry';
import { LLMClient } from '../providers/LLMClient';
import { ProviderService } from '../providers/ProviderService';
import { FetchTransport } from '../providers/http';
import { KeyManager } from '../keys/KeyManager';
import { Scheduler } from '../scheduler/Scheduler';
import { RealClock } from '../scheduler/clock';
import { AccountLimiter } from '../scheduler/AccountLimiter';
import { CircuitBreaker } from '../scheduler/CircuitBreaker';
import { defaultLimitsFor } from '../scheduler/rateLimits';
import { Account } from '../scheduler/types';

/**
 * Constructs and owns the resilience services and wires them to VS Code (output
 * channel sink, network probe, global capture -> notification). The core
 * services themselves are vscode-free and unit-tested; this is the thin glue.
 */
export class Services implements vscode.Disposable {
  readonly redactor: SecretRedactor;
  readonly logger: Logger;
  readonly errors: ErrorService;
  readonly degraded: DegradedModeRegistry;
  readonly connectivity: ConnectivityMonitor;
  readonly keys: KeyStore;
  readonly providers: ProviderService;
  readonly keyManager: KeyManager;
  readonly scheduler: Scheduler;

  private readonly channel: vscode.OutputChannel;
  private readonly capture: GlobalCaptureHandle;
  private lastFatal: ErrorReport | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel('conclave');
    this.redactor = new SecretRedactor();
    this.logger = new Logger({ append: (line) => this.channel.appendLine(line) }, this.redactor);
    this.errors = new ErrorService({ redactor: this.redactor, logger: this.logger });

    this.degraded = new DegradedModeRegistry();
    this.degraded.register(Capability.Network, 'full');
    this.degraded.register(Capability.Sandbox, 'full');
    this.degraded.register(Capability.Lsp, 'full');
    this.degraded.register(Capability.TreeSitter, 'full');
    this.degraded.register(Capability.Skills, 'full');
    this.degraded.register(Capability.Paid, 'unavailable', {
      consequence: 'No paid key configured — running on free tiers only.',
      restoreAction: { label: 'Add paid key', kind: 'add', command: 'conclave.openPanel' },
    });

    this.connectivity = new ConnectivityMonitor(() => probeNetwork());
    this.connectivity.onChange((online) => {
      this.degraded.set(Capability.Network, online ? 'full' : 'unavailable', {
        consequence: online
          ? undefined
          : 'No internet — provider calls are queued and resume when you reconnect.',
        restoreAction: { label: 'Retry now', kind: 'retry', command: 'conclave.checkConnectivity' },
      });
      this.logger.info(online ? 'network_online' : 'network_offline', {
        queued: this.connectivity.queuedCount,
      });
    });

    // Provider layer: keys in SecretStorage, registry, transport-mapped client.
    this.keys = new KeyStore(context.secrets, this.redactor);
    const registry = new ProviderRegistry();
    const client = new LLMClient({
      transport: new FetchTransport(),
      keyProvider: (providerId) => this.keys.getKey(providerId),
      redactor: this.redactor,
      logger: this.logger,
    });

    // Rate-limit-aware scheduler: one default account per provider for now
    // (Phase 21 pools multiple). Every provider call is funneled through it.
    const accounts: Account[] = registry.list().map((p) => ({
      id: `${p.id}:default`,
      providerId: p.id,
      limiter: new AccountLimiter(defaultLimitsFor(p)),
      breaker: new CircuitBreaker(5, 30_000),
      weight: 1,
      available: true,
      cooldownUntil: 0,
    }));
    this.scheduler = new Scheduler({
      clock: new RealClock(),
      accounts,
      errors: this.errors,
      logger: this.logger,
    });
    this.scheduler.onThrottled((report) => {
      this.logger.warn('scheduler_throttled', { code: report.code, retryAfterMs: report.retryAfterMs });
    });

    this.providers = new ProviderService(registry, this.scheduler, client, this.keys);
    this.keyManager = new KeyManager(this.providers, this.errors);

    this.capture = installGlobalCapture(this.errors, (report) => this.onFatal(report));
    this.logger.info('services_initialized');
  }

  get lastFatalError(): ErrorReport | undefined {
    return this.lastFatal;
  }

  showOutput(): void {
    this.channel.show(true);
  }

  private onFatal(report: ErrorReport): void {
    this.lastFatal = report;
    // Non-blocking surface for now; the rich ErrorReport card lands in Phase 20.
    const labels = report.recoveryActions.map((a) => a.label);
    void vscode.window.showErrorMessage(report.title, ...labels);
  }

  dispose(): void {
    this.capture.dispose();
    this.connectivity.stop();
    this.channel.dispose();
  }
}

/** Network reachability probe. Logic that uses it (the monitor) is tested with
 * an injected probe; this concrete IO is intentionally thin. */
async function probeNetwork(): Promise<boolean> {
  try {
    await dns.lookup('api.github.com');
    return true;
  } catch {
    return false;
  }
}

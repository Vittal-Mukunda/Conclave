import * as vscode from 'vscode';
import { promises as dns } from 'dns';
import { SecretRedactor } from '../logging/redaction';
import { Logger } from '../logging/Logger';
import { ErrorService } from '../errors/ErrorService';
import { ErrorReport } from '../errors/ErrorReport';
import { installGlobalCapture, GlobalCaptureHandle } from '../errors/globalCapture';
import { Capability, DegradedModeRegistry } from '../degraded/DegradedModeRegistry';
import { ConnectivityMonitor } from '../connectivity/ConnectivityMonitor';

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

  private readonly channel: vscode.OutputChannel;
  private readonly capture: GlobalCaptureHandle;
  private lastFatal: ErrorReport | undefined;

  constructor() {
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

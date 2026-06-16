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
import { Storage } from '../storage/Storage';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { ProbeService } from '../capability/ProbeService';
import { TelemetryStore, CallRecord } from '../telemetry/TelemetryStore';
import { CostCalculator } from '../cost/CostCalculator';
import { ShadowPriceEngine } from '../cost/ShadowPriceEngine';
import { PricedCost } from '../cost/PricedCost';
import { BudgetManager } from '../cost/BudgetManager';
import { CostPolicy } from '../cost/CostPolicy';
import { OnboardingHost } from '../onboarding/OnboardingHost';
import { CodeIntelService } from '../codeintel/CodeIntelService';
import { RepoMemory } from '../editing/RepoMemory';
import { EditService } from '../editing/EditService';
import { VerifyService } from '../verify/VerifyService';
import { RouterService } from '../router/RouterService';
import { BanditStore } from '../learn/BanditStore';
import { CompetenceService } from '../learn/CompetenceService';
import { CouncilService } from '../council/CouncilService';
import { BestOfNService } from '../bestofn/BestOfNService';
import { SecurityService } from '../security/SecurityService';
import { AgentService } from '../agent/AgentService';

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
  readonly onboarding: OnboardingHost;
  readonly codeIntel: CodeIntelService;
  readonly editing: EditService;
  readonly verify: VerifyService;
  readonly router: RouterService;
  readonly security: SecurityService;
  readonly competence: CompetenceService;
  readonly council: CouncilService;
  readonly bestOfN: BestOfNService;
  readonly agent: AgentService;
  readonly repoMemory?: RepoMemory;
  readonly scheduler: Scheduler;
  readonly storage?: Storage;
  readonly capability?: CapabilityRegistry;
  readonly telemetry?: TelemetryStore;
  readonly cost: CostCalculator;
  readonly shadow: ShadowPriceEngine;
  readonly pricedCost: PricedCost;
  readonly budget?: BudgetManager;
  readonly policy: CostPolicy;
  readonly banditStore?: BanditStore;

  private readonly channel: vscode.OutputChannel;
  private readonly capture: GlobalCaptureHandle;
  private probeTimer?: ReturnType<typeof setInterval>;
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
    this.degraded.register(Capability.Storage, 'full');
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

    // Persistence layer: capability/quota registry + telemetry + cost meter.
    // Degrades (does not crash) if the storage engine cannot open (STATE-4).
    this.cost = new CostCalculator(registry);
    this.shadow = new ShadowPriceEngine();
    this.pricedCost = new PricedCost(this.cost, this.shadow);
    try {
      this.storage = Storage.open(context.globalStorageUri.fsPath);
      this.capability = new CapabilityRegistry(this.storage.db);
      this.capability.seed(registry.list());
      this.telemetry = new TelemetryStore(this.storage.db);
      this.budget = new BudgetManager(this.storage.db);
      this.repoMemory = new RepoMemory(this.storage.db);
      this.banditStore = new BanditStore(this.storage.db);
      this.logger.info('storage_ready', { version: this.storage.version });
    } catch (err) {
      this.degraded.set(Capability.Storage, 'unavailable', {
        consequence: 'Telemetry, cost tracking and the quota registry are off (database unavailable).',
        restoreAction: { label: 'Open logs', kind: 'docs', command: 'conclave.reportIssue' },
      });
      this.errors.report(err, { category: 'state', code: 'STATE-4' });
    }

    // Cost mode defaults to free-only; restored from persisted budget when present.
    this.policy = new CostPolicy(this.budget?.state().mode ?? 'free-only');

    const capability = this.capability;
    const telemetry = this.telemetry;
    const budget = this.budget;
    const observer =
      capability && telemetry
        ? (rec: CallRecord) => {
            telemetry.record(rec);
            capability.recordOutcome(rec.provider, rec.model, {
              ok: rec.ok,
              rateLimited: rec.status === 'PROV-1',
              latencyMs: rec.latencyMs,
              tokensOut: rec.tokensOut,
            });
            // Fold real paid spend into the budget; warn once per threshold (COST-2).
            if (budget && rec.costUsd > 0) {
              const { warn } = budget.record(rec.costUsd);
              if (warn !== undefined) {
                const report = budget.warnReport(warn);
                this.logger.warn('budget_threshold', { level: warn, code: report.code });
                void vscode.window.showWarningMessage(
                  report.title,
                  ...report.recoveryActions.map((a) => a.label),
                );
              }
            }
          }
        : undefined;

    this.providers = new ProviderService(registry, this.scheduler, client, this.keys, this.cost, observer);
    this.keyManager = new KeyManager(this.providers, this.errors);
    this.onboarding = new OnboardingHost(context, this.providers, this.keyManager, this.errors);
    // Code intelligence / localization (Phase 7). Indexed lazily on first query.
    this.codeIntel = new CodeIntelService(this.degraded, this.logger);
    // Editing + git checkpoints + repo memory (Phase 8). Repo memory needs
    // storage; absent it, editing/checkpoints still work (just no remembered facts).
    this.editing = new EditService(this.logger, this.errors, this.repoMemory);
    // Verification ladder + sandbox (Phase 9). Marks Sandbox degraded (process,
    // not container). Reuses the remembered test command (VER-6) from repo memory.
    this.verify = new VerifyService(this.degraded, this.logger, this.repoMemory);
    // Difficulty estimator + cascade router (Phase 11): picks the cheapest tier
    // the role/difficulty allow over the keyed pool, priced by pricedCost and
    // gated by the live cost policy. A COST lever — climbs only on failure.
    // Security & privacy hardening (Phase 15): Sensitive-repo mode + provider
    // privacy gate (SEC-2), outbound secret redaction (SEC-1), untrusted-content
    // fencing (SEC-3), hardened sandbox policy (SEC-5).
    this.security = new SecurityService(this.logger, this.repoMemory);
    this.router = new RouterService(
      this.logger,
      registry,
      this.keys,
      this.pricedCost,
      this.policy,
      this.budget,
      this.security,
    );
    // Competence learner (Phase 12): a per-workspace LinUCB bandit that picks
    // among the routed candidates from learned per-context outcomes, warm-started
    // from benchmark priors, persisted in the bandit table, and updated strongly
    // from human ACCEPT/REJECT (lessons written to repo memory).
    this.competence = new CompetenceService(this.logger, this.capability, this.banditStore, this.repoMemory);
    // Assignment solver + heterogeneous council (Phase 13): a single author for
    // convergent stages, a diverse >=2-family council (diversity-pruned) for
    // divergent ones, seated by the learner's conservative LCB competence.
    this.council = new CouncilService(this.logger, this.router, this.competence);
    // Best-of-N + strong verifier-selector (Phase 14): CodeT dual-execution
    // consensus fused with type/critic/coverage signals, Pandora optimal stopping
    // (endogenous N, K≤8), CODING-stop on the first ladder pass. Candidate
    // authoring (the LLM sampler) lands with codegen — same flagged deviation.
    this.bestOfN = new BestOfNService(this.logger);
    // Agent loop (Phase 10): control FSM wiring localize -> edit -> verify with
    // checkpoint/rollback + budget guards. The router (Phase 11) names the tier
    // and the learner (Phase 12) picks the model. Codegen brain deferred.
    this.agent = new AgentService(
      this.logger,
      this.codeIntel,
      this.editing,
      this.verify,
      this.budget,
      this.router,
      this.competence,
    );

    // Live capacity probing: startup pass + hourly, only for keyed providers.
    if (capability) {
      const probe = new ProbeService({
        registry: capability,
        hasKey: (id) => this.keys.hasKey(id),
        probe: async (p) => {
          const r = await this.providers.testConnection(p.id);
          return { latencyMs: r.latencyMs };
        },
        now: () => Date.now(),
        logger: this.logger,
      });
      void probe.probeAll(registry.list()).catch(() => undefined);
      this.probeTimer = setInterval(() => {
        void probe.probeAll(registry.list()).catch(() => undefined);
      }, 3_600_000);
      this.probeTimer.unref?.();
    }

    this.capture = installGlobalCapture(this.errors, (report) => this.onFatal(report));
    this.logger.info('services_initialized');
  }

  get lastFatalError(): ErrorReport | undefined {
    return this.lastFatal;
  }

  showOutput(): void {
    this.channel.show(true);
  }

  /** Cost-mode + spend-cap dialog (conclave.setBudget). */
  async manageBudget(): Promise<void> {
    if (!this.budget) {
      void vscode.window.showWarningMessage('conclave: budget controls are unavailable (storage is off).');
      return;
    }
    const state = this.budget.state();
    const modePick = await vscode.window.showQuickPick(
      [
        { label: 'Free only', mode: 'free-only' as const, description: '$0 — paid models never used' },
        { label: 'Free first', mode: 'free-first' as const, description: 'free, paid spillover within cap' },
        { label: 'Best quality', mode: 'best-quality' as const, description: 'free + paid within cap' },
      ],
      { placeHolder: `Cost mode (current: ${state.mode})` },
    );
    if (modePick) {
      this.budget.setMode(modePick.mode);
      this.policy.mode = modePick.mode;
    }
    const capInput = await vscode.window.showInputBox({
      prompt: 'Spend cap in USD (blank = no cap)',
      value: state.capUsd?.toString() ?? '',
      validateInput: (v) => (v === '' || /^\d+(\.\d+)?$/.test(v) ? undefined : 'Enter a number or leave it blank'),
    });
    if (capInput !== undefined) {
      this.budget.setCap(capInput === '' ? null : Number(capInput));
    }
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
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
    }
    this.storage?.close();
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

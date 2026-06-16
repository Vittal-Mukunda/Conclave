import { KeyStore } from '../keys/KeyStore';
import { LLMClient } from './LLMClient';
import { ProviderRegistry } from './registry';
import { Scheduler } from '../scheduler/Scheduler';
import { estimateMessagesTokens } from './tokenEstimate';
import { ConclaveError } from '../errors/ErrorReport';
import { CostCalculator } from '../cost/CostCalculator';
import { CallRecord } from '../telemetry/TelemetryStore';
import { ChatRequest, ChatResponse, Provider, ProviderKind } from './types';

export type CallObserver = (record: CallRecord) => void;

export interface ProviderStatusView {
  id: string;
  label: string;
  kind: ProviderKind;
  hasKey: boolean;
  keyUrl?: string;
  models: string[];
}

export interface TestConnectionResult {
  ok: true;
  providerId: string;
  model: string;
  latencyMs: number;
}

/**
 * Ties the registry, key store and LLM client together. vscode-free so it can be
 * unit-tested; the host wires the real KeyStore (SecretStorage) and transport.
 */
export class ProviderService {
  constructor(
    readonly registry: ProviderRegistry,
    private readonly scheduler: Scheduler,
    private readonly client: LLMClient,
    private readonly keys: KeyStore,
    private readonly cost?: CostCalculator,
    private readonly observer?: CallObserver,
  ) {}

  list(kind?: ProviderKind): Provider[] {
    return this.registry.list(kind);
  }

  setKey(providerId: string, value: string): Promise<void> {
    return this.keys.setKey(providerId, value);
  }

  clearKey(providerId: string): Promise<void> {
    return this.keys.clearKey(providerId);
  }

  hasKey(providerId: string): Promise<boolean> {
    return this.keys.hasKey(providerId);
  }

  async status(): Promise<ProviderStatusView[]> {
    const out: ProviderStatusView[] = [];
    for (const p of this.registry.list()) {
      out.push({
        id: p.id,
        label: p.label,
        kind: p.kind,
        hasKey: await this.keys.hasKey(p.id),
        keyUrl: p.keyUrl,
        models: p.defaultModels.map((m) => m.id),
      });
    }
    return out;
  }

  /** All provider calls go through the scheduler so rate limits are enforced and
   * failover/backoff apply. The client is only invoked inside the scheduled run,
   * after capacity has been acquired. */
  async chat(providerId: string, req: ChatRequest, stream = false): Promise<ChatResponse> {
    const provider = this.requireProvider(providerId);
    try {
      const res = await this.scheduler.submit<ChatResponse>({
        providerId,
        estTokens: this.reserveTokens(req),
        run: () => this.client.chat(provider, req, { stream }),
      });
      this.record(providerId, req.model, 'chat', res, true, 'ok');
      return res;
    } catch (err) {
      this.record(providerId, req.model, 'chat', undefined, false, codeOf(err));
      throw err;
    }
  }

  /** Minimal round-trip to validate a key/connection. Throws ConclaveError on failure. */
  async testConnection(providerId: string): Promise<TestConnectionResult> {
    const provider = this.requireProvider(providerId);
    const model = provider.defaultModels[0];
    const req: ChatRequest = {
      model: model.id,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
      temperature: 0,
    };
    try {
      const res = await this.scheduler.submit<ChatResponse>({
        providerId,
        estTokens: this.reserveTokens(req),
        priority: 1, // user is waiting on a connection test
        run: () => this.client.chat(provider, req),
      });
      this.record(providerId, model.id, 'probe', res, true, 'ok');
      return { ok: true, providerId, model: model.id, latencyMs: res.latencyMs };
    } catch (err) {
      this.record(providerId, model.id, 'probe', undefined, false, codeOf(err));
      throw err;
    }
  }

  /** Best-effort telemetry; never throws into the caller. */
  private record(
    providerId: string,
    model: string,
    stage: string,
    res: ChatResponse | undefined,
    ok: boolean,
    status: string,
  ): void {
    if (!this.observer) {
      return;
    }
    const tokensIn = res?.tokensIn ?? 0;
    const tokensOut = res?.tokensOut ?? 0;
    const cost = this.cost?.price(providerId, model, tokensIn, tokensOut) ?? {
      spendUsd: 0,
      savedUsd: 0,
      paid: false,
    };
    try {
      this.observer({
        ts: Date.now(),
        provider: providerId,
        model,
        stage,
        tokensIn,
        tokensOut,
        latencyMs: res?.latencyMs ?? 0,
        ok,
        status,
        costUsd: cost.spendUsd,
        savedUsd: cost.savedUsd,
        estimated: res?.estimatedTokens ?? false,
      });
    } catch {
      /* telemetry is best-effort */
    }
  }

  /** Conservative reservation: input estimate + the max possible output. */
  private reserveTokens(req: ChatRequest): number {
    return estimateMessagesTokens(req.messages) + (req.maxTokens ?? 512);
  }

  private requireProvider(providerId: string): Provider {
    const provider = this.registry.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return provider;
  }
}

function codeOf(err: unknown): string {
  return err instanceof ConclaveError ? err.code ?? 'error' : 'error';
}

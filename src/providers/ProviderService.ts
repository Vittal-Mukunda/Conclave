import { KeyStore } from '../keys/KeyStore';
import { LLMClient } from './LLMClient';
import { ProviderRegistry } from './registry';
import { Scheduler } from '../scheduler/Scheduler';
import { estimateMessagesTokens } from './tokenEstimate';
import { ChatRequest, ChatResponse, Provider, ProviderKind } from './types';

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
  chat(providerId: string, req: ChatRequest, stream = false): Promise<ChatResponse> {
    const provider = this.requireProvider(providerId);
    return this.scheduler.submit<ChatResponse>({
      providerId,
      estTokens: this.reserveTokens(req),
      run: () => this.client.chat(provider, req, { stream }),
    });
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
    const res = await this.scheduler.submit<ChatResponse>({
      providerId,
      estTokens: this.reserveTokens(req),
      priority: 1, // user is waiting on a connection test
      run: () => this.client.chat(provider, req),
    });
    return { ok: true, providerId, model: model.id, latencyMs: res.latencyMs };
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

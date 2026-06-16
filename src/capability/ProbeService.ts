import { ConclaveError } from '../errors/ErrorReport';
import { Logger } from '../logging/Logger';
import { Provider } from '../providers/types';
import { CapabilityRegistry } from './CapabilityRegistry';

export interface ProbeResult {
  providerId: string;
  ok: boolean;
  latencyMs?: number;
  error?: ConclaveError;
}

export interface ProbeDeps {
  registry: CapabilityRegistry;
  hasKey: (providerId: string) => Promise<boolean>;
  /** Performs a minimal round-trip (e.g. ProviderService.testConnection). */
  probe: (provider: Provider) => Promise<{ latencyMs: number }>;
  now: () => number;
  logger?: Logger;
}

/**
 * Live capacity probing. Updates each model's availability + latency in the
 * registry. Only probes providers that have a key (can't probe otherwise, and
 * won't spend quota needlessly). A schema/endpoint change (PROV-7) is logged so
 * the user is informed and the model marked unavailable for failover.
 */
export class ProbeService {
  constructor(private readonly deps: ProbeDeps) {}

  async probeProvider(provider: Provider): Promise<ProbeResult> {
    if (!(await this.deps.hasKey(provider.id))) {
      // No key -> leave availability untouched (we can't assess it).
      return { providerId: provider.id, ok: false };
    }
    try {
      const { latencyMs } = await this.deps.probe(provider);
      for (const m of provider.defaultModels) {
        this.deps.registry.setProbe(provider.id, m.id, { available: true, latencyMs, at: this.deps.now() });
      }
      return { providerId: provider.id, ok: true, latencyMs };
    } catch (err) {
      const ce = err instanceof ConclaveError ? err : undefined;
      for (const m of provider.defaultModels) {
        this.deps.registry.setProbe(provider.id, m.id, { available: false, at: this.deps.now() });
      }
      if (ce?.code === 'PROV-7') {
        this.deps.logger?.warn('provider_schema_changed', { provider: provider.id });
      }
      return { providerId: provider.id, ok: false, error: ce };
    }
  }

  async probeAll(providers: Provider[]): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    for (const p of providers) {
      results.push(await this.probeProvider(p));
    }
    return results;
  }
}

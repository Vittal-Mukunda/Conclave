import { describe, it, expect, vi } from 'vitest';
import { Storage } from '../../src/storage/Storage';
import { CapabilityRegistry } from '../../src/capability/CapabilityRegistry';
import { ProbeService } from '../../src/capability/ProbeService';
import { ProviderRegistry } from '../../src/providers/registry';
import { ConclaveError } from '../../src/errors/ErrorReport';

const provider = new ProviderRegistry().get('groq')!;
const firstModel = provider.defaultModels[0].id;

function freshRegistry(): CapabilityRegistry {
  return new CapabilityRegistry(Storage.memory().db);
}

describe('ProbeService (live capacity probing updates availability)', () => {
  it('marks models available + records latency on a successful probe', async () => {
    const reg = freshRegistry();
    const ps = new ProbeService({
      registry: reg,
      hasKey: async () => true,
      probe: async () => ({ latencyMs: 123 }),
      now: () => 10,
    });
    const r = await ps.probeProvider(provider);
    expect(r.ok).toBe(true);
    const m = reg.getModel('groq', firstModel)!;
    expect(m.available).toBe(1);
    expect(m.latency_ms).toBe(123);
  });

  it('skips (and does not call probe) when there is no key', async () => {
    const reg = freshRegistry();
    const probe = vi.fn();
    const ps = new ProbeService({ registry: reg, hasKey: async () => false, probe, now: () => 0 });
    const r = await ps.probeProvider(provider);
    expect(r.ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });

  it('marks models unavailable on a probe failure', async () => {
    const reg = freshRegistry();
    const ps = new ProbeService({
      registry: reg,
      hasKey: async () => true,
      probe: async () => {
        throw new ConclaveError({ category: 'provider', code: 'PROV-3', title: 'outage' });
      },
      now: () => 20,
    });
    const r = await ps.probeProvider(provider);
    expect(r.ok).toBe(false);
    expect(reg.getModel('groq', firstModel)?.available).toBe(0);
  });

  it('logs a schema/endpoint change (PROV-7)', async () => {
    const reg = freshRegistry();
    const warn = vi.fn();
    const ps = new ProbeService({
      registry: reg,
      hasKey: async () => true,
      probe: async () => {
        throw new ConclaveError({ category: 'provider', code: 'PROV-7', title: 'schema changed' });
      },
      now: () => 0,
      logger: { warn } as never,
    });
    await ps.probeProvider(provider);
    expect(warn).toHaveBeenCalled();
  });
});

import { RecoveryAction } from '../errors/ErrorReport';

// Tracks which capabilities are full / degraded / unavailable, what the user
// loses in each state, and how to restore it. The UI reads this to show banners
// ("Running without Docker — confidence lowered") and the router reads it to
// decide what it may attempt.

export type CapabilityState = 'full' | 'degraded' | 'unavailable';

/** Well-known capability ids. Providers register dynamically as `provider:<id>`. */
export const Capability = {
  Sandbox: 'sandbox',
  Lsp: 'lsp',
  TreeSitter: 'treeSitter',
  Network: 'network',
  Paid: 'paid',
  Skills: 'skills',
} as const;

export interface CapabilityStatus {
  capability: string;
  state: CapabilityState;
  /** What the user loses while in this state (plain language). */
  consequence?: string;
  /** One-click action to restore full capability. */
  restoreAction?: RecoveryAction;
}

export interface CapabilityChange {
  capability: string;
  previous: CapabilityState;
  current: CapabilityState;
  status: CapabilityStatus;
}

export type CapabilityListener = (change: CapabilityChange) => void;

export interface CapabilityMeta {
  consequence?: string;
  restoreAction?: RecoveryAction;
}

export class DegradedModeRegistry {
  private readonly map = new Map<string, CapabilityStatus>();
  private readonly listeners = new Set<CapabilityListener>();

  register(capability: string, state: CapabilityState = 'full', meta: CapabilityMeta = {}): void {
    if (!this.map.has(capability)) {
      this.map.set(capability, { capability, state, ...meta });
    }
  }

  /** Set a capability's state; emits a change event only on an actual transition. */
  set(capability: string, state: CapabilityState, meta: CapabilityMeta = {}): void {
    const prev = this.map.get(capability);
    const previous: CapabilityState = prev?.state ?? 'full';
    const status: CapabilityStatus = {
      capability,
      state,
      consequence: meta.consequence ?? (state === 'full' ? undefined : prev?.consequence),
      restoreAction: meta.restoreAction ?? (state === 'full' ? undefined : prev?.restoreAction),
    };
    this.map.set(capability, status);

    if (previous !== state) {
      const change: CapabilityChange = { capability, previous, current: state, status };
      for (const l of this.listeners) {
        try {
          l(change);
        } catch {
          /* a listener must not break the registry */
        }
      }
    }
  }

  get(capability: string): CapabilityStatus | undefined {
    return this.map.get(capability);
  }

  /** True unless explicitly 'unavailable'. Degraded still counts as usable. */
  isAvailable(capability: string): boolean {
    return this.map.get(capability)?.state !== 'unavailable';
  }

  list(): CapabilityStatus[] {
    return [...this.map.values()];
  }

  onChange(listener: CapabilityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

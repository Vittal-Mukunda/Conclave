// Injected clock so every time-dependent scheduler behaviour is deterministically
// testable. Production uses RealClock; tests use ManualClock and call advance().

export interface Clock {
  now(): number;
  /** Schedule `cb` after `ms`. Returns a cancel function. */
  setTimeout(cb: () => void, ms: number): () => void;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
  setTimeout(cb: () => void, ms: number): () => void {
    const handle = setTimeout(cb, ms);
    // Don't keep the host process alive just for a scheduler wake.
    (handle as { unref?: () => void }).unref?.();
    return () => clearTimeout(handle);
  }
}

interface Timer {
  id: number;
  at: number;
  cb: () => void;
  cancelled: boolean;
}

/** Virtual clock for tests. advance(ms) fires due timers in order and flushes
 * microtasks between them so async issue() chains settle deterministically. */
export class ManualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: Timer[] = [];

  now(): number {
    return this.t;
  }

  setTimeout(cb: () => void, ms: number): () => void {
    const id = ++this.seq;
    this.timers.push({ id, at: this.t + Math.max(0, ms), cb, cancelled: false });
    return () => {
      const timer = this.timers.find((x) => x.id === id);
      if (timer) {
        timer.cancelled = true;
      }
    };
  }

  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await flush();
    for (;;) {
      const due = this.timers
        .filter((x) => !x.cancelled && x.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) {
        break;
      }
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = Math.max(this.t, due.at);
      due.cb();
      await flush();
    }
    this.t = target;
    await flush();
  }
}

/** Drain the microtask/immediate queue several times to settle promise chains. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

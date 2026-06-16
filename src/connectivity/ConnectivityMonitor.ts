// Online/offline monitor with a queue-and-resume buffer (SETUP-8 / UX-4). When
// offline, actions enqueued here are held and automatically drained the moment
// connectivity returns. The network probe and clock are injected so the logic is
// deterministically unit-testable without real IO.

export type ProbeFn = () => Promise<boolean>;
export type ConnectivityListener = (online: boolean) => void;

export class ConnectivityMonitor {
  private _online: boolean;
  private readonly queue: Array<() => Promise<void>> = [];
  private readonly listeners = new Set<ConnectivityListener>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly probe: ProbeFn,
    initialOnline = true,
  ) {
    this._online = initialOnline;
  }

  get online(): boolean {
    return this._online;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  onChange(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Run `task` now if online; otherwise hold it and run it (FIFO) when we come
   * back online. The returned promise settles with the task's eventual result.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this._online) {
      return Promise.resolve().then(task);
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (err) {
          reject(err as Error);
        }
      });
    });
  }

  /** Probe once and update state (used by the poller and by manual "Retry"). */
  async check(): Promise<boolean> {
    let ok: boolean;
    try {
      ok = await this.probe();
    } catch {
      ok = false;
    }
    this.setOnline(ok);
    return ok;
  }

  start(intervalMs = 15000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.check();
    }, intervalMs);
    // Do not keep the host process alive just for the poller.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private setOnline(value: boolean): void {
    if (value === this._online) {
      return;
    }
    this._online = value;
    for (const l of this.listeners) {
      try {
        l(value);
      } catch {
        /* a listener must not break the monitor */
      }
    }
    if (value) {
      this.drain();
    }
  }

  private drain(): void {
    const pending = this.queue.splice(0);
    for (const run of pending) {
      void run();
    }
  }
}

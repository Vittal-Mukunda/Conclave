import { describe, it, expect, vi } from 'vitest';
import { ConnectivityMonitor } from '../../src/connectivity/ConnectivityMonitor';

describe('ConnectivityMonitor (UX-4: offline detected, queued action resumes)', () => {
  it('holds an action while offline and runs it on reconnect', async () => {
    let reachable = false;
    const monitor = new ConnectivityMonitor(async () => reachable, /* initialOnline */ false);

    const ran = vi.fn();
    const pending = monitor.enqueue(async () => {
      ran();
      return 'done';
    });

    // Still offline: the task must not have run.
    expect(ran).not.toHaveBeenCalled();
    expect(monitor.queuedCount).toBe(1);

    // Connectivity returns -> check() flips state and drains the queue.
    reachable = true;
    await monitor.check();

    await expect(pending).resolves.toBe('done');
    expect(ran).toHaveBeenCalledOnce();
    expect(monitor.online).toBe(true);
    expect(monitor.queuedCount).toBe(0);
  });

  it('runs immediately when online', async () => {
    const monitor = new ConnectivityMonitor(async () => true, true);
    await expect(monitor.enqueue(async () => 7)).resolves.toBe(7);
  });

  it('notifies listeners on state change only', async () => {
    let reachable = true;
    const monitor = new ConnectivityMonitor(async () => reachable, true);
    const listener = vi.fn();
    monitor.onChange(listener);

    await monitor.check(); // still online -> no event
    expect(listener).not.toHaveBeenCalled();

    reachable = false;
    await monitor.check(); // online -> offline
    expect(listener).toHaveBeenCalledWith(false);
  });

  it('a probe that throws is treated as offline', async () => {
    const monitor = new ConnectivityMonitor(async () => {
      throw new Error('dns blew up');
    }, true);
    await monitor.check();
    expect(monitor.online).toBe(false);
  });
});

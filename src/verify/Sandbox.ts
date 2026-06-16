import { exec } from 'child_process';
import { CommandRunner, RunResult } from './types';

const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * The shipped default `CommandRunner`: a local subprocess with a time limit and
 * an output cap. This is a *degraded* sandbox — it isolates by process, not by
 * container, so the host marks Capability.Sandbox = degraded. A real
 * Docker/Firecracker runner drops in behind the same `CommandRunner` interface
 * (VER-7 OOM via cgroup limits, VER-8 cached images) with no change to the ladder.
 *
 * A killed process (time limit) returns `timedOut` so the ladder reports a
 * partial verification (VER-2/4) rather than a hang. Buffer overflow (a flood of
 * output, a proxy for runaway/OOM here) surfaces as a failure, never a crash.
 */
export class ProcessSandbox implements CommandRunner {
  constructor(private readonly maxBuffer = DEFAULT_MAX_BUFFER) {}

  run(command: string, opts: { cwd?: string; timeoutMs?: number }): Promise<RunResult> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = exec(
        command,
        { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: this.maxBuffer, windowsHide: true },
        (err, stdout, stderr) => {
          const durationMs = Date.now() - started;
          // exec sets err.killed + err.signal when the timeout fires.
          const killed = Boolean(err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed);
          const timedOut = killed && opts.timeoutMs !== undefined;
          const exitCode = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
          resolve({
            exitCode: timedOut ? null : typeof exitCode === 'number' ? exitCode : 1,
            stdout: stdout ?? '',
            stderr: stderr ?? (err && !timedOut ? String(err.message) : ''),
            timedOut,
            durationMs,
          });
        },
      );
      // Detach stdin so a command that reads input can't hang the run.
      child.stdin?.end();
    });
  }
}

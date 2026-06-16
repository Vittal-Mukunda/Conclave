// Phase 9 — verification ladder. Pure types shared by the ladder, the
// confidence model and the sandbox runner. Nothing here imports vscode so the
// orchestration + scoring stay unit-testable with a fake CommandRunner.

/** Escalating rungs, weakest signal to strongest. */
export type RungKind = 'typecheck' | 'lint' | 'build' | 'test' | 'coverage';

export interface Rung {
  kind: RungKind;
  /** Shell command to execute (e.g. "npm run typecheck"). */
  command: string;
  timeoutMs?: number;
  /** Run twice and flag if results disagree (VER-1). Only meaningful for tests. */
  detectFlake?: boolean;
}

export interface RunResult {
  /** Process exit code; null when killed (e.g. timeout). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when a time limit killed the process (VER-2 / VER-4). */
  timedOut: boolean;
  durationMs: number;
}

/** Minimal command surface. Host backs it with a process sandbox; tests with a fake. */
export interface CommandRunner {
  run(command: string, opts: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
}

export type RungStatus = 'pass' | 'fail' | 'timeout' | 'skipped' | 'flaky';

export interface RungResult {
  kind: RungKind;
  status: RungStatus;
  durationMs: number;
  /** Why it skipped / what failed / flake detail. */
  reason?: string;
  /** Tail of combined output for the report. */
  output?: string;
}

export interface Verdict {
  rungs: RungResult[];
  /** Calibrated 0..1. Honest: low when evidence is weak, never falsely high. */
  confidence: number;
  /** Human-readable caveats (VER-3/5/9/10 etc.). */
  flags: string[];
  /** All attempted (non-skipped) rungs passed. */
  passed: boolean;
}

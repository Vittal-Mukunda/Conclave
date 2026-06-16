import { ConfidenceModel } from './ConfidenceModel';
import { CommandRunner, Rung, RungResult, RunResult, Verdict } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL = 4_000;

export interface LadderOptions {
  cwd?: string;
  /**
   * Optional second runner representing the real host. When given, a passing
   * test rung is re-run here; a divergent result flags an env difference (VER-9).
   */
  hostRunner?: CommandRunner;
}

/**
 * Runs verification rungs weakest-to-strongest and assembles a calibrated
 * Verdict. Pure orchestration over a `CommandRunner`; IO lives in the sandbox.
 *
 * Catalog: VER-1 (flaky -> run twice, flag), VER-2/4 (timeout -> kill + partial),
 * VER-9 (sandbox/host divergence -> flag). A hard failure short-circuits: later
 * rungs are marked skipped ("prior rung failed") since their result would be
 * meaningless. VER-3/5/10 are surfaced by the ConfidenceModel from which rungs
 * the caller did/didn't include.
 */
export class VerificationLadder {
  constructor(
    private readonly runner: CommandRunner,
    private readonly confidence: ConfidenceModel = new ConfidenceModel(),
  ) {}

  async run(rungs: Rung[], opts: LadderOptions = {}): Promise<Verdict> {
    const results: RungResult[] = [];
    let envDiff = false;
    let halted = false;

    for (const rung of rungs) {
      if (halted) {
        results.push({ kind: rung.kind, status: 'skipped', durationMs: 0, reason: 'prior rung failed' });
        continue;
      }

      const first = await this.exec(rung, opts.cwd);
      let result = this.classify(rung, first);

      // VER-1: re-run to detect flakiness when asked.
      if (rung.detectFlake && (result.status === 'pass' || result.status === 'fail')) {
        const second = await this.exec(rung, opts.cwd);
        const secondStatus = this.classify(rung, second).status;
        if (secondStatus !== result.status) {
          result = {
            kind: rung.kind,
            status: 'flaky',
            durationMs: first.durationMs + second.durationMs,
            reason: `inconsistent across runs (${result.status} then ${secondStatus})`,
            output: tail(combine(second)),
          };
        }
      }

      // VER-9: a passing test rung re-checked on the host.
      if (result.status === 'pass' && rung.kind === 'test' && opts.hostRunner) {
        const onHost = await opts.hostRunner.run(rung.command, { cwd: opts.cwd, timeoutMs: rung.timeoutMs ?? DEFAULT_TIMEOUT_MS });
        if (this.classify(rung, onHost).status !== 'pass') {
          envDiff = true;
        }
      }

      results.push(result);
      if (result.status === 'fail' || result.status === 'timeout') {
        halted = true;
      }
    }

    return this.confidence.score(results, { envDiff });
  }

  private exec(rung: Rung, cwd?: string): Promise<RunResult> {
    return this.runner.run(rung.command, { cwd, timeoutMs: rung.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  }

  private classify(rung: Rung, r: RunResult): RungResult {
    const base = { kind: rung.kind, durationMs: r.durationMs, output: tail(combine(r)) };
    if (r.timedOut) {
      return { ...base, status: 'timeout', reason: 'exceeded time limit' };
    }
    if (r.exitCode === 0) {
      return { ...base, status: 'pass' };
    }
    return { ...base, status: 'fail', reason: `exit code ${r.exitCode}` };
  }
}

function combine(r: RunResult): string {
  return `${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`;
}

function tail(s: string): string {
  return s.length > OUTPUT_TAIL ? s.slice(-OUTPUT_TAIL) : s;
}

import { describe, it, expect } from 'vitest';
import { VerificationLadder } from '../../src/verify/VerificationLadder';
import { CommandRunner, RunResult, Rung } from '../../src/verify/types';

type Scripted = Partial<RunResult> & { exitCode: number | null };

/** Returns queued results per command; falls back to a pass. */
class FakeRunner implements CommandRunner {
  calls: string[] = [];
  constructor(private readonly queues: Record<string, Scripted[]> = {}) {}
  run(command: string): Promise<RunResult> {
    this.calls.push(command);
    const next = this.queues[command]?.shift();
    return Promise.resolve(fill(next ?? { exitCode: 0 }));
  }
}

function fill(s: Scripted): RunResult {
  return { exitCode: s.exitCode, stdout: s.stdout ?? '', stderr: s.stderr ?? '', timedOut: s.timedOut ?? false, durationMs: s.durationMs ?? 1 };
}

const rung = (kind: Rung['kind'], command: string, extra: Partial<Rung> = {}): Rung => ({ kind, command, ...extra });

describe('VerificationLadder', () => {
  it('runs rungs in order and passes when all pass', async () => {
    const runner = new FakeRunner();
    const v = await new VerificationLadder(runner).run([
      rung('typecheck', 'tc'),
      rung('build', 'b'),
      rung('test', 't'),
      rung('coverage', 'c'),
    ]);
    expect(runner.calls).toEqual(['tc', 'b', 't', 'c']);
    expect(v.passed).toBe(true);
    expect(v.rungs.map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
  });

  it('short-circuits: a failed rung skips the rest', async () => {
    const runner = new FakeRunner({ b: [{ exitCode: 1 }] });
    const v = await new VerificationLadder(runner).run([
      rung('typecheck', 'tc'),
      rung('build', 'b'),
      rung('test', 't'),
    ]);
    expect(v.rungs.map((r) => r.status)).toEqual(['pass', 'fail', 'skipped']);
    expect(runner.calls).toEqual(['tc', 'b']); // test never ran
    expect(v.passed).toBe(false);
  });

  it('VER-2/4: a timeout halts the ladder and is reported', async () => {
    const runner = new FakeRunner({ t: [{ exitCode: null, timedOut: true }] });
    const v = await new VerificationLadder(runner).run([rung('test', 't'), rung('coverage', 'c')]);
    expect(v.rungs[0].status).toBe('timeout');
    expect(v.rungs[1].status).toBe('skipped');
  });

  it('VER-1: re-runs a flake-detecting test and flags inconsistency', async () => {
    // First run passes, second fails -> flaky.
    const runner = new FakeRunner({ t: [{ exitCode: 0 }, { exitCode: 1 }] });
    const v = await new VerificationLadder(runner).run([rung('test', 't', { detectFlake: true })]);
    expect(v.rungs[0].status).toBe('flaky');
    expect(runner.calls.filter((c) => c === 't')).toHaveLength(2);
  });

  it('VER-1: two consistent passes are not flaky', async () => {
    const runner = new FakeRunner({ t: [{ exitCode: 0 }, { exitCode: 0 }] });
    const v = await new VerificationLadder(runner).run([rung('test', 't', { detectFlake: true })]);
    expect(v.rungs[0].status).toBe('pass');
  });

  it('VER-9: sandbox pass + host fail flags an env difference', async () => {
    const sandbox = new FakeRunner({ t: [{ exitCode: 0 }] });
    const host = new FakeRunner({ t: [{ exitCode: 1 }] });
    const v = await new VerificationLadder(sandbox).run([rung('test', 't')], { hostRunner: host });
    expect(v.flags.some((f) => /VER-9/.test(f))).toBe(true);
  });
});

import { RungKind, RungResult, Verdict } from './types';

// Turns rung outcomes into a calibrated confidence + honest caveats. The guiding
// rule (mirrors LOC-1): never report falsely high confidence. Weak evidence
// (no tests, no coverage, flaky, partial, env divergence) caps the score and
// always raises a visible flag.

/** Relative weight of each rung as evidence the change is correct. */
const WEIGHTS: Record<RungKind, number> = {
  typecheck: 0.15,
  lint: 0.1,
  build: 0.25,
  test: 0.4,
  coverage: 0.1,
};

/** Ceilings applied when stronger evidence is missing. */
const NO_TESTS_CAP = 0.4; // VER-5: type-check only
const NO_COVERAGE_CAP = 0.85; // VER-10: passed but unmeasured coverage
const TIMEOUT_CAP = 0.5; // VER-2/4: partial run
const FAIL_CAP = 0.2; // a real failure: confidence floor-ish

export interface ConfidenceContext {
  /** Test rung passed in the sandbox but a host re-run diverged (VER-9). */
  envDiff?: boolean;
}

export class ConfidenceModel {
  score(rungs: RungResult[], ctx: ConfidenceContext = {}): Verdict {
    const flags: string[] = [];
    const attempted = rungs.filter((r) => r.status !== 'skipped');
    const passedRungs = rungs.filter((r) => r.status === 'pass');
    const anyFail = attempted.some((r) => r.status === 'fail');
    const anyTimeout = attempted.some((r) => r.status === 'timeout');
    const flaky = rungs.filter((r) => r.status === 'flaky');

    const hadTests = rungs.some((r) => r.kind === 'test' && r.status !== 'skipped');
    const hadCoverage = rungs.some((r) => r.kind === 'coverage' && r.status !== 'skipped');

    // Base: fraction of attempted evidence (by weight) that passed.
    const attemptedWeight = sumWeight(attempted);
    const passedWeight = sumWeight(passedRungs);
    let confidence = attemptedWeight > 0 ? passedWeight / attemptedWeight : 0;

    if (anyFail) {
      flags.push('Verification failed — see the failing rung.');
      confidence = Math.min(confidence, FAIL_CAP);
    }
    if (anyTimeout) {
      flags.push('A rung timed out (VER-2/4) — only a partial verification ran.');
      confidence = Math.min(confidence, TIMEOUT_CAP);
    }
    if (flaky.length > 0) {
      flags.push(`Flaky result on ${flaky.map((f) => f.kind).join(', ')} (VER-1) — treat as unreliable.`);
      confidence *= 0.7;
    }
    if (!hadTests) {
      flags.push('No tests ran (VER-5) — type-check/build only, LOW confidence.');
      confidence = Math.min(confidence, NO_TESTS_CAP);
    } else if (!hadCoverage) {
      flags.push('No coverage measured (VER-10) — confidence held conservative.');
      confidence = Math.min(confidence, NO_COVERAGE_CAP);
    }
    // Rungs skipped because they needed unavailable services (VER-3).
    const partial = rungs.some((r) => r.status === 'skipped' && /service|network|db/i.test(r.reason ?? ''));
    if (partial) {
      flags.push('Some checks were skipped — they need services not available here (VER-3).');
      confidence *= 0.8;
    }
    if (ctx.envDiff) {
      flags.push('Passed in the sandbox but diverged on the host (VER-9) — environment differs.');
      confidence *= 0.6;
    }

    return {
      rungs,
      confidence: clamp(confidence),
      flags,
      passed: attempted.length > 0 && !anyFail && !anyTimeout && flaky.length === 0,
    };
  }
}

function sumWeight(rungs: RungResult[]): number {
  return rungs.reduce((s, r) => s + WEIGHTS[r.kind], 0);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}

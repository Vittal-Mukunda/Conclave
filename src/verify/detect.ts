import { Rung } from './types';

// Pure rung detection from a package.json `scripts` map plus an optionally
// remembered test command (VER-6, from RepoMemory). Returns the ladder in
// weakest-to-strongest order. A missing test command yields no test rung, which
// the ConfidenceModel surfaces as VER-5 (LOW confidence) rather than a false pass.

export interface DetectInput {
  scripts?: Record<string, string>;
  /** Remembered test command for this workspace (overrides script detection). */
  rememberedTest?: string;
}

export function buildRungs(input: DetectInput): Rung[] {
  const scripts = input.scripts ?? {};
  const rungs: Rung[] = [];

  if (scripts.typecheck) {
    rungs.push({ kind: 'typecheck', command: 'npm run typecheck' });
  }
  if (scripts.lint) {
    rungs.push({ kind: 'lint', command: 'npm run lint' });
  }
  if (scripts.build) {
    rungs.push({ kind: 'build', command: 'npm run build' });
  }

  const testCommand = input.rememberedTest ?? detectTestScript(scripts);
  if (testCommand) {
    rungs.push({ kind: 'test', command: testCommand, detectFlake: true });
  }

  const coverage = scripts.coverage
    ? 'npm run coverage'
    : scripts['test:coverage']
      ? 'npm run test:coverage'
      : undefined;
  if (coverage) {
    rungs.push({ kind: 'coverage', command: coverage });
  }

  return rungs;
}

function detectTestScript(scripts: Record<string, string>): string | undefined {
  if (scripts.test) {
    return 'npm test';
  }
  if (scripts['test:unit']) {
    return 'npm run test:unit';
  }
  return undefined;
}

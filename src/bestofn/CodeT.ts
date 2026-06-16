import { Solution } from './types';

// CodeT dual-execution consensus (OR design §7). Solutions that pass the SAME
// set of tests are functionally agreeing; the more solutions agree and the more
// tests they jointly pass, the more we trust them. Score per solution:
//
//     |passing_solutions| · |passing_tests|²
//
// where passing_solutions = the agreement cluster (solutions with the identical
// pass signature) and passing_tests = the tests that cluster passes. Quadratic in
// tests so broad correctness dominates mere agreement; a lone solution that
// passes many tests still scores, but a cluster that agrees on many tests wins.

export interface ConsensusEntry {
  id: string;
  /** Solutions sharing this solution's exact pass signature (the cluster). */
  clusterSize: number;
  /** Tests this solution passes. */
  testsPassed: number;
  /** clusterSize · testsPassed². */
  score: number;
}

function signature(passed: boolean[]): string {
  return passed.map((p) => (p ? '1' : '0')).join('');
}

/** Rank solutions by dual-execution consensus, strongest first. */
export function codeTConsensus(solutions: Solution[]): ConsensusEntry[] {
  const clusters = new Map<string, number>();
  for (const s of solutions) {
    const sig = signature(s.passed);
    clusters.set(sig, (clusters.get(sig) ?? 0) + 1);
  }

  return solutions
    .map((s) => {
      const sig = signature(s.passed);
      const clusterSize = clusters.get(sig) ?? 1;
      const testsPassed = s.passed.filter(Boolean).length;
      return { id: s.id, clusterSize, testsPassed, score: clusterSize * testsPassed * testsPassed };
    })
    .sort((a, b) => b.score - a.score || b.testsPassed - a.testsPassed || a.id.localeCompare(b.id));
}

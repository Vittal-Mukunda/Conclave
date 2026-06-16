import { codeTConsensus } from './CodeT';
import { Solution } from './types';

// The STRONG selector (OR design §7): rank candidates by a fusion of the CodeT
// dual-execution consensus with the LSP/type signal, a diverse-critic vote, and
// changed-line coverage. The consensus term dominates (execution feedback is the
// judge, not self-report), but the other signals break ties and catch a cluster
// that agrees on weak tests. Pure and deterministic.

export interface SelectorWeights {
  consensus: number;
  typeSignal: number;
  criticVote: number;
  coverage: number;
}

export const DEFAULT_WEIGHTS: SelectorWeights = {
  consensus: 0.5,
  typeSignal: 0.2,
  criticVote: 0.15,
  coverage: 0.15,
};

export interface Ranking {
  id: string;
  score: number;
  consensus: number;
  /** Normalised consensus in [0,1]. */
  consensusNorm: number;
}

export interface SelectionResult {
  winnerId?: string;
  rankings: Ranking[];
  /** Any drawn solution passes the ladder (oracle Pass@K is satisfiable). */
  oraclePass: boolean;
  /** The selected winner passes the ladder (Best@K). */
  bestPass: boolean;
  /** oraclePass && !bestPass — the SELECTOR is the bottleneck, not K (invest in
   *  the verifier, per §7). Loudly flagged for telemetry. */
  selectorMiss: boolean;
}

export class Selector {
  constructor(private readonly weights: SelectorWeights = DEFAULT_WEIGHTS) {}

  select(solutions: Solution[]): SelectionResult {
    if (solutions.length === 0) {
      return { winnerId: undefined, rankings: [], oraclePass: false, bestPass: false, selectorMiss: false };
    }

    const consensus = new Map(codeTConsensus(solutions).map((c) => [c.id, c.score]));
    const maxConsensus = Math.max(1, ...consensus.values());

    const rankings: Ranking[] = solutions
      .map((s) => {
        const cRaw = consensus.get(s.id) ?? 0;
        const cNorm = cRaw / maxConsensus;
        const score =
          this.weights.consensus * cNorm +
          this.weights.typeSignal * (s.typeSignal ?? 0) +
          this.weights.criticVote * (s.criticVote ?? 0) +
          this.weights.coverage * (s.coverage ?? 0);
        return { id: s.id, score, consensus: cRaw, consensusNorm: cNorm };
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const winnerId = rankings[0]?.id;
    const byId = new Map(solutions.map((s) => [s.id, s]));
    const oraclePass = solutions.some((s) => s.ladderPass);
    const bestPass = winnerId ? byId.get(winnerId)?.ladderPass === true : false;
    return { winnerId, rankings, oraclePass, bestPass, selectorMiss: oraclePass && !bestPass };
  }
}

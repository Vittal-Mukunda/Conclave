import { pandoraOrder, pandoraStop } from './Pandora';
import { Selector, SelectionResult } from './Selector';
import { passFraction, SampleSource, Solution } from './types';

// Best-of-N orchestrator (OR design §7). Draws candidate solutions from sources
// in Weitzman reservation order, stopping when (a) a candidate passes the ladder
// — the CODING stop, first good-enough wins; (b) the best reward in hand beats
// every remaining reservation — Pandora optimality; or (c) the K ceiling / latency
// budget is hit. The drawn set is then ranked by the strong Selector (CodeT
// consensus + type + critic + coverage). N is endogenous; K is just a ceiling.

export interface BestOfNConfig {
  /** Ceiling on samples (target K~8). */
  maxSamples?: number;
  /** Optional wall-clock budget for the two-phase Pandora-over-time stop. */
  deadlineMs?: number;
  now?: () => number;
}

export type StopReason = 'ladder' | 'reservation' | 'cap' | 'deadline' | 'exhausted';

export interface BestOfNResult {
  drawn: Solution[];
  selection: SelectionResult;
  winner?: Solution;
  opened: number;
  stoppedBy: StopReason;
}

export class BestOfN {
  private readonly selector: Selector;
  private readonly maxSamples: number;

  constructor(selector?: Selector, private readonly config: BestOfNConfig = {}) {
    this.selector = selector ?? new Selector();
    this.maxSamples = config.maxSamples ?? 8;
  }

  async run(sources: SampleSource[]): Promise<BestOfNResult> {
    const order = pandoraOrder(sources.map((s) => ({ id: s.id, reservation: s.reservation, value: s })));
    const now = this.config.now ?? (() => Date.now());
    const start = now();

    const drawn: Solution[] = [];
    let best = -Infinity;
    let stoppedBy: StopReason = 'exhausted';

    for (let i = 0; i < order.length; i++) {
      if (drawn.length >= this.maxSamples) {
        stoppedBy = 'cap';
        break;
      }
      if (this.config.deadlineMs !== undefined && now() - start >= this.config.deadlineMs) {
        stoppedBy = 'deadline';
        break;
      }
      // Pandora reservation stop: nothing left can beat what we hold.
      if (best >= 0 && pandoraStop(best, order[i].reservation)) {
        stoppedBy = 'reservation';
        break;
      }

      const sol = await order[i].value.draw();
      drawn.push(sol);
      best = Math.max(best, passFraction(sol));

      // CODING stop: first candidate that clears the ladder ends sampling.
      if (sol.ladderPass) {
        stoppedBy = 'ladder';
        break;
      }
    }

    const selection = this.selector.select(drawn);
    const winner = selection.winnerId ? drawn.find((s) => s.id === selection.winnerId) : undefined;
    return { drawn, selection, winner, opened: drawn.length, stoppedBy };
  }
}

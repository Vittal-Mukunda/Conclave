// Weitzman / Pandora's-box optimal stopping (OR design §7). Each box has a
// reservation value (cap) and yields a realized reward when opened. The rule:
// open boxes in DECREASING reservation order, and stop as soon as the best reward
// already in hand is at least the highest remaining reservation — no unopened box
// could beat what we hold, so sampling more is wasted cost. This makes N (the
// number of candidates drawn) ENDOGENOUS rather than a fixed K.

export interface PandoraBox<T> {
  id: string;
  reservation: number;
  value: T;
}

/** Stop sampling once the best realized reward dominates every remaining cap. */
export function pandoraStop(bestRealized: number, nextReservation: number): boolean {
  return bestRealized >= nextReservation;
}

/** Reservation order: highest cap first (Weitzman's selection rule). */
export function pandoraOrder<T>(boxes: PandoraBox<T>[]): PandoraBox<T>[] {
  return [...boxes].sort((a, b) => b.reservation - a.reservation || a.id.localeCompare(b.id));
}

export interface PandoraResult<T> {
  /** Boxes opened, in order. */
  opened: { id: string; reward: number; value: T }[];
  chosenId?: string;
  bestReward: number;
  stoppedEarly: boolean;
}

/**
 * Synchronous Pandora engine for deterministic testing. `open` realizes a box's
 * reward. `maxOpens` caps cost (the K ceiling); `stopWhen` is the early CODING
 * stop (e.g. a candidate that passes the ladder).
 */
export function pandora<T>(
  boxes: PandoraBox<T>[],
  open: (box: PandoraBox<T>) => number,
  opts: { maxOpens?: number; stopWhen?: (reward: number) => boolean } = {},
): PandoraResult<T> {
  const order = pandoraOrder(boxes);
  const maxOpens = opts.maxOpens ?? order.length;
  const opened: { id: string; reward: number; value: T }[] = [];
  let bestReward = -Infinity;
  let chosenId: string | undefined;
  let stoppedEarly = false;

  for (let i = 0; i < order.length; i++) {
    if (opened.length >= maxOpens) {
      stoppedEarly = true;
      break;
    }
    // Reservation stop: nothing left can beat what we hold.
    if (bestReward >= 0 && pandoraStop(bestReward, order[i].reservation)) {
      stoppedEarly = true;
      break;
    }
    const reward = open(order[i]);
    opened.push({ id: order[i].id, reward, value: order[i].value });
    if (reward > bestReward) {
      bestReward = reward;
      chosenId = order[i].id;
    }
    if (opts.stopWhen?.(reward)) {
      stoppedEarly = true; // CODING stop — first good-enough candidate
      break;
    }
  }

  return { opened, chosenId, bestReward: bestReward === -Infinity ? 0 : bestReward, stoppedEarly };
}

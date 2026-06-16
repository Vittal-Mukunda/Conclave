import { describe, it, expect } from 'vitest';
import { pandora, pandoraOrder, pandoraStop, PandoraBox } from '../../src/bestofn/Pandora';

function box(id: string, reservation: number): PandoraBox<string> {
  return { id, reservation, value: id };
}

describe('Pandora', () => {
  it('opens boxes in decreasing reservation order', () => {
    const order = pandoraOrder([box('lo', 0.2), box('hi', 0.9), box('mid', 0.5)]);
    expect(order.map((b) => b.id)).toEqual(['hi', 'mid', 'lo']);
  });

  it('stops when the best reward dominates remaining reservations', () => {
    expect(pandoraStop(0.8, 0.5)).toBe(true);
    expect(pandoraStop(0.4, 0.5)).toBe(false);
  });

  it('stops early when an opened box beats every remaining cap', () => {
    // hi(res .9) opens to reward .95; mid(.5) and lo(.2) can't beat it -> stop.
    const rewards: Record<string, number> = { hi: 0.95, mid: 0.4, lo: 0.1 };
    const r = pandora([box('lo', 0.2), box('hi', 0.9), box('mid', 0.5)], (b) => rewards[b.id]);
    expect(r.opened.map((o) => o.id)).toEqual(['hi']);
    expect(r.chosenId).toBe('hi');
    expect(r.stoppedEarly).toBe(true);
  });

  it('keeps opening while reservations still exceed the best reward', () => {
    // hi opens low (.3); mid(.5)>.3 so keep going; mid opens .6 > lo(.2) -> stop.
    const rewards: Record<string, number> = { hi: 0.3, mid: 0.6, lo: 0.1 };
    const r = pandora([box('lo', 0.2), box('hi', 0.9), box('mid', 0.5)], (b) => rewards[b.id]);
    expect(r.opened.map((o) => o.id)).toEqual(['hi', 'mid']);
    expect(r.chosenId).toBe('mid');
  });

  it('honours the maxOpens ceiling', () => {
    const r = pandora(
      [box('a', 0.9), box('b', 0.8), box('c', 0.7)],
      () => 0, // never satisfies reservation stop
      { maxOpens: 2 },
    );
    expect(r.opened).toHaveLength(2);
    expect(r.stoppedEarly).toBe(true);
  });

  it('stopWhen triggers the coding stop on the first good box', () => {
    const r = pandora(
      [box('a', 0.9), box('b', 0.8)],
      () => 1,
      { stopWhen: (reward) => reward >= 1 },
    );
    expect(r.opened).toHaveLength(1);
  });
});

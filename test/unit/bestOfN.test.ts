import { describe, it, expect } from 'vitest';
import { BestOfN } from '../../src/bestofn/BestOfN';
import { SampleSource, Solution } from '../../src/bestofn/types';

function source(id: string, reservation: number, sol: Solution, log: string[]): SampleSource {
  return {
    id,
    reservation,
    draw: () => {
      log.push(id);
      return sol;
    },
  };
}

describe('BestOfN', () => {
  it('CODING stop: halts at the first candidate passing the ladder', async () => {
    const log: string[] = [];
    const sources = [
      source('hi', 0.9, { id: 'hi', passed: [true, true], ladderPass: true }, log),
      source('mid', 0.8, { id: 'mid', passed: [true, true], ladderPass: true }, log),
      source('lo', 0.7, { id: 'lo', passed: [true, true], ladderPass: true }, log),
    ];
    const r = await new BestOfN().run(sources);
    expect(r.stoppedBy).toBe('ladder');
    expect(r.opened).toBe(1);
    expect(log).toEqual(['hi']); // mid/lo never drawn
  });

  it('Pandora stop: stops once the best reward beats remaining reservations', async () => {
    const log: string[] = [];
    const sources = [
      source('hi', 0.9, { id: 'hi', passed: [true, true, true], ladderPass: false }, log), // pf=1.0
      source('mid', 0.5, { id: 'mid', passed: [false], ladderPass: false }, log),
      source('lo', 0.2, { id: 'lo', passed: [false], ladderPass: false }, log),
    ];
    const r = await new BestOfN().run(sources);
    expect(r.stoppedBy).toBe('reservation');
    expect(r.opened).toBe(1);
    expect(log).toEqual(['hi']);
  });

  it('honours the K ceiling (maxSamples)', async () => {
    const log: string[] = [];
    const sources = ['a', 'b', 'c', 'd'].map((id) =>
      source(id, 0.6, { id, passed: [false, false], ladderPass: false }, log),
    );
    const r = await new BestOfN(undefined, { maxSamples: 2 }).run(sources);
    expect(r.opened).toBe(2);
    expect(r.stoppedBy).toBe('cap');
  });

  it('selects the consensus winner among all drawn candidates', async () => {
    const log: string[] = [];
    // High reservations so Pandora never early-stops; partial pass so no ladder stop.
    const sources = [
      source('a', 1, { id: 'a', passed: [true, true, false], ladderPass: false }, log),
      source('b', 1, { id: 'b', passed: [true, true, false], ladderPass: false }, log), // agrees with a
      source('c', 1, { id: 'c', passed: [true, false, false], ladderPass: false }, log),
    ];
    const r = await new BestOfN(undefined, { maxSamples: 8 }).run(sources);
    expect(r.opened).toBe(3);
    expect(['a', 'b']).toContain(r.winner?.id); // consensus cluster wins
  });

  it('empty sources yield no winner', async () => {
    const r = await new BestOfN().run([]);
    expect(r.winner).toBeUndefined();
    expect(r.opened).toBe(0);
  });
});

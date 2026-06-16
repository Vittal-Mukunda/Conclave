import { describe, it, expect } from 'vitest';
import {
  applyHunks,
  detectEol,
  hasConflictMarkers,
  joinLines,
  splitLines,
} from '../../src/editing/patch';
import { Hunk } from '../../src/editing/types';

const lines = (s: string) => splitLines(s);

describe('patch — applyHunks', () => {
  it('replaces a contiguous region anchored on its old lines', () => {
    const src = ['a', 'b', 'c', 'd'];
    const h: Hunk = { startLine: 2, oldLines: ['b', 'c'], newLines: ['B', 'C', 'C2'] };
    const r = applyHunks(src, [h]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual(['a', 'B', 'C', 'C2', 'd']);
  });

  it('applies multiple hunks bottom-up so line numbers stay valid', () => {
    const src = ['1', '2', '3', '4', '5'];
    const hunks: Hunk[] = [
      { startLine: 1, oldLines: ['1'], newLines: ['1', '1b'] }, // grows file
      { startLine: 4, oldLines: ['4'], newLines: ['four'] },
    ];
    const r = applyHunks(src, hunks);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual(['1', '1b', '2', '3', 'four', '5']);
  });

  it('inserts with an empty oldLines anchor', () => {
    const src = ['a', 'b'];
    const r = applyHunks(src, [{ startLine: 2, oldLines: [], newLines: ['inserted'] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual(['a', 'inserted', 'b']);
  });

  it('deletes with an empty newLines', () => {
    const r = applyHunks(['a', 'b', 'c'], [{ startLine: 2, oldLines: ['b'], newLines: [] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual(['a', 'c']);
  });

  it('EDIT-8: re-syncs when the anchor shifted within the window', () => {
    // The edit was generated against line 2, but a line was inserted above.
    const src = ['header', 'a', 'b', 'c'];
    const h: Hunk = { startLine: 2, oldLines: ['b'], newLines: ['B'] };
    const r = applyHunks(src, [h]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toEqual(['header', 'a', 'B', 'c']);
  });

  it('EDIT-1: reports drift (never forces) when context no longer matches', () => {
    const src = ['a', 'totally', 'different'];
    const r = applyHunks(src, [{ startLine: 2, oldLines: ['b', 'c'], newLines: ['X'] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/drift/i);
  });
});

describe('patch — helpers', () => {
  it('round-trips split/join and preserves CRLF on rewrite', () => {
    const crlf = 'a\r\nb\r\nc';
    expect(detectEol(crlf)).toBe('\r\n');
    expect(joinLines(lines(crlf), detectEol(crlf))).toBe(crlf);
  });

  it('EDIT-4: detects unresolved conflict markers', () => {
    expect(hasConflictMarkers('ok\n<<<<<<< HEAD\nx')).toBe(true);
    expect(hasConflictMarkers('=======')).toBe(true);
    expect(hasConflictMarkers('no markers here')).toBe(false);
  });
});

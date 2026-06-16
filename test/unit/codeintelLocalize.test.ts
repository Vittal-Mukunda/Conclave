import { describe, it, expect } from 'vitest';
import { HeuristicSymbolExtractor } from '../../src/codeintel/symbols';
import { DependencyGraph } from '../../src/codeintel/depgraph';
import { fuse, ChunkSignal } from '../../src/codeintel/Localizer';
import { CodeIndex } from '../../src/codeintel/CodeIndex';
import { HashingEmbedder } from '../../src/codeintel/embeddings';
import { SourceFile } from '../../src/codeintel/types';

function file(path: string, content: string): SourceFile {
  return { path, content, hash: String(content.length), lines: content.split('\n').length };
}

describe('HeuristicSymbolExtractor', () => {
  const ex = new HeuristicSymbolExtractor();

  it('finds functions, classes, interfaces with line ranges', () => {
    const src = file(
      'a.ts',
      [
        'export function add(a, b) {', // 1
        '  return a + b;', //            2
        '}', //                          3
        '', //                           4
        'export class Widget {', //      5
        '  render() {', //               6
        '    return 1;', //              7
        '  }', //                        8
        '}', //                          9
      ].join('\n'),
    );
    const syms = ex.extract(src);
    const add = syms.find((s) => s.name === 'add')!;
    expect(add).toMatchObject({ kind: 'function', startLine: 1, endLine: 3 });
    const widget = syms.find((s) => s.name === 'Widget')!;
    expect(widget.kind).toBe('class');
    expect(widget.startLine).toBe(5);
    expect(widget.endLine).toBe(9);
  });

  it('detects const arrow functions and python defs', () => {
    const ts = ex.extract(file('b.ts', 'export const handler = (req) => {\n  return req;\n}'));
    expect(ts.find((s) => s.name === 'handler')).toBeTruthy();
    const py = ex.extract(file('c.py', 'def compute(x):\n    return x * 2\n'));
    expect(py.find((s) => s.name === 'compute')?.kind).toBe('function');
  });
});

describe('DependencyGraph', () => {
  it('links relative imports and computes proximity', () => {
    const files = [
      file('src/a.ts', "import { b } from './b';"),
      file('src/b.ts', "import { c } from './sub/c';\nexport const b = 1;"),
      file('src/sub/c.ts', 'export const c = 1;'),
      file('src/lonely.ts', 'export const z = 1;'),
    ];
    const g = new DependencyGraph(files);
    expect(g.edgeCount).toBe(2);
    expect(g.distance('src/a.ts', 'src/b.ts')).toBe(1);
    expect(g.distance('src/a.ts', 'src/sub/c.ts')).toBe(2);
    expect(g.distance('src/a.ts', 'src/lonely.ts')).toBe(Infinity);
    expect(g.proximityBoost(['src/a.ts'], 'src/b.ts')).toBeCloseTo(0.5);
    expect(g.proximityBoost(['src/a.ts'], 'src/lonely.ts')).toBe(0);
  });

  it('ignores external/bare module specifiers', () => {
    const g = new DependencyGraph([file('x.ts', "import fs from 'fs';\nimport vscode from 'vscode';")]);
    expect(g.edgeCount).toBe(0);
  });
});

function sig(over: Partial<ChunkSignal>): ChunkSignal {
  return { file: 'f.ts', startLine: 1, endLine: 10, lex: 0, vec: 0, symbolBoost: 0, proxBoost: 0, ...over };
}

describe('fuse (LOC-1 confidence -> action)', () => {
  it('empty signals => ask', () => {
    const r = fuse('q', []);
    expect(r.action).toBe('ask');
    expect(r.candidates).toHaveLength(0);
  });

  it('strong unambiguous hit => use', () => {
    const r = fuse('q', [
      sig({ file: 'hit.ts', lex: 10, vec: 0.9, symbolBoost: 1 }),
      sig({ file: 'other.ts', lex: 1, vec: 0.1 }),
    ]);
    expect(r.candidates[0].file).toBe('hit.ts');
    expect(r.action).toBe('use');
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('close matches across files => widen (ambiguous)', () => {
    const r = fuse('q', [
      sig({ file: 'a.ts', lex: 10, vec: 0.8 }),
      sig({ file: 'b.ts', lex: 10, vec: 0.8 }),
    ]);
    expect(r.action).toBe('widen');
  });

  it('weak signal => ask', () => {
    const r = fuse('q', [sig({ file: 'a.ts', lex: 0.0001, vec: 0.05 })]);
    expect(r.action).toBe('ask');
  });

  it('dedupes overlapping ranges in the same file, keeps the stronger', () => {
    const r = fuse('q', [
      sig({ file: 'a.ts', startLine: 1, endLine: 20, lex: 10, vec: 0.9 }),
      sig({ file: 'a.ts', startLine: 5, endLine: 15, lex: 9, vec: 0.8 }),
    ]);
    const aRanges = r.candidates.filter((c) => c.file === 'a.ts');
    expect(aRanges).toHaveLength(1);
  });
});

describe('CodeIndex end-to-end', () => {
  const files = [
    file(
      'src/scheduler.ts',
      'export function acquireRateLimit(tokens) {\n  // token bucket rate limiter\n  return bucket.take(tokens);\n}',
    ),
    file('src/ui/button.ts', 'export function renderButton() {\n  return draw("click me");\n}'),
    file('src/cost.ts', 'export function priceCall(tokensIn, tokensOut) {\n  return tokensIn * 2 + tokensOut * 8;\n}'),
  ];

  function index(): CodeIndex {
    const ci = new CodeIndex(new HashingEmbedder(256), new HeuristicSymbolExtractor());
    ci.build(files);
    return ci;
  }

  it('localizes to the right file+symbol for a task', () => {
    const r = index().localize('fix the rate limiter token bucket');
    expect(r.candidates[0].file).toBe('src/scheduler.ts');
    expect(r.candidates[0].symbol).toBe('acquireRateLimit');
    expect(r.candidates[0].reasons).toContain('lexical');
  });

  it('returns precise line ranges (symbol-tightened)', () => {
    const r = index().localize('priceCall pricing of paid tokens');
    const top = r.candidates[0];
    expect(top.file).toBe('src/cost.ts');
    expect(top.startLine).toBe(1);
    expect(top.endLine).toBeGreaterThanOrEqual(1);
  });

  it('incremental update re-indexes a file (LOC-2)', () => {
    const ci = index();
    ci.update(file('src/scheduler.ts', 'export function acquireRateLimit() {\n  return retryWithBackoff();\n}'));
    const r = ci.localize('retry with backoff');
    expect(r.candidates[0].file).toBe('src/scheduler.ts');
  });

  it('unknown topic => low confidence ask/widen, never a false "use"', () => {
    const r = index().localize('quantum teleportation flux capacitor');
    expect(r.action).not.toBe('use');
  });
});

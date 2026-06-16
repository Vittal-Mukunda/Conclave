import { describe, it, expect } from 'vitest';
import { Ignore, isProbablyBinary, isGenerated, inIgnoredDir } from '../../src/codeintel/ignore';
import { chunkFile } from '../../src/codeintel/chunk';
import { LexicalIndex, tokenize } from '../../src/codeintel/lexical';
import { HashingEmbedder, VectorIndex, cosine } from '../../src/codeintel/embeddings';
import { SourceFile } from '../../src/codeintel/types';

function file(path: string, content: string): SourceFile {
  return { path, content, hash: String(content.length), lines: content.split('\n').length };
}

describe('ignore (LOC-3)', () => {
  it('excludes built-in dirs, binaries, generated lockfiles', () => {
    const ig = new Ignore();
    expect(inIgnoredDir('node_modules/x/index.js')).toBe(true);
    expect(ig.ignores('node_modules/x/index.js')).toBe(true);
    expect(isProbablyBinary('media/icon.png')).toBe(true);
    expect(isGenerated('package-lock.json')).toBe(true);
    expect(ig.ignores('src/app.ts')).toBe(false);
  });

  it('applies .gitignore globs, anchoring and negation', () => {
    const ig = Ignore.from(['*.log', '/secret/', '!keep.log'].join('\n'));
    expect(ig.ignores('debug.log')).toBe(true);
    expect(ig.ignores('keep.log')).toBe(false); // negated
    expect(ig.ignores('secret/key.txt')).toBe(true);
    expect(ig.ignores('src/secret/key.txt')).toBe(false); // anchored to root
  });
});

describe('chunkFile (LOC-5)', () => {
  it('returns a single chunk for a small file', () => {
    const chunks = chunkFile(file('a.ts', 'one\ntwo\nthree'), { maxLines: 120 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 3 });
  });

  it('splits a large file into overlapping ranges covering every line', () => {
    const content = Array.from({ length: 250 }, (_, i) => `line${i + 1}`).join('\n');
    const chunks = chunkFile(file('big.ts', content), { maxLines: 100, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[chunks.length - 1].endLine).toBe(250);
    // consecutive chunks overlap
    expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine);
  });
});

describe('lexical BM25', () => {
  it('tokenizes camelCase and snake_case into parts + whole', () => {
    const t = tokenize('getUserToken some_value');
    expect(t).toContain('getusertoken');
    expect(t).toContain('user');
    expect(t).toContain('token');
    expect(t).toContain('value');
  });

  it('ranks the doc containing the query term highest', () => {
    const idx = new LexicalIndex();
    idx.add('auth.ts', 'function verifyToken(token) { return checkExpiry(token); }');
    idx.add('ui.ts', 'function renderButton() { return draw(); }');
    const scores = idx.score('token expiry');
    expect((scores.get('auth.ts') ?? 0)).toBeGreaterThan(scores.get('ui.ts') ?? 0);
  });

  it('remove drops a doc from results', () => {
    const idx = new LexicalIndex();
    idx.add('a.ts', 'alpha beta');
    idx.remove('a.ts');
    expect(idx.size).toBe(0);
    expect(idx.score('alpha').size).toBe(0);
  });
});

describe('embeddings', () => {
  it('cosine of identical text is 1, orthogonal-ish is lower', () => {
    const e = new HashingEmbedder(256);
    const a = e.embed('rate limiter token bucket');
    expect(cosine(a, a)).toBeCloseTo(1);
    const b = e.embed('completely unrelated banana pie');
    expect(cosine(a, b)).toBeLessThan(cosine(a, a));
  });

  it('VectorIndex re-embeds only on hash change (LOC-6)', () => {
    const vi = new VectorIndex(new HashingEmbedder(64));
    expect(vi.upsert('a', 'hello world', 'h1')).toBe(true);
    expect(vi.upsert('a', 'hello world', 'h1')).toBe(false); // unchanged
    expect(vi.upsert('a', 'hello there', 'h2')).toBe(true); // changed
  });

  it('query ranks semantically closer docs first', () => {
    const vi = new VectorIndex(new HashingEmbedder(256));
    vi.upsert('rl', 'rate limiter token bucket scheduler', 'h1');
    vi.upsert('css', 'button color padding margin layout', 'h2');
    const top = vi.query('token bucket rate limit', 5)[0];
    expect(top.docId).toBe('rl');
  });
});

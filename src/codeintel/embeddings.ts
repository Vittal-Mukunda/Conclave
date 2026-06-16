import { Embedder } from './types';
import { tokenize } from './lexical';

// Semantic retrieval arm. The real system will embed with a provider model; the
// shipped default is a deterministic local hashing embedder (the feature-hashing
// "hashing trick") so the pipeline runs offline and tests are reproducible. It
// captures token-overlap semantics, not deep meaning — good enough as a second
// signal fused with lexical + symbol + dependency evidence, and swappable via the
// Embedder interface.

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function hash(token: string): number {
  // FNV-1a 32-bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HashingEmbedder implements Embedder {
  constructor(readonly dim = 256) {}

  embed(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const tokens = tokenize(text);
    for (const t of tokens) {
      const h = hash(t);
      const idx = h % this.dim;
      const sign = (h & 1) === 0 ? 1 : -1; // signed hashing reduces collision bias
      vec[idx] += sign;
    }
    // L2 normalize so cosine == dot and lengths don't dominate.
    let norm = 0;
    for (const v of vec) {
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dim; i++) {
        vec[i] /= norm;
      }
    }
    return vec;
  }
}

interface Entry {
  vec: number[];
  hash: string;
}

/**
 * Cosine-similarity vector store keyed by docId. Re-embeds only when a doc's
 * content hash changes (LOC-6: stale embeddings invalidate/refresh).
 */
export class VectorIndex {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly embedder: Embedder) {}

  get size(): number {
    return this.entries.size;
  }

  /** Insert/update; skips re-embedding when the hash is unchanged. Returns true if (re)embedded. */
  upsert(docId: string, text: string, hash: string): boolean {
    const existing = this.entries.get(docId);
    if (existing && existing.hash === hash) {
      return false;
    }
    this.entries.set(docId, { vec: this.embedder.embed(text), hash });
    return true;
  }

  remove(docId: string): void {
    this.entries.delete(docId);
  }

  /** Top-k docs by cosine similarity to the query. */
  query(text: string, k = 20): Array<{ docId: string; score: number }> {
    const q = this.embedder.embed(text);
    const scored: Array<{ docId: string; score: number }> = [];
    for (const [docId, e] of this.entries) {
      scored.push({ docId, score: cosine(q, e.vec) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

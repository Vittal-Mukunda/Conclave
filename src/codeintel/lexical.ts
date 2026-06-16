// Lexical retrieval: tokenizer + inverted index + BM25 scoring. This is the
// keyword arm of the fused localizer — it catches exact identifiers (function
// names, error strings) that embeddings can blur. Pure + deterministic.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on', 'with',
  'this', 'that', 'be', 'as', 'by', 'at', 'from', 'into',
]);

/** Lowercase tokens; split on non-alphanumerics AND camelCase / snake_case. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9]+/)) {
    if (!raw) {
      continue;
    }
    // Split camelCase / PascalCase into parts, keep the whole too.
    const parts = raw.split(/(?<=[a-z0-9])(?=[A-Z])/);
    const whole = raw.toLowerCase();
    if (whole.length > 1 && !STOP.has(whole)) {
      out.push(whole);
    }
    if (parts.length > 1) {
      for (const p of parts) {
        const lp = p.toLowerCase();
        if (lp.length > 1 && !STOP.has(lp)) {
          out.push(lp);
        }
      }
    }
  }
  return out;
}

interface Posting {
  tf: number;
}

const K1 = 1.5;
const B = 0.75;

export class LexicalIndex {
  private readonly postings = new Map<string, Map<string, Posting>>(); // term -> docId -> tf
  private readonly docLen = new Map<string, number>();
  private totalLen = 0;

  add(docId: string, text: string): void {
    const tokens = tokenize(text);
    this.docLen.set(docId, tokens.length);
    this.totalLen += tokens.length;
    const counts = new Map<string, number>();
    for (const t of tokens) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    for (const [term, tf] of counts) {
      let m = this.postings.get(term);
      if (!m) {
        m = new Map();
        this.postings.set(term, m);
      }
      m.set(docId, { tf });
    }
  }

  remove(docId: string): void {
    const len = this.docLen.get(docId);
    if (len === undefined) {
      return;
    }
    this.totalLen -= len;
    this.docLen.delete(docId);
    for (const m of this.postings.values()) {
      m.delete(docId);
    }
  }

  get size(): number {
    return this.docLen.size;
  }

  /** BM25 scores for a query, by docId. Only docs with a match appear. */
  score(query: string): Map<string, number> {
    const N = this.docLen.size;
    const avg = N > 0 ? this.totalLen / N : 0;
    const scores = new Map<string, number>();
    if (N === 0 || avg === 0) {
      return scores;
    }
    for (const term of new Set(tokenize(query))) {
      const m = this.postings.get(term);
      if (!m) {
        continue;
      }
      const df = m.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [docId, { tf }] of m) {
        const dl = this.docLen.get(docId) ?? 0;
        const denom = tf + K1 * (1 - B + (B * dl) / avg);
        const add = idf * ((tf * (K1 + 1)) / denom);
        scores.set(docId, (scores.get(docId) ?? 0) + add);
      }
    }
    return scores;
  }
}

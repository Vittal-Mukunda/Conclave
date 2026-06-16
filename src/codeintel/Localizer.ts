import { LocalizationAction, LocalizationResult, LocationCandidate } from './types';

// Fusion + confidence calibration. Takes the per-chunk evidence (lexical,
// semantic, symbol, dependency) and produces ranked FILE+LINE candidates plus a
// calibrated action: use a confident, unambiguous hit; WIDEN a mediocre one;
// ASK when it is weak or ambiguous (LOC-1 — editing the wrong place is the
// dominant failure, so a low-confidence localization must not be trusted).

export interface ChunkSignal {
  file: string;
  startLine: number;
  endLine: number;
  /** Raw BM25 lexical score. */
  lex: number;
  /** Raw cosine semantic score in [0,1]. */
  vec: number;
  /** Symbol-name match boost in [0,1]. */
  symbolBoost: number;
  /** Dependency-graph proximity boost in [0,1]. */
  proxBoost: number;
  symbol?: string;
}

export interface FuseWeights {
  lex: number;
  vec: number;
  prox: number;
  symbol: number;
}

export interface FuseOptions {
  topN?: number;
  weights?: FuseWeights;
  /** >= this top score and unambiguous => 'use'. */
  useThreshold?: number;
  /** >= this => 'widen'; below => 'ask'. */
  widenThreshold?: number;
  /** Top vs runner-up gap below which different-file results are "ambiguous". */
  ambiguityGap?: number;
  /** Saturation constant for BM25 -> [0,1): lexN = lex/(lex+k). */
  lexSaturation?: number;
}

const DEFAULT_WEIGHTS: FuseWeights = { lex: 0.45, vec: 0.3, prox: 0.25, symbol: 0.35 };

export function fuse(query: string, signals: ChunkSignal[], opts: FuseOptions = {}): LocalizationResult {
  const topN = opts.topN ?? 8;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const useT = opts.useThreshold ?? 0.6;
  const widenT = opts.widenThreshold ?? 0.3;
  const gap = opts.ambiguityGap ?? 0.08;
  const lexK = opts.lexSaturation ?? 2.5;

  if (signals.length === 0) {
    return {
      query,
      candidates: [],
      confidence: 0,
      action: 'ask',
      note: 'No matching code found — ask the user to point at the right area.',
    };
  }

  // Saturating (not max-relative) normalization so an absolutely-weak best match
  // stays weak — a single faint hit must not be inflated to confidence 1.0.
  const scored: LocationCandidate[] = signals.map((s) => {
    const lexN = s.lex / (s.lex + lexK);
    const vecN = Math.max(0, Math.min(1, s.vec)); // cosine already in [0,1]
    const base = w.lex * lexN + w.vec * vecN + w.prox * s.proxBoost;
    const score = Math.min(1, base + w.symbol * s.symbolBoost);
    const reasons: string[] = [];
    if (lexN > 0.2) {
      reasons.push('lexical');
    }
    if (vecN > 0.2) {
      reasons.push('semantic');
    }
    if (s.symbolBoost > 0 && s.symbol) {
      reasons.push(`symbol:${s.symbol}`);
    }
    if (s.proxBoost > 0.2) {
      reasons.push('dependency');
    }
    return {
      file: s.file,
      startLine: s.startLine,
      endLine: s.endLine,
      score,
      reasons,
      symbol: s.symbol,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const candidates = dedupeOverlaps(scored).slice(0, topN);

  const confidence = candidates[0]?.score ?? 0;
  const ambiguous =
    candidates.length >= 2 &&
    candidates[0].file !== candidates[1].file &&
    candidates[0].score - candidates[1].score < gap;

  let action: LocalizationAction;
  let note: string | undefined;
  if (confidence >= useT && !ambiguous) {
    action = 'use';
  } else if (confidence >= widenT) {
    action = 'widen';
    note = ambiguous
      ? 'Top matches are close across files — widen the search before editing.'
      : 'Moderate confidence — widen context before editing.';
  } else {
    action = 'ask';
    note = 'Low confidence — ask the user to confirm the target before editing.';
  }

  return { query, candidates, confidence, action, note };
}

/** Drop a lower-scored range that overlaps a higher-scored one in the same file. */
function dedupeOverlaps(sorted: LocationCandidate[]): LocationCandidate[] {
  const kept: LocationCandidate[] = [];
  for (const c of sorted) {
    const clash = kept.find(
      (k) => k.file === c.file && c.startLine <= k.endLine && k.startLine <= c.endLine,
    );
    if (!clash) {
      kept.push(c);
    }
  }
  return kept;
}

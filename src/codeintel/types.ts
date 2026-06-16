// Shared types for the code-intelligence / localization subsystem (Phase 7).
// The dominant agent failure mode is editing the WRONG PLACE, so this layer's
// job is to turn a natural-language task into precise FILE+LINE ranges. Heavy
// engines (real LSP, tree-sitter, provider embeddings) sit behind the
// interfaces here; deterministic defaults ship now and are swapped later.

export interface SourceFile {
  /** Workspace-relative POSIX path. */
  path: string;
  content: string;
  /** Content hash for staleness detection (LOC-6). */
  hash: string;
  /** Line count (1-based line numbers run 1..lines). */
  lines: number;
}

export interface Chunk {
  file: string;
  /** 1-based inclusive line range. */
  startLine: number;
  endLine: number;
  text: string;
}

export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'const';

export interface SymbolDef {
  file: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
}

/** Pluggable symbol extraction (heuristic now; tree-sitter / LSP later). */
export interface SymbolExtractor {
  extract(file: SourceFile): SymbolDef[];
}

/** Pluggable text embedding (local hashing now; provider embeddings later). */
export interface Embedder {
  readonly dim: number;
  embed(text: string): number[];
}

export interface LocationCandidate {
  file: string;
  startLine: number;
  endLine: number;
  /** Fused, normalized relevance in [0,1]. */
  score: number;
  /** Why this range surfaced (e.g. "lexical", "semantic", "symbol:foo", "dep"). */
  reasons: string[];
  symbol?: string;
}

/** What the agent should do with a localization, given its confidence (LOC-1). */
export type LocalizationAction = 'use' | 'widen' | 'ask';

export interface LocalizationResult {
  query: string;
  candidates: LocationCandidate[];
  /** Confidence in the top candidate, [0,1]. */
  confidence: number;
  action: LocalizationAction;
  note?: string;
}

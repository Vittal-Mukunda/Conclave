// Stable content hash for drift detection (EDIT-1). FNV-1a 32-bit, matching the
// hashing scheme used by the codeintel embedder so the codebase has one hash
// idiom. Deterministic + dependency-free so the editor logic stays pure and
// unit-testable.
export function hashContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Length-tagged so two different strings that collide on the rolling hash
  // are still distinguished by size — cheap extra guard for drift detection.
  return `${(h >>> 0).toString(16)}-${content.length}`;
}

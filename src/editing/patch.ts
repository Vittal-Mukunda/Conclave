import { Hunk } from './types';

export interface PatchOk {
  ok: true;
  lines: string[];
}
export interface PatchDrift {
  ok: false;
  hunk: Hunk;
  reason: string;
}
export type PatchResult = PatchOk | PatchDrift;

const NL = /\r\n|\r|\n/;

export function splitLines(content: string): string[] {
  return content.split(NL);
}

export function joinLines(lines: string[], eol = '\n'): string {
  return lines.join(eol);
}

/** Detect the dominant line ending so a rewrite preserves the file's style. */
export function detectEol(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Apply hunks to `lines`, anchoring each on its `oldLines`. Hunks are applied
 * bottom-to-top so earlier edits don't shift later line numbers.
 *
 * Drift handling (EDIT-1, EDIT-8): if `oldLines` don't match verbatim at
 * `startLine`, we search a small window around it (the user may have inserted
 * or removed lines above — EDIT-8 re-sync). If still not found, we report drift
 * rather than forcing the change — never clobber.
 */
export function applyHunks(input: string[], hunks: Hunk[], window = 25): PatchResult {
  // Sort descending by startLine so applying one hunk never invalidates the
  // indices of the hunks we haven't applied yet.
  const ordered = [...hunks].sort((a, b) => b.startLine - a.startLine);
  let lines = [...input];

  for (const hunk of ordered) {
    const at = locate(lines, hunk, window);
    if (at < 0) {
      return {
        ok: false,
        hunk,
        reason:
          hunk.oldLines.length === 0
            ? `insertion anchor line ${hunk.startLine} is out of range`
            : `context at line ${hunk.startLine} no longer matches (file drifted)`,
      };
    }
    lines = [...lines.slice(0, at), ...hunk.newLines, ...lines.slice(at + hunk.oldLines.length)];
  }
  return { ok: true, lines };
}

/**
 * Return the 0-based index where `hunk.oldLines` actually sit, or -1.
 * Pure insertions (no oldLines) anchor at `startLine` directly if in range.
 */
function locate(lines: string[], hunk: Hunk, window: number): number {
  const expected = hunk.startLine - 1; // 1-based -> 0-based

  if (hunk.oldLines.length === 0) {
    // Insertion: valid anywhere from 0..length (length == append at end).
    return expected >= 0 && expected <= lines.length ? expected : -1;
  }
  if (matchesAt(lines, expected, hunk.oldLines)) {
    return expected;
  }
  // Re-sync search: widen outward from the expected position (EDIT-8).
  for (let d = 1; d <= window; d++) {
    if (matchesAt(lines, expected - d, hunk.oldLines)) {
      return expected - d;
    }
    if (matchesAt(lines, expected + d, hunk.oldLines)) {
      return expected + d;
    }
  }
  return -1;
}

function matchesAt(lines: string[], idx: number, old: string[]): boolean {
  if (idx < 0 || idx + old.length > lines.length) {
    return false;
  }
  for (let i = 0; i < old.length; i++) {
    if (lines[idx + i] !== old[i]) {
      return false;
    }
  }
  return true;
}

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})(\s|$)/;

/** True if the content already carries unresolved merge-conflict markers (EDIT-4). */
export function hasConflictMarkers(content: string): boolean {
  return splitLines(content).some((l) => CONFLICT_MARKER.test(l));
}

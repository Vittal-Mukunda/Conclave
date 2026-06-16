import {
  EditFailure,
  EditPlan,
  EditResult,
  FileEdit,
  FileState,
  FileWrite,
} from './types';
import { hashContent } from './hash';
import { applyHunks, detectEol, hasConflictMarkers, joinLines, splitLines } from './patch';

/**
 * Pure, all-or-nothing edit planner. Given an edit plan and the current state
 * of every file it touches, it produces either a complete set of writes or a
 * list of failures — never a partial application (EDIT-7). The vscode host
 * supplies file state and commits the returned writes atomically.
 *
 * Catalog: EDIT-1 (drift -> fail, never force), EDIT-2 (outside workspace ->
 * block), EDIT-4 (pre-existing conflict markers -> refuse), EDIT-6 (unsaved
 * buffer divergence surfaced), EDIT-7 (atomic), EDIT-8 (re-sync via patch),
 * EDIT-9 (missing target).
 */
export class AtomicEditor {
  /**
   * @param isInsideWorkspace path predicate (EDIT-2); host implements it from
   *        the open workspace folders. Defaults to allow-all for pure tests.
   */
  constructor(
    private readonly isInsideWorkspace: (path: string) => boolean = () => true,
  ) {}

  plan(plan: EditPlan, files: Map<string, FileState>): EditResult {
    const failures: EditFailure[] = [];
    const writes: FileWrite[] = [];
    const reconciled: string[] = [];

    for (const edit of plan.edits) {
      const result = this.resolve(edit, files.get(edit.path));
      if (result.failure) {
        failures.push(result.failure);
        continue;
      }
      if (result.reconciled) {
        reconciled.push(edit.path);
      }
      writes.push(result.write!);
    }

    // Atomic: any failure aborts the whole plan; the host gets zero writes.
    if (failures.length > 0) {
      return { ok: false, failures };
    }
    return { ok: true, writes, reconciled };
  }

  private resolve(
    edit: FileEdit,
    state: FileState | undefined,
  ): { failure?: EditFailure; write?: FileWrite; reconciled?: boolean } {
    if (!this.isInsideWorkspace(edit.path)) {
      return {
        failure: { path: edit.path, code: 'EDIT-2', message: 'edit targets a path outside the workspace' },
      };
    }

    const creating = edit.newContent !== undefined && (!state || state.content === '');
    if (!state && !creating) {
      return {
        failure: { path: edit.path, code: 'EDIT-9', message: 'target file is missing' },
      };
    }

    const current = state?.content ?? '';
    let reconciled = false;

    // EDIT-6: an unsaved buffer diverged from disk. We can still proceed using
    // the buffer content the host handed us, but flag it so the caller can note
    // the reconciliation (host saves the buffer first).
    if (state?.bufferDirty) {
      reconciled = true;
    }

    // EDIT-1/8: drift check against the hash the edit was generated on.
    if (edit.baseHash !== undefined && hashContent(current) !== edit.baseHash) {
      return {
        failure: {
          path: edit.path,
          code: 'EDIT-1',
          message: 'file changed since the edit was generated — re-read and regenerate',
        },
      };
    }

    // EDIT-4: refuse to write over a file that already has conflict markers.
    if (hasConflictMarkers(current)) {
      return {
        failure: {
          path: edit.path,
          code: 'EDIT-4',
          message: 'file has unresolved merge-conflict markers — resolve before editing',
        },
      };
    }

    if (edit.newContent !== undefined) {
      return { write: { path: edit.path, content: edit.newContent }, reconciled };
    }

    if (edit.hunks && edit.hunks.length > 0) {
      const eol = detectEol(current);
      const patched = applyHunks(splitLines(current), edit.hunks);
      if (!patched.ok) {
        return {
          failure: { path: edit.path, code: 'EDIT-1', message: patched.reason },
        };
      }
      return { write: { path: edit.path, content: joinLines(patched.lines, eol) }, reconciled };
    }

    return {
      failure: { path: edit.path, code: 'EDIT-9', message: 'edit has neither newContent nor hunks' },
    };
  }
}

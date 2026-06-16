// Phase 8 — editing model. Pure types shared by the atomic editor, the
// checkpoint manager and the vscode host glue. Nothing here imports vscode so
// the apply/validate logic is unit-testable with fakes.

/**
 * A line-anchored change to a contiguous region of a file. `startLine` is
 * 1-based and points at the first line of `oldLines`. The applier verifies
 * `oldLines` actually sit there (drift detection, EDIT-1) before swapping in
 * `newLines`. An insertion is `oldLines: []`; a deletion is `newLines: []`.
 */
export interface Hunk {
  startLine: number;
  oldLines: string[];
  newLines: string[];
}

/**
 * One file's worth of change. Either whole-content replacement (`newContent`)
 * or a set of `hunks`. `baseHash` is the hash of the content the edit was
 * generated against; a mismatch means the file drifted under us (EDIT-1/8).
 */
export interface FileEdit {
  path: string;
  baseHash?: string;
  newContent?: string;
  hunks?: Hunk[];
}

export interface EditPlan {
  edits: FileEdit[];
}

/** Current on-disk/in-editor state of a file the plan touches. */
export interface FileState {
  path: string;
  content: string;
  /** True when an unsaved editor buffer diverges from disk (EDIT-6). */
  bufferDirty?: boolean;
}

/** A single resolved write the host should commit, post-validation. */
export interface FileWrite {
  path: string;
  content: string;
}

export type EditFailureCode =
  | 'EDIT-1' // diff won't apply (drift)
  | 'EDIT-2' // edit outside workspace
  | 'EDIT-4' // pre-existing merge conflict markers
  | 'EDIT-6' // unsaved buffer divergence unresolved
  | 'EDIT-9'; // missing target / would corrupt

export interface EditFailure {
  path: string;
  code: EditFailureCode;
  message: string;
}

/**
 * Atomic result. `ok` is all-or-nothing (EDIT-7): a non-empty `failures` means
 * `writes` is empty and the host must not touch the tree.
 */
export type EditResult =
  | { ok: true; writes: FileWrite[]; reconciled: string[] }
  | { ok: false; failures: EditFailure[] };

/** Opaque handle to a checkpoint the work can be rolled back to. */
export interface CheckpointRef {
  /** Git ref (commit sha or stash ref) the checkpoint was recorded at. */
  ref: string;
  label: string;
  /** True when a dirty working tree was captured first (EDIT-3). */
  capturedDirty: boolean;
}

/**
 * Minimal git surface the CheckpointManager needs. The host backs it with a
 * real `git` CLI; tests back it with a fake. Methods may reject; the manager
 * owns retry/ErrorReport mapping (EDIT-5).
 */
export interface GitOps {
  isRepo(): Promise<boolean>;
  isClean(): Promise<boolean>;
  /** Commit everything (work + edits) and return the new commit sha. */
  commitAll(message: string): Promise<string>;
  /** Current HEAD sha. */
  head(): Promise<string>;
  /** Hard-restore the working tree to `ref` (EDIT-7 rollback). */
  resetHard(ref: string): Promise<void>;
}

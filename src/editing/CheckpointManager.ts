import { CheckpointRef, GitOps } from './types';

export interface CheckpointError {
  code: 'EDIT-5';
  message: string;
  cause: unknown;
}

/**
 * Git-backed checkpoints around an edit run. Pure orchestration over the
 * injected `GitOps`; the host supplies a CLI-backed implementation and tests a
 * fake.
 *
 * Catalog: EDIT-3 (dirty tree -> auto-checkpoint the user's work FIRST),
 * EDIT-5 (git op fails -> retry once, then a typed error the host turns into an
 * ErrorReport), EDIT-7 (rollback restores the captured ref).
 */
export class CheckpointManager {
  constructor(
    private readonly git: GitOps,
    /** Retry attempts for a transient git failure before giving up (EDIT-5). */
    private readonly retries = 1,
  ) {}

  /**
   * Record a checkpoint before conclave edits. If the tree is dirty, the user's
   * uncommitted work is committed first (EDIT-3) so a later rollback can't lose
   * it. Returns the ref to roll back to, or undefined when there's no repo
   * (caller decides whether to proceed read-only-unsafe or warn).
   */
  async before(label: string): Promise<CheckpointRef | undefined> {
    if (!(await this.run(() => this.git.isRepo()))) {
      return undefined;
    }
    const clean = await this.run(() => this.git.isClean());
    if (!clean) {
      // EDIT-3: capture the user's dirty work as its own commit first.
      const ref = await this.run(() => this.git.commitAll(`conclave checkpoint: ${label} (user work)`));
      return { ref, label, capturedDirty: true };
    }
    const ref = await this.run(() => this.git.head());
    return { ref, label, capturedDirty: false };
  }

  /** Restore the tree to a checkpoint (EDIT-7 rollback / LOOP-2 auto-revert). */
  async rollback(ref: CheckpointRef): Promise<void> {
    await this.run(() => this.git.resetHard(ref.ref));
  }

  /** Run a git op with bounded retry; map a final failure to a typed error (EDIT-5). */
  private async run<T>(op: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await op();
      } catch (err) {
        lastErr = err;
      }
    }
    const error: CheckpointError = {
      code: 'EDIT-5',
      message: 'git operation failed after retry',
      cause: lastErr,
    };
    throw error;
  }
}

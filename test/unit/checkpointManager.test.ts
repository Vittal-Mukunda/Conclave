import { describe, it, expect } from 'vitest';
import { CheckpointManager, CheckpointError } from '../../src/editing/CheckpointManager';
import { GitOps } from '../../src/editing/types';

class FakeGit implements GitOps {
  repo = true;
  clean = true;
  headSha = 'head0';
  commits: string[] = [];
  resets: string[] = [];
  failNext = 0; // number of leading calls to a flaky op that throw

  isRepo() {
    return Promise.resolve(this.repo);
  }
  isClean() {
    return Promise.resolve(this.clean);
  }
  async commitAll(message: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('transient git failure');
    }
    this.commits.push(message);
    this.headSha = `commit${this.commits.length}`;
    return this.headSha;
  }
  head() {
    return Promise.resolve(this.headSha);
  }
  async resetHard(ref: string) {
    this.resets.push(ref);
  }
}

describe('CheckpointManager', () => {
  it('returns undefined when there is no repo', async () => {
    const git = new FakeGit();
    git.repo = false;
    const ref = await new CheckpointManager(git).before('x');
    expect(ref).toBeUndefined();
  });

  it('clean tree -> checkpoints at HEAD without a commit', async () => {
    const git = new FakeGit();
    git.clean = true;
    const ref = await new CheckpointManager(git).before('edit');
    expect(ref).toMatchObject({ ref: 'head0', capturedDirty: false });
    expect(git.commits).toHaveLength(0);
  });

  it('EDIT-3: dirty tree -> commits the user work first', async () => {
    const git = new FakeGit();
    git.clean = false;
    const ref = await new CheckpointManager(git).before('edit');
    expect(ref?.capturedDirty).toBe(true);
    expect(git.commits[0]).toMatch(/user work/);
    expect(ref?.ref).toBe('commit1');
  });

  it('EDIT-5: retries a transient git failure, then succeeds', async () => {
    const git = new FakeGit();
    git.clean = false;
    git.failNext = 1; // first commit attempt fails, retry succeeds
    const ref = await new CheckpointManager(git, 1).before('edit');
    expect(ref?.ref).toBe('commit1');
  });

  it('EDIT-5: throws a typed error after exhausting retries', async () => {
    const git = new FakeGit();
    git.clean = false;
    git.failNext = 5;
    await expect(new CheckpointManager(git, 1).before('edit')).rejects.toMatchObject({
      code: 'EDIT-5',
    } satisfies Partial<CheckpointError>);
  });

  it('EDIT-7: rollback hard-resets to the checkpoint ref', async () => {
    const git = new FakeGit();
    const mgr = new CheckpointManager(git);
    await mgr.rollback({ ref: 'abc123', label: 'x', capturedDirty: false });
    expect(git.resets).toEqual(['abc123']);
  });
});

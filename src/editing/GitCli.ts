import { execFile } from 'child_process';
import { GitOps } from './types';

/**
 * `GitOps` backed by the real `git` CLI in the workspace root. Thin IO; all the
 * retry/checkpoint policy lives in CheckpointManager (which is unit-tested with
 * a fake). Each method rejects on a non-zero exit so the manager's retry +
 * EDIT-5 mapping kicks in.
 */
export class GitCli implements GitOps {
  constructor(private readonly cwd: string) {}

  async isRepo(): Promise<boolean> {
    try {
      const out = await this.git(['rev-parse', '--is-inside-work-tree']);
      return out.trim() === 'true';
    } catch {
      return false;
    }
  }

  async isClean(): Promise<boolean> {
    const out = await this.git(['status', '--porcelain']);
    return out.trim().length === 0;
  }

  async commitAll(message: string): Promise<string> {
    await this.git(['add', '-A']);
    // --no-verify: a checkpoint must not be blocked by the user's pre-commit
    // hooks (we're snapshotting their in-progress work, not shipping it).
    await this.git(['commit', '--no-verify', '-m', message]);
    return this.head();
  }

  async head(): Promise<string> {
    const out = await this.git(['rev-parse', 'HEAD']);
    return out.trim();
  }

  async resetHard(ref: string): Promise<void> {
    await this.git(['reset', '--hard', ref]);
  }

  private git(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, { cwd: this.cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`git ${args[0]} failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}

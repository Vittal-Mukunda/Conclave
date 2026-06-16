import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { Capability, DegradedModeRegistry } from '../degraded/DegradedModeRegistry';
import { RepoMemory, RepoMemoryKeys } from '../editing/RepoMemory';
import { VerificationLadder } from './VerificationLadder';
import { ProcessSandbox } from './Sandbox';
import { buildRungs } from './detect';
import { Rung, Verdict } from './types';

// vscode glue for the verification ladder. Detects the rung set from the
// workspace package.json + remembered test command (VER-6), runs it through the
// ladder on the process sandbox, and surfaces a calibrated verdict. The sandbox
// isolates by process, not container, so we honestly mark Capability.Sandbox
// degraded (mirrors the Phase 7 LSP/tree-sitter posture).

export class VerifyService {
  private readonly ladder: VerificationLadder;

  constructor(
    private readonly degraded: DegradedModeRegistry,
    private readonly logger: Logger,
    private readonly repoMemory?: RepoMemory,
  ) {
    this.ladder = new VerificationLadder(new ProcessSandbox());
    this.degraded.set(Capability.Sandbox, 'degraded', {
      consequence:
        'Verifying in a process sandbox (no container) — results may differ from a clean environment; confidence is held conservative.',
    });
  }

  private root(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  /** Resolve the rungs for the open workspace (package.json scripts + VER-6 memory). */
  async detectRungs(): Promise<Rung[]> {
    const root = this.root();
    if (!root) {
      return [];
    }
    let scripts: Record<string, string> | undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(root), 'package.json'));
      scripts = JSON.parse(Buffer.from(bytes).toString('utf8')).scripts;
    } catch {
      // No package.json (or unreadable) — non-Node project; rely on memory only.
    }
    const rememberedTest = this.repoMemory?.get(root, RepoMemoryKeys.TestCommand);
    return buildRungs({ scripts, rememberedTest });
  }

  /** Run the ladder and return the verdict (undefined when no folder is open). */
  async verify(): Promise<Verdict | undefined> {
    const root = this.root();
    if (!root) {
      return undefined;
    }
    const rungs = await this.detectRungs();
    const verdict = await this.ladder.run(rungs, { cwd: root });
    this.logger.info('verify_done', {
      confidence: verdict.confidence,
      passed: verdict.passed,
      rungs: verdict.rungs.map((r) => `${r.kind}:${r.status}`),
    });
    return verdict;
  }

  /** `conclave.verify` command — runs the ladder and surfaces the verdict. */
  async runVerifyCommand(): Promise<void> {
    const root = this.root();
    if (!root) {
      void vscode.window.showWarningMessage('conclave: open a folder before verifying.');
      return;
    }
    const verdict = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'conclave: verifying…' },
      () => this.verify(),
    );
    if (!verdict) {
      return;
    }
    if (verdict.rungs.length === 0) {
      void vscode.window.showWarningMessage(
        'conclave: no verification commands found. Use "Remember Test Command" to set one (VER-6).',
      );
      return;
    }
    const pct = Math.round(verdict.confidence * 100);
    const summary = `${verdict.passed ? 'PASS' : 'INCOMPLETE'} · confidence ${pct}% · ${verdict.rungs
      .map((r) => `${r.kind}:${r.status}`)
      .join(', ')}`;
    const detail = verdict.flags.length ? ` — ${verdict.flags[0]}` : '';
    if (verdict.passed && verdict.flags.length === 0) {
      void vscode.window.showInformationMessage(`conclave: ${summary}`);
    } else {
      void vscode.window.showWarningMessage(`conclave: ${summary}${detail}`);
    }
  }
}

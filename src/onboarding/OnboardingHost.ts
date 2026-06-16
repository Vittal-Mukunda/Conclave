import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ErrorService } from '../errors/ErrorService';
import { KeyManager } from '../keys/KeyManager';
import { ProviderService } from '../providers/ProviderService';
import {
  OnboardingStatus,
  OnboardingStepId,
  WorkspaceFacts,
  evaluateOnboarding,
  shouldLaunchWizard,
} from './OnboardingService';

const ONBOARDED_KEY = 'conclave.onboarded';

/**
 * vscode glue for the first-run wizard. Gathers environment facts, drives the
 * step actions (add key, open folder, init git), and persists completion in
 * globalState so the wizard does not re-nag once conclave is runnable.
 */
export class OnboardingHost {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly providers: ProviderService,
    private readonly keyManager: KeyManager,
    private readonly errors: ErrorService,
  ) {}

  async gatherFacts(): Promise<WorkspaceFacts> {
    const status = await this.providers.status();
    const folder = vscode.workspace.workspaceFolders?.[0];
    return {
      hasAnyKey: status.some((s) => s.hasKey),
      folderOpen: !!folder,
      isGitRepo: folder ? isGitRepo(folder.uri.fsPath) : false,
      firstRun: this.context.globalState.get<boolean>(ONBOARDED_KEY) !== true,
    };
  }

  async status(): Promise<OnboardingStatus> {
    return evaluateOnboarding(await this.gatherFacts());
  }

  /**
   * On first run / while not runnable, surface a NON-blocking nudge that opens
   * the wizard on click. Never blocks activation (kept headless-safe — the modal
   * wizard only runs from an explicit user action).
   */
  async notifyIfIncomplete(refresh?: () => Promise<void>): Promise<void> {
    if (!shouldLaunchWizard(await this.status())) {
      return;
    }
    const start = 'Start setup';
    void vscode.window
      .showInformationMessage('conclave: a quick setup is needed before you can run.', start)
      .then((pick) => {
        if (pick === start) {
          void this.run(refresh);
        }
      });
  }

  /** The guided wizard: walk incomplete steps until conclave is ready. */
  async run(refresh?: () => Promise<void>): Promise<void> {
    for (;;) {
      const st = await this.status();
      await refresh?.();
      if (st.ready) {
        await this.markOnboarded();
        void vscode.window.showInformationMessage('conclave: setup complete — ready to go.');
        return;
      }
      const next = st.nextStep;
      if (!next) {
        return;
      }
      const buttons = next.required ? [next.action.label] : [next.action.label, 'Skip'];
      const pick = await vscode.window.showInformationMessage(
        `conclave setup — ${next.title}`,
        { modal: true, detail: next.detail },
        ...buttons,
      );
      if (pick === undefined) {
        return; // user cancelled — re-offered next launch
      }
      if (pick === 'Skip') {
        // Only optional steps are skippable; if required ones are done, finish.
        if ((await this.status()).ready) {
          await this.markOnboarded();
        }
        return;
      }
      await this.performAction(next.id);
    }
  }

  /** `conclave.initGit`: initialize a repo in the open folder (SETUP-12). */
  async initGit(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showWarningMessage('conclave: open a folder before initializing git.');
      return;
    }
    try {
      await runGit(folder.uri.fsPath);
      void vscode.window.showInformationMessage('conclave: initialized a git repository.');
    } catch (err) {
      this.errors.report(err, { category: 'setup', code: 'SETUP-12' });
      void vscode.window.showWarningMessage(
        'conclave: could not initialize git. conclave will run read-only-safe with a warning.',
      );
    }
  }

  private async performAction(id: OnboardingStepId): Promise<void> {
    switch (id) {
      case 'keys':
        await this.keyManager.manage();
        break;
      case 'folder':
        await vscode.commands.executeCommand('workbench.action.files.openFolder');
        break;
      case 'git':
        await this.initGit();
        break;
    }
  }

  private async markOnboarded(): Promise<void> {
    await this.context.globalState.update(ONBOARDED_KEY, true);
  }
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

function runGit(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['init'], { cwd }, (err) => (err ? reject(err) : resolve()));
  });
}

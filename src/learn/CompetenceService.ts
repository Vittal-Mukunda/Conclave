import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { CapabilityRegistry } from '../capability/CapabilityRegistry';
import { RepoMemory } from '../editing/RepoMemory';
import { RoutedCandidate } from '../router/types';
import { BanditStore } from './BanditStore';
import { CompetenceLearner, SelectResult } from './CompetenceLearner';
import { LearnContext } from './types';

// vscode glue for the competence learner. Warm-starts arms from the capability
// registry's benchmark priors, persists arm state to the BanditStore per
// workspace (STATE-6), and records human ACCEPT/REJECT (the strongest reward
// signal) — writing a durable lesson to repo memory. The learning math lives in
// CompetenceLearner; this assembles its deps and tracks the last selection so a
// feedback command can attribute the reward.

interface LastSelection {
  context: LearnContext;
  candidate: RoutedCandidate;
}

export class CompetenceService {
  private readonly learner: CompetenceLearner;
  private readonly hydrated = new Set<string>();
  private last?: LastSelection;

  constructor(
    private readonly logger: Logger,
    private readonly capability?: CapabilityRegistry,
    private readonly store?: BanditStore,
    private readonly repoMemory?: RepoMemory,
  ) {
    this.learner = new CompetenceLearner({
      priors: (arm) => this.priorFor(arm),
      onUpdate: (arm, state, rho) => {
        const ws = this.workspaceId();
        if (ws && this.store) {
          this.store.save(ws, arm, state, rho ?? 0);
        }
      },
      lesson: (text) => {
        const ws = this.workspaceId();
        this.repoMemory?.set(ws ?? 'global', `learn.lesson.${Date.now()}`, text);
      },
    });
  }

  /** Pick a model among routed candidates, recording it for later feedback. */
  select(context: LearnContext, candidates: RoutedCandidate[]): SelectResult {
    this.ensureHydrated();
    const result = this.learner.select(context, candidates);
    if (result.chosen) {
      this.last = { context, candidate: result.chosen };
    }
    this.logger.info('competence_select', {
      role: context.role,
      taskType: context.taskType,
      chosen: result.chosen ? `${result.chosen.model.providerId}/${result.chosen.model.modelId}` : 'none',
    });
    return result;
  }

  /** Conservative competence (LCB/mean/UCB) for a candidate — used by the
   *  Phase 13 assignment solver to seat councils. */
  evaluate(context: LearnContext, candidate: RoutedCandidate): { arm: string; mean: number; ucb: number; lcb: number } {
    this.ensureHydrated();
    return this.learner.evaluate(context, candidate);
  }

  /** Fold a verification-ladder outcome into the chosen arm. */
  recordLadder(context: LearnContext, candidate: RoutedCandidate, passed: boolean): void {
    this.ensureHydrated();
    this.learner.recordLadder(context, candidate, passed);
  }

  /** `conclave.recordFeedback` — attribute a human ACCEPT/REJECT to the last pick. */
  async recordFeedbackCommand(): Promise<void> {
    if (!this.last) {
      void vscode.window.showInformationMessage('conclave: no recent model selection to rate yet.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Accept', accepted: true, description: 'the result was good' },
        { label: 'Reject', accepted: false, description: 'the result was wrong' },
      ],
      {
        placeHolder: `Rate ${this.last.candidate.model.providerId}/${this.last.candidate.model.modelId} for this task`,
      },
    );
    if (!pick) {
      return;
    }
    this.ensureHydrated();
    this.learner.recordHuman(this.last.context, this.last.candidate, pick.accepted);
    void vscode.window.showInformationMessage(
      `conclave: recorded ${pick.accepted ? 'ACCEPT' : 'REJECT'} — the learner will weight this model accordingly.`,
    );
  }

  private ensureHydrated(): void {
    const ws = this.workspaceId();
    if (!ws || !this.store || this.hydrated.has(ws)) {
      return;
    }
    this.hydrated.add(ws);
    for (const a of this.store.load(ws)) {
      this.learner.restore(a.arm, a.state, a.rho);
    }
  }

  private priorFor(arm: string): number | undefined {
    if (!this.capability) {
      return undefined;
    }
    const [provider, ...rest] = arm.split('/');
    const model = rest.join('/');
    const prior = this.capability.getModel(provider, model)?.benchmark_prior ?? 0;
    return prior > 0 ? prior : undefined;
  }

  private workspaceId(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

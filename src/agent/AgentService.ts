import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { CodeIntelService } from '../codeintel/CodeIntelService';
import { EditService } from '../editing/EditService';
import { VerifyService } from '../verify/VerifyService';
import { BudgetManager } from '../cost/BudgetManager';
import { RouterService } from '../router/RouterService';
import { CompetenceService } from '../learn/CompetenceService';
import { CheckpointRef } from '../editing/types';
import { AgentLoop } from './AgentLoop';
import { AgentTask, BudgetGate, Checkpointer, PlanDecision, Planner, Verifier } from './types';
import { RunStateStore } from './RunStateStore';
import { RunCoordinator, RunRecord, findCrashedRuns } from './RunState';
import { ActivityVM } from '../panel/PanelViewModel';

// vscode glue for the agent loop. Wires the safety rails to real services:
// checkpointer = Phase 8 EditService, verifier = Phase 9 VerifyService, budget
// gate = Phase 5 BudgetManager. The planner localizes the goal (Phase 7).
//
// Engine deviation (flagged): LLM-driven code generation lands in later phases
// (Phase 13/14 council + best-of-N). Until then the default planner localizes
// the target and hands off cleanly with an honest reason, exercising the full
// control loop without inventing edits.

export class AgentService {
  // STATE-3: one in-process coordinator gates concurrent runs per workspace.
  private readonly coordinator = new RunCoordinator();
  // UX-2: the cancellation source for the run currently in progress, if any.
  private cancelSource?: vscode.CancellationTokenSource;

  constructor(
    private readonly logger: Logger,
    private readonly codeIntel: CodeIntelService,
    private readonly editing: EditService,
    private readonly verify: VerifyService,
    private readonly budget?: BudgetManager,
    private readonly router?: RouterService,
    private readonly competence?: CompetenceService,
    private readonly runStore?: RunStateStore,
  ) {}

  private planner(): Planner {
    return {
      plan: async (task: AgentTask): Promise<PlanDecision> => {
        const loc = await this.codeIntel.localize(task.goal);
        if (loc.action === 'ask') {
          return { kind: 'ambiguous', question: loc.note ?? 'Which part of the code should this change touch?' };
        }
        const top = loc.candidates[0];
        const where = top ? `${top.file}:${top.startLine}-${top.endLine}` : 'the workspace';
        // Route the (eventual) implement stage so the difficulty estimate + tier
        // pick are wired and visible — even though codegen authoring lands later.
        let routed = '';
        if (this.router) {
          const r = await this.router.route('implement', task.goal, {
            scopeFiles: loc.candidates.length,
            localizeConfidence: loc.confidence,
          });
          // The learner (Phase 12) chooses among the routed candidates, folding
          // in learned per-context competence; fall back to the router's pick.
          const learned = this.competence?.select(
            { taskType: r.estimate.taskType, difficulty: r.estimate.d, role: 'implement' },
            r.candidates,
          ).chosen;
          const choice = learned ?? r.chosen;
          const pick = choice
            ? `${choice.model.providerId}/${choice.model.modelId} (${choice.tier})`
            : 'no keyed model';
          routed = `; difficulty ${r.estimate.d.toFixed(2)} (${r.estimate.level}) → ${pick}`;
        }
        // No codegen engine yet — hand off honestly rather than fabricate edits.
        return {
          kind: 'handoff',
          reason: `located ${where} (confidence ${loc.confidence.toFixed(2)})${routed}, but automated code generation arrives in a later phase`,
        };
      },
    };
  }

  private checkpointer(onCheckpoint?: (ref: string) => void): Checkpointer {
    const refs = new Map<string, CheckpointRef>();
    return {
      checkpoint: async (label) => {
        const ref = await this.editing.checkpoint(label);
        if (!ref) {
          return undefined;
        }
        refs.set(ref.ref, ref);
        // STATE-1/2: persist the resume point + bump liveness each iteration.
        onCheckpoint?.(ref.ref);
        return ref.ref;
      },
      rollback: async (refStr) => {
        const ref = refs.get(refStr);
        if (ref) {
          await this.editing.rollback(ref);
        }
      },
    };
  }

  private verifier(): Verifier {
    return {
      verify: async () => {
        const v = await this.verify.verify();
        return v
          ? { passed: v.passed, confidence: v.confidence, flags: v.flags }
          : { passed: false, confidence: 0, flags: ['no workspace open'] };
      },
    };
  }

  private budgetGate(): BudgetGate {
    return {
      canContinue: () =>
        this.budget?.capReached()
          ? { allowed: false, reason: 'spend cap reached — stopping the agent (LOOP-7/COST-3)' }
          : { allowed: true },
    };
  }

  /** `conclave.runAgent` — drive the control loop for a natural-language goal. */
  async runAgentCommand(): Promise<void> {
    const goal = await vscode.window.showInputBox({
      title: 'conclave — run agent',
      prompt: 'Describe the change. conclave plans, edits, verifies, and checkpoints each step.',
      ignoreFocusOut: true,
    });
    if (!goal) {
      return;
    }

    const workspaceId = this.workspaceId() ?? 'no-workspace';
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // STATE-3: refuse to start a second run on a workspace already running one.
    const claim = this.coordinator.begin(workspaceId, runId);
    if (claim.state === 'queued') {
      this.coordinator.end(workspaceId, runId); // don't actually hold a slot for a one-shot command
      void vscode.window.showWarningMessage(
        'conclave: an agent run is already in progress for this workspace. Wait for it to finish before starting another (STATE-3).',
      );
      return;
    }

    // STATE-1/2: persist the run so a reload/crash can recover it.
    const started = Date.now();
    this.runStore?.begin({
      id: runId,
      workspaceId,
      goal,
      status: 'running',
      iteration: 0,
      startedAt: started,
      heartbeatAt: started,
    });

    // UX-2: a fresh cancellation source for this run, surfaced as a panel/notif
    // Cancel button and checked each iteration by the loop.
    const cancelSource = new vscode.CancellationTokenSource();
    this.cancelSource = cancelSource;

    let iter = 0;
    const loop = new AgentLoop({
      planner: this.planner(),
      actor: { apply: () => ({ ok: false, reason: 'no codegen engine wired yet' }) },
      verifier: this.verifier(),
      checkpointer: this.checkpointer((ref) => {
        iter += 1;
        this.runStore?.heartbeat(runId, Date.now(), iter, ref);
      }),
      budget: this.budgetGate(),
      signal: { isCancelled: () => cancelSource.token.isCancellationRequested },
    });

    this.emitActivity({ kind: 'working', title: 'Agent running…', detail: goal, cancellable: true });
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'conclave: agent running…', cancellable: true },
        (_progress, token) => {
          token.onCancellationRequested(() => cancelSource.cancel());
          return loop.run({ goal });
        },
      );
      this.runStore?.finish(runId, 'completed');
      this.logger.info('agent_done', { status: result.status, iterations: result.iterations.length, best: result.bestConfidence });

      const head = `conclave [${result.status}]: ${result.reason}`;
      if (result.status === 'needs-clarification' && result.question) {
        this.emitActivity({ kind: 'needs-input', title: 'Needs your input', detail: result.question, cancellable: false });
        void vscode.window.showWarningMessage(`${head} — ${result.question}`);
      } else if (result.status === 'blocked') {
        this.emitActivity({ kind: 'error', title: 'Blocked', detail: result.reason, cancellable: false });
        void vscode.window.showWarningMessage(
          result.scopedSuggestion ? `${head} Try: ${result.scopedSuggestion}` : head,
        );
      } else if (result.status === 'success') {
        this.emitActivity({ kind: 'done', title: 'Done', detail: result.reason, cancellable: false });
        void vscode.window.showInformationMessage(`${head} (confidence ${Math.round(result.bestConfidence * 100)}%)`);
      } else {
        this.emitActivity({ kind: 'done', title: result.status, detail: result.reason, cancellable: false });
        void vscode.window.showWarningMessage(head);
      }
    } catch (err) {
      // The run threw — leave it 'running' so it surfaces as recoverable, then rethrow.
      this.emitActivity({ kind: 'error', title: 'Agent failed', detail: 'See the conclave output channel.', cancellable: false });
      this.logger.warn('agent_run_failed', { runId });
      throw err;
    } finally {
      this.coordinator.end(workspaceId, runId);
      cancelSource.dispose();
      if (this.cancelSource === cancelSource) {
        this.cancelSource = undefined;
      }
    }
  }

  /** `conclave.cancelAgent` — cancel the run in progress (UX-2). No-op if idle. */
  cancelCurrentCommand(): void {
    if (this.cancelSource) {
      this.cancelSource.cancel();
      this.logger.info('agent_cancel_requested');
      void vscode.window.showInformationMessage('conclave: cancelling the agent…');
    } else {
      void vscode.window.showInformationMessage('conclave: no agent run is in progress.');
    }
  }

  // --- activity stream (UX-2/3): the panel subscribes to render live state ---

  private readonly activityListeners = new Set<(vm: ActivityVM) => void>();

  onActivity(listener: (vm: ActivityVM) => void): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  private emitActivity(vm: ActivityVM): void {
    for (const l of this.activityListeners) {
      try {
        l(vm);
      } catch {
        /* a listener must not break the run */
      }
    }
  }

  /**
   * Non-blocking activation nudge: if a previous run was orphaned by a crash /
   * reload (STATE-2), tell the user once and offer recovery. Headless-safe.
   */
  async notifyIfRunOrphaned(): Promise<void> {
    if (!this.runStore) {
      return;
    }
    const workspaceId = this.workspaceId() ?? 'no-workspace';
    const crashed = findCrashedRuns(this.runStore.running(workspaceId), Date.now());
    if (crashed.length === 0) {
      return;
    }
    this.logger.info('agent_run_orphaned', { count: crashed.length });
    const pick = await vscode.window.showWarningMessage(
      `conclave: an agent run was interrupted ("${crashed[0].run.goal}"). Recover it?`,
      'Recover…',
      'Dismiss',
    );
    if (pick === 'Recover…') {
      await this.recoverRunsCommand();
    }
  }

  /**
   * `conclave.recoverRun` — STATE-2 resume-or-discard. Lists the orphaned runs;
   * the user resumes one from its last checkpoint (re-running the goal) or
   * discards it (rolling back to the checkpoint and forgetting the run).
   */
  async recoverRunsCommand(): Promise<void> {
    if (!this.runStore) {
      void vscode.window.showWarningMessage('conclave: run recovery is unavailable (storage is off).');
      return;
    }
    const workspaceId = this.workspaceId() ?? 'no-workspace';
    const crashed = findCrashedRuns(this.runStore.running(workspaceId), Date.now());
    if (crashed.length === 0) {
      void vscode.window.showInformationMessage('conclave: no interrupted runs to recover.');
      return;
    }

    const choice = await vscode.window.showQuickPick(
      crashed.map((c) => ({
        label: c.run.goal,
        description: `iter ${c.run.iteration}${c.recoverable ? ' · checkpoint available' : ' · no checkpoint'}`,
        candidate: c,
      })),
      { placeHolder: 'Select an interrupted run to recover' },
    );
    if (!choice) {
      return;
    }
    const { candidate } = choice;

    const action = await vscode.window.showQuickPick(
      [
        { label: 'Resume', description: 'restart the goal from where it left off (STATE-1)', value: 'resume' as const },
        {
          label: 'Discard',
          description: candidate.recoverable ? 'roll back to the last checkpoint and forget it' : 'forget it',
          value: 'discard' as const,
        },
      ],
      { placeHolder: `"${candidate.run.goal}" — resume or discard?` },
    );
    if (!action) {
      return;
    }

    if (action.value === 'discard') {
      // STATE-1: roll the tree back to the last checkpoint if there is one.
      if (candidate.run.checkpointRef) {
        const ref: CheckpointRef = { ref: candidate.run.checkpointRef, label: candidate.run.goal, capturedDirty: false };
        await this.editing.rollback(ref);
      }
      this.runStore.finish(candidate.run.id, 'aborted');
      this.logger.info('agent_run_discarded', { runId: candidate.run.id });
      void vscode.window.showInformationMessage('conclave: interrupted run discarded.');
      return;
    }

    // Resume: mark the old record terminal and re-drive the goal as a fresh run.
    this.runStore.finish(candidate.run.id, 'aborted');
    this.logger.info('agent_run_resumed', { runId: candidate.run.id });
    await this.runResumed(candidate.run);
  }

  /** Re-drive a recovered run's goal through the loop as a new run (STATE-1). */
  private async runResumed(prior: RunRecord): Promise<void> {
    const workspaceId = prior.workspaceId;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.coordinator.begin(workspaceId, runId).state === 'queued') {
      this.coordinator.end(workspaceId, runId);
      void vscode.window.showWarningMessage('conclave: a run is already in progress; try recovery again later (STATE-3).');
      return;
    }
    const started = Date.now();
    this.runStore?.begin({
      id: runId,
      workspaceId,
      goal: prior.goal,
      status: 'running',
      iteration: prior.iteration,
      checkpointRef: prior.checkpointRef,
      startedAt: started,
      heartbeatAt: started,
    });
    let iter = prior.iteration;
    const loop = new AgentLoop({
      planner: this.planner(),
      actor: { apply: () => ({ ok: false, reason: 'no codegen engine wired yet' }) },
      verifier: this.verifier(),
      checkpointer: this.checkpointer((ref) => {
        iter += 1;
        this.runStore?.heartbeat(runId, Date.now(), iter, ref);
      }),
      budget: this.budgetGate(),
    });
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'conclave: resuming agent…' },
        () => loop.run({ goal: prior.goal }),
      );
      this.runStore?.finish(runId, 'completed');
      void vscode.window.showInformationMessage(`conclave [${result.status}]: ${result.reason}`);
    } finally {
      this.coordinator.end(workspaceId, runId);
    }
  }

  private workspaceId(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }
}

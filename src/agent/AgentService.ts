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

// vscode glue for the agent loop. Wires the safety rails to real services:
// checkpointer = Phase 8 EditService, verifier = Phase 9 VerifyService, budget
// gate = Phase 5 BudgetManager. The planner localizes the goal (Phase 7).
//
// Engine deviation (flagged): LLM-driven code generation lands in later phases
// (Phase 13/14 council + best-of-N). Until then the default planner localizes
// the target and hands off cleanly with an honest reason, exercising the full
// control loop without inventing edits.

export class AgentService {
  constructor(
    private readonly logger: Logger,
    private readonly codeIntel: CodeIntelService,
    private readonly editing: EditService,
    private readonly verify: VerifyService,
    private readonly budget?: BudgetManager,
    private readonly router?: RouterService,
    private readonly competence?: CompetenceService,
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

  private checkpointer(): Checkpointer {
    const refs = new Map<string, CheckpointRef>();
    return {
      checkpoint: async (label) => {
        const ref = await this.editing.checkpoint(label);
        if (!ref) {
          return undefined;
        }
        refs.set(ref.ref, ref);
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

    const loop = new AgentLoop({
      planner: this.planner(),
      actor: { apply: () => ({ ok: false, reason: 'no codegen engine wired yet' }) },
      verifier: this.verifier(),
      checkpointer: this.checkpointer(),
      budget: this.budgetGate(),
    });

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'conclave: agent running…' },
      () => loop.run({ goal }),
    );
    this.logger.info('agent_done', { status: result.status, iterations: result.iterations.length, best: result.bestConfidence });

    const head = `conclave [${result.status}]: ${result.reason}`;
    if (result.status === 'needs-clarification' && result.question) {
      void vscode.window.showWarningMessage(`${head} — ${result.question}`);
    } else if (result.status === 'blocked') {
      void vscode.window.showWarningMessage(
        result.scopedSuggestion ? `${head} Try: ${result.scopedSuggestion}` : head,
      );
    } else if (result.status === 'success') {
      void vscode.window.showInformationMessage(`${head} (confidence ${Math.round(result.bestConfidence * 100)}%)`);
    } else {
      void vscode.window.showWarningMessage(head);
    }
  }
}

import * as vscode from 'vscode';
import { Logger } from '../logging/Logger';
import { Role } from '../router/types';
import { RouterService } from '../router/RouterService';
import { CompetenceService } from '../learn/CompetenceService';
import { TaskType } from '../router/types';
import { AssignmentSolver } from './AssignmentSolver';
import { StageAssignment, StageRequest } from './types';

// vscode glue for the assignment solver + council. Pulls the routed candidate
// pool for each stage, scores it with the learner's conservative LCB, and seats
// a single author (convergent) or a diverse council (divergent). The solver math
// is pure; this assembles its deps and surfaces the result.

export class CouncilService {
  constructor(
    private readonly logger: Logger,
    private readonly router: RouterService,
    private readonly competence: CompetenceService,
  ) {}

  /**
   * Assign every stage for a goal: plan (council) -> implement (single author)
   * -> review (council). The convergent author is requested first so it gets
   * first claim on the scarce strong coder under capacity.
   */
  async assignForGoal(goal: string): Promise<{ stages: StageAssignment[]; difficulty: number; taskType: TaskType }> {
    // One difficulty estimate for the goal; reused across stage contexts.
    const base = await this.router.route('implement', goal);
    const difficulty = base.estimate.d;
    const taskType = base.estimate.taskType;

    // Candidate pools differ per role (plan/review have no code requirement).
    const pools = new Map<Role, Awaited<ReturnType<RouterService['route']>>>();
    pools.set('implement', base);
    pools.set('plan', await this.router.route('plan', goal));
    pools.set('review', await this.router.route('review', goal));

    // Union of all candidates so the solver can place any across stages.
    const all = [...pools.values()].flatMap((r) => r.candidates);
    const seen = new Set<string>();
    const candidates = all.filter((c) => {
      const k = `${c.model.providerId}/${c.model.modelId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const solver = new AssignmentSolver({
      score: (role, c) => this.competence.evaluate({ taskType, difficulty, role }, c).lcb,
    });

    const stages: StageRequest[] = [
      { role: 'implement' }, // convergent author first
      { role: 'plan', size: 3 },
      { role: 'review', size: 3 },
    ];
    const result = solver.assign(stages, candidates);
    this.logger.info('council_assign', {
      goal: goal.slice(0, 80),
      difficulty,
      taskType,
      stages: result.map((s) => s.kind),
    });
    return { stages: result, difficulty, taskType };
  }

  /** `conclave.planCouncil` — show the stage assignment for a goal. */
  async planCouncilCommand(): Promise<void> {
    const goal = await vscode.window.showInputBox({
      title: 'conclave — council assignment',
      prompt: 'Describe the change; conclave assigns an author + diverse review council.',
      ignoreFocusOut: true,
    });
    if (!goal) {
      return;
    }
    const { stages, difficulty, taskType } = await this.assignForGoal(goal);
    const lines = stages.map((s) => {
      if (s.kind === 'convergent') {
        const a = s.author ? `${s.author.model.providerId}/${s.author.model.modelId}` : 'none';
        return `${s.role}: author=${a}`;
      }
      const fams = s.members.map((m) => m.family).join(', ');
      return `${s.role}: council[${s.members.length}] families={${fams}}${s.homogeneous ? ' (single-author fallback)' : ''}`;
    });
    void vscode.window.showInformationMessage(
      `conclave [${taskType}, d=${difficulty.toFixed(2)}] — ${lines.join(' | ')}`,
    );
  }
}

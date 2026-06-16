import { Role, TaskType } from '../router/types';

// Phase 12 — competence learner (contextual bandit). All vscode/LLM-free so the
// learning math is deterministically unit-testable; the host wires persistence
// (BanditStore over SqlDb) and warm-start priors (capability benchmark_prior).

/** The context a selection is made in (OR design §5: task-type / difficulty /
 *  stage; repo is handled by scoping the learner per workspace). */
export interface LearnContext {
  taskType: TaskType;
  /** Difficulty in [0,1] from the Phase 11 estimator. */
  difficulty: number;
  role: Role;
}

// Stable feature ordering — the encoder and any persisted arm state depend on it.
export const TASK_TYPES: readonly TaskType[] = ['mechanical', 'bugfix', 'feature', 'refactor', 'design'];
export const ROLES: readonly Role[] = ['plan', 'implement', 'review', 'mechanical'];

// Feature layout: [bias, difficulty, taskType one-hot(5), role one-hot(4)].
export const FEATURE_DIM = 1 + 1 + TASK_TYPES.length + ROLES.length; // 11

/** A human ACCEPT/REJECT counts much more than a single ladder pass/fail
 *  (OR design §5: "update ... strongly from human ACCEPT/REJECT"). */
export const HUMAN_WEIGHT = 3;
export const LADDER_WEIGHT = 1;

/** Default competence prior for an arm with no benchmark data. */
export const DEFAULT_PRIOR = 0.5;

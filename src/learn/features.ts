import { Vec } from './linalg';
import { FEATURE_DIM, LearnContext, ROLES, TASK_TYPES } from './types';

// Encode a LearnContext into the fixed-dimension feature vector LinUCB scores
// over. Layout: [bias=1, difficulty, taskType one-hot(5), role one-hot(4)].

export function encode(ctx: LearnContext): Vec {
  const x = new Array(FEATURE_DIM).fill(0);
  x[0] = 1; // bias
  x[1] = Math.min(1, Math.max(0, ctx.difficulty));
  const ti = TASK_TYPES.indexOf(ctx.taskType);
  if (ti >= 0) {
    x[2 + ti] = 1;
  }
  const ri = ROLES.indexOf(ctx.role);
  if (ri >= 0) {
    x[2 + TASK_TYPES.length + ri] = 1;
  }
  return x;
}

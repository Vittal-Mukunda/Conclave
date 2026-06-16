// Error taxonomy. Categories mirror the groups in docs/edge-cases.md so every
// failure in the system maps to a known family with a friendly default title.

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'fatal';

export type ErrorCategory =
  | 'setup' // SETUP-*
  | 'provider' // PROV-*
  | 'localization' // LOC-*
  | 'edit' // EDIT-*
  | 'verification' // VER-*
  | 'loop' // LOOP-*
  | 'cost' // COST-*
  | 'state' // STATE-*
  | 'security' // SEC-*
  | 'skill' // SKILL-*
  | 'connectivity' // SETUP-8 / network
  | 'ux' // UX-*
  | 'unknown';

/** Plain-language default title per category (no jargon, no stack traces). */
export function titleForCategory(category: ErrorCategory): string {
  switch (category) {
    case 'setup':
      return 'Setup needs attention';
    case 'provider':
      return 'A model provider had a problem';
    case 'localization':
      return 'Could not pinpoint the code to change';
    case 'edit':
      return 'A code edit could not be applied';
    case 'verification':
      return 'Verification could not complete';
    case 'loop':
      return 'The task could not be completed automatically';
    case 'cost':
      return 'Budget limit reached';
    case 'state':
      return 'Could not load saved state';
    case 'security':
      return 'A security check stopped this';
    case 'skill':
      return 'A skill could not be used';
    case 'connectivity':
      return 'No internet connection';
    case 'ux':
    case 'unknown':
    default:
      return 'Something went wrong';
  }
}

/** Best-effort category guess for plain Errors (typed errors carry their own). */
export function heuristicCategory(err: Error): ErrorCategory | undefined {
  const msg = `${err.name} ${err.message}`.toLowerCase();
  if (/(econnrefused|enotfound|eai_again|network|offline|getaddrinfo|fetch failed|socket hang up)/.test(msg)) {
    return 'connectivity';
  }
  if (/(429|rate limit|quota|too many requests)/.test(msg)) {
    return 'provider';
  }
  return undefined;
}

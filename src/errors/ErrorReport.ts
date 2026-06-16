import { ErrorCategory, ErrorSeverity } from './taxonomy';

// A RecoveryAction is what the UI renders as a button. There is ALWAYS at least
// one on every ErrorReport — the customer must never hit a dead-end.
export type RecoveryKind =
  | 'retry'
  | 'configure'
  | 'install'
  | 'start'
  | 'wait'
  | 'docs'
  | 'report'
  | 'switch'
  | 'add'
  | 'continue'
  | 'dismiss';

export interface RecoveryAction {
  /** Button text, plain language, e.g. "Update key", "Start Docker". */
  label: string;
  kind: RecoveryKind;
  /** VS Code command the button invokes (one-click redirection). */
  command?: string;
  args?: unknown;
  /** External URL to open instead of (or alongside) a command. */
  url?: string;
}

export interface ErrorReport {
  id: string;
  timestamp: number;
  severity: ErrorSeverity;
  category: ErrorCategory;
  /** Catalog id when known, e.g. "PROV-1". */
  code?: string;
  /** Plain title — no jargon. */
  title: string;
  /** Redacted human-readable detail. */
  detail: string;
  /** Redacted underlying cause, if any. */
  cause?: string;
  /** Always length >= 1. */
  recoveryActions: RecoveryAction[];
  canRetry: boolean;
  /** Set when we degraded instead of failing, describing what changed. */
  fallbackApplied?: string;
  /** For rate-limit/throttle errors: ms until capacity is expected to free. */
  retryAfterMs?: number;
}

/** Universal last-resort action present on every otherwise-actionless report. */
export const REPORT_ISSUE_ACTION: RecoveryAction = {
  label: 'Report issue',
  kind: 'report',
  command: 'conclave.reportIssue',
};

export interface ConclaveErrorInit {
  category: ErrorCategory;
  severity?: ErrorSeverity;
  code?: string;
  title: string;
  detail?: string;
  cause?: unknown;
  recoveryActions?: RecoveryAction[];
  canRetry?: boolean;
  fallbackApplied?: string;
  retryAfterMs?: number;
}

/**
 * The typed error every conclave subsystem throws. Carries everything needed to
 * build an ErrorReport so the ErrorService can render it without guessing.
 */
export class ConclaveError extends Error {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly code?: string;
  readonly title: string;
  readonly detail: string;
  readonly causeText?: string;
  readonly recoveryActions: RecoveryAction[];
  readonly canRetry: boolean;
  readonly fallbackApplied?: string;
  readonly retryAfterMs?: number;

  constructor(init: ConclaveErrorInit) {
    super(init.title);
    this.name = 'ConclaveError';
    this.category = init.category;
    this.severity = init.severity ?? 'error';
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail ?? init.title;
    this.causeText = init.cause !== undefined ? stringifyCause(init.cause) : undefined;
    this.recoveryActions = init.recoveryActions ?? [];
    this.canRetry = init.canRetry ?? false;
    this.fallbackApplied = init.fallbackApplied;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export function stringifyCause(cause: unknown): string {
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

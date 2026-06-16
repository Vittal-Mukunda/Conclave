import { randomUUID } from 'crypto';
import { Logger } from '../logging/Logger';
import { SecretRedactor } from '../logging/redaction';
import {
  ConclaveError,
  ErrorReport,
  RecoveryAction,
  REPORT_ISSUE_ACTION,
  stringifyCause,
} from './ErrorReport';
import { ErrorCategory, ErrorSeverity, heuristicCategory, titleForCategory } from './taxonomy';

export interface ReportContext {
  category?: ErrorCategory;
  code?: string;
  fatal?: boolean;
  severity?: ErrorSeverity;
  title?: string;
  recoveryActions?: RecoveryAction[];
  canRetry?: boolean;
  fallbackApplied?: string;
}

interface NormalizedError {
  category?: ErrorCategory;
  code?: string;
  severity?: ErrorSeverity;
  title?: string;
  detail?: string;
  cause?: string;
  recoveryActions: RecoveryAction[];
  canRetry?: boolean;
  fallbackApplied?: string;
}

export type ReportListener = (report: ErrorReport) => void;

/**
 * Central error funnel. ANY caught value — typed ConclaveError, plain Error,
 * string, object, null — becomes a valid ErrorReport with >= 1 recovery action.
 * Never throws. All text fields are redacted before the report leaves here.
 */
export class ErrorService {
  private readonly listeners = new Set<ReportListener>();

  constructor(
    private readonly deps: { redactor?: SecretRedactor; logger?: Logger } = {},
  ) {}

  onReport(listener: ReportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Build, log, emit and return an ErrorReport. Guaranteed not to throw. */
  report(err: unknown, ctx: ReportContext = {}): ErrorReport {
    let report: ErrorReport;
    try {
      report = this.finalize(this.normalize(err, ctx), ctx);
    } catch (internal) {
      // The error funnel itself must never fail.
      report = {
        id: safeUuid(),
        timestamp: Date.now(),
        severity: 'fatal',
        category: 'unknown',
        title: 'Something went wrong',
        detail: this.redact(stringifyCause(internal)) ?? '',
        recoveryActions: [REPORT_ISSUE_ACTION],
        canRetry: false,
      };
    }
    this.deps.logger?.error('error_report', report);
    for (const l of this.listeners) {
      try {
        l(report);
      } catch {
        /* a listener must not break reporting */
      }
    }
    return report;
  }

  private normalize(err: unknown, ctx: ReportContext): NormalizedError {
    if (err instanceof ConclaveError) {
      return {
        category: err.category,
        code: err.code,
        severity: err.severity,
        title: err.title,
        detail: err.detail,
        cause: err.causeText,
        recoveryActions: [...err.recoveryActions],
        canRetry: err.canRetry,
        fallbackApplied: err.fallbackApplied,
      };
    }
    if (err instanceof Error) {
      const category = ctx.category ?? heuristicCategory(err) ?? 'unknown';
      return {
        category,
        title: titleForCategory(category),
        detail: err.message || err.name,
        cause: err.name,
        recoveryActions: [],
      };
    }
    const category = ctx.category ?? 'unknown';
    return {
      category,
      title: titleForCategory(category),
      detail: safeString(err),
      recoveryActions: [],
    };
  }

  private finalize(base: NormalizedError, ctx: ReportContext): ErrorReport {
    const severity: ErrorSeverity = ctx.fatal ? 'fatal' : ctx.severity ?? base.severity ?? 'error';
    const category = ctx.category ?? base.category ?? 'unknown';

    let actions = ctx.recoveryActions ?? base.recoveryActions ?? [];
    if (severity === 'fatal' && !actions.some((a) => a.kind === 'report')) {
      actions = [...actions, REPORT_ISSUE_ACTION];
    }
    if (actions.length === 0) {
      actions = [REPORT_ISSUE_ACTION];
    }

    return {
      id: safeUuid(),
      timestamp: Date.now(),
      severity,
      category,
      code: ctx.code ?? base.code,
      title: this.redact(ctx.title ?? base.title) ?? 'Something went wrong',
      detail: this.redact(base.detail) ?? '',
      cause: this.redact(base.cause),
      recoveryActions: actions,
      canRetry: ctx.canRetry ?? base.canRetry ?? false,
      fallbackApplied: ctx.fallbackApplied ?? base.fallbackApplied,
    };
  }

  private redact(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    return this.deps.redactor ? this.deps.redactor.redactText(value) : value;
  }
}

function safeString(value: unknown): string {
  if (value === null) {
    return 'Unknown error (null)';
  }
  if (value === undefined) {
    return 'Unknown error (undefined)';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeUuid(): string {
  try {
    return randomUUID();
  } catch {
    return `err-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

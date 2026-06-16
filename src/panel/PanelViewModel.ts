import { ErrorReport, RecoveryAction, RecoveryKind, REPORT_ISSUE_ACTION } from '../errors/ErrorReport';
import { CapabilityStatus } from '../degraded/DegradedModeRegistry';

// Phase 20 — UI/UX panel. Pure presenters that turn domain state (ErrorReport,
// connectivity, degraded capabilities, agent activity) into plain view-models the
// webview renders. Zero `vscode` import so every UX-* shape is unit-testable
// under vitest; the host (ConclaveViewProvider) only marshals these over
// postMessage. Secrets never appear here — reports are already redacted upstream.
//
//   UX-1 any error      -> error CARD (plain title + cause + >=1 button)
//   UX-2 long op         -> live activity with a cancel action
//   UX-3 needs input     -> a distinct activity kind (not working, not failed)
//   UX-4 offline         -> persistent connectivity banner + queued count
//   UX-6 advanced        -> progressive disclosure (caller renders behind a toggle)
//   UX-7 accessibility   -> view-models carry the text the host maps to ARIA roles

/** A recovery button. The command/url is sent to the webview but only executed
 * back on the host after `isSafePanelCommand` validates it (the webview can never
 * make the host run an arbitrary command). */
export interface ActionVM {
  label: string;
  kind: RecoveryKind;
  command?: string;
  url?: string;
}

export interface ErrorCardVM {
  id: string;
  severity: ErrorReport['severity'];
  code?: string;
  title: string;
  detail: string;
  cause?: string;
  fallbackApplied?: string;
  retryAfterMs?: number;
  /** Always length >= 1 — the customer is never left without an action (UX-1). */
  actions: ActionVM[];
}

/** Distinct states so the UI never conflates "needs you" with "working" or
 * "failed" (UX-3). */
export type ActivityKind = 'idle' | 'working' | 'needs-input' | 'error' | 'done';

export interface ActivityVM {
  kind: ActivityKind;
  title: string;
  detail?: string;
  /** A long-running op shows a Cancel affordance (UX-2). */
  cancellable: boolean;
}

export interface ConnectivityVM {
  online: boolean;
  queued: number;
  /** Plain banner text; empty when online with nothing queued. */
  message: string;
}

export interface DegradedItemVM {
  capability: string;
  state: 'degraded' | 'unavailable';
  consequence?: string;
  restore?: ActionVM;
}

export interface DegradedVM {
  items: DegradedItemVM[];
}

function toActionVM(a: RecoveryAction): ActionVM {
  return { label: a.label, kind: a.kind, command: a.command, url: a.url };
}

/** Build a renderable error card. Guarantees at least one action even if the
 * report somehow arrived without one (defence in depth; UX-1). */
export function toErrorCard(report: ErrorReport): ErrorCardVM {
  const actions = report.recoveryActions.length > 0 ? report.recoveryActions : [REPORT_ISSUE_ACTION];
  return {
    id: report.id,
    severity: report.severity,
    code: report.code,
    title: report.title,
    detail: report.detail,
    cause: report.cause,
    fallbackApplied: report.fallbackApplied,
    retryAfterMs: report.retryAfterMs,
    actions: actions.map(toActionVM),
  };
}

/** Connectivity banner (UX-4). Online with nothing queued => empty message so the
 * banner hides; offline (or queued work) => a persistent, plain explanation. */
export function connectivityView(online: boolean, queued: number): ConnectivityVM {
  let message = '';
  if (!online) {
    message =
      queued > 0
        ? `Offline — ${queued} action${queued === 1 ? '' : 's'} queued; they resume when you reconnect.`
        : 'Offline — provider calls are queued and resume when you reconnect.';
  } else if (queued > 0) {
    message = `Back online — resuming ${queued} queued action${queued === 1 ? '' : 's'}.`;
  }
  return { online, queued, message };
}

/** Degraded-capability list (the panel's honest status). Only the
 * not-`full` capabilities are surfaced, each with its consequence + one-click
 * restore when known. */
export function degradedView(list: CapabilityStatus[]): DegradedVM {
  const items = list
    .filter((s): s is CapabilityStatus & { state: 'degraded' | 'unavailable' } => s.state !== 'full')
    .map((s) => ({
      capability: s.capability,
      state: s.state,
      consequence: s.consequence,
      restore: s.restoreAction ? toActionVM(s.restoreAction) : undefined,
    }));
  return { items };
}

/**
 * Only conclave's own commands may be triggered from the webview. A panel button
 * carries a command string, but the host validates it here before executing so a
 * compromised/buggy webview can never drive arbitrary VS Code commands
 * (e.g. `workbench.action.*`). Deny-by-default.
 */
export function isSafePanelCommand(command: unknown): command is string {
  return typeof command === 'string' && /^conclave\.[A-Za-z]+$/.test(command);
}

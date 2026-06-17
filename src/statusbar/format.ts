import type { CostMode } from '../cost/CostPolicy';
import type { ActivityKind } from '../panel/PanelViewModel';

// Pure status-bar text/tooltip computation. Kept vscode-free so it is unit
// tested directly; the thin StatusBar class owns the vscode.StatusBarItem and
// calls this. Codicon markup ($(name)) is just text VS Code renders as an icon.

export interface StatusBarInput {
  mode: CostMode;
  spentUsd: number;
  capUsd: number | null;
  /** Live agent state; 'idle' when no run is in flight. */
  activityKind: ActivityKind;
}

export interface StatusBarText {
  text: string;
  tooltip: string;
}

/** Warn once spend reaches this share of the cap (matches BudgetManager COST-2). */
const WARN_AT_PCT = 80;

const MODE_LABEL: Record<CostMode, string> = {
  'free-only': 'free',
  'free-first': 'free-first',
  'best-quality': 'best',
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatStatusBar(input: StatusBarInput): StatusBarText {
  // An in-flight run takes over the item so the user always sees live state.
  if (input.activityKind === 'working') {
    return { text: '$(sync~spin) conclave: working', tooltip: 'conclave — agent is running. Click to open the panel.' };
  }
  if (input.activityKind === 'needs-input') {
    return { text: '$(question) conclave: needs input', tooltip: 'conclave — the agent is waiting on you. Click to open the panel.' };
  }

  // Otherwise show the cost posture: mode, and spend against the cap when set.
  const mode = MODE_LABEL[input.mode];
  const capped = input.capUsd !== null && input.capUsd > 0;
  const pct = capped ? (input.spentUsd / (input.capUsd as number)) * 100 : 0;
  const warn = capped && pct >= WARN_AT_PCT;
  const icon = warn ? '$(warning)' : '$(zap)';

  let text = `${icon} conclave: ${mode}`;
  if (input.spentUsd > 0 || capped) {
    text += ` · ${money(input.spentUsd)}`;
    if (capped) {
      text += `/${money(input.capUsd as number)}`;
    }
  }

  const tooltipParts = [`conclave — cost mode: ${input.mode}`, `Spent: ${money(input.spentUsd)}`];
  if (capped) {
    tooltipParts.push(`Cap: ${money(input.capUsd as number)} (${pct.toFixed(0)}% used)`);
  } else {
    tooltipParts.push('Cap: none');
  }
  tooltipParts.push('Click to open the conclave panel.');

  return { text, tooltip: tooltipParts.join('\n') };
}

import * as vscode from 'vscode';
import { formatStatusBar, StatusBarInput } from './format';

/**
 * The conclave status-bar item: an always-visible glance at cost posture (mode +
 * spend) that flips to live agent state during a run. Click opens the panel. The
 * text/tooltip logic lives in the pure `formatStatusBar` (unit tested); this is
 * the thin vscode wrapper that owns the item and its lifecycle.
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(command = 'conclave.openPanel') {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'conclave';
    this.item.command = command;
  }

  update(input: StatusBarInput): void {
    const { text, tooltip } = formatStatusBar(input);
    this.item.text = text;
    this.item.tooltip = tooltip;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

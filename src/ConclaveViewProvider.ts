import * as vscode from 'vscode';
import { handleWebviewMessage } from './messaging';
import { PanelHost } from './panel/PanelHost';
import { OnboardingStatus } from './onboarding/OnboardingService';
import { ErrorReport } from './errors/ErrorReport';
import { CapabilityStatus } from './degraded/DegradedModeRegistry';
import {
  ActivityVM,
  connectivityView,
  degradedView,
  isSafePanelCommand,
  toErrorCard,
} from './panel/PanelViewModel';

/** Minimal onboarding view the host can supply to the webview banner. */
export interface OnboardingProvider {
  status(): Promise<OnboardingStatus>;
}

/**
 * Renders the conclave sidebar webview and wires the two-way message channel.
 * Phase 2: shows the provider list (free/paid + whether a key is set) and routes
 * key actions to the PanelHost. API keys never cross into the webview.
 */
export class ConclaveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'conclave.panel';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly host?: PanelHost,
    private readonly onboarding?: OnboardingProvider,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(webviewView.webview, msg);
    });

    void this.postProviders();
    void this.postOnboarding();
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  /** Re-push provider status to the webview (after a key change). */
  public async postProviders(): Promise<void> {
    if (!this.view || !this.host) {
      return;
    }
    const providers = await this.host.getProviderStatus();
    void this.view.webview.postMessage({ type: 'providers', payload: providers });
  }

  /** Push the onboarding banner state (steps + readiness). Keys/reports excluded. */
  public async postOnboarding(): Promise<void> {
    if (!this.view || !this.onboarding) {
      return;
    }
    const status = await this.onboarding.status();
    void this.view.webview.postMessage({
      type: 'onboarding',
      payload: {
        ready: status.ready,
        steps: status.steps.map((s) => ({
          id: s.id,
          title: s.title,
          done: s.done,
          required: s.required,
        })),
      },
    });
  }

  /** UX-1: push a redacted error card the webview renders with recovery buttons. */
  public postError(report: ErrorReport): void {
    void this.view?.webview.postMessage({ type: 'error', payload: toErrorCard(report) });
  }

  /** UX-2/3: push live agent activity (working / needs-input / error / done). */
  public postActivity(vm: ActivityVM): void {
    void this.view?.webview.postMessage({ type: 'activity', payload: vm });
  }

  /** UX-4: push the persistent connectivity banner state. */
  public postConnectivity(online: boolean, queued: number): void {
    void this.view?.webview.postMessage({ type: 'connectivity', payload: connectivityView(online, queued) });
  }

  /** Push the degraded-capability list (honest status with restore actions). */
  public postDegraded(list: CapabilityStatus[]): void {
    void this.view?.webview.postMessage({ type: 'degraded', payload: degradedView(list) });
  }

  private async onMessage(webview: vscode.Webview, msg: unknown): Promise<void> {
    const message = msg as { type?: string; payload?: { providerId?: string; command?: unknown; url?: unknown } };
    const providerId = message.payload?.providerId;

    // Ping/pong stays handled by the pure protocol.
    const reply = handleWebviewMessage(message as { type: string });
    if (reply) {
      void webview.postMessage(reply);
      return;
    }
    if (!this.host) {
      return;
    }

    switch (message.type) {
      case 'getProviders':
        await this.postProviders();
        break;
      case 'startOnboarding':
        await vscode.commands.executeCommand('conclave.startOnboarding');
        await this.postProviders();
        await this.postOnboarding();
        break;
      case 'addKey':
        if (providerId) {
          await this.host.addOrUpdateKey(providerId);
          await this.postProviders();
        }
        break;
      case 'clearKey':
        if (providerId) {
          await this.host.clearKey(providerId);
          await this.postProviders();
        }
        break;
      case 'testConnection':
        if (providerId) {
          const result = await this.host.testConnection(providerId);
          void webview.postMessage({ type: 'testResult', payload: { providerId, ...result } });
        }
        break;
      case 'runAction':
        await this.runRecoveryAction(message.payload?.command, message.payload?.url);
        break;
      default:
        break;
    }
  }

  /**
   * Execute a recovery-button action from the webview. A command is run only when
   * it passes `isSafePanelCommand` (deny-by-default) so the webview can never
   * drive arbitrary VS Code commands; a URL is opened externally.
   */
  private async runRecoveryAction(command: unknown, url: unknown): Promise<void> {
    if (isSafePanelCommand(command)) {
      await vscode.commands.executeCommand(command);
    }
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'),
    );

    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>conclave</title>
</head>
<body>
  <main>
    <h1>conclave</h1>
    <div id="connectivity" class="banner" role="status" aria-live="polite" hidden></div>
    <section id="error" class="card" role="alert" aria-live="assertive" hidden></section>
    <section id="activity" aria-label="Agent activity" role="status" aria-live="polite" hidden></section>
    <section id="onboarding" aria-label="Setup" hidden></section>
    <p class="tagline">Providers — add a free or paid key to get started.</p>
    <ul id="providers" aria-label="LLM providers"></ul>
    <details id="advanced">
      <summary>Status &amp; diagnostics</summary>
      <section id="degraded" aria-label="Degraded capabilities"></section>
    </details>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

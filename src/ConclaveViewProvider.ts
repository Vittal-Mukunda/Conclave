import * as vscode from 'vscode';
import { handleWebviewMessage } from './messaging';
import { PanelHost } from './panel/PanelHost';

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

  private async onMessage(webview: vscode.Webview, msg: unknown): Promise<void> {
    const message = msg as { type?: string; payload?: { providerId?: string } };
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
      default:
        break;
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
    <p class="tagline">Providers — add a free or paid key to get started.</p>
    <ul id="providers" aria-label="LLM providers"></ul>
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

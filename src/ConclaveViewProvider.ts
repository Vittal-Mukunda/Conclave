import * as vscode from 'vscode';
import { handleWebviewMessage } from './messaging';

/**
 * Renders the conclave sidebar webview and wires the two-way message channel.
 * Phase 0: a placeholder UI whose "Ping" button round-trips ping -> pong through
 * the extension host to prove the channel works end to end.
 */
export class ConclaveViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'conclave.panel';

  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      const reply = handleWebviewMessage(msg);
      if (reply) {
        void webviewView.webview.postMessage(reply);
      }
    });
  }

  /** Reveal/focus the view if it has already been resolved. */
  public reveal(): void {
    this.view?.show?.(true);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'),
    );

    // Strict CSP: no inline script (nonce-gated only), styles from our origin.
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
    <p class="tagline">Multi-model AI coding agent.</p>
    <button id="ping" type="button" aria-label="Send a ping to the extension host">Ping</button>
    <p id="status" role="status" aria-live="polite">idle</p>
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

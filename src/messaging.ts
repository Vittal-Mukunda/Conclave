// Pure webview <-> extension-host message protocol. Kept free of any `vscode`
// import so it is unit-testable under vitest (Node) without the extension host.
// Phase 0 only implements ping -> pong; later phases extend the union.

export interface WebviewMessage {
  type: string;
  /** Optional correlation id the webview supplies and we echo back. */
  id?: string;
  payload?: unknown;
}

/**
 * Handle an inbound message from the webview and return the reply to post back,
 * or `null` when there is nothing to send (unknown/ignored message types).
 *
 * Returning `null` rather than throwing keeps the protocol forward-compatible:
 * a newer webview can send a message an older host does not recognise without
 * crashing the host (relevant once the Error & Recovery Contract lands).
 */
export function handleWebviewMessage(msg: WebviewMessage): WebviewMessage | null {
  switch (msg?.type) {
    case 'ping':
      return { type: 'pong', id: msg.id, payload: { at: Date.now() } };
    default:
      return null;
  }
}

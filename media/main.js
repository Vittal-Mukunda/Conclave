// Webview script. Runs in the sandboxed webview, talks to the extension host
// only via postMessage. Phase 0: Ping button -> host -> pong -> status update.
(function () {
  const vscode = acquireVsCodeApi();
  const status = document.getElementById('status');
  const pingBtn = document.getElementById('ping');

  pingBtn.addEventListener('click', function () {
    status.textContent = 'pinging...';
    vscode.postMessage({ type: 'ping', id: String(Date.now()) });
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'pong') {
      status.textContent = 'pong received at ' + new Date().toLocaleTimeString();
    }
  });
}());

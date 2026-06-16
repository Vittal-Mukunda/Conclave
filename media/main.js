// Webview script. Talks to the extension host only via postMessage. Renders the
// provider list with key status and Add/Test/Clear buttons. API keys never reach
// the webview — only presence flags and friendly messages.
(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('providers');
  const status = document.getElementById('status');
  const onboarding = document.getElementById('onboarding');

  function setStatus(text) {
    status.textContent = text || '';
  }

  function button(label, action, providerId, classes) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = classes || '';
    b.setAttribute('aria-label', label + ' for ' + providerId);
    b.addEventListener('click', function () {
      if (action === 'testConnection') {
        setStatus('Testing ' + providerId + '...');
      }
      vscode.postMessage({ type: action, payload: { providerId: providerId } });
    });
    return b;
  }

  function render(providers) {
    list.innerHTML = '';
    providers.forEach(function (p) {
      const li = document.createElement('li');
      li.className = 'provider';

      const head = document.createElement('div');
      head.className = 'provider-head';

      const name = document.createElement('span');
      name.className = 'provider-name';
      name.textContent = p.label;

      const tag = document.createElement('span');
      tag.className = 'tag tag-' + p.kind;
      tag.textContent = p.kind;

      const keyState = document.createElement('span');
      keyState.className = p.hasKey ? 'key-set' : 'key-unset';
      keyState.textContent = p.hasKey ? '✓ key set' : 'no key';

      head.appendChild(name);
      head.appendChild(tag);
      head.appendChild(keyState);

      const actions = document.createElement('div');
      actions.className = 'provider-actions';
      actions.appendChild(button(p.hasKey ? 'Update' : 'Add key', 'addKey', p.id, 'primary'));
      actions.appendChild(button('Test', 'testConnection', p.id));
      if (p.hasKey) {
        actions.appendChild(button('Clear', 'clearKey', p.id));
      }

      li.appendChild(head);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function renderOnboarding(payload) {
    onboarding.innerHTML = '';
    if (!payload || payload.ready) {
      onboarding.hidden = true;
      return;
    }
    onboarding.hidden = false;

    const heading = document.createElement('h2');
    heading.textContent = 'Finish setup';
    onboarding.appendChild(heading);

    const steps = document.createElement('ul');
    steps.className = 'steps';
    (payload.steps || []).forEach(function (s) {
      const li = document.createElement('li');
      li.className = s.done ? 'step done' : 'step';
      const mark = s.done ? '✓ ' : '○ ';
      const opt = s.required ? '' : ' (optional)';
      li.textContent = mark + s.title + opt;
      steps.appendChild(li);
    });
    onboarding.appendChild(steps);

    const start = document.createElement('button');
    start.textContent = 'Start setup';
    start.className = 'primary';
    start.setAttribute('aria-label', 'Start conclave setup');
    start.addEventListener('click', function () {
      vscode.postMessage({ type: 'startOnboarding' });
    });
    onboarding.appendChild(start);
  }

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'providers') {
      render(msg.payload || []);
    } else if (msg.type === 'onboarding') {
      renderOnboarding(msg.payload);
    } else if (msg.type === 'testResult') {
      setStatus(msg.payload && msg.payload.message);
    }
  });

  // Ask for the initial provider list.
  vscode.postMessage({ type: 'getProviders' });
}());

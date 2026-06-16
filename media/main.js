// Webview script. Talks to the extension host only via postMessage. Renders the
// provider list with key status and Add/Test/Clear buttons. API keys never reach
// the webview — only presence flags and friendly messages.
(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('providers');
  const status = document.getElementById('status');
  const onboarding = document.getElementById('onboarding');
  const connectivityEl = document.getElementById('connectivity');
  const errorEl = document.getElementById('error');
  const activityEl = document.getElementById('activity');
  const degradedEl = document.getElementById('degraded');

  function setStatus(text) {
    status.textContent = text || '';
  }

  // A recovery/action button that asks the host to run a command or open a URL.
  // The host re-validates the command before executing (deny-by-default).
  function actionButton(action, primary) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.className = primary ? 'primary' : '';
    b.setAttribute('aria-label', action.label);
    b.addEventListener('click', function () {
      vscode.postMessage({
        type: 'runAction',
        payload: { command: action.command, url: action.url },
      });
    });
    return b;
  }

  // UX-1: an error card — plain title, optional cause, and >= 1 recovery button.
  function renderError(card) {
    errorEl.innerHTML = '';
    if (!card) {
      errorEl.hidden = true;
      return;
    }
    errorEl.hidden = false;
    errorEl.className = 'card severity-' + (card.severity || 'error');

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = (card.code ? '[' + card.code + '] ' : '') + card.title;
    errorEl.appendChild(title);

    if (card.detail) {
      const detail = document.createElement('p');
      detail.className = 'card-detail';
      detail.textContent = card.detail;
      errorEl.appendChild(detail);
    }
    if (card.fallbackApplied) {
      const fb = document.createElement('p');
      fb.className = 'card-fallback';
      fb.textContent = 'Fallback applied: ' + card.fallbackApplied;
      errorEl.appendChild(fb);
    }
    if (card.cause) {
      const det = document.createElement('details');
      det.className = 'card-cause';
      const sum = document.createElement('summary');
      sum.textContent = 'Details';
      det.appendChild(sum);
      const pre = document.createElement('pre');
      pre.textContent = card.cause;
      det.appendChild(pre);
      errorEl.appendChild(det);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    (card.actions || []).forEach(function (a, i) {
      actions.appendChild(actionButton(a, i === 0));
    });
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss error');
    dismiss.addEventListener('click', function () {
      renderError(null);
    });
    actions.appendChild(dismiss);
    errorEl.appendChild(actions);
  }

  // UX-2/3: live agent activity, visually distinct per state. 'working' shows a
  // Cancel button; 'needs-input' is unmistakably different from working/failed.
  function renderActivity(vm) {
    activityEl.innerHTML = '';
    if (!vm || vm.kind === 'idle') {
      activityEl.hidden = true;
      return;
    }
    activityEl.hidden = false;
    activityEl.className = 'activity activity-' + vm.kind;

    const title = document.createElement('div');
    title.className = 'activity-title';
    title.textContent = vm.title;
    activityEl.appendChild(title);

    if (vm.detail) {
      const d = document.createElement('p');
      d.className = 'activity-detail';
      d.textContent = vm.detail;
      activityEl.appendChild(d);
    }
    if (vm.cancellable) {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.setAttribute('aria-label', 'Cancel the running agent');
      cancel.addEventListener('click', function () {
        vscode.postMessage({ type: 'runAction', payload: { command: 'conclave.cancelAgent' } });
      });
      activityEl.appendChild(cancel);
    }
  }

  // UX-4: persistent offline/queued banner.
  function renderConnectivity(vm) {
    if (!vm || !vm.message) {
      connectivityEl.hidden = true;
      connectivityEl.textContent = '';
      return;
    }
    connectivityEl.hidden = false;
    connectivityEl.className = 'banner ' + (vm.online ? 'banner-info' : 'banner-warn');
    connectivityEl.textContent = vm.message;
  }

  function renderDegraded(vm) {
    degradedEl.innerHTML = '';
    const items = (vm && vm.items) || [];
    if (items.length === 0) {
      const ok = document.createElement('p');
      ok.className = 'degraded-ok';
      ok.textContent = 'All systems full capability.';
      degradedEl.appendChild(ok);
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'degraded-list';
    items.forEach(function (it) {
      const li = document.createElement('li');
      li.className = 'degraded-item state-' + it.state;
      const head = document.createElement('span');
      head.className = 'degraded-name';
      head.textContent = it.capability + ' — ' + it.state;
      li.appendChild(head);
      if (it.consequence) {
        const c = document.createElement('p');
        c.className = 'degraded-consequence';
        c.textContent = it.consequence;
        li.appendChild(c);
      }
      if (it.restore) {
        li.appendChild(actionButton(it.restore, false));
      }
      ul.appendChild(li);
    });
    degradedEl.appendChild(ul);
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
    } else if (msg.type === 'error') {
      renderError(msg.payload);
    } else if (msg.type === 'activity') {
      renderActivity(msg.payload);
    } else if (msg.type === 'connectivity') {
      renderConnectivity(msg.payload);
    } else if (msg.type === 'degraded') {
      renderDegraded(msg.payload);
    }
  });

  // Ask for the initial provider list.
  vscode.postMessage({ type: 'getProviders' });
}());

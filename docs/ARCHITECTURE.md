# conclave — Architecture

Living document. Updated at each phase end. Describes how the pieces fit, not the full plan
(see `build-plan.md`) nor the OR math (see `operations-research-design.md`).

## Layering (target)

```
VS Code Extension Host (Node, TypeScript)
  extension.ts ............. activation, command + view registration
  panel / webview .......... sidebar UI (postMessage protocol)
  [later] engine ........... agent loop, router, scheduler, OR brain
  [later] providers ........ free + paid LLM adapters (BYOK)
  [later] codeintel ........ LSP + tree-sitter + embeddings + dep graph
  [later] sandbox .......... Docker (dockerode) verification ladder
  [later] skills ........... SKILL.md ingest / retrieval / sandbox
  [later] storage .......... better-sqlite3 (telemetry, memory, skills index)
```

## Phase 0 — present

- **Build:** `esbuild.js` bundles `src/extension.ts` -> `out/extension.js` (CJS, `vscode` external).
  Webview assets in `media/` are plain JS/CSS, served via `asWebviewUri`.
- **Entry:** `src/extension.ts` registers the webview view provider and the `conclave.openPanel`
  command (keybinding `Ctrl+Alt+C` / `Cmd+Alt+C`). The command focuses the activity-bar view.
- **UI:** `src/ConclaveViewProvider.ts` renders the sidebar webview under a strict nonce-gated CSP.
  Placeholder UI with a Ping button.
- **Message protocol:** `src/messaging.ts` is a *pure* module (no `vscode` import) so it is unit
  testable under vitest. `handleWebviewMessage` returns a reply or `null`; Phase 0 implements only
  `ping -> pong`. The provider owns the `vscode` wiring; the protocol owns the logic. This split is
  the pattern for every later feature: testable logic in vscode-free modules, thin vscode glue.

## Phase 1 — Error & Resilience Framework

The safety net every later feature plugs into. Core is `vscode`-free and unit-tested; `Services`
is the thin glue that wires it to the host.

- **Taxonomy** (`src/errors/taxonomy.ts`): `ErrorCategory` (mirrors edge-cases.md groups) +
  `ErrorSeverity`; `titleForCategory` (plain titles) + `heuristicCategory` (guess for plain Errors).
- **ErrorReport / ConclaveError** (`src/errors/ErrorReport.ts`): the report shape + `RecoveryAction`
  (always >= 1) + the typed error all subsystems throw. `REPORT_ISSUE_ACTION` is the universal
  fallback action.
- **ErrorService** (`src/errors/ErrorService.ts`): funnels ANY caught value (typed/Error/string/
  object/null) into a valid, redacted ErrorReport with >= 1 action. Never throws — even an internal
  failure yields a fatal report. Emits to subscribers; logs via Logger.
- **Secret redaction** (`src/logging/redaction.ts`): `SecretRedactor` with (1) a registry of
  known-live secrets removed by exact substring, and (2) shape patterns (sk-/AIza/ghp_/gsk_/Bearer/
  key=value). MANDATORY before any log / provider send / report / UI surface. This is the SEC-4
  invariant's enforcement point.
- **Logger** (`src/logging/Logger.ts`): structured JSON lines, redacted before reaching the sink.
- **DegradedModeRegistry** (`src/degraded/DegradedModeRegistry.ts`): per-capability
  full|degraded|unavailable + consequence + restore action; emits on real transitions. The router
  and UI read this. `degraded` ≠ unusable; only `unavailable` blocks.
- **ConnectivityMonitor** (`src/connectivity/ConnectivityMonitor.ts`): online/offline via an
  injected probe; `enqueue` holds actions while offline and auto-drains FIFO on reconnect (UX-4).
- **globalCapture** (`src/errors/globalCapture.ts`): process `unhandledRejection`/`uncaughtException`
  -> fatal ErrorReport, never rethrown — no VS Code crash dialog.
- **Services** (`src/core/Services.ts`): builds all of the above, wires the OutputChannel sink, the
  DNS network probe, network-state -> degraded-mode bridge, and surfaces fatal reports as a
  notification (rich card comes in Phase 20). `extension.ts` wraps every entry point in `guard()`.

Catalog entries handled: **UX-1** (any error -> actionable report), **UX-4** (offline + queued
resume), **SEC-4** (no secret in logs/reports).

## Phase 2 — Provider abstraction + secure keys

Uniform BYOK layer for free + paid LLM APIs. Core is `vscode`-free with an injected transport;
SecretStorage + dialogs are the glue.

- **Types** (`src/providers/types.ts`): `Provider`, `ModelInfo` (incl. price metadata), `ChatRequest`/
  `ChatResponse` (`{text, tokensIn, tokensOut, finishReason, latencyMs, estimatedTokens, ...}`).
- **Transport** (`src/providers/http.ts`): `HttpTransport` interface (`FetchTransport` default) so the
  client is testable without network. Handles timeout via AbortController and SSE line decoding;
  raises `TransportError`.
- **Adapters** (`src/providers/adapters/`): `ChatAdapter` contract; `OpenAICompatibleAdapter` (default
  for Groq/OpenRouter/Cerebras/Mistral/DeepSeek/GitHub Models/Gemini-OpenAI/OpenAI) and a dedicated
  `AnthropicAdapter` (x-api-key, anthropic-version, system field, content blocks, stop_reason). Pure
  build/parse; throw typed errors on empty/malformed/refusal.
- **Errors** (`src/providers/errors.ts`): maps transport/HTTP/parse failures onto the Phase 1
  taxonomy with catalog codes — 401/403→SETUP-2, quota→SETUP-4, paid billing→PROV-13, 404→PROV-8,
  429→PROV-1, 451→SETUP-10, 5xx→PROV-3, timeout→PROV-4, network→SETUP-8, context→PROV-10, plus
  PROV-5/6/9/12. Each carries ≥1 recovery action.
- **registry** (`src/providers/registry.ts`): built-in free + paid catalog; `getAdapter`;
  `equivalentModel` for PROV-8 fallback.
- **LLMClient** (`src/providers/LLMClient.ts`): `chat()` non-stream + stream; registers the key with
  the redactor before use (SEC-4); a dropped stream → PROV-12 with NO partial commit; estimates
  tokens when usage is absent. Raw transport only — retries/rate-limits come in Phase 3.
- **KeyStore** (`src/keys/KeyStore.ts`): wraps `SecretStorage` (injected `SecretStore` interface);
  registers/unregisters keys with the redactor; returns presence flags, never keys, to the UI.
- **ProviderService** + **KeyManager** + **PanelHost**: service ties registry+client+keys and a
  `testConnection`; KeyManager drives the per-provider add/update/clear/test via native dialogs and
  implements PanelHost so the webview buttons reuse the same flows. The sidebar now lists providers
  (free/paid + key-set state) — keys never cross into the webview.

Catalog handled: SETUP-2/3/4/10, PROV-5/6/8/9/10/11/12/13, SEC-4. Command: `conclave.manageKeys`.

## Phase 3 — Rate-limit-aware scheduler

The single choke point that makes an over-limit issuance **physically impossible**. Fully
deterministic via an injected `Clock` (`RealClock` in prod, `ManualClock` in tests).

- **SlidingWindowLimiter** (`src/scheduler/SlidingWindowLimiter.ts`): strict sliding window — sum of
  recorded amounts in ANY window ≤ limit (stricter than a token bucket, which can admit 2× across a
  boundary). Used for RPM/TPM/RPD/TPD. `timeUntilAvailable` drives wake scheduling.
- **AccountLimiter** (`src/scheduler/AccountLimiter.ts`): combines the request + token windows for
  one account. `tryAcquire` is **atomic** (check-all-then-record-all, no await between) → no race /
  double-spend on single-threaded JS.
- **CircuitBreaker** (`src/scheduler/CircuitBreaker.ts`): K failures → open → half-open (one probe)
  → closed/re-open. `peekAvailable`/`confirmDispatch` split so the dispatcher checks before
  reserving the single probe.
- **backoff** (`src/scheduler/backoff.ts`): bounded jittered exponential + `parseRetryAfterMs`
  (seconds or HTTP-date). `Retry-After` flows from the 429 response → `HttpResponse.header()` →
  `mapHttpError` → `ConclaveError.retryAfterMs` → scheduler cooldown.
- **Scheduler** (`src/scheduler/Scheduler.ts`): async priority queue; picks the eligible pooled
  account with the most remaining capacity; dispatches only after `tryAcquire`; classifies failures
  (rate-limit → cooldown, outage → breaker+backoff, account-dead → fail over, request-bad → fail
  over); requeues within attempt/wall-clock budget; one `clock.setTimeout` wake at the soonest
  capacity/cooldown/breaker time. When all accounts are throttled it **queues** the job and emits a
  PROV-2 ErrorReport (countdown + "Add key"/"Add paid"), resuming automatically.

Wiring: `ProviderService.chat`/`testConnection` now submit through the scheduler — the LLMClient is
only invoked inside a scheduled `run` after capacity is acquired ("callable ONLY via scheduler").
`Services` builds one default `Account` per provider (`defaultLimitsFor`, breaker 5/30s).

Catalog handled: PROV-1/2/3/4/14/15, SETUP-8. Invariant enforced: no call exceeds a live
RPM/TPM/RPD limit.

## Testing strategy

- **Unit (vitest, Node):** pure modules only; must never import `vscode`. Config:
  `vitest.config.ts` (includes `test/unit/**`).
- **Integration (@vscode/test-electron + Mocha):** runs in a real downloaded VS Code host. Compiled
  by `tsconfig.test.json` to `out/test/integration/`, launched by `runTest.ts`. Asserts activation,
  command registration, command execution.
- **Package check:** `vsce package` -> `.vsix`; verified to install into a clean VS Code profile.

## Conventions

- Keep all `vscode`-dependent code thin and push logic into vscode-free, unit-tested modules.
- Strict TypeScript (`strict`, `noUnusedLocals`, `noImplicitReturns`).
- CSP on every webview: `default-src 'none'`, nonce-gated scripts, no inline script.

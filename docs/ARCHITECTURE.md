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

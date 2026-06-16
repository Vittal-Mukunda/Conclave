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

# conclave — Progress

Resume a session with: read `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/edge-cases.md`,
`docs/skills-spec.md`, then continue the next phase.

## Status: Phase 10 COMPLETE

| Phase | Title | State |
|------:|-------|-------|
| 0 | Foundation & extension skeleton | ✅ complete |
| 1 | Error & Resilience Framework | ✅ complete |
| 2 | Provider abstraction + key storage | ✅ complete |
| 3 | Rate-limit-aware scheduler | ✅ complete |
| 4 | Capability & quota registry + cost meter | ✅ complete |
| 5 | Shadow-price engine + budget/spend control | ✅ complete |
| 6 | Onboarding wizard & first-run | ✅ complete |
| 7 | Code intelligence + localization | ✅ complete |
| 8 | Editing + git checkpoints + repo memory | ✅ complete |
| 9 | Verification ladder + sandbox | ✅ complete |
| 10 | Agent loop | ✅ complete |
| 11 | Difficulty estimator + cascade router | ⬜ next |
| 12 | Competence learner (bandit) | ⬜ |
| 13 | Assignment solver + diverse council | ⬜ |
| 14 | Best-of-N + strong verifier-selector | ⬜ |
| 15 | Security & privacy hardening | ⬜ |
| 16 | Skills I: format/ingest/retrieval | ⬜ |
| 17 | Skills II: composition/injection | ⬜ |
| 18 | Skills III: security sandbox/marketplace | ⬜ |
| 19 | State, crash recovery & concurrency | ⬜ |
| 20 | UI / UX panel | ⬜ |
| 21 | Multi-account quota pooling | ⬜ |
| 22 | Hardening, edge-case matrix, eval, release | ⬜ |

## Phase 10 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| plan -> checkpoint -> act -> verify -> decide, bounded by iteration cap | `agentLoop.test.ts` (success path; checkpoint before act) | ✅ |
| Accept only a passing verdict that clears the confidence threshold | `agentLoop.test.ts` (success at 0.9; partial when never accepted) | ✅ |
| LOOP-1: oscillation -> detect + cap + HANDOFF | `agentLoop.test.ts` (repeated signature -> oscillation) | ✅ |
| LOOP-2: makes it worse -> checkpoint + auto-rollback | `agentLoop.test.ts` (regression -> rollback to checkpoint) | ✅ |
| LOOP-3: stuck -> clean HANDOFF | `agentLoop.test.ts` (no-progress limit -> handoff) | ✅ |
| LOOP-4: impossible/out-of-scope -> explain + scoped suggestion | `agentLoop.test.ts` (impossible -> blocked + suggestion) | ✅ |
| LOOP-5: ambiguous -> ONE clarifying question BEFORE planning | `agentLoop.test.ts` (ambiguous -> needs-clarification, never acts) | ✅ |
| LOOP-6: partial success -> report honestly | `agentLoop.test.ts` (progress but unaccepted -> partial) | ✅ |
| LOOP-7: runaway cost -> budget cap -> stop + handoff | `agentLoop.test.ts` (closed gate -> handoff before acting) | ✅ |
| LOOP-9: hallucinated edit caught by verifier, not committed | `agentLoop.test.ts` (failed act -> verified failure, not pass) | ✅ |
| Loop never commits a regression / leaves tree worse | rollback-on-regression + accept-threshold gate | ✅ |
| Wired to real services (localize/edit+checkpoint/verify/budget) | `AgentService` (planner=codeIntel, checkpointer=editing, verifier=verify, gate=budget) | ✅ |
| Host activates + runAgent command registered | integration 10/10 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 227/227 |
| `.vsix` packages | `npm run package` (582 KB, 15 files) | ✅ |

## Phase 9 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Escalating ladder runs weakest->strongest, passes when all pass | `verificationLadder.test.ts` (order + all-pass) | ✅ |
| Failed rung short-circuits remaining rungs | `verificationLadder.test.ts` (fail -> skip rest) | ✅ |
| VER-1: flaky -> run twice, flag | `verificationLadder.test.ts` (re-run -> flaky), `confidenceModel.test.ts` (lowers + flags) | ✅ |
| VER-2/4: hang/slow -> time limit kills + partial report | `verificationLadder.test.ts` (timeout halts), `confidenceModel.test.ts` (cap 0.5) | ✅ |
| VER-3: needs services -> partial verify + lowered confidence | `confidenceModel.test.ts` (service-skipped flag + penalty) | ✅ |
| VER-5: NO tests -> LSP/type-check only, LOW confidence + flag | `confidenceModel.test.ts` (cap 0.4 + flag), `verifyDetect.test.ts` (no test rung) | ✅ |
| VER-6: test cmd undetectable -> ask once; remember in repo memory | `verifyDetect.test.ts` (remembered overrides); `VerifyService.detectRungs` reads RepoMemory | ✅ |
| VER-9: passes sandbox/fails host -> note env diff | `verificationLadder.test.ts` (hostRunner divergence -> VER-9 flag) | ✅ |
| VER-10: no coverage tool -> conservative LOW confidence + flag | `confidenceModel.test.ts` (cap 0.85 + flag) | ✅ |
| Sandbox honestly flagged degraded (process, not container; VER-7/8 future) | `VerifyService` sets Capability.Sandbox = degraded; `ProcessSandbox` timeout+buffer cap | ✅ |
| Host activates + verify command registered | integration 9/9 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 218/218 |
| `.vsix` packages | `npm run package` (580 KB, 15 files) | ✅ |

## Phase 8 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| EDIT-1: drift -> fail+regenerate, never force | `atomicEditor.test.ts` (base-hash drift -> EDIT-1), `editPatch.test.ts` (context mismatch -> drift) | ✅ |
| EDIT-2: edit outside workspace -> BLOCK | `atomicEditor.test.ts` (outside predicate -> EDIT-2); `EditService.isInsideWorkspace` | ✅ |
| EDIT-3: dirty tree -> auto-checkpoint user work FIRST | `checkpointManager.test.ts` (dirty -> commitAll "user work", capturedDirty) | ✅ |
| EDIT-4: conflict markers -> refuse; never clobber | `atomicEditor.test.ts` + `editPatch.test.ts` (hasConflictMarkers) | ✅ |
| EDIT-5: git op fails -> retry; else typed ErrorReport | `checkpointManager.test.ts` (retry succeeds; exhausted -> EDIT-5) | ✅ |
| EDIT-6: unsaved buffers -> reconcile | `atomicEditor.test.ts` (bufferDirty -> reconciled); `EditService.applyPlan` saves first | ✅ |
| EDIT-7: rollback/partial -> ATOMIC (all-or-nothing) | `atomicEditor.test.ts` (one failure -> zero writes); `checkpointManager.test.ts` (rollback resetHard) | ✅ |
| EDIT-8: user edits mid-run -> re-sync; no overwrite | `editPatch.test.ts` (anchor re-sync within window) | ✅ |
| EDIT-9: missing target / write fail -> ErrorReport; no corruption | `atomicEditor.test.ts` (missing -> EDIT-9); `EditService` rolls back on write error | ✅ |
| VER-6: remember test command in repo memory (ask once) | `repoMemory.test.ts`; `conclave.rememberTestCommand` | ✅ |
| STATE-6: repo memory scoped per workspace | `repoMemory.test.ts` (WS_A/WS_B isolation) | ✅ |
| STATE-5: migration v4 (repo_memory) preserves prior rows | `repoMemory.test.ts` (latestVersion=4, all migrations applied) | ✅ |
| Host activates + Phase 8 commands registered | integration 8/8 (checkpoint, rememberTestCommand) | ✅ |
| Unit suite | `npm run test:unit` | ✅ 198/198 |
| `.vsix` packages | `npm run package` (577 KB, 15 files) | ✅ |

## Phase 7 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Fuse lexical + semantic + symbol + dep-graph -> FILE+LINE ranges | `codeintelLocalize.test.ts` (CodeIndex e2e: file+symbol+range) | ✅ |
| Precise line ranges (symbol-tightened) | `codeintelLocalize.test.ts` | ✅ |
| LOC-1: low/ambiguous confidence -> widen/ask, never false "use" | `codeintelLocalize.test.ts` (fuse thresholds + unknown-topic) | ✅ |
| LOC-2: lazy/incremental index (build/update/remove) | `CodeIndex.update/remove`, `CodeIntelService.ensureIndexed` lazy | ✅ |
| LOC-3: gitignore + binary/generated/vendored exclude | `codeintelIndex.test.ts` (Ignore globs/anchor/negate) | ✅ |
| LOC-4: unreadable/odd-encoding files skipped w/ note | `CodeIntelService.buildWorkspace` try/catch skip+log | ✅ |
| LOC-5: large file chunking (overlapping line ranges) | `codeintelIndex.test.ts` (chunkFile) + size-cap skip | ✅ |
| LOC-6: stale embeddings re-embed only on hash change | `codeintelIndex.test.ts` (VectorIndex.upsert) | ✅ |
| BM25 lexical ranking | `codeintelIndex.test.ts` | ✅ |
| Heuristic symbol extraction (fn/class/iface/const/py) | `codeintelLocalize.test.ts` (HeuristicSymbolExtractor) | ✅ |
| Dependency graph edges + proximity | `codeintelLocalize.test.ts` (DependencyGraph) | ✅ |
| Capability honestly flagged degraded (no real LSP/tree-sitter yet) | `CodeIntelService` sets Lsp/TreeSitter = degraded | ✅ |
| Host activates + localize command registered | integration 7/7 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 168/168 |
| `.vsix` packages | `npm run package` (573 KB, 15 files) | ✅ |

## Phase 6 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| First run -> wizard (UX-5) | `onboarding.test.ts` (shouldLaunchWizard on firstRun) + `notifyIfIncomplete` | ✅ |
| SETUP-1: no keys -> guide, can't run | `onboarding.test.ts` (ready=false, blocker COST→SETUP-1) | ✅ |
| SETUP-11: no folder -> prompt, disable run | `onboarding.test.ts` (blocker SETUP-11) | ✅ |
| SETUP-12: not git -> offer init / read-only optional | `onboarding.test.ts` (git step optional, non-blocking) | ✅ |
| Keys precedence over folder when both missing | `onboarding.test.ts` | ✅ |
| Blocker carries step action + resume action (≥1 button) | `onboarding.test.ts` | ✅ |
| Wizard completion persists (no re-nag) | `OnboardingHost` globalState `conclave.onboarded` | ✅ |
| Webview onboarding banner (steps + Start setup) | `ConclaveViewProvider.postOnboarding` + `media/main.js` | ✅ |
| Activation stays non-blocking / headless-safe | `notifyIfIncomplete` (non-modal nudge; modal only on user action) | ✅ |
| Host activates + Phase 5/6 commands registered | integration 6/6 (setBudget, startOnboarding, initGit) | ✅ |
| Unit suite | `npm run test:unit` | ✅ 145/145 |
| `.vsix` packages | `npm run package` (566 KB, 15 files) | ✅ |

## Phase 5 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Shadow price subgradient: λ ← max(0, λ + η·(consumption − budget)) | `shadowPrice.test.ts` (rise over budget, decay+clamp under) | ✅ |
| pricedCost: real $ for paid, $0 for free, + shadow-priced scarcity | `shadowPrice.test.ts` (PricedCost) | ✅ |
| COST MODE gates candidates (free-only / free-first / best-quality) | `costPolicy.test.ts` | ✅ |
| Spend cap never exceeded — HARD STOP at cap (COST-3) | `budgetManager.test.ts` (preflight blocks + capReached) | ✅ |
| Warn once at 50/80/100% (COST-2) | `budgetManager.test.ts` | ✅ |
| Pre-flight estimate + confirm for expensive task (COST-4) | `budgetManager.test.ts` | ✅ |
| Free ceiling → add key/add paid/wait (COST-1) | `budgetManager.test.ts` (freeCeilingReport actions) | ✅ |
| Budget state persists across reload (cap/spend/mode/warned) | `budgetManager.test.ts` (new instance same db) | ✅ |
| Migration v3 (budget table) preserves prior rows (STATE-5) | `storage.test.ts` (v1→v3 keeps model row + seeds budget) | ✅ |
| Paid spend folds into budget from call path | `Services` observer → `budget.record` → COST-2 surface | ✅ |
| Host activates + commands registered | integration 5/5 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 135/135 |
| `.vsix` packages with WASM dep | `npm run package` (563 KB, 15 files) | ✅ |

## Phase 4 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Schema CRUD | `capabilityRegistry.test.ts`, `telemetryCost.test.ts` | ✅ |
| Versioned migration preserves data (STATE-5) | `storage.test.ts` (v1→v2 keeps rows, adds column) | ✅ |
| Quota decrement + correct reset | `capabilityRegistry.test.ts` | ✅ |
| Cost math: free saved + paid spend | `telemetryCost.test.ts`, `CostCalculator` | ✅ |
| Per-model usage rankings | `telemetryCost.test.ts` | ✅ |
| Probing updates availability (PROV-7) | `probeService.test.ts` | ✅ |
| Persists across reload | `storage.test.ts` (reopen file DB) | ✅ |
| Storage degrades, never crashes (STATE-4) | Services try/catch → `storage` unavailable | ✅ |
| Telemetry recorded from call path | `ProviderService.record` → observer | ✅ |
| Host activates + DB opens in Electron | integration 5/5 (activation 222ms = open+migrate+seed) | ✅ |
| Unit suite | `npm run test:unit` | ✅ 115/115 |
| `.vsix` packages with WASM dep + installs | `npm run package` (560 KB, 15 files) + clean install | ✅ |

**Deviation flagged:** storage engine is `node-sqlite3-wasm` (pure WASM), not the mandated
`better-sqlite3` (won't compile here; would ABI-mismatch Electron). Abstracted behind `SqlDb` so a
native engine can be swapped at ship time. See ARCHITECTURE.md "Phase 4".

## Phase 3 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Buckets never exceed limits in any window (fake clock) | `slidingWindow.test.ts`, `accountLimiter.test.ts` | ✅ |
| Bursts queue + drain | `scheduler.test.ts` (9 jobs / rpm 3, window invariant holds) | ✅ |
| Backoff bounded + jittered, honors Retry-After | `backoff.test.ts` | ✅ |
| Breaker opens + recovers (PROV-3) | `circuitBreaker.test.ts`, `scheduler.test.ts` | ✅ |
| 429 storm + bursty = zero violations, full recovery, no lost/dup (PROV-1) | `scheduler.test.ts` (each job runs exactly twice: fail once, succeed once) | ✅ |
| ALL-throttled -> queued + PROV-2 report w/ countdown + Add key/Add paid (PROV-2) | `scheduler.test.ts` | ✅ |
| Concurrent race = no double-spend (PROV-14) | `scheduler.test.ts` (20 concurrent / rpm 5, each runs once) | ✅ |
| Failover across pooled accounts (PROV-15) | `scheduler.test.ts` (both accounts carry load) | ✅ |
| Offline queued resume (SETUP-8) | network → SETUP-8 mapping + connectivity queue (Phase 1) | ✅ |
| LLMClient callable only via scheduler | `ProviderService` routes all calls through `scheduler.submit` | ✅ |
| Host activates with scheduler wired | integration 5/5 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 98/98 |
| `.vsix` packages | `npm run package` (23.6 KB) | ✅ |

## Phase 2 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Free + paid providers under one interface | `registry.test.ts` (free & paid lists, prices) | ✅ |
| Anthropic paid adapter round-trips | `anthropicAdapter.test.ts` + `llmClient.test.ts` | ✅ |
| Each error -> ErrorReport with correct action/code | `providerErrors.test.ts`, `llmClient.test.ts` | ✅ |
| Malformed JSON handled, no crash (PROV-5) | `llmClient.test.ts` | ✅ |
| Empty response (PROV-6) | `llmClient.test.ts` / `openaiAdapter.test.ts` | ✅ |
| 404 -> PROV-8 + equivalent-model fallback | `llmClient.test.ts`, `registry.equivalentModel` | ✅ |
| Refusal -> PROV-9 retry-different-model (PROV-9) | adapter + client tests | ✅ |
| finish=length surfaced not thrown (PROV-11) | `llmClient.test.ts` | ✅ |
| Stream drop -> PROV-12, no partial commit | `llmClient.test.ts` | ✅ |
| Paid billing fail -> PROV-13 fallback to free | `providerErrors.test.ts` | ✅ |
| Geo-block (SETUP-10) | `providerErrors.test.ts` | ✅ |
| Keys persist in SecretStorage | `keyStore.test.ts` (persist across instances) | ✅ |
| No key in logs (SEC-4) | `keyStore.test.ts`, `llmClient.test.ts` (redactor registration) | ✅ |
| Token estimation fallback | `llmClient.test.ts` (estimatedTokens) | ✅ |
| Host activates + `manageKeys` registered | integration 5/5 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 73/73 |
| `.vsix` packages + installs clean | `npm run package` (19.5 KB) + clean-profile install | ✅ |

## Phase 1 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Arbitrary/unknown thrown error -> valid ErrorReport w/ action (UX-1) | `errorService.test.ts` (Error, string, object, number, null, undefined) | ✅ |
| Typed ConclaveError preserved (code/category/retry/actions) | `errorService.test.ts` | ✅ |
| Fatal always carries "Report issue" | `errorService.test.ts` | ✅ |
| unhandledRejection / uncaughtException captured, no crash | `globalCapture.test.ts` | ✅ |
| Offline detected + queued action resumes (UX-4) | `connectivity.test.ts` | ✅ |
| Secret in a log/report is redacted, no key substring (SEC-4) | `redaction.test.ts`, `errorService.test.ts` | ✅ |
| Degraded-mode transition exposes consequence + restore action | `degraded.test.ts` | ✅ |
| Host still activates with full wiring | integration suite (5/5) in VS Code 1.124.2 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 28/28 |
| `.vsix` still packages | `npm run package` (11.6 KB) | ✅ |

## Phase 0 — acceptance gate (all met)

| Acceptance criterion | Proof | Result |
|----------------------|-------|--------|
| TS scaffold builds | `npm run build` -> `out/extension.js` 4.6kb | ✅ |
| Strict typecheck | `npm run typecheck` (tsc --noEmit) | ✅ clean |
| Unit tests pass | `npm run test:unit` (vitest) | ✅ 3/3 |
| Integration: activation | `npm run test:integration` in VS Code 1.124.2 host | ✅ |
| Integration: command registered | same suite | ✅ |
| Integration: command executes | same suite | ✅ 3/3 passing |
| Activity-bar icon + sidebar view | contributed in `package.json`, `media/icon.svg` | ✅ (visual via F5) |
| Command + keybinding | `conclave.openPanel`, `Ctrl/Cmd+Alt+C` | ✅ registered |
| ping -> pong two-way | `handleWebviewMessage` unit-tested; provider wires postMessage | ✅ |
| `.vsix` packages | `npm run package` -> `conclave-0.0.1.vsix` (9 files) | ✅ |
| `.vsix` installs into clean VS Code | `code --install-extension` to throwaway profile | ✅ |
| ARCHITECTURE.md + PROGRESS.md | this file + `ARCHITECTURE.md` | ✅ |

**Manual (user) verification left:** press `F5`, confirm the icon shows, the panel opens from icon
and palette, and the Ping button shows "pong received...". All non-visual behavior is covered by the
automated integration test above.

## Notes / debt carried forward

- **Phase 7 engine deviation:** localization ships pure-TS defaults
  (`HeuristicSymbolExtractor`, `HashingEmbedder`, hand-rolled cosine) behind the
  `SymbolExtractor`/`Embedder` interfaces instead of real LSP + web-tree-sitter +
  provider embeddings + ml-matrix (heavy native/WASM deps). Capability flagged
  **degraded**. Swap in real engines via the interfaces in a later hardening pass.
  See ARCHITECTURE.md "Phase 7". `[[storage-engine-wasm]]`-style deviation.

- `npm audit` reports 9 vulns (5 moderate / 3 high / 1 critical) — all in **dev** tooling
  (vsce/test-electron transitive deps), none shipped in the `.vsix`. Revisit during Phase 22
  hardening; do not `audit fix --force` now (breaking changes).
- No edge-case-catalog entries are in scope for Phase 0 (the catalog starts at Phase 1's error
  framework).
- `.vscode-test/` holds a 254 MB downloaded VS Code build (gitignored).

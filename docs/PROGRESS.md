# conclave — Progress

Resume a session with: read `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/edge-cases.md`,
`docs/skills-spec.md`, then continue the next phase.

## Status: Phase 6 COMPLETE

| Phase | Title | State |
|------:|-------|-------|
| 0 | Foundation & extension skeleton | ✅ complete |
| 1 | Error & Resilience Framework | ✅ complete |
| 2 | Provider abstraction + key storage | ✅ complete |
| 3 | Rate-limit-aware scheduler | ✅ complete |
| 4 | Capability & quota registry + cost meter | ✅ complete |
| 5 | Shadow-price engine + budget/spend control | ✅ complete |
| 6 | Onboarding wizard & first-run | ✅ complete |
| 7 | Code intelligence + localization | ⬜ next |
| 8 | Editing + git checkpoints + repo memory | ⬜ |
| 9 | Verification ladder + sandbox | ⬜ |
| 10 | Agent loop | ⬜ |
| 11 | Difficulty estimator + cascade router | ⬜ |
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

- `npm audit` reports 9 vulns (5 moderate / 3 high / 1 critical) — all in **dev** tooling
  (vsce/test-electron transitive deps), none shipped in the `.vsix`. Revisit during Phase 22
  hardening; do not `audit fix --force` now (breaking changes).
- No edge-case-catalog entries are in scope for Phase 0 (the catalog starts at Phase 1's error
  framework).
- `.vscode-test/` holds a 254 MB downloaded VS Code build (gitignored).

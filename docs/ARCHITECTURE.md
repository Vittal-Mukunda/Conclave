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

## Phase 4 — Capability/quota registry + telemetry + cost meter

Persistent learning + accounting layer in SQLite. Degrades (never crashes) if the engine can't open.

> **Storage engine deviation (deliberate, flagged):** the master prompt mandates `better-sqlite3`,
> but it cannot compile in this environment (no Node-24 prebuild + no MSVC build tools) and would
> ABI-mismatch the Electron host anyway. We use **`node-sqlite3-wasm`** (pure WASM, no native build,
> ABI-independent — verified loading in both Node 24 (vitest) and the VS Code/Electron host). It is
> abstracted behind the `SqlDb` interface so a native `better-sqlite3` adapter can be swapped in at
> ship time with zero changes to the repositories.

- **SqlDb** (`src/storage/SqlDb.ts`): engine-agnostic interface (`run/get/all/exec/userVersion/
  transaction`) + `WasmSqlDb` adapter + `openDatabase`.
- **migrations** (`src/storage/migrations.ts`): versioned, `user_version`-tracked, each in a
  transaction; never edit a shipped migration. Tables: `model`, `call`, `quota` (STATE-5).
- **Storage** (`src/storage/Storage.ts`): `open(dir)` / `memory()`, runs migrations; the caller
  catches open failures and marks `storage` unavailable (STATE-4 degrade).
- **CapabilityRegistry** (`src/capability/CapabilityRegistry.ts`): per-(provider,model) published/
  probed limits, rolling latency (EWMA) + throughput, success/error/429 counts, availability,
  prices; idempotent `seed`; `setProbe`; `recordOutcome`; and a persisted **quota meter** with lazy
  correct resets (survives reload).
- **TelemetryStore** (`src/telemetry/TelemetryStore.ts`): per-call insert; `totals` (spend vs
  saved), `rankings` (per-model usage, busiest first), `recent`.
- **CostCalculator** (`src/cost/CostCalculator.ts`): pure pricing — paid → real USD spend; free →
  "money saved" valued at a reference frontier price (COST-5: estimate, flagged).
- **ProbeService** (`src/capability/ProbeService.ts`): live capacity probing of keyed providers →
  updates availability + latency; PROV-7 (schema change) logged + model marked unavailable.
- **Wiring:** `ProviderService` now records a `CallRecord` after every chat/probe (best-effort) →
  telemetry insert + `recordOutcome`. `Services` opens storage at `globalStorageUri`, seeds models,
  wires the observer, runs a startup + hourly probe pass (keyed providers only).

Packaging: `node-sqlite3-wasm` is a runtime dep shipped in the `.vsix` (esbuild external;
`.vscodeignore` re-includes it). Catalog handled: PROV-7, COST-5, STATE-4/5.

## Phase 5 — Shadow-price engine + budget/spend control

The cost-allocation layer. Makes free (rate-limited, $0) and paid (unlimited, real $)
candidates comparable on one scale, and enforces the **spend-cap-never-exceeded** invariant.
All math is pure + deterministic; persistence reuses the `SqlDb` from Phase 4.

- **ShadowPriceEngine** (`src/cost/ShadowPriceEngine.ts`): a Lagrange price λ per scarce
  resource (provider/account/window quota, latency, global $). Projected subgradient ascent
  `λ ← max(0, λ + η·(consumption − budget))` — over-budget raises the price, slack decays it
  toward 0. A free tier's quota gets a price even though its dollar cost is 0.
- **PricedCost** (`src/cost/PricedCost.ts`): the scalar the router minimises =
  real $ (paid only, from `CostCalculator`) + Σ λ_j·consumption_j over the call's resources.
- **CostPolicy** (`src/cost/CostPolicy.ts`): COST MODE candidate gate — `free-only` (default,
  $0, paid never), `free-first` (paid as spillover under cap), `best-quality` (free+paid under
  cap). The hard cap blocks all paid in every mode (COST-3 is never overridden).
- **BudgetManager** (`src/cost/BudgetManager.ts`): persisted single-row `budget` (cap, running
  spend, mode, last-warned threshold). `record` folds real paid spend in and warns once per
  50/80/100% threshold (COST-2); `preflight` HARD-STOPs a task that would exceed the cap
  (COST-3) and flags an expensive single task for confirm (COST-4); `freeCeilingReport` offers
  add-key/add-paid/wait (COST-1). Each guard returns a typed `ConclaveError` with ≥1 action.
- **migrations** (`src/storage/migrations.ts`): v3 adds the `budget` table, seeded with safe
  defaults (uncapped, free-only); additive, preserves prior rows (STATE-5).
- **Wiring** (`src/core/Services.ts`): builds `shadow`/`pricedCost`/`budget`/`policy`
  (mode restored from persisted budget). The telemetry observer now also folds `rec.costUsd`
  into the budget and surfaces a COST-2 warning notification on a crossed threshold. New
  command `conclave.setBudget` (Services.manageBudget) sets cost mode + spend cap via dialogs.

Catalog handled: COST-1/2/3/4 (COST-5 was Phase 4), STATE-5. Invariant enforced: spend cap
never exceeded.

## Phase 6 — Onboarding wizard & first-run

Turns a cold install into a runnable one: detects what is missing, guides the user
through it, and refuses to pretend conclave is ready when it isn't. Pure logic is
vscode-free + unit-tested; the wizard dialogs + git/folder actions are the glue.

- **OnboardingService** (`src/onboarding/OnboardingService.ts`): pure
  `evaluateOnboarding(facts)` -> ordered steps + `ready` + a `blocker` ConclaveError
  for the first unmet REQUIRED step. Steps: keys (required, SETUP-1), folder
  (required, SETUP-11), git (optional, SETUP-12 — degrades to read-only-safe, never
  blocks). `shouldLaunchWizard` = firstRun || !ready.
- **OnboardingHost** (`src/onboarding/OnboardingHost.ts`): gathers facts (any stored
  key, open folder, `.git` present, `globalState['conclave.onboarded']`), runs the
  guided modal wizard, performs step actions (manage keys, open folder, `git init`
  via `child_process`), and persists completion. `notifyIfIncomplete` shows a
  NON-blocking nudge on activation — the modal wizard only opens on explicit user
  action, keeping activation headless-safe.
- **Webview banner**: `ConclaveViewProvider.postOnboarding` pushes a serialized
  status (steps + readiness only — no keys/reports); `media/main.js` renders a
  "Finish setup" banner with a Start-setup button (ARIA-labelled, UX-7) that posts
  `startOnboarding`. Banner hides once ready.
- **Wiring**: `Services` builds `onboarding`; `extension.ts` registers
  `conclave.startOnboarding` + `conclave.initGit` and fires the non-blocking nudge
  after activation.

Catalog handled: UX-5, SETUP-1, SETUP-11, SETUP-12.

## Phase 7 — Code intelligence + localization

The #2 strength lever: the dominant agent failure is editing the WRONG PLACE, so
this layer turns a natural-language task into precise FILE+LINE ranges with a
calibrated confidence. All ranking is pure + deterministic; the vscode host only
feeds it files.

> **Engine deviation (deliberate, flagged):** the master prompt mandates real LSP
> + web-tree-sitter + provider/embedding models + ml-matrix. Those are heavy
> (native/WASM) deps that risk the same build/ABI problems as better-sqlite3, so
> Phase 7 ships **deterministic pure-TS defaults behind interfaces**:
> `HeuristicSymbolExtractor` (regex + brace/indent ranges) implements
> `SymbolExtractor`; `HashingEmbedder` (feature-hashing) implements `Embedder`;
> cosine is hand-rolled (no ml-matrix). A real tree-sitter/LSP extractor and
> provider-backed embedder drop in via the same interfaces with no change to the
> fusion. The capability is honestly marked **degraded** (Lsp/TreeSitter) so the
> UI/router know precision is reduced.

- **types** (`src/codeintel/types.ts`): `SourceFile`/`Chunk`/`SymbolDef`/
  `LocationCandidate`/`LocalizationResult` + the `SymbolExtractor` / `Embedder`
  pluggable interfaces.
- **ignore** (`src/codeintel/ignore.ts`): gitignore matcher (globs, anchoring,
  negation) + built-in binary/generated/vendored-dir exclusion (LOC-3).
- **chunk** (`src/codeintel/chunk.ts`): overlapping line-range chunks for large
  files (LOC-5).
- **lexical** (`src/codeintel/lexical.ts`): camel/snake-aware tokenizer + inverted
  index + BM25 — the keyword arm (catches exact identifiers embeddings blur).
- **embeddings** (`src/codeintel/embeddings.ts`): `HashingEmbedder` + cosine +
  `VectorIndex` with hash-gated re-embedding (LOC-6) — the semantic arm.
- **symbols** (`src/codeintel/symbols.ts`): `HeuristicSymbolExtractor` for the
  common TS/JS/Python declaration forms with approximate ranges.
- **depgraph** (`src/codeintel/depgraph.ts`): import/require/from edges → undirected
  graph; BFS `distance` + `proximityBoost` (relevant code clusters together).
- **Localizer** (`src/codeintel/Localizer.ts`): pure `fuse()` — saturating-
  normalized lexical + cosine + symbol + proximity → ranked candidates, overlap
  dedupe, and the LOC-1 action: **use** (confident + unambiguous) / **widen**
  (moderate or ambiguous) / **ask** (weak). Saturating (not max-relative) lexical
  normalization prevents a single faint hit being inflated to false confidence.
- **CodeIndex** (`src/codeintel/CodeIndex.ts`): orchestrator — chunk + index all
  arms, build dependency seeds, assemble per-chunk signals, call `fuse`. Symbol-
  tightening narrows a candidate to the matched symbol's range. `update`/`remove`
  give incremental indexing (LOC-2).
- **CodeIntelService** (`src/codeintel/CodeIntelService.ts`): vscode glue — lazy
  workspace walk (`findFiles` + `.gitignore`, size/encoding guards LOC-4/5),
  builds the index on first query, marks Lsp/TreeSitter degraded. Command
  `conclave.localize`.

Catalog handled: LOC-1, LOC-2, LOC-3, LOC-4, LOC-5, LOC-6.

## Phase 8 — Editing + git checkpoints + repo memory

The write path. Localization (Phase 7) says *where*; this layer changes it
*safely*. The guiding rule is **never clobber, never leave the tree partial**:
all edit validation is pure + all-or-nothing, and every apply is fenced by a git
checkpoint so any failure rolls back cleanly.

- **types** (`src/editing/types.ts`): `Hunk` (line-anchored region) / `FileEdit`
  (whole-content or hunks + `baseHash`) / `EditPlan` / `FileState` / `EditResult`
  + the `GitOps` interface (the minimal git surface the checkpoint logic needs).
- **hash** (`src/editing/hash.ts`): FNV-1a + length tag — the drift fingerprint
  (EDIT-1), same hash idiom as the codeintel embedder.
- **patch** (`src/editing/patch.ts`): pure anchored hunk applier. Applies
  bottom-to-top so earlier edits don't shift later line numbers; verifies each
  hunk's `oldLines` sit at its anchor, **re-syncing** within a small window when
  the user inserted/removed lines above (EDIT-8); reports drift instead of
  forcing when context no longer matches (EDIT-1). Also `hasConflictMarkers`
  (EDIT-4) and EOL preservation.
- **AtomicEditor** (`src/editing/AtomicEditor.ts`): pure planner. Validates every
  edit — workspace boundary (EDIT-2), base-hash drift (EDIT-1), hunk apply
  (EDIT-1/8), pre-existing conflict markers (EDIT-4), missing target (EDIT-9) —
  and emits a complete write set **only if all pass** (EDIT-7); a single failure
  yields zero writes. Surfaces a `reconciled` list for dirty buffers (EDIT-6).
- **CheckpointManager** (`src/editing/CheckpointManager.ts`): pure orchestration
  over `GitOps`. `before()` commits the user's uncommitted work first when the
  tree is dirty (EDIT-3) so a rollback can never lose it; clean trees checkpoint
  at HEAD. `rollback()` hard-resets (EDIT-7). Every git op gets one retry, then a
  typed `EDIT-5` error the host maps to an ErrorReport.
- **RepoMemory** (`src/editing/RepoMemory.ts`): per-workspace key/value facts
  (test/build command) in the `repo_memory` table (migration v4), scoped by
  workspace id (STATE-6) so settings never leak across repos; survives reloads so
  conclave asks once (VER-6).
- **GitCli** (`src/editing/GitCli.ts`): `GitOps` via the real `git` CLI
  (`--no-verify` checkpoints, porcelain status). Thin IO; all policy is in the
  unit-tested CheckpointManager.
- **EditService** (`src/editing/EditService.ts`): vscode glue. Reads current file
  state preferring open (unsaved) buffers over disk (EDIT-6/8), enforces the
  boundary from `workspaceFolders` (EDIT-2), checkpoints before applying, writes
  via `workspace.fs`, and rolls back to the checkpoint if a write fails midway
  (EDIT-9 -> EDIT-7). Commands `conclave.checkpoint` + `conclave.rememberTestCommand`.

RepoMemory needs storage; absent it, editing and checkpoints still work (just no
remembered facts), mirroring the Phase 4 degrade-don't-crash posture.

Catalog handled: EDIT-1, EDIT-2, EDIT-3, EDIT-4, EDIT-5, EDIT-6, EDIT-7, EDIT-8,
EDIT-9, VER-6, STATE-6 (and STATE-5 via migration v4).

## Phase 9 — Verification ladder + sandbox

The honesty layer: after an edit, *how sure are we it's correct?* A ladder of
escalating checks runs weakest-to-strongest and produces a **calibrated**
confidence — never falsely high. The same rule as localization (LOC-1): weak
evidence caps the score and always raises a visible flag.

> **Engine deviation (deliberate, flagged):** the master plan wants a real
> container sandbox (Docker/Firecracker, cgroup memory limits, cached images).
> That's a heavy host dependency, so Phase 9 ships a **process sandbox** —
> subprocess + time limit + output cap — behind the `CommandRunner` interface. A
> real container runner drops in unchanged (VER-7 OOM via cgroups, VER-8 cached
> images). Capability **Sandbox** is honestly marked **degraded** so confidence
> stays conservative and the UI can say "no container — results may differ".

- **types** (`src/verify/types.ts`): `Rung` (kind + command + timeout +
  `detectFlake`), `RunResult`, `RungResult`, `Verdict`, and the `CommandRunner`
  interface (host = sandbox, tests = fake).
- **detect** (`src/verify/detect.ts`): pure rung builder from `package.json`
  scripts + the remembered test command (VER-6). No test command -> no test rung,
  which the model turns into VER-5 rather than a false pass.
- **ConfidenceModel** (`src/verify/ConfidenceModel.ts`): pure scoring. Weighted
  pass fraction, then ceilings/penalties: VER-5 no tests (cap 0.4), VER-10 no
  coverage (cap 0.85), VER-2/4 timeout (cap 0.5), VER-1 flaky (×0.7), VER-3
  service-skipped (×0.8), VER-9 env diff (×0.6), failure (cap 0.2). Every cap
  emits a plain-language flag.
- **VerificationLadder** (`src/verify/VerificationLadder.ts`): pure orchestration
  over `CommandRunner`. Runs rungs in order, short-circuits on a hard
  fail/timeout (later rungs skipped — their result would be meaningless),
  re-runs flake-detecting tests and marks divergence `flaky` (VER-1), and
  optionally re-runs a passing test rung on a host runner to detect an
  environment difference (VER-9). Assembles the Verdict via the model.
- **ProcessSandbox** (`src/verify/Sandbox.ts`): the shipped `CommandRunner` —
  `child_process.exec` with a time limit (kill -> `timedOut`, VER-2/4) and an
  output cap (overflow -> failure, never a crash). stdin detached so an
  input-reading command can't hang the run.
- **VerifyService** (`src/verify/VerifyService.ts`): vscode glue. Reads
  `package.json` scripts + RepoMemory (VER-6), builds the ladder, runs it on the
  sandbox in the workspace root, marks Sandbox degraded, and surfaces the verdict
  (confidence % + per-rung status + first caveat). Command `conclave.verify`.

Catalog handled: VER-1, VER-2, VER-3, VER-4, VER-5, VER-6 (consumes Phase 8 repo
memory), VER-9, VER-10. VER-7/VER-8 are deferred to a real container runner.

## Phase 10 — Agent loop

The conductor. It ties the previous three layers into one bounded, safe cycle:
**plan -> checkpoint -> act -> verify -> decide**. Its job is not cleverness but
*safety* — it can never run away, never commit a regression, and always ends in
an honest terminal state.

> **Engine deviation (deliberate, flagged):** LLM-driven code generation (drafting
> the actual edits) lands in later phases (council + best-of-N). Phase 10 ships
> the full control FSM with all safety rails wired to real services; the default
> host planner localizes the target (Phase 7) and **hands off cleanly** with an
> honest reason instead of fabricating edits. The codegen "brain" drops into the
> `Planner`/`Actor` seam later with no change to the loop.

- **types** (`src/agent/types.ts`): `AgentTask`, `PlanDecision`
  (plan/ambiguous/impossible/handoff), `VerifyOutcome`, `IterationRecord`,
  `LoopResult` (status + reason), `LoopConfig`, and the injected step interfaces
  `Planner` / `Actor` / `Verifier` / `Checkpointer` / `BudgetGate`.
- **AgentLoop** (`src/agent/AgentLoop.ts`): pure FSM. Each iteration: budget gate
  (LOOP-7 stop-before-spend), plan (ambiguous -> LOOP-5 one question;
  impossible -> LOOP-4 scoped suggestion), oscillation check on plan signature
  (LOOP-1), checkpoint, act, verify. A passing verdict over the accept threshold
  is success; a verdict that *regresses* below the best-so-far is rolled back to
  the checkpoint (LOOP-2); no improvement for `noProgressLimit` iterations hands
  off (LOOP-3). Exhausting the cap with progress reports `partial` honestly
  (LOOP-6). A failed/hallucinated edit is verified as failure, never committed
  (LOOP-9).
- **AgentService** (`src/agent/AgentService.ts`): vscode glue. Wires the steps to
  real services — planner=CodeIntel localize, checkpointer=EditService
  (checkpoint + rollback), verifier=VerifyService, budget gate=BudgetManager —
  and surfaces the terminal `LoopResult`. Command `conclave.runAgent`.

The two invariants are structural: (1) the loop is hard-capped by
`maxIterations` so it physically cannot spin forever, and (2) acceptance is
gated on a verified confidence threshold while regressions auto-rollback, so a
run can only ever leave the tree better or unchanged — never worse.

Catalog handled: LOOP-1, LOOP-2, LOOP-3, LOOP-4, LOOP-5, LOOP-6, LOOP-7, LOOP-9
(LOOP-8 context compaction is a Phase 19 concern).

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

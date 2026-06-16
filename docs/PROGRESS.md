# conclave — Progress

Resume a session with: read `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/edge-cases.md`,
`docs/skills-spec.md`, then continue the next phase.

## Status: Phase 19 COMPLETE

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
| 11 | Difficulty estimator + cascade router | ✅ complete |
| 12 | Competence learner (bandit) | ✅ complete |
| 13 | Assignment solver + diverse council | ✅ complete |
| 14 | Best-of-N + strong verifier-selector | ✅ complete |
| 15 | Security & privacy hardening | ✅ complete |
| 16 | Skills I: format/ingest/retrieval | ✅ complete |
| 17 | Skills II: composition/injection | ✅ complete |
| 18 | Skills III: security sandbox/marketplace | ✅ complete |
| 19 | State, crash recovery & concurrency | ✅ complete |
| 20 | UI / UX panel | ⬜ next |
| 21 | Multi-account quota pooling | ⬜ |
| 22 | Hardening, edge-case matrix, eval, release | ⬜ |

## Phase 19 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| STATE-3: two runs → second is prevented/queued, never races | `runState.test.ts` (queue behind active; idempotent same id; per-workspace independent; promote on end) | ✅ |
| STATE-3 wired: a second `runAgent` on a busy workspace is refused with a clear message | `AgentService.runAgentCommand` (coordinator.begin → queued → warn + return) | ✅ |
| STATE-1/2: a run is persisted (goal, status, iteration, checkpoint, heartbeat) and survives a reload | `runStateStore.test.ts` (begin/get/running; reopened-db orphan recoverable) | ✅ |
| STATE-1: heartbeat records the resume point (iteration + last checkpoint) each iteration | `runStateStore.test.ts` (heartbeat bumps iter/checkpoint); `AgentService.checkpointer` onCheckpoint → `runStore.heartbeat` | ✅ |
| STATE-2: a crashed run (frozen heartbeat on a 'running' row) is detected; live runs excluded | `runState.test.ts` (`findCrashedRuns`: stale flagged, live/terminal excluded, newest-first) | ✅ |
| STATE-2: recoverable iff a checkpoint exists; resume re-drives the goal, discard rolls back to the checkpoint | `runState.test.ts` (recoverable flag); `AgentService.recoverRunsCommand`/`runResumed` (resume re-runs; discard → editing.rollback + finish 'aborted') | ✅ |
| STATE-2: activation surfaces an orphaned run (non-blocking, headless-safe) | `AgentService.notifyIfRunOrphaned`; `extension.ts` background nudge | ✅ |
| STATE-4: a corrupt/unknown-status run row is skipped, never fatal | `runStateStore.test.ts` (bogus-status row skipped) | ✅ |
| STATE-5: migration v7 (`agent_run`) preserves prior rows | `storage.test.ts` (dynamic latestVersion=7); `banditStore`/`skillStore`/`repoMemory` (v7) | ✅ |
| STATE-6: runs + coordinator scoped per workspace | `runState.test.ts` (distinct workspaces); `runStateStore.test.ts` (per-workspace running) | ✅ |
| Wired: Services builds RunStateStore; AgentService owns the RunCoordinator | `Services` (runStore → AgentService); `AgentService` (`coordinator`) | ✅ |
| Host activates + recoverRun command registered | integration 19/19 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 434/434 |
| `.vsix` packages | `npm run package` (611 KB, 15 files) | ✅ |

**Notes:** full mid-iteration resume (re-entering the loop at the exact failed
step) needs the codegen brain that lands later — same flagged deferred-brain
pattern as the loop/council/best-of-N engines. The seam is complete: the run
record + checkpoint ref + coordinator + crash classification are all persisted
and tested; "Resume" re-drives the same goal from the last checkpoint and
"Discard" rolls the tree back to it. The coordinator is in-process (one
extension host owns one) — the authoritative concurrency gate within a session;
the persisted heartbeat is what catches a cross-session crash (STATE-2).

## Phase 18 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Static scan flags secret/file access, dynamic/shell exec, outbound network | `skillsScan.test.ts` (secret-file-access/dangerous-exec high; outbound-network medium) | ✅ |
| SKILL-2: prompt-injection in instructions → high-risk → blocks ingest | `skillsScan.test.ts` (prompt-injection high); `skillsTrust.test.ts` (high → quarantine) | ✅ |
| SKILL-3: .py/.pyc source-bytecode mismatch detected; scanner pluggable but not trusted alone | `skillsScan.test.ts` (mismatch + bytecode-present; plugin merged; throwing plugin safe) | ✅ |
| Trust tiers: first-party trusted; community instructions-only by default | `skillsTrust.test.ts` (project scripts-on; community license-only scripts-off) | ✅ |
| Vetted only via permissive license + scan-clean + popularity floor (or operator vet) | `skillsTrust.test.ts` (Apache+popular→vetted; operatorVetted→vetted) | ✅ |
| SKILL-9: popularity NEVER grants trust | `skillsTrust.test.ts` (popular+unlicensed stays community, scripts off, reason) | ✅ |
| allowed-tools enforced as a HARD CEILING (deny-by-default; scoped globs) | `skillsSandbox.test.ts` (toolAllowed; outside-ceiling denied) | ✅ |
| SKILL-7: HITL confirm before first script exec + any network/deploy/commit | `skillsSandbox.test.ts` (first-exec confirm; deploy/commit confirm) | ✅ |
| SKILL-7: provider-API egress always denied (anti-exfiltration); instructions-only never executes | `skillsSandbox.test.ts` (provider host denied; allowlisted host confirm; instructions-only refused) | ✅ |
| Marketplace discovery over injected transport; listings are priors only | `skillsMarketplace.test.ts` (parse skills/array; category/sortBy/Bearer) | ✅ |
| SKILL-6: marketplace unreachable/non-OK/malformed → typed retryable error | `skillsMarketplace.test.ts` (503 / transport fail / bad JSON → SKILL-6) | ✅ |
| Wired: secureIngest = ingest→scan→trust quarantines high-risk; canRun gate; search | `SkillsService` (secureIngest/canRun/searchMarketplace); `Services` (MarketplaceClient) | ✅ |
| Host activates + scanSkills/searchSkills commands registered | integration 18/18 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 414/414 |
| `.vsix` packages | `npm run package` (608 KB, 15 files) | ✅ |

**Notes:** the hardened-container runner is deferred (same flagged deviation as
Phase 9's process sandbox) — the `SandboxPolicy` + `SkillExecutionGate` are the
enforcement seam, and scripts are HITL-gated + default-off for untrusted skills
regardless. The marketplace folder DOWNLOAD/install is the deferred heavy piece;
search + the ingest→scan→trust pipeline it feeds are complete. The Skills
subsystem (Phases 16–18) is now complete.

## Phase 17 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Injection points: each sub-agent role receives only its categories; localizer/reviewer READ-ONLY | `skillsCompose.test.ts` (eligibleForRole; rolePolicy readOnly) | ✅ |
| Skill categorisation: metadata.category wins, else keyword heuristic, else general | `skillsCompose.test.ts` (declared / heuristic / general) | ✅ |
| Precedence: user/session > project > vetted > community | `skillsCompose.test.ts` (byPrecedence order; community can't outrank) | ✅ |
| Within a tier: glob/role-specific > general; newer version breaks ties | `skillsCompose.test.ts` (specific>general; compareVersion; version tiebreak) | ✅ |
| Compose: layered, delimited, source-tagged blocks in precedence order | `skillsCompose.test.ts` (project block first; `<skill name=… trust=…>`) | ✅ |
| Role filtering: ineligible skills excluded | `skillsCompose.test.ts` (editor↔reviewer split) | ✅ |
| SKILL-4: execution-directive conflict → highest-precedence value wins + surfaced to planner; never silently merged | `skillsCompose.test.ts` (test_command: project beats community; SkillConflict winner/losers) | ✅ |
| Agreeing directives raise no conflict | `skillsCompose.test.ts` (same test_command → 0 conflicts) | ✅ |
| metadata.requires dependencies resolved from the installed index; missing → graceful note | `skillsCompose.test.ts` (dependencies; missingDependencies) | ✅ |
| Forged closing delimiter in a body defanged (no breakout) | `skillsCompose.test.ts` (`</skill>` → `<\/skill>`) | ✅ |
| Wired: SkillsService.composeForAgent + per-role preview command | `SkillsService` (composer); command `conclave.composeSkills` | ✅ |
| Host activates + composeSkills command registered | integration 17/17 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 386/386 |
| `.vsix` packages | `npm run package` (604 KB, 15 files) | ✅ |

**Notes:** composition output (`ComposedContext`) is the seam the agent's
sub-agents inject at once codegen lands — same deferred-brain pattern as the
loop/council/best-of-N engines. The script sandbox, the `allowed-tools` hard
ceiling, the static + supply-chain scan, and the real marketplace/git fetch
(SKILL-2/3/7/9) are Phase 18.

## Phase 16 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| SKILL.md format: frontmatter starts line 1; name/description required; name regex + ≤64; metadata map; allowed-tools list; unknown fields preserved | `skillsParse.test.ts` (valid parse; block scalars + nested map; field normalisation) | ✅ |
| SKILL-1: missing/unclosed frontmatter, missing/invalid name, name≠dir, missing/over-long description → FAIL LOUDLY (typed SKILL-1 + detail) | `skillsParse.test.ts` (6 failure cases); `skillsIngest.test.ts` (name≠dir / no SKILL.md quarantined) | ✅ |
| Ingest: content-addressed folder hash (order-independent, content-sensitive) | `skillsIngest.test.ts` (folderHash); `skillStore.test.ts` (hash changes on body bump) | ✅ |
| SKILL-8: missing referenced file → graceful note, not failure | `skillsIngest.test.ts` (missingReferences + SKILL-8 warning) | ✅ |
| Community tier defaults scripts DISABLED; first-party may run | `skillsIngest.test.ts` (scriptsEnabled by trust) | ✅ |
| Retrieval: description-primary hybrid scorer (embed + BM25 + glob + trust prior) ranks the match first | `skillsRetrieve.test.ts` (PDF task → pdf-tools; SQL task → sql-helper) | ✅ |
| Activation threshold drops non-matches; trust prior can't cross it alone | `skillsRetrieve.test.ts` (pdf below-threshold for SQL task) | ✅ |
| File-glob match boosts a skill for changed files | `skillsRetrieve.test.ts` (changedGlobs → ts-style first; glob signal = 1) | ✅ |
| SKILL-5: ≤3 active + combined token budget; overflow dropped + reported | `skillsRetrieve.test.ts` (over-cap; over-budget) | ✅ |
| Trust precedence breaks ties (user/project > community) | `skillsRetrieve.test.ts` (dup → user wins) | ✅ |
| Content-addressed store persists + reloads; lock() for reproducibility (STATE-4 corrupt-row skip) | `skillStore.test.ts` (save/reload/upsert/persist/lock/remove) | ✅ |
| Migration v6 (skill table) preserves prior rows (STATE-5) | `skillStore.test.ts` (latestVersion=6); `storage.test.ts` (dynamic) | ✅ |
| SKILL-6: marketplace/remote unreachable → degrade to local + retry | `SkillsService.refresh` (RemoteSkillSource try/catch → Capability.Skills degraded + SKILL-6 ErrorReport) | ✅ |
| Wired: Services builds SkillsService + SkillStore; activation scans in background | `Services` (skills/skillStore); `extension.ts` (refresh on activate) | ✅ |
| Host activates + refreshSkills/findSkills commands registered | integration 16/16 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 372/372 |
| `.vsix` packages | `npm run package` (601 KB, 15 files) | ✅ |

**Notes:** Composition + conflict precedence (SKILL-4) and the per-sub-agent
injection points are Phase 17; the static + supply-chain scan, the script
sandbox, `allowed-tools` hard-ceiling enforcement, and the real
marketplace/git fetch (SKILL-2/3/7/9) are Phase 18. The frontmatter parser is a
deliberate pure-TS subset rather than a full YAML engine (flagged in
ARCHITECTURE.md "Phase 16"; `[[storage-engine-wasm]]`-style deviation).

## Phase 15 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| SEC-1: secrets in outbound content detected + REDACTED before send | `secretScanner.test.ts` (openai/anthropic/google/github/groq/aws/slack/PEM/JWT/assignment) | ✅ |
| SEC-1: redact only the value of `secret = "..."`, keep key name | `secretScanner.test.ts` (password assignment) | ✅ |
| SEC-4 reinforce: clean code untouched; `containsNoSecret` assertion | `secretScanner.test.ts` (no false positives) | ✅ |
| SEC-2: free tiers classified as training, paid APIs no-train | `privacy.test.ts` (dataPosture) | ✅ |
| SEC-2: Sensitive-repo mode blocks training providers, keeps no-train | `privacy.test.ts` (allowsProvider); wired into `RouterService.keyedPool` | ✅ |
| SEC-3: prompt-injection patterns flagged as high risk | `injection.test.ts` (ignore-previous / role-tag / system-prompt / exfiltrate) | ✅ |
| SEC-3: untrusted content fenced as DATA; forged delimiter neutralised | `injection.test.ts` (wrap + breakout defang); `sanitizeUntrusted` requires confirm | ✅ |
| SEC-5: hardened sandbox policy (no net, no host FS, caps dropped, RO root) | `sandboxPolicy.test.ts` (`DEFAULT_SANDBOX_POLICY`, `isHardened`) | ✅ |
| SEC-5/SKILL-7: egress allowlist ALWAYS excludes provider API hosts | `sandboxPolicy.test.ts` (provider host denied even if allowlisted) | ✅ |
| Wired: SecurityService owns Sensitive flag + privacy gate consulted by router | `Services` (security→router privacy); `SecurityService` | ✅ |
| Host activates + toggleSensitiveRepo command registered | integration 15/15 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 344/344 |
| `.vsix` packages | `npm run package` (595 KB, 15 files) | ✅ |

**Notes:** SecretScanner complements (does not replace) the Phase 1
`SecretRedactor` — the redactor strips *known live* keys + shapes from logs
(SEC-4); the scanner does a broader content scan (PEM/JWT/cloud keys/secret
assignments) on *outbound prompt material* (SEC-1). The hardened `SandboxPolicy`
is declarative and enforced once a real container sandbox lands (Phase 9 ships a
process sandbox, flagged degraded); `permitsEgress`/`isHardened` are the
enforcement seam. Untrusted-content fencing (SEC-3) and outbound redaction
(SEC-1) are callable now and plug into the prompt-assembly path with codegen.

## Phase 14 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| CodeT dual-execution consensus: \|passing_sols\|·\|passing_tests\|² | `codeT.test.ts` (cluster·tests²; quadratic in tests) | ✅ |
| Consensus clusters by exact pass signature (agreement, not count) | `codeT.test.ts` (same-count different-signature → separate clusters) | ✅ |
| Strong selector fuses consensus + type + critic + coverage | `selector.test.ts` (consensus winner; signals break ties) | ✅ |
| Best@K-plateau diagnostic: oracle passes but winner fails → selector miss | `selector.test.ts` (selectorMiss flagged; clear when winner passes) | ✅ |
| Weitzman/Pandora: open in reservation order, stop when best beats remaining | `pandora.test.ts` (order; early stop; keep-going; `pandoraStop`) | ✅ |
| Endogenous N with a K ceiling | `pandora.test.ts`/`bestOfN.test.ts` (maxOpens / maxSamples cap) | ✅ |
| CODING stop = first candidate passing the ladder | `bestOfN.test.ts` (ladderPass halts at first draw; `stopWhen`) | ✅ |
| Lazy sampling — unopened sources never drawn | `bestOfN.test.ts` (draw log shows only opened) | ✅ |
| Selector picks consensus winner across all drawn candidates | `bestOfN.test.ts` (cluster wins) | ✅ |
| Two-phase latency budget (deadline stop) | `BestOfN` `deadlineMs`/`now` (Pandora-over-time seam) | ✅ |
| Wired: BestOfNService + engine; selector pipeline reported | `Services` (bestOfN); command `conclave.bestOfN` | ✅ |
| Host activates + bestOfN command registered | integration 14/14 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 322/322 |
| `.vsix` packages | `npm run package` (593 KB, 15 files) | ✅ |

**Engine deviation (flagged):** the candidate SAMPLER is an LLM author, which
lands with codegen (Phase 13/14 of the OR design assume it). The full
sampling/stopping/selection pipeline ships and is unit-tested over injected
solutions; `BestOfNService.run` is callable now and the agent plugs the sampler
into it once authoring exists — same deviation pattern as the agent/council
engines.

## Phase 13 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Greedy assignment maximises LCB competence | `assignmentSolver.test.ts` (convergent picks highest LCB) | ✅ |
| Single-author enforced for convergent stages | `assignmentSolver.test.ts` (implement/mechanical → exactly one author) | ✅ |
| Capacity constraint — a booked model is unavailable to the next stage | `assignmentSolver.test.ts` (cap=1 → 2nd stage takes next best) | ✅ |
| Quality floor — no author below it | `assignmentSolver.test.ts` (floor 0.5 → no eligible author) | ✅ |
| Stage kind routed by role (convergent vs divergent) | `assignmentSolver.test.ts` (plan/review=divergent, implement/mechanical=convergent) | ✅ |
| Council only at divergent stages; ≥2 base FAMILIES (distinct lineages) | `councilBuilder.test.ts` (one model per family); `councilFamily.test.ts` | ✅ |
| Prompt-strategy + temperature diversity across members | `councilBuilder.test.ts` (direct/CoT/test-first; temps 0.2/0.6/1.0) | ✅ |
| DIVERSITY-PRUNING drops a member that won't raise Pass@K | `councilBuilder.test.ts` (non-competitive 2nd-of-family pruned; competitive kept) | ✅ |
| NEVER a homogeneous council — single-family falls back to one author | `councilBuilder.test.ts` (1 family → homogeneous + fallback) | ✅ |
| Synthesize with one strong model | `councilBuilder.test.ts` (synthesizer = top LCB) | ✅ |
| Cross-provider same-lineage counts as one family (no echo chamber) | `councilFamily.test.ts` (two Llama providers → same family) | ✅ |
| LinUCB exposes LCB (assign) vs UCB (explore) | `linucb.test.ts` (lcb=mean−width); `CompetenceLearner.evaluate` | ✅ |
| Wired: router pool → learner LCB → solver; per-stage assignment | `CouncilService.assignForGoal` (plan/implement/review) | ✅ |
| Host activates + planCouncil command registered | integration 13/13 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 301/301 |
| `.vsix` packages | `npm run package` (591 KB, 15 files) | ✅ |

**Note:** the optional exact-ILP comparison from OR design §6 is intentionally
not shipped — greedy is near-optimal for this capacity-constrained, single-author
structure and the ILP adds no quality at this scale. The `AssignmentSolver` seam
allows slotting an exact solver later.

## Phase 12 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| LinUCB per arm: theta=A⁻¹b, UCB=mean+alpha·sqrt(xᵀA⁻¹x) | `linucb.test.ts` (unseen=optimism; reward raises mean, shrinks width) | ✅ |
| Context = task-type / difficulty / stage (repo via workspace scope) | `features.ts` (11-dim encode); `competenceLearner.test.ts` | ✅ |
| Select argmax(UCB − costWeight·pricedCost), budget-coupled | `competenceLearner.test.ts` (ties break on cost; cheaper wins) | ✅ |
| Warm-start from benchmark priors | `linucb.test.ts` (prior→mean); `competenceLearner.test.ts` (strong prior picked) | ✅ |
| Update from binary ladder pass/fail | `competenceLearner.test.ts` (pass beats fail) | ✅ |
| Strong update from human ACCEPT/REJECT + lesson to repo memory | `competenceLearner.test.ts` (ACCEPT raises + lesson; REJECT lowers) | ✅ |
| Sliding window for drift (forgetting factor) | `linucb.test.ts` (`forget` decays toward prior) | ✅ |
| Consumption (rho) regressor feeds pricedCost | `competenceLearner.test.ts` (observe/expected EWMA) | ✅ |
| Hand-rolled linear algebra is correct (no ml-matrix dep) | `linalg.test.ts` (solve/quadForm/outer; inputs unmutated) | ✅ |
| Arm state persists per workspace; corrupt row skipped (STATE-6/STATE-4) | `banditStore.test.ts` (save/load/upsert/scope/corrupt-skip) | ✅ |
| Migration v5 (bandit table) preserves prior rows (STATE-5) | `banditStore.test.ts` (latestVersion=5); `storage.test.ts` (dynamic) | ✅ |
| Wired: learner picks among routed candidates; warm-start from registry priors | `AgentService.planner` (router→competence.select); `Services` wiring | ✅ |
| Host activates + recordFeedback command registered | integration 12/12 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 287/287 |
| `.vsix` packages | `npm run package` (589 KB, 15 files) | ✅ |

**Deviation flagged:** linear algebra is hand-rolled (`src/learn/linalg.ts`,
small Gaussian solve) rather than the mandated `ml-matrix` — the context
dimension is tiny (11) so a dependency is unwarranted; the helpers are the
swap seam if a real library is wanted later. Same pattern as the Phase 7
embeddings deviation. `[[storage-engine-wasm]]`-style note.

## Phase 11 — acceptance gate (all met)

| Acceptance criterion / catalog | Proof | Result |
|--------------------------------|-------|--------|
| Tiny heuristic -> difficulty d + task type; cached | `difficultyEstimator.test.ts` (mechanical→L0, design→L3; identity-cached) | ✅ |
| Difficulty drift logged when realised tier ≠ predicted | `difficultyEstimator.test.ts` (observe→`difficulty_drift`; match→no log) | ✅ |
| Signals (breadth / scope / weak localization) raise difficulty | `difficultyEstimator.test.ts` (narrow<broad; placed<unplaced) | ✅ |
| Cascade L0..L3 per role; IMPLEMENT floors at a strong coder (L2), L3 at high d | `cascade.test.ts` (implement≥L2; mechanical=L0; plan/review=bucket) | ✅ |
| Only mechanical edits use the cheap tier | `cascade.test.ts` (mechanical startTier=L0 regardless of d) | ✅ |
| Escalate ONLY on ladder-fail / confidence<τ / regression (verifier-triggered) | `cascade.test.ts` (`shouldEscalate`); no speculative climb on clean pass | ✅ |
| Router orders cheapest tier at/above floor, then role fit, then pricedCost | `cascadeRouter.test.ts` (implement picks L2 free over paid mini) | ✅ |
| COST MODE + hard cap gate candidates (free-only drops paid; cap blocks paid) | `cascadeRouter.test.ts` (free-only / best-quality+capReached) | ✅ |
| Authoring roles require `code`; below-floor pick flagged (confidence lowered) | `cascadeRouter.test.ts` (reasoner-x excluded from implement; below-floor flag) | ✅ |
| Verifier-triggered escalation climbs a tier; caps at L3 with handoff flag | `cascadeRouter.test.ts` (escalate L2→L3; L3→top-tier flag) | ✅ |
| Wired to real services (registry pool / pricedCost / policy / budget cap) | `RouterService` (keyed pool, pricedCost scalar, live CostPolicy + cap) | ✅ |
| Agent handoff names the routed implement tier | `AgentService.planner` routes 'implement' with localize signals | ✅ |
| Host activates + estimateDifficulty command registered | integration 11/11 | ✅ |
| Unit suite | `npm run test:unit` | ✅ 259/259 |
| `.vsix` packages | `npm run package` (585 KB, 15 files) | ✅ |

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

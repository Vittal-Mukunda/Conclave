# conclave — Operations-Research Design (the "OR brain")

> **STATUS: STUB.** Derived from the Master Prompt's inlined design so phases have a source-of-truth
> reference. Replace with the full OR design when available.

The brain is deterministic code + a tiny difficulty model. Strong/paid models are scarce resources
to be SPENT, never the conductor. Everything below is TypeScript (no Python/LiteLLM).

## 1. Hard feasibility — rate limits (Phase 3)
- Token-bucket per (provider, account) for RPM + TPM, plus daily RPD/TPD.
- A call must acquire from ALL relevant buckets before issuing. LLMClient is callable ONLY through
  the scheduler. Result: exceeding a live limit is physically un-issuable.
- Async priority queue; round-robin / weighted across equivalent accounts (pooling). Jittered
  backoff honoring Retry-After. Per-account circuit breaker (K fails -> open -> half-open probe).
- Injected clock for deterministic tests.

## 2. Capability & quota registry (Phase 4)
- SQLite keyed by (provider, model): published + probed limits, rolling latency/throughput,
  benchmark priors, success/429 rates, remaining quota per window with correct resets.
- Live capacity probing on startup + periodically. Cost-equivalent meter: free => "money saved";
  paid => REAL running spend. Per-model usage ranking.

## 3. Shadow prices + budget/spend (Phase 5)
- Shadow price lambda_j per resource (provider/account/window + global latency + global $).
  Update: lambda_j <- max(0, lambda_j + eta * (consumption_j - budget_j)).
- pricedCost(provider, model, stage): $ component uses REAL price for paid models.
- COST MODE policy gates which candidates the router may use and how paid maps to the top tier.
- Spend guards (paid present): user cap; warn 50/80/100%; pre-flight estimate + confirm for
  expensive tasks; HARD STOP at cap.

## 4. Difficulty estimator + cascade (Phase 11)
- Tiny model / heuristic -> difficulty d + task type; cached; drift logged.
- Cascade L0..L3 per role. IMPLEMENT always uses a strong CODING model even at low d; only mechanical
  edits use the cheap tier.
- Escalate ONLY when the ladder fails OR verifier confidence < tau OR regression tests fail OR d is
  high. Reservation-index thresholds. Paid frontier = top tier in paid modes.
- Cost target: 45-85%+ cheaper vs always-top at maintained resolve rate.

## 5. Competence learner — contextual bandit (Phase 12)
- LinUCB per eligible model. Context = task-type / difficulty / repo / stage.
  Select argmax(UCB - pricedCost) within candidates, budget-coupled. Thompson sampling optional.
- Warm-start from benchmark priors. Update from binary ladder pass/fail AND strongly from human
  ACCEPT/REJECT (write lessons to repo memory). Sliding window for drift. Consumption (rho)
  regressor feeds pricedCost.

## 6. Assignment solver + heterogeneous council (Phase 13)
- Greedy near-optimal assignment maximizing LCB competence s.t. capacity + quality floor +
  single-author for convergent stages. Optional small exact ILP to compare.
- COUNCIL only at DIVERGENT stages (plan-when-ambiguous, review): >=2 base FAMILIES (different
  lineages) + prompt-strategy + temperature diversity + DIVERSITY-PRUNING. Synthesize with one
  strong model; judge via verifier where possible. NEVER homogeneous consensus vote. Drop any
  member that does not raise oracle Pass@K.

## 7. Best-of-N + strong verifier-selector (Phase 14) — the #1 quality lever
- Sampling / stopping via Weitzman/Pandora: fair-cap tau, open in tau order, stop when best exceeds
  remaining caps. N endogenous; target K~8.
- STRONG SELECTOR: run regression + reproduction tests on each candidate; rank by CodeT-style
  DUAL-EXECUTION CONSENSUS score |passing_solutions| * |passing_tests|^2, combined with LSP/type
  signal + diverse-critic vote + changed-line coverage.
- CODING stop = first candidate passing the ladder. Pandora-over-time two-phase under a latency
  budget. If Best@K plateaus near oracle Pass@K, invest in the verifier, not larger K.

## 8. Verification ladder (Phase 9) — the judge
Fail fast/cheap: (1) lint -> (2) LSP type-check -> (3) targeted tests for changed code -> (4) full
suite in ephemeral Docker (only if cheaper steps pass). Trust calibration: measure CHANGED-LINE
coverage; uncovered changes LOWER confidence + LOUD flag. Flaky detection: run twice.

## Tooling
ml-matrix for linear algebra (LinUCB, embeddings ops). better-sqlite3 for all persistence. Injected
clock + seeded RNG so every OR component is deterministically testable.

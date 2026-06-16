# conclave — Build Plan

> **STATUS: STUB.** Derived from the Master Prompt's inlined design so phases have a source-of-truth
> reference. Replace with the full build-plan when available. Until then, the Master Prompt is
> authoritative and this file restates it.

## What conclave is
A multi-model AI coding agent shipped as a VS Code extension. Orchestrates FREE-tier LLM APIs
(Groq, Google AI Studio/Gemini, OpenRouter, Cerebras, NVIDIA NIM, SambaNova, Mistral, GitHub
Models, Z.AI, DeepSeek, Cohere, ...) AND, when supplied, PAID APIs (OpenAI, Anthropic, Google paid)
into one coding agent that plans, edits code, runs tests in a sandbox, and iterates. Supports
downloadable SKILLS (Anthropic Agent Skills / SKILL.md standard).

## Core idea
- HARNESS quality (code understanding + diff editing + execute-test-repair loop) + FEEDBACK quality
  matter ~2x more than model choice. Do not chase strength via model-orchestration cleverness.
- Use multiple models SURGICALLY: heterogeneous council only at DIVERGENT steps (planning, review);
  ONE strong model authors code at the CONVERGENT step (implement).
- The execution sandbox + verification ladder is the JUDGE. Never trust "done" over the verifier.
- Free tiers: binding constraint is RATE LIMITS, not money — pool quota across providers. Paid keys:
  remove that ceiling, unlock frontier quality — but guard spend.

## The hierarchy
- ORCHESTRATION = deterministic code (router, scheduler, OR brain) + a tiny fast model that only
  estimates difficulty. Never a strong/paid model as conductor.
- Two independent axes: DIFFICULTY (cheap/fast do mundane; strong do hard; climb only when needed)
  and ROLE (best model per stage is LEARNED, not "big = better"; coders out-edit generalists,
  reasoners out-plan coders).
- IMPLEMENT is convergent authorship -> strong CODING model, single author. Only mechanical edits
  (rename/reformat) use the cheap tier.
- Escalation is VERIFIER-TRIGGERED: a misjudged-easy task fails its cheap attempt and AUTO-CLIMBS.

## Where strength comes from (invest in this order)
1. Best-of-N + a strong VERIFIER/SELECTOR (test-time scaling; ~+13..+17 pts). Target K~8. CodeT
   dual-execution consensus: |passing_solutions| * |passing_tests|^2. If Best@K plateaus near oracle
   Pass@K, invest in the VERIFIER, not larger K.
2. LOCALIZATION / retrieval precision — dominant failure mode is editing the WRONG PLACE. Fuse LSP +
   tree-sitter repo map + embeddings + dependency graph; return precise FILE+LINE ranges.
3. EXECUTION-FEEDBACK repair loop — grounded in the test sandbox, NOT self-judgment.
4. SCAFFOLD quality (same model; ~+6..+8 pts) — compact diffs, sub-agent context isolation,
   proactive compaction. Context rot is real — keep working set small.
5. MODEL ROUTING / cascade — a COST lever (45-85%+ cut), not primarily quality.
6. SKILLS — encode user/domain execution knowledge to raise first-try correctness on the user repo.

AVOID: intrinsic self-correction; homogeneous multi-agent debate/consensus voting (echo chamber);
over-long context. Ensemble ONLY heterogeneous + diversity-prune + verifier-select.

## Paid + free (BYOK)
Provider layer accepts free + paid keys uniformly. Paid = additional candidates at REAL price,
integrated via the shadow-price/pricedCost machinery. COST MODE: (a) Free only (default, $0);
(b) Free-first, paid spillover within a SPEND CAP; (c) Best quality. SPEND GUARDS mandatory when any
paid key present: cap, warn 50/80/100%, pre-flight estimate + confirm, HARD STOP at cap.

## Universal error & recovery contract
Customer never sees a raw stack trace/crash/dead-end. Every failure -> ErrorReport
{severity, title, detail, cause, recoveryActions[>=1], canRetry, fallbackApplied}. Degrade, never
crash. Capture all unhandled exceptions globally.

## Invariants (non-negotiable)
- Call exceeding live RPM/TPM/RPD is physically un-issuable (token buckets).
- No budget and no paid spend cap ever exceeded.
- No destructive/side-effectful act without explicit approval + safety checkpoint.
- Secrets never appear in prompts/logs/telemetry/sandbox/errors/repo. Redact before send.
- The verifier decides correctness. Uncovered changes LOWER confidence + are flagged.

## Tech stack
TypeScript, Node 18+ (whole brain in TS, no Python/LiteLLM). VS Code Extension API; Webview sidebar;
keys ONLY in vscode.SecretStorage. esbuild; @vscode/vsce -> .vsix. LLM via thin OpenAI-compatible
client (native fetch) + per-provider adapters (e.g. Anthropic). Code intel: VS Code LSP +
web-tree-sitter + embeddings. Storage/telemetry/memory/skills-index: better-sqlite3. Sandbox: Docker
via dockerode. Git: simple-git. Diffs: `diff` (unified) or structured search/replace. Math:
ml-matrix. YAML parser for SKILL.md frontmatter. Tests: vitest + @vscode/test-electron. Aider is a
DESIGN REFERENCE ONLY — reimplement in TS.

## Working method
Phases one at a time, test-first. A phase is done only when ALL acceptance criteria pass, tests
green, AND referenced edge-case entries have handling + tests. Keep ARCHITECTURE.md + PROGRESS.md
current. Commit small. Real blocker -> STOP and ASK.

## Phase list (build order)
0 skeleton · 1 error framework · 2 providers+keys · 3 rate-limit scheduler · 4 capability/quota
registry · 5 shadow-price+budget · 6 onboarding wizard · 7 code intel+localization · 8 editing+git+
memory · 9 verification ladder+sandbox · 10 agent loop · 11 difficulty estimator+cascade · 12
bandit learner · 13 assignment solver+council · 14 best-of-N+verifier-selector · 15 security
hardening · 16 skills I (format/ingest/retrieval) · 17 skills II (composition/injection) · 18 skills
III (sandbox/marketplace) · 19 state/crash/concurrency · 20 UI/UX panel · 21 multi-account pooling ·
22 hardening+edge-case matrix+eval+release.

See `docs/operations-research-design.md` for the OR brain, `docs/skills-spec.md` for the Skills
subsystem, `docs/edge-cases.md` for the failure catalog.

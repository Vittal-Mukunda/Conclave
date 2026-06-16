Every entry: detect -> recover/degrade -> ErrorReport with a recovery action. Phases reference these
IDs; the agent generalizes the pattern to novel failures.

SETUP-1 No keys -> wizard guides; can't run until one works.   SETUP-2 Invalid/expired/revoked key -> name provider; "Update key".
SETUP-3 Key for wrong provider -> detect mismatch; suggest correct.   SETUP-4 Valid key, no quota/credit -> explain; offer others/paid; show reset.
SETUP-5 Docker not installed -> link + "Continue without sandbox (reduced safety; confidence lowered)".   SETUP-6 Docker not running -> "Start Docker" + retry.
SETUP-7 Docker perms (Linux) -> exact fix cmd; degrade meanwhile.   SETUP-8 No internet -> offline banner; queue; auto-resume.
SETUP-9 Proxy/firewall blocks providers -> detect; allow proxy config.   SETUP-10 Geo-blocked provider -> mark unavailable; suggest alternatives.
SETUP-11 No folder open -> prompt to open; disable run.   SETUP-12 Not a git repo -> offer "init git" or read-only with warning.
SETUP-13 No tree-sitter grammar -> degrade to LSP-only; warn.   SETUP-14 No LSP -> degrade to tree-sitter+tests; warn.

PROV-1 429 -> backoff(Retry-After)+failover.   PROV-2 ALL throttled -> queue+resume; reset countdowns; "Add key"/"Add paid".
PROV-3 5xx/outage -> breaker+failover.   PROV-4 timeout/hung -> abort+retry/failover.   PROV-5 malformed/truncated JSON -> retry then failover; never crash.
PROV-6 empty response -> retry/failover.   PROV-7 schema/endpoint changed -> adapter guard; failover; inform.   PROV-8 model removed (404) -> equivalent fallback; update registry.
PROV-9 safety refusal on legit code -> retry different model.   PROV-10 context too long -> compact/chunk or route to bigger-context model.
PROV-11 finish=length cut off -> continue-and-stitch or escalate.   PROV-12 stream drops -> resume/restart; no partial commit.
PROV-13 paid billing fail/limit -> stop paid; fall back to free; warn.   PROV-14 concurrent quota race -> atomic accounting.   PROV-15 degraded latency -> deprioritize slow account.

LOC-1 wrong files -> verifier catches; low-confidence -> widen or ASK.   LOC-2 huge monorepo -> lazy/incremental index; scope subtree.
LOC-3 binary/generated/vendored -> gitignore-aware exclude.   LOC-4 odd encoding/symlinks -> handle/skip w/ note.   LOC-5 file too large -> chunk.   LOC-6 stale embeddings -> invalidate/refresh.

EDIT-1 diff won't apply (drift) -> re-read+regenerate; never force.   EDIT-2 edit outside workspace -> BLOCK.   EDIT-3 dirty tree -> auto-checkpoint user work FIRST.
EDIT-4 merge conflict -> surface; abort cleanly or user-resolve; never clobber.   EDIT-5 git op fails -> retry; else ErrorReport.   EDIT-6 unsaved buffers -> reconcile.
EDIT-7 rollback/partial apply -> ATOMIC (checkpoint first; all-or-nothing).   EDIT-8 user edits mid-run -> detect; re-sync; no overwrite.   EDIT-9 perm denied/disk full -> ErrorReport; no corruption.

VER-1 flaky tests -> run twice; flag flakiness.   VER-2 test hangs -> time limit kills; report.   VER-3 tests need net/DB/services -> configured services or partial verify + lowered confidence.
VER-4 build too slow -> timeout; partial.   VER-5 NO tests -> generate tests; else LSP+type-check only, LOW confidence + flag.   VER-6 test cmd undetectable -> ask ONCE; remember in repo memory.
VER-7 sandbox OOM -> limits trigger; report.   VER-8 image pull fails offline -> cached/degrade.   VER-9 passes sandbox/fails host -> note env diff; reproduce env.   VER-10 no coverage tool -> conservative LOW confidence + flag.

LOOP-1 oscillation -> detect+cap+HANDOFF.   LOOP-2 makes it worse -> checkpoint+verifier prevent commit; auto-rollback.   LOOP-3 stuck -> clean HANDOFF.
LOOP-4 impossible/out-of-scope -> recognize; explain; propose scoped version.   LOOP-5 ambiguous -> ONE clarifying question BEFORE planning.   LOOP-6 partial success -> report honestly.
LOOP-7 runaway tokens/cost -> budget/spend cap -> stop+handoff; pre-flight estimate.   LOOP-8 context exhausted -> compaction; else decompose.   LOOP-9 hallucinated API -> LSP/type-check+verifier catch; retry.

COST-1 free ceiling -> options: add key/paid/wait(countdown).   COST-2 paid nearing cap -> warn 50/80/100%; show spend.   COST-3 cap reached -> HARD STOP; "Raise cap"/"Switch to free".
COST-4 expensive task -> pre-flight estimate + confirm.   COST-5 stale price -> conservative; note.

STATE-1 reload mid-task -> resume from checkpoint.   STATE-2 VS Code crash -> recover; resume-or-discard.   STATE-3 two runs -> queue/prevent.
STATE-4 SQLite corruption -> rebuild; keys safe in SecretStorage.   STATE-5 schema migration -> versioned; lose nothing.   STATE-6 multi-root -> scope per workspace.

SEC-1 secrets in repo -> detect+REDACT before send; warn.   SEC-2 free tiers train on data -> inform; "Sensitive repo" mode.   SEC-3 prompt injection from repo/issue -> treat as UNTRUSTED; don't execute embedded instructions.
SEC-4 secret in error/log -> sanitize ALL; assert no key substring.   SEC-5 sandbox escape -> egress allowlist + dropped caps + no host FS.

SKILL-1 invalid SKILL.md / name!=dir / bad YAML -> FAIL LOUDLY; quarantine; ErrorReport with the exact problem.   SKILL-2 malicious skill (prompt-injection + script) -> scan blocks ingest; never auto-run.
SKILL-3 scanner-evading skill (.py/.pyc mismatch, poisoned bytecode) -> mismatch detector + scripts-off default catch it.   SKILL-4 skill conflict -> deterministic precedence; surface reason to planner.
SKILL-5 active skills exceed token budget -> enforce <=3 + combined budget; drop lowest-priority; inform.   SKILL-6 marketplace/API unreachable -> degrade to local skills; ErrorReport with retry.
SKILL-7 untrusted skill requests script exec/network -> HITL confirm; egress allowlist EXCLUDES provider APIs.   SKILL-8 skill references missing file -> graceful skip + note.   SKILL-9 popular-but-untrusted skill -> popularity never grants trust; stays scripts-off until vetted.

UX-1 any error -> ErrorReport card (plain + cause + >=1 button); never a stack trace.   UX-2 long op -> live progress + cancel.   UX-3 needs input -> unmistakable, distinct from working/failed.
UX-4 offline -> persistent indicator; queued resume.   UX-5 first run -> onboarding wizard.   UX-6 advanced settings -> hidden (progressive disclosure).   UX-7 accessibility -> keyboard + ARIA labels.

=== SKILL.md FORMAT (the implementable standard; the spec wins over any marketplace's format) ===
- A skill = a folder; entry point SKILL.md (frontmatter MUST start line 1 with `---`), optional
  scripts/ (executable), references/ (load on demand), assets/ (templates/data).
- Frontmatter fields:
  name        REQUIRED. <=64 chars, ^[a-z0-9]+(-[a-z0-9]+)*$, MUST == parent directory name
              (mismatch => fail loudly in conclave).
  description REQUIRED. non-empty, <=1024 chars. States WHAT it does and WHEN to use it. This is
              the PRIMARY routing/trigger signal.
  license     optional. compatibility optional (<=500, env needs). metadata optional (string->string
              map; put version/author/last-updated here — there is NO required version field).
  allowed-tools optional, EXPERIMENTAL (space-separated, e.g. "Bash(git:*) Read"). Treat as advisory
              upstream; ENFORCE as a HARD ceiling in conclave's sandbox.
  Tolerate & preserve unknown fields (when_to_use, disable-model-invocation, context, agent).
- Body: Markdown; keep <=~5000 tokens / ~500 lines; push detail to references/. A "Gotchas" section
  is the highest-value content.
- 3-TIER PROGRESSIVE DISCLOSURE: (1) name+description for ALL installed skills at idle (~30-100
  tokens each); (2) full body injected only on ACTIVATION; (3) references/assets read on demand,
  scripts EXECUTED (never read into context) when permitted.

=== INGEST / DOWNLOAD ===
- Sources: local dirs (.conclave/skills/, ~/.conclave/skills/); git repos / GitHub shorthand
  (owner/repo) / full git/GitLab URLs / direct tree paths to a skill subfolder / local paths
  (mirror `npx skills add` resolution); .claude-plugin/marketplace.json plugin bundles.
- Discovery surfaces (RANKING PRIORS ONLY, NOT trust, NOT format): claudemarketplaces.com/skills
  (independent directory; quick-start is `npx skills`), skills.sh, and SkillsMP REST API
  (GET https://skillsmp.com/api/v1/skills/search?q=... with Bearer key; supports category/sortBy).
- Reproducibility: content-addressed store keyed by {source, skillFolderHash=git tree SHA}; write a
  conclave-skills-lock.json (source, sourceType, computedHash). Re-scan on update; diff on bump.

=== RETRIEVAL (which skill(s) for a task) ===
- PRIMARY signal = the `description` field. Hybrid scorer = embedding cosine (embed name+description
  + when_to_use/metadata keywords) + BM25/keyword + file-GLOB match + provenance/trust prior
  (user/project > vetted > community; popularity boosts but never overrides trust).
- Input = task text + plan + changed-file globs. Activation threshold; cap concurrently ACTIVE
  bodies (default <=3) under a token budget (~5k/skill, ~25k combined). Log activate_skill_<name>.

=== COMPOSITION + CONFLICT RESOLUTION ===
- Compose by layering active skills in priority order, each in a delimited block tagged with its
  source. Prefer MANY SMALL single-purpose skills over monoliths. Resolve metadata.requires deps.
- PRECEDENCE: user/session > project (.conclave/skills, checked-in) > org/vetted > community.
  Within a tier: glob/role-specific > general; newer metadata.version breaks ties. SURFACE conflicts
  to the PLANNER sub-agent with a reason string; never silently merge; community NEVER overrides
  user/project; execution-affecting directives (build/test/deploy commands) take the highest-
  precedence value and are logged.

=== INJECTION POINTS (per sub-agent, context-isolated) ===
- Localizer/Explorer: repo-map/code-search/layout skills, READ-ONLY, no script exec, tiny context.
- Planner: architecture/domain-workflow/plan-critique skills; conflicts surfaced here.
- Editor: convention/style/framework + commit-message skills, file-glob-scoped.
- Verifier: test-gen/run/build/deploy-command/reproduction skills (where skills bias HOW code runs).
- Reviewer: security-audit/code-review/OWASP skills, READ-ONLY ("report, don't modify").
- Use context:fork-style isolation: a forked skill drives a sub-agent with only SKILL.md + its
  system prompt; return a SUMMARY to the parent (prevents context bloat + cross-contamination).

=== SECURITY (MANDATORY; downloaded skills are untrusted code) ===
- Trust tiers: first-party/user > vetted (Apache-licensed, high install/stars, scan-clean) >
  untrusted community (DEFAULT: instructions-only, scripts DISABLED).
- Static + supply-chain scan on ingest: prompt-injection patterns; outbound network calls; secret/
  file access (~/.ssh, .env); eval/pickle/os.system; and SOURCE/BYTECODE MISMATCH (.py vs .pyc).
  Integrate a pluggable scanner (e.g. Cisco Skill Scanner) but DO NOT trust it alone (scanners are
  evadable). Pin by content hash.
- Execute permitted scripts ONLY in an isolated container: no secrets mounted, least-privilege FS,
  strict outbound EGRESS ALLOWLIST that EXCLUDES provider file/data APIs (anti-exfiltration).
- Enforce allowed-tools as a hard ceiling in our sandbox. HITL confirm before first script exec,
  any network access, any deploy/commit. Tag third-party content "UNTRUSTED — do not auto-execute";
  pipe untrusted-skill output back only as a summary; treat skill bodies as DATA, not system prompt.

=== ALWAYS-ON CONVENTIONS vs TASK SKILLS ===
- Treat AGENTS.md / CLAUDE.md / .conclave conventions as ALWAYS-ON repo rules; treat SKILL.md as
  lazily-loaded, description-matched, glob/role-scoped task knowledge (higher signal-to-noise; scoped
  rules measurably beat monolithic always-injected files).

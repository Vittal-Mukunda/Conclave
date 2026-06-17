# conclave

A multi-model AI coding agent shipped as a VS Code extension. It orchestrates free-tier and paid
LLM APIs into one agentic coding loop that plans, edits code, runs tests in a sandbox, and iterates
— governed by a rate-limit-aware scheduler, a verification ladder, repo memory, a best-of-N
verifier-selector, and a downloadable Skills subsystem.

> **Status: pre-release (v0.0.1).** Phases 0–20 complete; Phase 21 (multi-account quota pooling)
> in progress. See `docs/build-plan.md` for the full plan and `docs/PROGRESS.md` for current state.

## Features

- **Multi-provider orchestration** — Anthropic + OpenAI-compatible adapters behind one client,
  with a rate-limit-aware scheduler (sliding-window limiter, circuit breaker, backoff).
- **Cost control** — shadow-price engine, per-period budget cap, spend tracking, and a
  free-only / cost-aware mode switch.
- **Agentic loop** — difficulty estimator → cascade router → edit → sandboxed verification ladder,
  with git checkpoints and crash recovery.
- **Council & best-of-N** — diverse author/review assignment and a strong verifier-selector.
- **Competence learner** — a per-workspace contextual bandit (LinUCB) that learns which model wins
  on which task.
- **Skills subsystem** — ingest, retrieve, compose, and sandbox downloadable skills; marketplace
  search and trust gating.
- **Security & privacy** — secret scanning, log redaction, prompt-injection guards, and a
  sensitive-repo mode.
- **Code intelligence** — local symbol/embedding-based task localization (pure-TS defaults; see the
  Phase 7 note in `docs/ARCHITECTURE.md`).

Open the panel from the conclave icon in the activity bar, or via the command palette
("conclave: Open Panel", `Ctrl+Alt+C` / `Cmd+Alt+C`). All commands are listed under the
`conclave:` prefix in the palette.

## Develop

```sh
npm install
npm run build             # esbuild -> out/extension.js
npm run typecheck         # tsc --noEmit (strict)
npm run test:unit         # vitest (pure logic)
npm run test:integration  # @vscode/test-electron (activation + commands)
npm run package           # vsce -> conclave-0.0.1.vsix
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## License

MIT — see the `LICENSE` file.

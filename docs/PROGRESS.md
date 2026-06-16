# conclave — Progress

Resume a session with: read `docs/PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/edge-cases.md`,
`docs/skills-spec.md`, then continue the next phase.

## Status: Phase 1 COMPLETE

| Phase | Title | State |
|------:|-------|-------|
| 0 | Foundation & extension skeleton | ✅ complete |
| 1 | Error & Resilience Framework | ✅ complete |
| 2 | Provider abstraction + key storage | ⬜ next |
| 3 | Rate-limit-aware scheduler | ⬜ |
| 4 | Capability & quota registry + cost meter | ⬜ |
| 5 | Shadow-price engine + budget/spend control | ⬜ |
| 6 | Onboarding wizard & first-run | ⬜ |
| 7 | Code intelligence + localization | ⬜ |
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

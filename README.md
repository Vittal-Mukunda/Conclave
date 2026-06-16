# conclave

A multi-model AI coding agent shipped as a VS Code extension. It orchestrates free-tier and paid
LLM APIs into one agentic coding loop that plans, edits code, runs tests in a sandbox, and iterates
— governed by a rate-limit-aware scheduler, a verification ladder, repo memory, a best-of-N
verifier-selector, and a downloadable Skills subsystem.

> **Status: Phase 0** — extension skeleton (sidebar webview, command, packaging). Not yet a working
> agent. See `docs/build-plan.md` for the full plan and `docs/PROGRESS.md` for current state.

## Develop

```sh
npm install
npm run build          # esbuild -> out/extension.js
npm run test:unit      # vitest (pure logic)
npm run test:integration  # @vscode/test-electron (activation + command)
npm run package        # vsce -> conclave-0.0.1.vsix
```

Press `F5` in VS Code to launch an Extension Development Host. The conclave icon appears in the
activity bar; open the panel from the icon or via the command palette ("conclave: Open Panel",
`Ctrl+Alt+C` / `Cmd+Alt+C`). The placeholder panel's **Ping** button round-trips a message through
the extension host.

## License

MIT — see the `LICENSE` file.

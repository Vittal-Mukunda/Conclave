# Changelog

All notable changes to the conclave extension are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Status-bar item** — an always-visible glance at cost posture (mode + spend
  against the cap) that flips to live agent state while a run is in flight.
  Click it to open the conclave panel. Switches to a warning icon once spend
  reaches 80% of the cap.
- **Multi-account quota pooling (Phase 21)** — register multiple keys per
  provider; the scheduler pools their quota and deprioritises a slow or dead
  account, with health + observed latency persisted across reloads. New command
  *conclave: Manage Account Pool*.

## [0.0.1] — pre-release

Initial pre-release covering Phases 0–20:

- Multi-provider orchestration (Anthropic + OpenAI-compatible) behind one client.
- Rate-limit-aware scheduler: sliding-window limiter, circuit breaker, backoff.
- Cost control: shadow-price engine, budget cap, spend tracking, cost-mode switch.
- Agentic loop: difficulty estimator → cascade router → edit → sandboxed
  verification ladder, with git checkpoints and crash recovery.
- Council & best-of-N verifier-selector.
- Per-workspace competence learner (LinUCB bandit).
- Skills subsystem: ingest, retrieve, compose, sandbox, marketplace search.
- Security & privacy: secret scanning, log redaction, prompt-injection guards,
  sensitive-repo mode.
- Panel UX: error cards, live agent activity with cancel, connectivity and
  degraded-capability surfacing.

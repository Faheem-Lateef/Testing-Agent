---
name: qa-self-evolution
description: Guides the QA agent meta-review loop in src/orchestrator/selfEvolution.ts — post-run analysis via OpenRouter, self-patching agent sources, tsc guard with rollback, and capped re-test cycles. Use when extending self-evolution, debugging [EVOLUTION] logs, or tuning coverage gaps.
---

# QA Agent Self-Evolution

## Flow

1. `runMainTestSuites()` in `src/orchestrator.ts` finishes UI (optional), frontend E2E, and API integration.
2. `runSelfEvolutionLoop(artifacts, runMainTestSuites)` runs up to **3** generations.
3. Each generation: OpenRouter analyzes execution summary + agent source files → JSON `{ gaps, patches }` → write full files under `src/` → `npx tsc --noEmit` → rollback on failure → re-run suites on success.

## Editable agent files

Default list in `AGENT_SOURCE_FILES` inside `selfEvolution.ts`. Add paths only under `src/`.

## Logging

All evolution steps use `[EVOLUTION]` on stdout and structured `logger.info({ evolution: true }, ...)`.

## Safety

- Patches must use `filePath` starting with `src/`.
- Failed typecheck restores in-memory backups (not git).
- Stop early when analysis returns no patches or re-tests have zero failures.

## When changing behavior

- Keep OpenRouter `temperature: 0.1` and JSON-only responses.
- Do not raise `MAX_SELF_EVOLUTION_GENERATIONS` without explicit user approval.
- Re-run hook: `runMainTestSuites` must stay stateless (no global mutation between passes except patched files).

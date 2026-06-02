# Active Context — Autonomous Full-Stack QA Agent

> **Last updated:** 2026-06-02
> **Session focus:** Self-evolution meta-loop after test runs

---

## Current Focus

**Post-run meta-review:** `src/orchestrator/selfEvolution.ts` analyzes run artifacts + agent sources via OpenRouter, applies patches, runs `npx tsc --noEmit`, rolls back on failure, re-runs `runMainTestSuites()` (max 3 generations).

### Completed This Session
1. ✅ `selfEvolution.ts` — analysis, patch pipeline, compile guard, rollback, re-test loop
2. ✅ `orchestrator.ts` — `runMainTestSuites()` + `runSelfEvolutionLoop()` wired into `runFullQACycle()`
3. ✅ Types: `QaRunArtifacts`, `EvolutionLoopResult`, etc. in `utils/types.ts`
4. ✅ Project skill `.cursor/skills/qa-self-evolution/` and hook `.cursor/hooks/post-qa-run.sh`
5. ✅ `npm run typecheck` passes

---

## Required Environment

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | Model slug (e.g. `anthropic/claude-sonnet-4`) |
| `ROUTES_DIR` | Express route scan target |
| `BASE_APP_URL` | Running app URL (default `http://localhost:3000`) |

## Optional Environment

| Variable | Purpose |
|----------|---------|
| `FIGMA_*` | UI regression (`hasFigma` flag) |
| `GITHUB_*` | PR on verified fix (`hasGit` flag) |
| `FIGMA_ROUTE_MAP` / `FIGMA_SOURCE_MAP` | UI test targets |

---

## OpenRouter Client Config

```typescript
baseURL: 'https://openrouter.ai/api/v1'
defaultHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Swiftlane QA Agent' }
temperature: 0.1  // all AI modules
```

---

*Update at start and end of each work session.*

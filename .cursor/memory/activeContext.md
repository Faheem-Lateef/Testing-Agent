# Active Context — Autonomous Full-Stack QA Agent

> **Last updated:** 2026-06-02
> **Session focus:** Migrated AI layer to OpenRouter (OpenAI SDK)

---

## Current Focus

**All AI calls now route through OpenRouter using the `openai` npm package.**

### Completed This Session
1. ✅ Removed `@anthropic-ai/sdk` dependency
2. ✅ Added `openai` client pointed at `https://openrouter.ai/api/v1`
3. ✅ Config: `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` required; removed `ANTHROPIC_API_KEY`
4. ✅ Updated `testGenerator.ts`, `bugFixer.ts`, `semanticDiff.ts`
5. ✅ Shared helpers in `config.ts`: `createOpenRouterClient`, `handleOpenRouterAuthError`, `extractCompletionText`
6. ✅ `npm run typecheck` passes

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

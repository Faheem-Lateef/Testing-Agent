# QA Agent — Progress Log

> Auto-appended by `writeProgressLog()` after every run.
> Manual entries below reflect architectural milestones.

---

## [2026-06-02 23:43:00] milestone: Blank-canvas project scaffolding

- **Outcome**: SUCCESS ✓
- **FSM State**: `COMPLETED`

### Changes Introduced
- [qa-agent] created: `src/orchestrator/featureEngineer/projectScaffolder.ts`
  - `scaffoldWorkspaceIfBlank(backendRoot, frontendRoot)` using `mkdirSync`
  - Writes `package.json`, `tsconfig.json`, `src/global.d.ts` (wildcard shim), placeholder entry points
  - Runs `npm install --save-dev typescript @types/node` bootstrap
  - Exports `DEFAULT_BACKEND_URL = http://localhost:3001`, `DEFAULT_FRONTEND_URL = http://localhost:5173`
- [qa-agent] modified: `src/orchestrator/featureEngineer/compilerSandbox.ts`
  - `ensureTypescriptInstalled()` — runs npm install if node_modules absent before `tsc --noEmit`
  - Missing project directory now returns `success: true` (blank-canvas safe)
- [qa-agent] modified: `src/orchestrator/featureEngineer/repoAnalyzer.ts`
  - `isBlankCanvas: boolean` added to `RepoSnapshot`
  - Detected when real source files < 5
- [qa-agent] modified: `src/orchestrator/featureEngineer/openRouterPhases.ts`
  - `isBlankCanvas` param on `runFullStackDevelopmentPhase`
  - Greenfield prompt requests complete project structure (all files)
- [qa-agent] modified: `src/orchestrator/featureEngineer.ts`
  - Env defaults injected before `loadConfig()` (ROUTES_DIR, BASE_APP_URL, FRONTEND_APP_URL, GIT_REPO_ROOT)
  - `resetConfigCache()` called after injection
  - `scaffoldWorkspaceIfBlank()` called between `resolveWorkspaceRoots` and Phase 1
- [qa-agent] modified: `src/utils/config.ts`
  - `resetConfigCache()` exported
  - `ROUTES_DIR` missing → non-fatal warn + fallback path (no `process.exit`)

---

## [2026-06-02 23:48:00] milestone: AI model default fallback + hot-swap menu

- **Outcome**: SUCCESS ✓
- **FSM State**: `COMPLETED`

### Changes Introduced
- [qa-agent] created: `src/cli/modelConfig.ts`
  - `DEFAULT_MODEL = 'google/gemini-2.5-flash'`
  - `applyModelDefault()` — silent fallback, persists to .env, prints 🤖 log
  - `promptModelSwitch()` — curated select: Gemini 2.5 Flash / Claude 3.5 Sonnet / GPT-4o Mini
  - `printActiveModelLine()` — model badge before every run
  - `upsertEnvFile(key, value)` — shared .env writer utility
- [qa-agent] modified: `src/utils/config.ts`
  - `OPENROUTER_MODEL` schema: `.default('google/gemini-2.5-flash')` (never fatal)
- [qa-agent] modified: `src/cli/envGuard.ts`
  - `OPENROUTER_MODEL` removed from ENV_SPECS (no longer prompted)
- [qa-agent] modified: `src/cli/menu.ts`
  - `TestingIntent` extended with `'switch-model'`
  - ⚙️ choice shows current model inline
  - `printIntentBadge` guards `switch-model` with early return
- [qa-agent] modified: `src/index.ts`
  - `applyModelDefault()` called after banner (startup sequence step 2)
  - `handleRunCommand` uses while-loop for switch-model → menu re-display
  - `printActiveModelLine()` shown before every intent badge

---

## [2026-06-03 00:00:00] milestone: Multi-provider AI routing

- **Outcome**: SUCCESS ✓
- **FSM State**: `COMPLETED`

### Changes Introduced
- [qa-agent] created: `src/utils/providerRouter.ts` — auto-detect OpenRouter / Google / OpenAI / Groq / Anthropic from key prefix
- [qa-agent] modified: `src/utils/config.ts` — any of 7 key env vars; `createOpenRouterClient()` routes to correct API
- [qa-agent] modified: `src/cli/modelConfig.ts` — per-provider model menu + `AI_MODEL` persistence
- [qa-agent] modified: `src/cli/envGuard.ts` — prompts `AI_API_KEY` (universal) instead of OpenRouter-only
- [qa-agent] modified: `.env.example`, `README.md` — multi-provider setup docs

---

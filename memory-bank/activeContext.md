# Active Context — Memory Bank (repo root)

> Canonical mirror for the Feature Engineer. Also see `.cursor/memory/activeContext.md`.
> **Last updated:** 2026-06-02 19:53:56
> Last run: "memory auto-update verification" → SUCCESS (COMPLETED)

## Stack anchors

- **API prefix:** `/api/v1` (Express marketplace backend)
- **Database:** MongoDB via Mongoose
- **Errors:** `AppError` + `errorHandler` middleware
- **Frontend:** Next.js App Router, Tailwind CSS, LUXE design tokens (`glass`, `accent`, Syne font)
- **QA agent:** Node 20+ ESM, TypeScript strict, multi-provider AI (`temperature: 0.1`)

## Backend layout

- Routes aggregator: `src/routes/index.ts` — register feature routers with `router.use('...', featureRouter)`
- Services/controllers/repositories pattern under `src/`

## Memory Bank Auto-Sync (HARDCODED)

Every memory write goes to BOTH canonical locations simultaneously:
- `memory-bank/progress.md` — repo root
- `.cursor/memory/progress.md` — Cursor IDE memory

`checkMemoryDrift(cwd)` is called in READING_CONTEXT and warns when the two locations
have diverged. `syncToAllMemoryDirs(cwd, filename, content)` re-aligns them.

`loadMemoryBankSync()` reads from both + `.cursorrules` synchronously before any async I/O.

## Duplicate File Detection (HARDCODED)

`detectAgentDuplicates(qaAgentRoot)` runs in READING_CONTEXT alongside `checkMemoryDrift`:
- **Name collisions:** same basename in multiple directories
- **Content clones:** byte-identical files at different paths (MD5 hash)
- Logs `[DUPLICATE-DETECTOR]` warnings with explicit paths
- Never silently suppressed — investigate before generating new code for affected module

## Blank-canvas scaffolding

When `backend demo/ecommerce-backend` or `backend demo/ecommerce-frontend` do not exist,
the Feature Engineer auto-creates them via `projectScaffolder.ts`:

- `mkdirSync` creates all source folders (controllers, models, routes, services, middleware, config)
- Writes `package.json` with `build: "tsc --noEmit"`, `tsconfig.json` with `strict:false / skipLibCheck:true`, and `src/global.d.ts` with `declare module '*'` (wildcard shim)
- Runs `npm install --save-dev typescript @types/node` so `tsc --noEmit` works without full runtime deps
- Default ports: **Backend → http://localhost:3001** | **Frontend → http://localhost:5173**
- ROUTES_DIR, BASE_APP_URL, FRONTEND_APP_URL, GIT_REPO_ROOT are auto-injected into `process.env` before `loadConfig()` is called
- `resetConfigCache()` is called after injection so the config cache stays coherent
- `repoAnalyzer` sets `isBlankCanvas: true` when fewer than 5 real source files exist
- When blank canvas, OpenRouter PHASE-1 prompt requests COMPLETE application structure (all models, controllers, routes, pages, components)

## AI provider & model configuration (multi-provider)

- **Any supported API key** via `AI_API_KEY` (auto-detects provider from prefix)
- Also accepts: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`
- Routing: `src/utils/providerRouter.ts` → correct base URL per provider
- **OpenRouter** `sk-or-…` → `openrouter.ai` | models like `google/gemini-2.5-flash`
- **Google Gemini** `AIza…` → direct API | models like `gemini-2.5-flash`
- **OpenAI** `sk-proj-…` / `sk-…` → `api.openai.com` | models like `gpt-4o-mini`
- **Anthropic** `sk-ant-…` → Messages API shim | models like `claude-3-5-sonnet-20241022`
- **Groq** `gsk_…` → `api.groq.com` | models like `llama-3.3-70b-versatile`
- Override: `AI_PROVIDER=openrouter|google|openai|groq|anthropic`
- Defaults + hot-swap: `src/cli/modelConfig.ts` (provider-specific model menu)
- Startup logs: `🌐 [AI-PROVIDER]` + model badge via `printActiveModelLine()`
- Legacy: `OPENROUTER_MODEL` / `AI_MODEL` both written on model change

## Module map (QA agent src/)

| Path | Role |
|------|------|
| `utils/providerRouter.ts` | Key auto-detect, base URL routing, Anthropic compat client |
| `cli/modelConfig.ts` | Provider-aware defaults + hot-swap menu + .env writer |
| `cli/envGuard.ts` | Prompts for `AI_API_KEY` (any provider) + ROUTES_DIR + URLs |
| `orchestrator/featureEngineer/sandbox.ts` | External project workspace (outside agent repo) |
| `cli/menu.ts` | Intent menu including ⚙️ switch-model loop |
| `cli/banner.ts` | Colored phase headers + status helpers |
| `orchestrator/featureEngineer/projectScaffolder.ts` | mkdirSync blank-canvas bootstrap |
| `orchestrator/featureEngineer/compilerSandbox.ts` | tsc guard + npm install if node_modules absent |
| `orchestrator/featureEngineer/repoAnalyzer.ts` | isBlankCanvas detection |
| `orchestrator/featureEngineer/openRouterPhases.ts` | PHASE-1 dev prompt (greenfield vs incremental) |
| `orchestrator/featureEngineer/memoryBank.ts` | Agent + project memory: finalizeAgentMemoryUpdate / finalizeProjectMemoryUpdate |
| `orchestrator/featureEngineer/duplicateDetector.ts` | Name collision + content clone scan (wired to READING_CONTEXT) |

## Constraints

- KISS / DRY — minimal additive diffs
- No blind full-file regex replacement for injections
- Compile gate: `npm run build` or `tsc --noEmit` after every write
- `strict: false`, `skipLibCheck: true` in scaffolded project tsconfigs
- Feature runs: `finalizeProjectMemoryUpdate()` (external app) + `finalizeAgentMemoryUpdate()` (agent, both dirs)
- QA runs (backend/frontend/fullstack): `finalizeAgentMemoryUpdate()` only
- Memory ALWAYS loaded via `loadMemoryBankSync()` as ABSOLUTE FIRST operation (readFileSync)
- Drift check + dup scan ALWAYS run in READING_CONTEXT before any LLM call

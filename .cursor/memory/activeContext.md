# Active Context — QA Feature Engineer Agent

> **Last updated:** 2026-06-02
> **Session focus:** Autonomous Feature Engineer 4-phase lifecycle, blank-canvas scaffolding,
> AI model hot-swap, memory-bank auto-sync, duplicate file detection

---

## Current Architecture

The agent is now an **Autonomous Feature Engineer** (`src/orchestrator/featureEngineer.ts`).
It acts simultaneously as full-stack developer, QA automation tester, and self-healing debugger.

### 4-Phase Lifecycle

```
PHASE_1_DEVELOPMENT  → LLM generates all application code (full-stack or incremental)
PHASE_2_TEST_GEN     → Dynamic Playwright E2E test generated per feature
PHASE_3_TEST_RUN     → Playwright executes generated test, parses __FEATURE_RESULT__ JSON
PHASE_4_REPORT       → Engineering report: dev log, test compliance, patch summary
```

FSM states: `IDLE → READING_CONTEXT → INJECTING_CODE → COMPILING → GENERATING_TESTS → TESTING → DEBUGGING → REPORTING → COMPLETED / FAILED`

### READING_CONTEXT boot sequence (hardcoded, runs every invocation)
1. `loadMemoryBankSync(cwd)` — synchronous, absolute first operation (readFileSync)
2. `checkMemoryDrift(cwd)` — warns if `memory-bank/` and `.cursor/memory/` have diverged
3. `detectAgentDuplicates(cwd)` — scans `src/` for name collisions and content clones
4. `loadProjectMemoryBank(cwd)` — async, augments sync snapshot
5. `analyzeRepositories()` — backend + frontend snapshot; sets `isBlankCanvas`

### Auto-write after every run (hardcoded `finally` block)
- `writeProgressLog()` → appends to **both** `memory-bank/progress.md` AND `.cursor/memory/progress.md`
- `syncToAllMemoryDirs()` available for full overwrites across all canonical locations

---

## Required Environment

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | Model slug — **auto-defaulted** to `google/gemini-2.5-flash` if missing |
| `ROUTES_DIR` | Express route scan target — auto-injected as fallback, non-fatal if absent |
| `BASE_APP_URL` | Running app URL — auto-defaulted to `http://localhost:3001` |
| `FRONTEND_APP_URL` | Frontend URL — auto-defaulted to `http://localhost:5173` |

---

## OpenRouter Client Config

```typescript
baseURL: 'https://openrouter.ai/api/v1'
defaultHeaders: { 'HTTP-Referer': 'http://localhost:3001', 'X-Title': 'QA Feature Engineer' }
temperature: 0.1  // all AI modules
```

Default model: `google/gemini-2.5-flash`
Curated hot-swap menu: Gemini 2.5 Flash · Claude 3.5 Sonnet · GPT-4o Mini

---

## Blank-Canvas Scaffolding

When backend/frontend directories are empty or absent, `projectScaffolder.ts` creates:
- `package.json` with `build: "tsc --noEmit"`, minimal deps
- `tsconfig.json` (NodeNext for backend, React/DOM for frontend)
- Placeholder entry points (`src/index.ts`, `src/app/page.tsx`)
- Runs `npm install --save-dev typescript @types/node` bootstrap
- Sets `isBlankCanvas: true` → OpenRouter prompt requests **complete application**

---

## Module Map (src/)

| Path | Role |
|------|------|
| `index.ts` | CLI entry — banner, env guard, intent menu, model hot-swap loop |
| `cli/banner.ts` | Colored phase headers + status helpers |
| `cli/envGuard.ts` | Interactive prompts for OPENROUTER_API_KEY + URLs (NOT model) |
| `cli/menu.ts` | Intent menu: backend / frontend / fullstack / engineer / switch-model |
| `cli/modelConfig.ts` | Default fallback + hot-swap menu + .env writer |
| `orchestrator/featureEngineer.ts` | Main 4-phase orchestrator |
| `orchestrator/featureEngineer/fsm.ts` | FSM state transitions |
| `orchestrator/featureEngineer/types.ts` | All TS interfaces + constants |
| `orchestrator/featureEngineer/logging.ts` | phaseLog / devLog / testLog / memoryLog |
| `orchestrator/featureEngineer/memoryBank.ts` | loadMemoryBankSync + writeProgressLog + syncToAllMemoryDirs + checkMemoryDrift |
| `orchestrator/featureEngineer/duplicateDetector.ts` | Scan src/ for name collisions and content clones |
| `orchestrator/featureEngineer/projectScaffolder.ts` | mkdirSync blank-canvas bootstrap |
| `orchestrator/featureEngineer/compilerSandbox.ts` | tsc guard + npm install + rollback |
| `orchestrator/featureEngineer/repoAnalyzer.ts` | isBlankCanvas detection + repo snapshot |
| `orchestrator/featureEngineer/openRouterPhases.ts` | PHASE-1 dev + heal prompts (greenfield vs incremental) |
| `orchestrator/featureEngineer/codeAnchors.ts` | Code injection with anchor matching + replaceEntireFile support |
| `orchestrator/featureEngineer/phase1Development.ts` | Apply LLM-generated code files |
| `orchestrator/featureEngineer/phase2TestGen.ts` | Generate Playwright E2E test → src/ui/generated/ |
| `orchestrator/featureEngineer/phase3Runner.ts` | Execute test, parse __FEATURE_RESULT__ JSON |
| `orchestrator/featureEngineer/phase4Report.ts` | Engineering report: dev log + compliance + patch summary |
| `utils/config.ts` | Zod env validation + resetConfigCache() |
| `utils/types.ts` | Shared interfaces (BrowserDiagnostic, etc.) |
| `utils/logger.ts` | Pino structured logger |

---

## Memory Bank Canonical Locations

Both directories MUST stay in sync. Every write goes to both:
- `memory-bank/` (repo root)
- `.cursor/memory/` (Cursor IDE memory)

`checkMemoryDrift()` warns on divergence. `syncToAllMemoryDirs()` re-aligns.

---

## Constraints

- `loadMemoryBankSync()` MUST be the absolute first operation (readFileSync — synchronous)
- `writeProgressLog()` MUST be called in `finally` block — every run, success or failure
- `detectAgentDuplicates()` MUST run in READING_CONTEXT before any code generation
- `resetConfigCache()` MUST be called after programmatic `process.env` mutations
- Max heal attempts: 4 (`MAX_HEAL_ATTEMPTS`)
- Max compile attempts: 3 (`MAX_COMPILE_ATTEMPTS`)
- Generated E2E tests written to `src/ui/generated/feature-{slug}.test.ts`

---

*This file is automatically synced to memory-bank/activeContext.md. Update both locations.*

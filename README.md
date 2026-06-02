# QA Feature Engineer Agent

An autonomous Node.js/TypeScript agent with two roles:

1. **Feature Engineer** — Give it a plain-English spec. It writes full-stack code, generates a Playwright E2E test, runs it, and self-heals on failures.
2. **QA Regression Agent** — Visual regression vs Figma, API test generation, and a self-healing patch loop for your running Express backend.

---

## Requirements

- **Node.js 20+**
- An **[OpenRouter](https://openrouter.ai/) API key**
- A **running backend** (for QA mode) — the agent sends real HTTP requests
- Playwright Chromium (for E2E tests and UI regression)

---

## Quick Start

### 1. Install

```bash
npm install
npx playwright install chromium
```

### 2. Configure

```bash
cp .env.example .env
```

Only one AI key is required — any supported provider:

```env
AI_API_KEY=your-key-here
```

Or use a provider-specific variable (`OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`). The agent **auto-detects** the provider from the key prefix.

Everything else is auto-configured:

| Variable | Auto-default |
|----------|-------------|
| `AI_MODEL` / `OPENROUTER_MODEL` | Per provider (e.g. `gemini-2.5-flash` for Google, `google/gemini-2.5-flash` for OpenRouter) |
| `BASE_APP_URL` | `http://localhost:3001` |
| `FRONTEND_APP_URL` | `http://localhost:5173` |
| `ROUTES_DIR` | Auto-discovered from backend folder |

### 3. Run

```bash
npm run start
```

An interactive menu appears:

```
? What do you want to do?
  ❯ Engineer a feature
    Run backend QA
    Run frontend QA
    Run full-stack QA
    ⚙  Switch Active AI Model  [google/gemini-2.5-flash]
```

---

## Feature Engineering

The primary mode. Give the agent a feature spec and it handles everything:

```bash
npx tsx src/index.ts engineer "Add a product reviews endpoint with star ratings"
```

Or via the interactive menu — select **Engineer a feature** and type your spec.

### What happens

```
READING_CONTEXT  →  Load memory bank + check for drift + scan for duplicate files
PHASE_1          →  LLM generates full-stack code (backend routes/services + frontend pages)
COMPILING        →  tsc --noEmit gate (up to 3 attempts, auto-installs deps if needed)
PHASE_2          →  LLM writes a Playwright E2E test for the feature
PHASE_3          →  Playwright executes the test against your running app
PHASE_4          →  Engineering report: dev log, test compliance, patch summary
DEBUGGING        →  On test failure: LLM patches code, re-tests (up to 4 heal cycles)
finally          →  progress.md appended + activeContext.md header stamped (always)
```

### Blank-canvas projects

If no backend or frontend exists yet, the agent scaffolds one from scratch before generating:

```
backend demo/ecommerce-backend/   ← created automatically
  ├── package.json
  ├── tsconfig.json
  └── src/index.ts                ← placeholder, replaced by LLM

backend demo/ecommerce-frontend/  ← created automatically
  ├── package.json
  ├── tsconfig.json
  └── src/app/page.tsx            ← placeholder, replaced by LLM
```

The LLM detects a blank canvas and generates a **complete application** rather than an incremental feature.

---

## QA Regression Mode

Tests a running Express backend — discovers routes, generates test cases, runs them, and self-heals failures.

```bash
npx tsx src/index.ts run        # interactive menu → Backend / Frontend / Full-stack
npx tsx src/index.ts watch      # re-run on route file changes (2s debounce)
npx tsx src/index.ts webhook    # listen for CI triggers (POST /webhook/ci)
```

### What happens on backend QA

1. Auto-discovers backend folder, `ROUTES_DIR`, and port
2. Parses every Express route
3. Generates test cases via OpenRouter (happy path, edge cases, auth, injection)
4. Runs all tests via Axios
5. On failure: patches the source file, compiles, retests (up to `MAX_PATCH_RETRIES`)
6. Prints final report

Example output:

```
────────────────── ERRORS FOUND & FIXES ──────────────────
1. POST /api/v1/orders
   Error   : Expected 201, got 400
   File    : ecommerce-backend/src/services/orderService.ts
   Outcome : fixed (1 attempt)

        INTEGRATION TEST RUN — FINAL REPORT
  Endpoints discovered  : 27
  Tests passed          : 56
  Tests failed          : 0
```

---

## AI Model Hot-Swap

Switch models at runtime without editing `.env`:

```bash
npx tsx src/index.ts run   →   select "⚙ Switch Active AI Model"
```

| Model | Slug |
|-------|------|
| Gemini 2.5 Flash *(default)* | `google/gemini-2.5-flash` |
| Claude 3.5 Sonnet | `anthropic/claude-3.5-sonnet` |
| GPT-4o Mini | `openai/gpt-4o-mini` |

The selection is persisted to `.env` immediately and shown before every run.

---

## Memory Bank

The agent maintains a persistent memory bank in two locations kept in sync automatically:

```
memory-bank/
  ├── activeContext.md    ←  architecture notes + last run header (auto-stamped)
  └── progress.md         ←  full run log (auto-appended after every run)

.cursor/memory/
  ├── activeContext.md    ←  mirror — always updated alongside memory-bank/
  ├── progress.md         ←  mirror
  ├── systemArchitecture.md
  ├── systemPatterns.md
  └── productContext.md
```

After every run — whether it succeeds, fails, or crashes — the `finally` block:
- Appends a structured record to `progress.md` in **both** locations
- Stamps the `Last updated` date and `Last run` outcome into `activeContext.md` in **both** locations

At the start of every run the agent checks for drift between the two locations and warns if they have diverged.

---

## Duplicate File Detection

At the start of every Feature Engineer run the agent scans `src/` for:

- **Name collisions** — same filename appearing in different directories
- **Content clones** — byte-identical files at different paths

Findings are logged with `[DUPLICATE-DETECTOR]` prefix before any code generation begins, so the LLM never generates a conflicting second copy of an existing module.

---

## All Commands

| Command | What it does |
|---------|-------------|
| `npm run start` | Interactive menu |
| `npm run run` | Alias for interactive menu |
| `npm run watch` | Re-run QA on route file changes |
| `npm run webhook` | Webhook server (`POST /webhook/ci` on port 4040) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | `tsc` |

Direct invocations:

```bash
npx tsx src/index.ts engineer "your feature spec"
npx tsx src/index.ts run
npx tsx src/index.ts watch
npx tsx src/index.ts webhook
```

---

## Environment Variables

### Required (one AI key)

| Variable | Description |
|----------|-------------|
| `AI_API_KEY` | Any supported key (auto-detects provider) |
| `OPENROUTER_API_KEY` | OpenRouter (`sk-or-…`) — legacy alias |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Google Gemini (`AIza…`) |
| `OPENAI_API_KEY` | OpenAI (`sk-proj-…` / `sk-…`) |
| `ANTHROPIC_API_KEY` | Anthropic Claude (`sk-ant-…`) |
| `GROQ_API_KEY` | Groq (`gsk_…`) |

### Auto-configured (override in `.env` if needed)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | LLM model slug |
| `BASE_APP_URL` | `http://localhost:3001` | Backend URL |
| `FRONTEND_APP_URL` | `http://localhost:5173` | Frontend URL |
| `ROUTES_DIR` | Auto-discovered | Express routes directory |
| `GIT_REPO_ROOT` | `process.cwd()` | Backend repo root for patches |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PATCH_RETRIES` | `3` | Max patch attempts per QA failure |
| `FIGMA_API_TOKEN`, `FIGMA_FILE_KEY` | — | Enable UI regression vs Figma |
| `FIGMA_ROUTE_MAP`, `FIGMA_SOURCE_MAP` | `{}` | Route → Figma node mapping |
| `GITHUB_TOKEN`, `GITHUB_REPO_*` | — | Open PR after a verified fix |
| `WEBHOOK_PORT` | `4040` | Webhook server port |

---

## Project Structure

```
src/
├── index.ts                        CLI entry point
├── cli/
│   ├── banner.ts                   Colored terminal output
│   ├── envGuard.ts                 Interactive env prompts
│   ├── menu.ts                     Intent selection menu
│   └── modelConfig.ts              AI model default + hot-swap
├── orchestrator/
│   ├── selfEvolution.ts            Meta-review + self-patch loop
│   └── featureEngineer/
│       ├── fsm.ts                  FSM state machine
│       ├── types.ts                Shared interfaces + constants
│       ├── logging.ts              Phase-specific log helpers
│       ├── memoryBank.ts           Dual-location memory read/write + drift check
│       ├── duplicateDetector.ts    Name collision + content clone scan
│       ├── projectScaffolder.ts    Blank-canvas bootstrap
│       ├── compilerSandbox.ts      tsc guard + rollback
│       ├── repoAnalyzer.ts         isBlankCanvas detection
│       ├── openRouterPhases.ts     LLM prompts (dev + heal)
│       ├── codeAnchors.ts          Code injection with anchor matching
│       ├── phase1Development.ts    Apply generated code files
│       ├── phase2TestGen.ts        Generate Playwright E2E test
│       ├── phase3Runner.ts         Execute test, parse results
│       └── phase4Report.ts         Engineering report
├── api/                            Route parsing, test gen, test runner
├── ui/
│   ├── generated/                  Dynamic E2E tests (auto-written per feature)
│   ├── screenshot.ts
│   ├── figma.ts
│   ├── pixelDiff.ts
│   └── semanticDiff.ts
├── patcher/                        Bug fixing + retry loop
├── trigger/                        File watcher + webhook server
└── utils/                          Config (zod), types, logger

memory-bank/                        Auto-updated after every run
.cursor/memory/                     Mirror — always kept in sync with memory-bank/
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No AI API key | Add `AI_API_KEY` or a provider-specific key to `.env` |
| `Server unreachable` | Start your backend; verify `BASE_APP_URL` in `.env` |
| `tsc --noEmit` fails on generated code | Agent retries up to 3 times; check `[COMPILING]` log for the specific error |
| OpenRouter `402` | Add credits at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) |
| Wrong backend selected | Set `ROUTES_DIR` and `BASE_APP_URL` explicitly in `.env` |
| Memory bank drift warning | The two locations have diverged — copy the newer file to the other location |
| Duplicate file warning | Remove the stale copy before the next feature run |
| Patches not applied | Use a dev server with hot reload (`tsx watch`, `nodemon`) or restart after patches |

---

## License

MIT

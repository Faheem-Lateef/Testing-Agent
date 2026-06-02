# System Architecture — QA Feature Engineer Agent

> **Status:** Feature Engineer 4-phase lifecycle complete
> **Last updated:** 2026-06-02

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         src/index.ts                            │
│   CLI: run | watch | webhook | engineer "<spec>"                │
│   Startup: banner → loadMemoryBankSync → applyModelDefault      │
│            → envGuard → intentMenu → execution                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           │                             │
┌──────────▼──────────┐     ┌────────────▼──────────────────────────┐
│  orchestrator/      │     │  orchestrator/featureEngineer.ts       │
│  selfEvolution.ts   │     │  4-Phase Autonomous Feature Engineer   │
│  Meta-review loop   │     │                                        │
└─────────────────────┘     │  READING_CONTEXT                       │
                            │    ├─ loadMemoryBankSync (sync)        │
                            │    ├─ checkMemoryDrift                 │
                            │    ├─ detectAgentDuplicates            │
                            │    └─ analyzeRepositories              │
                            │                                        │
                            │  PHASE_1_DEVELOPMENT                   │
                            │    └─ openRouterPhases → codeAnchors   │
                            │                                        │
                            │  PHASE_2_TEST_GEN                      │
                            │    └─ phase2TestGen → ui/generated/    │
                            │                                        │
                            │  PHASE_3_TEST_RUN                      │
                            │    └─ phase3Runner → Playwright        │
                            │                                        │
                            │  PHASE_4_REPORT                        │
                            │    └─ phase4Report + writeProgressLog  │
                            └───────────────────────────────────────┘
                                          │
              ┌───────────────────────────┤
              │                           │
┌─────────────▼────────┐    ┌─────────────▼──────────┐
│  featureEngineer/    │    │  Legacy QA modules      │
│  ├─ fsm.ts           │    │  ├─ api/routeParser.ts  │
│  ├─ types.ts         │    │  ├─ api/testGenerator   │
│  ├─ logging.ts       │    │  ├─ api/testRunner      │
│  ├─ memoryBank.ts    │    │  ├─ ui/screenshot.ts    │
│  ├─ duplicateDet.ts  │    │  ├─ ui/figma.ts         │
│  ├─ projectScaffold  │    │  ├─ patcher/bugFixer    │
│  ├─ compilerSandbox  │    │  └─ trigger/            │
│  ├─ repoAnalyzer     │    └────────────────────────┘
│  ├─ openRouterPhases │
│  ├─ codeAnchors      │
│  ├─ phase1Dev        │
│  ├─ phase2TestGen    │
│  ├─ phase3Runner     │
│  └─ phase4Report     │
└──────────────────────┘
```

---

## 2. Technology Stack

### Runtime
| Package | Purpose |
|---------|---------|
| `openai` (^4.x) | OpenRouter via OpenAI-compatible API — all LLM calls |
| `playwright` (^1.50.1) | E2E browser automation + screenshot |
| `@inquirer/prompts` | Interactive CLI menus (select, confirm, input) |
| `picocolors` | Colored terminal output |
| `axios` (^1.7.9) | HTTP test execution |
| `pixelmatch` (^6.0.0) | Pixel-level image comparison |
| `pngjs` (^7.0.0) | PNG read/write |
| `chokidar` (^4.0.3) | File system watching |
| `express` (^4.21.2) | CI webhook server |
| `zod` (^3.24.1) | Env validation |
| `dotenv` (^16.4.7) | Local env loading |
| `pino` (^9.6.0) | Structured logging |

### Dev
| Package | Purpose |
|---------|---------|
| `typescript` | Compiler (strict + noUncheckedIndexedAccess) |
| `tsx` | Dev/runtime TS execution |
| `@types/node` | Node types |

---

## 3. Project Structure

```
sqa/
├── src/
│   ├── index.ts                              # CLI entry point
│   ├── cli/
│   │   ├── banner.ts                         # Colored terminal output
│   │   ├── envGuard.ts                       # Interactive env prompts
│   │   ├── menu.ts                           # Intent selection menu
│   │   └── modelConfig.ts                    # AI model default + hot-swap
│   ├── orchestrator/
│   │   ├── selfEvolution.ts                  # Meta-review + self-patch loop
│   │   └── featureEngineer/
│   │       ├── fsm.ts                        # FSM state transitions
│   │       ├── types.ts                      # Interfaces + constants
│   │       ├── logging.ts                    # Phase-specific log helpers
│   │       ├── memoryBank.ts                 # Sync load + dual-location write
│   │       ├── duplicateDetector.ts          # Name collision + content clone scan
│   │       ├── projectScaffolder.ts          # Blank-canvas bootstrap
│   │       ├── compilerSandbox.ts            # tsc guard + rollback
│   │       ├── repoAnalyzer.ts               # isBlankCanvas + snapshot
│   │       ├── openRouterPhases.ts           # LLM prompts (dev + heal)
│   │       ├── codeAnchors.ts                # Code injection
│   │       ├── phase1Development.ts          # Apply generated files
│   │       ├── phase2TestGen.ts              # Generate Playwright test
│   │       ├── phase3Runner.ts               # Execute + parse results
│   │       └── phase4Report.ts              # Engineering report
│   ├── api/
│   │   ├── flowTestGenerator.ts
│   │   ├── routeParser.ts
│   │   ├── testGenerator.ts
│   │   └── testRunner.ts
│   ├── ui/
│   │   ├── frontendRunner.ts
│   │   ├── screenshot.ts
│   │   ├── figma.ts
│   │   ├── pixelDiff.ts
│   │   ├── semanticDiff.ts
│   │   └── generated/                        # Dynamic E2E tests (gitkeep)
│   ├── patcher/
│   │   ├── bugFixer.ts
│   │   ├── applyPatch.ts
│   │   └── retryLoop.ts
│   ├── trigger/
│   │   ├── fileWatcher.ts
│   │   └── webhookServer.ts
│   └── utils/
│       ├── config.ts                         # Zod validation + resetConfigCache
│       ├── types.ts
│       └── logger.ts
├── memory-bank/                              # Canonical memory (auto-written)
│   ├── activeContext.md
│   └── progress.md
├── .cursor/
│   ├── memory/                               # Cursor IDE memory (MUST stay in sync)
│   │   ├── activeContext.md
│   │   ├── progress.md
│   │   ├── systemArchitecture.md
│   │   ├── systemPatterns.md
│   │   └── productContext.md
│   ├── skills/
│   └── hooks/
├── .env
├── package.json
└── tsconfig.json
```

---

## 4. Memory Bank Sync Architecture

```
loadMemoryBankSync()         writeProgressLog()
     │                             │
     ├── reads memory-bank/        ├── appends to memory-bank/progress.md
     ├── reads .cursor/memory/     └── appends to .cursor/memory/progress.md
     └── merges all candidates

checkMemoryDrift()           syncToAllMemoryDirs()
     │                             │
     └── warns if files differ     └── overwrites both locations
         across directories             (full content sync)
```

---

## 5. FSM State Transitions

```
IDLE
  └─► READING_CONTEXT (memory + drift check + dup scan + repo analysis)
        └─► INJECTING_CODE (development pass)
              └─► COMPILING (tsc --noEmit)
                    ├─► GENERATING_TESTS (phase 2 test gen)
                    │     └─► TESTING (Playwright execution)
                    │           ├─► DEBUGGING (self-heal on failure)
                    │           │     ├─► INJECTING_CODE (retry)
                    │           │     └─► REPORTING (after max attempts)
                    │           └─► REPORTING (on pass)
                    └─► REPORTING (on compile failure after max attempts)
                          └─► COMPLETED / FAILED
```

---

## 6. Environment Variables

```env
OPENROUTER_API_KEY=          # required
OPENROUTER_MODEL=            # auto-defaulted: google/gemini-2.5-flash
BASE_APP_URL=                # auto-defaulted: http://localhost:3001
FRONTEND_APP_URL=            # auto-defaulted: http://localhost:5173
ROUTES_DIR=                  # auto-injected fallback; non-fatal if absent
GIT_REPO_ROOT=               # auto-injected as cwd
```

---

*Update when stack, structure, or ADRs change.*

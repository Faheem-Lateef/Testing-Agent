# System Architecture — Autonomous Full-Stack QA Agent

> **Status:** Phase 1 scaffolding complete — implementation pending
> **Last updated:** 2026-06-02

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      src/index.ts                           │
│              CLI: run | watch | webhook                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   src/orchestrator.ts                        │
│              runFullQACycle() — main QA loop                 │
└───┬─────────────────┬─────────────────┬─────────────────────┘
    │                 │                 │
┌───▼────┐      ┌─────▼─────┐     ┌─────▼─────┐
│  ui/   │      │   api/    │     │ patcher/  │
│Visual  │      │ Route+Test│     │ Fix+Retry │
└────────┘      └───────────┘     └───────────┘
    ▲                 ▲                 ▲
    └─────────────────┴─────────────────┘
                           │
              ┌────────────▼────────────┐
              │      trigger/           │
              │ fileWatcher | webhook   │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │       utils/          │
              │ config | types | log  │
              └───────────────────────┘
```

**Pattern:** Flat module layout with orchestrator as coordinator.
**Module system:** ESM (`"type": "module"`).
**Runtime:** Node.js 20+, TypeScript strict.

---

## 2. Technology Stack

### Runtime
| Package | Version | Module | Purpose |
|---------|---------|--------|---------|
| `openai` | ^4.x | reasoning | OpenRouter via OpenAI-compatible API — vision, test gen, patching |
| `playwright` | ^1.50.1 | ui/screenshot | Browser automation |
| `pixelmatch` | ^6.0.0 | ui/pixelDiff | Pixel-level image comparison |
| `pngjs` | ^7.0.0 | ui/pixelDiff | PNG read/write |
| `axios` | ^1.7.9 | api/testRunner | HTTP test execution |
| `chokidar` | ^4.0.3 | trigger/fileWatcher | File system watching |
| `express` | ^4.21.2 | trigger/webhookServer | CI webhook server |
| `zod` | ^3.24.1 | utils/config | Env validation |
| `pino` | ^9.6.0 | utils/logger | Structured logging |
| `dotenv` | ^16.4.7 | utils/config | Local env loading |

### Dev
| Package | Purpose |
|---------|---------|
| `typescript` | Compiler (strict) |
| `tsx` | Dev/runtime TS execution |
| `@types/node` | Node types |
| `@types/express` | Express types |
| `@types/pngjs` | pngjs types |

### Post-Install
```bash
npx playwright install chromium
```

---

## 3. Project Structure

```
qa-agent/
├── src/
│   ├── index.ts                  # Entry point
│   ├── orchestrator.ts           # Main QA cycle
│   ├── ui/
│   │   ├── screenshot.ts         # Playwright: capture rendered UI
│   │   ├── figma.ts              # Figma REST API: fetch design frames
│   │   ├── pixelDiff.ts          # pixelmatch: pixel-level diff
│   │   └── semanticDiff.ts       # Claude Vision: semantic diff
│   ├── api/
│   │   ├── routeParser.ts        # Parse Express route files
│   │   ├── testGenerator.ts      # Claude: generate test cases
│   │   └── testRunner.ts         # axios: execute and validate
│   ├── patcher/
│   │   ├── bugFixer.ts           # Claude: corrected source file
│   │   ├── applyPatch.ts         # Write patched file to disk
│   │   └── retryLoop.ts          # Re-test loop, max N retries
│   ├── trigger/
│   │   ├── fileWatcher.ts        # chokidar: watch routes dir
│   │   └── webhookServer.ts      # Express: POST /webhook/ci
│   └── utils/
│       ├── config.ts             # zod env validation
│       ├── types.ts              # Shared interfaces
│       └── logger.ts             # pino logger
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 4. Layer Specifications

### 4.1 UI Layer (`src/ui/`)

#### `screenshot.ts`
- Playwright Chromium, viewport **1440×900**
- Navigate to `BASE_APP_URL + route`
- Wait for `networkidle`
- Viewport PNG screenshot (not full-page)
- Save to temp dir, return file path

#### `figma.ts`
- `GET https://api.figma.com/v1/images/:file_key`
- Params: node ID, `format=png`, `scale=2`
- Header: `X-Figma-Token: FIGMA_API_TOKEN`
- Download rendered image URL as binary buffer
- Save to temp dir, return file path
- Node ID: convert URL `1-23` → API `1:23`

#### `pixelDiff.ts`
- Read both PNGs with `pngjs`
- Compare using smaller of the two dimensions
- `pixelmatch` with `threshold: 0.1`, `includeAA: false`
- Write diff image to disk
- Return mismatch ratio: `mismatchedPixels / totalPixels`

#### `semanticDiff.ts`
- Send both images as base64 via Anthropic SDK
- Prompt: senior UI QA engineer comparing rendered UI (img1) vs Figma spec (img2)
- Check: color, padding, font size/weight, border radius, missing elements, layout shifts
- Response: pure JSON array `[{ "element": string, "issue": string, "confidence": number }]`

---

### 4.2 API Layer (`src/api/`)

#### `routeParser.ts`
- Read all `.ts` and `.js` files from `ROUTES_DIR`
- Regex extract: `router.get/post/put/patch/delete('/path', ...)`
- Return: `{ method, path, filePath, handler }[]`

#### `testGenerator.ts`
- Per route: send full source + metadata to Claude
- Prompt: senior backend QA — happy path, missing fields, invalid types, boundaries, duplicates, SQL injection, unauthorized access (if auth middleware detected)
- Response: JSON array `{ name, method, path, body, headers, expectedStatus, expectedShape }`
- Strip markdown fences before parse

#### `testRunner.ts`
- Execute with axios: `validateStatus: () => true`, timeout **10s**
- Compare actual vs expected status
- If `expectedShape` provided: verify each key exists with correct JS type
- Return: `{ testCase, passed, actualStatus, actualBody, responseTime, error? }`

---

### 4.3 Patcher Layer (`src/patcher/`)

#### `bugFixer.ts`
- Read full source file from disk
- Send to Claude with bug description + context (diff or failed test)
- Return: **complete corrected file** — no diff, no fences, no explanation
- Fix described bug only — no unrelated refactoring

#### `applyPatch.ts`
- `fs.writeFileSync` patched content to original path
- Log the write

#### `retryLoop.ts`
- Input: bug report + `verifyFn: () => Promise<boolean>`
- Loop up to `MAX_PATCH_RETRIES`:
  1. Generate patch via `bugFixer`
  2. Apply via `applyPatch`
  3. Call `verifyFn()`
  4. If true → return `'fixed'`
  5. If false → append failed patch to `bug.context`, retry
- Exhausted → return `'human_review'`

---

### 4.4 Trigger Layer (`src/trigger/`)

#### `fileWatcher.ts`
- `chokidar` watch `ROUTES_DIR` recursively, ignore `node_modules`
- **2 second debounce**
- On `change`: log path, call `runFullQACycle()`

#### `webhookServer.ts`
- Express `POST /webhook/ci`
- Respond **202 Accepted** immediately
- Call `runFullQACycle()` asynchronously

---

### 4.5 Orchestrator (`src/orchestrator.ts`)

`runFullQACycle()`:

**UI phase** — for each `FIGMA_ROUTE_MAP` entry:
1. Capture screenshot
2. Fetch Figma frame
3. Pixel diff — if ratio > **2%**, run semantic diff
4. Build bug report from combined output
5. Retry patch loop; verifyFn = fresh screenshot + pixel diff
6. `'fixed'` → log success with patched file path; `'human_review'` → log warning

**API phase** — for each parsed route:
1. Generate test cases via Claude
2. Run every test case
3. On failure: bug report + retry loop; verifyFn = re-run same test
4. `'fixed'` → log success; `'human_review'` → log warning

---

### 4.6 Entry Point (`src/index.ts`)

| Arg | Action |
|-----|--------|
| `run` | `runFullQACycle()` once, exit |
| `watch` | Start file watcher |
| `webhook` | Start webhook server |
| else | Print usage, exit 1 |

---

### 4.7 Utils (`src/utils/`)

#### `config.ts`
- Load `.env` via dotenv
- Validate all env vars with zod at startup
- Missing required var → descriptive error + exit

#### `types.ts`
Shared interfaces (to implement):
- `RouteMetadata`, `TestCase`, `TestResult`
- `BugReport`, `SemanticIssue`, `PatchOutcome`
- `FIGMA_ROUTE_MAP` type

#### `logger.ts`
- Pino structured logger
- JSON-friendly output

---

## 5. Environment Variables

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
FIGMA_API_TOKEN=
FIGMA_FILE_KEY=
BASE_APP_URL=http://localhost:3000
ROUTES_DIR=../your-app/src/routes
MAX_PATCH_RETRIES=3
```

Required: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `ROUTES_DIR`. Figma and GitHub optional (see `hasFigma` / `hasGit` flags).

---

## 6. TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

---

## 7. Critical Implementation Constants

| Constant | Value |
|----------|-------|
| `PIXEL_MISMATCH_THRESHOLD` | 0.02 (2%) |
| `PIXELMATCH_THRESHOLD` | 0.1 |
| `PIXELMATCH_INCLUDE_AA` | false |
| `VIEWPORT_WIDTH` | 1440 |
| `VIEWPORT_HEIGHT` | 900 |
| `AXIOS_TIMEOUT_MS` | 10000 |
| `WATCHER_DEBOUNCE_MS` | 2000 |
| `FIGMA_IMAGE_SCALE` | 2 |

---

## 8. Security

| Concern | Mitigation |
|---------|------------|
| API keys | Env vars only; never commit `.env` |
| Patch writes | Only via `applyPatch.ts` in controlled loop |
| No auto git | Agent never commits, pushes, or opens PRs |
| Webhook | No auth in v1 — document for Phase 2 hardening |

---

## 9. Architecture Decision Records

| ID | Decision | Rationale |
|----|----------|-----------|
| ADR-001 | Flat `src/` layout over nested layers | Matches spec; simpler imports |
| ADR-002 | ESM + NodeNext resolution | Node 20+ native ESM |
| ADR-003 | tsx for dev/runtime | No build step required for CLI |
| ADR-004 | 2% pixel threshold before semantic diff | Reduce Claude Vision API costs |
| ADR-005 | Full-file patch output | Simpler apply logic than unified diffs |
| ADR-006 | axios validateStatus always true | Capture all HTTP outcomes as test results |
| ADR-007 | No automatic PRs or git ops | Human reviews patched files before commit |
| ADR-008 | Removed git layer and simple-git | PR automation out of v1 scope |

---

*Update when stack, structure, or ADRs change.*

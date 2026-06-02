# System Patterns & Anti-Bloat Guidelines

> **Purpose:** Keep the codebase compact, modular, and free of unnecessary abstraction.
> **Last updated:** 2026-06-02
> **Read with:** `systemArchitecture.md` (structure) · `productContext.md` (scope)

---

## 1. Design Philosophy

The agent is a **pipeline of stateless functions** coordinated by a single **Orchestrator** owner. Every module does one job, returns a typed result, and exits. No layer owns session state. No helper sprawl.

**Target line budget:** Prefer fixing duplication over adding files. If a new file would contain fewer than ~30 lines of non-trivial logic, inline it in the caller instead.

---

## 2. Code Condensation Principles

### No Redundant Wrappers
- Do **not** create separate helper files for operations accomplishable cleanly in **under 5 lines** of native Node.js or framework code.
- Examples to **avoid** as standalone modules:
  - `readFileAsString.ts` → use `fs.readFileSync` / `fs.promises.readFile` inline
  - `sleep.ts` → use `await new Promise(r => setTimeout(r, ms))` inline
  - `stripMarkdownFences.ts` → one regex inline at the call site in `testGenerator.ts`
- **Exception:** Logic reused in **2+ layers** → extract to `src/utils/` only.

### Shared State Architecture
- All operational state for active QA cycles lives **purely in the Orchestrator** (class instance or single session object — pick one, use consistently).
- Layers (`ui/`, `api/`, `patcher/`, `trigger/`) are **stateless functional modules**: accept inputs → return results → no instance fields, no module-level mutable caches.
- Allowed Orchestrator-owned state (examples):
  - Current run ID, start time, correlation ID
  - Active `FIGMA_ROUTE_MAP` iteration index
  - Accumulated bug reports and outcomes for the final summary
  - Retry counters scoped to the current bug (passed into `retryLoop`, not stored in patcher)
- **Forbidden:** Global singletons, module-level `let lastResult`, hidden caches inside `ui/` or `api/`.

```
Orchestrator (stateful)
    │
    ├── ui/*.ts        (stateless fn in → result out)
    ├── api/*.ts       (stateless fn in → result out)
    ├── patcher/*.ts   (stateless fn in → result out)
    └── trigger/*.ts   (stateless fn in → callback out)
```

### Fail Fast
- If any external API call (**Figma**, **Anthropic**) returns a **fatal auth error** (`401`, `403`), **exit the process immediately** with a descriptive message.
- Do **not** continue the QA loop, do **not** run empty retries, do **not** swallow and proceed to the next route.
- Auth failures are configuration errors — not recoverable at runtime.
- Implementation pattern:

```typescript
// In API client wrappers — not scattered in every call site
if (status === 401 || status === 403) {
  logger.error({ service: 'figma', status }, 'Fatal auth error — check API token');
  process.exit(1);
}
```

- **Transient errors** (429, 5xx, network timeout): retry with backoff **only** inside the dedicated client wrapper, max 2 retries, then bubble up to Orchestrator for run-level abort.

---

## 3. Directory Isolation Rules

### UI Layer Separation (`src/ui/`)
- **Only:** DOM snapshotting, Figma image fetch, pixel diff, Claude Vision semantic diff.
- **Must never:**
  - Parse Express routes or read `ROUTES_DIR`
  - Execute axios HTTP tests
  - Write patched source files
  - Import from `src/api/` or `src/patcher/`

### API Layer Separation (`src/api/`)
- **Only:** Route parsing, Claude test generation, axios test execution.
- **Must never:**
  - Launch Playwright or read PNG screenshots
  - Call Figma API
  - Write patched source files
  - Import from `src/ui/` or `src/patcher/`

### Patcher Sandboxing (`src/patcher/`)
- Operates strictly on an **isolated text buffer** — read file → patch in memory → validate → write.
- **Before overwriting live source code**, verify compile health with a dry-run subprocess:

```bash
tsc --noEmit   # against patched content written to a temp path, or project tsconfig
```

- Flow:
  1. `bugFixer` returns corrected file content (string buffer)
  2. Write buffer to **temp file** (not target path yet)
  3. Run `tsc --noEmit` (or project-equivalent) against temp / project
  4. **Pass** → `applyPatch` writes to live path
  5. **Fail** → discard buffer, append failure to `bug.context`, retry loop continues
- **Must never:**
  - Import Playwright, Figma, or route parser logic
  - Skip compile check to save time

### Trigger Layer (`src/trigger/`)
- **Only:** File watching and webhook HTTP surface.
- Delegates all QA logic to Orchestrator — no inline test or patch code.

### Utils (`src/utils/`)
- **Only:** Config, types, logger — no business logic.
- **Must never** import from `ui/`, `api/`, `patcher/`, `trigger/`, or `orchestrator.ts`.

---

## 4. Module Interface Pattern

Every layer exports **named async functions** with explicit typed signatures. No default exports. No god objects.

```typescript
// Good — ui/screenshot.ts
export async function captureScreenshot(route: string, baseUrl: string): Promise<string> {
  // returns file path
}

// Bad
export class ScreenshotService {
  private browser: Browser;
  async init() { ... }
  async capture() { ... }
}
```

Orchestrator is the **only** place allowed to use a class or hold multi-step session state.

---

## 5. Anti-Patterns (Do Not Build)

| Anti-Pattern | Why | Instead |
|--------------|-----|---------|
| Generic `BaseLayer` abstract class | Over-abstraction for 4 small modules | Plain functions per file |
| Plugin registry / dependency injection container | YAGNI for v1 CLI agent | Direct imports in Orchestrator |
| Event bus between layers | Hidden coupling, hard to trace | Orchestrator calls functions sequentially |
| Separate `errors/`, `constants/`, `helpers/` dirs | Directory sprawl | `utils/types.ts`, inline constants in owning file |
| Caching Claude responses globally | Stale plans, hidden state | Orchestrator may pass prior context explicitly |
| Wrapper around axios for every verb | Noise | One shared axios instance in `testRunner.ts` |
| Multiple logger implementations | DRY violation | Single `utils/logger.ts` |

---

## 6. File Size & Complexity Limits

| Guideline | Limit |
|-----------|-------|
| Max lines per file (excluding types/prompts) | ~150 |
| Max functions exported per file | 3 |
| Max function length | ~40 lines |
| Max cyclomatic complexity | Split if > 2 nested conditionals |

When a file exceeds limits, split **by responsibility** (not by helper extraction).

---

## 7. Claude / LLM Call Pattern

- Prompts live as **string templates** in the calling file or a co-located `prompts/` subfolder **only if** prompts exceed ~20 lines.
- One Claude call = one purpose (plan, generate tests, patch, vision diff). No mega-prompts doing multiple jobs.
- Always strip markdown fences at the parse site — no shared `parseClaudeJson.ts` unless used 3+ times.
- Pass **minimal context**: file content + bug report + retry context — not entire repo.

---

## 8. Orchestrator Responsibilities (Single Owner)

The Orchestrator alone may:

- Loop over `FIGMA_ROUTE_MAP` and parsed routes
- Decide pixel threshold → semantic diff escalation
- Invoke `retryLoop` with the correct `verifyFn`
- Aggregate outcomes and emit final run summary
- Call `process.exit` on fatal auth failures bubbled from layers

The Orchestrator must **not**:

- Implement pixel diff, axios calls, or Claude prompts inline — delegate to layers
- Grow beyond ~200 lines — extract private helpers **inside the same file** first, split only if necessary

---

## 9. Testing Pattern (When Added)

- Unit-test **stateless layer functions** with mocked I/O.
- Integration-test **Orchestrator** with stubbed Claude/Figma/Playwright — one happy path, one auth-fail fast exit.
- No test utilities directory until 3+ tests share the same setup.

---

## 10. Checklist Before Adding a New File

- [ ] Can this live in an existing file under 150 lines?
- [ ] Is it reused in 2+ layers? (If no → don't extract to `utils/`)
- [ ] Does it introduce state? (If yes → belongs in Orchestrator only)
- [ ] Does it cross layer boundaries? (If yes → redesign)
- [ ] Would removing it later be painful? (If no → probably didn't need it)

---

*Update when new patterns are adopted or anti-patterns are discovered in review.*

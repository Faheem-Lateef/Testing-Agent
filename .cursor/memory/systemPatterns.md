# System Patterns — QA Feature Engineer Agent

> **Purpose:** Keep the codebase compact, modular, and free of unnecessary abstraction.
> **Last updated:** 2026-06-02

---

## 1. Design Philosophy

The agent is a **pipeline of stateless functions** coordinated by a single **Orchestrator** owner. Every module does one job, returns a typed result, and exits. No layer owns session state. No helper sprawl.

**Target line budget:** Prefer fixing duplication over adding files. If a new file would contain fewer than ~30 lines of non-trivial logic, inline it in the caller instead.

---

## 2. Memory Bank Pattern

### The two-location rule (MANDATORY)
Every memory write MUST go to BOTH canonical locations:
- `memory-bank/` (repo root)
- `.cursor/memory/` (Cursor IDE)

**Never write to only one.** `loadMemoryBankSync()` reads both — stale content in either
location corrupts the LLM context for every subsequent run.

```typescript
// ✅ Correct — use the helper
appendToAllMemoryDirs(cwd, 'progress.md', entry);
syncToAllMemoryDirs(cwd, 'activeContext.md', content);

// ❌ Wrong — single-location write
fs.appendFileSync(path.join(cwd, 'memory-bank/progress.md'), entry);
```

### Drift detection
`checkMemoryDrift(cwd)` warns when the two locations have diverged. It is called
automatically in READING_CONTEXT before any LLM call. If drift is found, call
`syncToAllMemoryDirs()` to re-align from the authoritative source.

### Sync order
1. `loadMemoryBankSync()` — sync read, absolute first operation
2. `checkMemoryDrift()` — warn on divergence
3. `detectAgentDuplicates()` — scan src/ for file-level duplicates
4. `loadProjectMemoryBank()` — async augment
5. → LLM calls may now begin

---

## 3. Duplicate Detection Pattern

Run `detectAgentDuplicates(qaAgentRoot)` during READING_CONTEXT. It scans:
- **Name collisions:** same `basename` in multiple directories
- **Content clones:** byte-identical files at different paths (via MD5 hash)

On clean workspace: `DuplicateReport.clean === true`, no warnings.
On issues: `[DUPLICATE-DETECTOR]` prefix with explicit paths logged.

Do NOT suppress the warnings. Investigate and remove the duplicate before generating
new code for the affected module — the LLM may otherwise generate conflicting versions.

---

## 4. Code Condensation Principles

### No Redundant Wrappers
- Do **not** create separate helper files for operations accomplishable in **under 5 lines** of native Node.js.
- Examples to **avoid** as standalone modules:
  - `readFileAsString.ts` → use `fs.readFileSync` inline
  - `sleep.ts` → use `await new Promise(r => setTimeout(r, ms))` inline
- **Exception:** Logic reused in **2+ layers** → extract to `src/utils/` only.

### Shared State Architecture
- All operational state lives **purely in the Orchestrator** (or the FSM for feature engineer).
- Layers are **stateless functional modules**: accept inputs → return results.
- **Forbidden:** Global singletons, module-level mutable caches outside `config.ts`.

---

## 5. Environment Pattern

### Config mutations require cache reset
After any `process.env[key] = value` assignment, ALWAYS call `resetConfigCache()`
so the next `loadConfig()` picks up the new value:

```typescript
process.env['OPENROUTER_MODEL'] = newModel;
resetConfigCache();
// loadConfig() will now return the new model
```

### Non-fatal defaults
Missing env vars that have sensible defaults (ROUTES_DIR, BASE_APP_URL, OPENROUTER_MODEL)
use `.default()` in zod schema — never `process.exit`. Only `OPENROUTER_API_KEY` is
truly required (no fallback possible).

---

## 6. FSM Pattern

The Feature Engineer uses a type-safe FSM (`FeatureEngineerFsm`). Transitions are
explicit and logged. Invalid transitions throw — they should never be silently ignored.

Key states where agent is blocked on I/O:
- `READING_CONTEXT` — file reads, memory drift, dup scan
- `COMPILING` — tsc subprocess
- `TESTING` — Playwright subprocess

---

## 7. Fail-Safe Execution

Every major execution path (feature engineer, backend run, frontend run) is wrapped in
`try/finally`. The `finally` block calls `writeProgressLog()` unconditionally.

```typescript
try {
  result = await runFeatureEngineer(spec, options);
} finally {
  writeProgressLog({ ...result, qaAgentRoot });
}
```

This guarantees the progress log is always updated, even if the agent crashes mid-run.

---

## 8. Anti-Patterns (Do Not Build)

| Anti-Pattern | Why | Instead |
|---|---|---|
| Write progress to only one memory location | LLM reads both; stale context corrupts runs | Use `appendToAllMemoryDirs()` |
| Skip `checkMemoryDrift` | Silent context drift is hard to debug | Keep it in READING_CONTEXT |
| Generate code without dup scan | May create second copy of a module | Always run `detectAgentDuplicates` first |
| `process.env` mutation without `resetConfigCache()` | Config reads stale cache | Always pair mutations with reset |
| Module-level mutable state | Hidden coupling | Orchestrator-owned state only |
| Generic BaseLayer abstract class | Over-abstraction | Plain functions per file |

---

## 9. File Size & Complexity Limits

| Guideline | Limit |
|-----------|-------|
| Max lines per file (excluding types/prompts) | ~150 |
| Max functions exported per file | 3–5 |
| Max function length | ~40 lines |

When a file exceeds limits, split **by responsibility** (not by helper extraction).

---

## 10. Checklist Before Adding a New File

- [ ] Can this live in an existing file under 150 lines?
- [ ] Is it reused in 2+ layers? (If no → don't extract to `utils/`)
- [ ] Does it introduce state? (If yes → belongs in Orchestrator only)
- [ ] Does it cross layer boundaries? (If yes → redesign)
- [ ] Run `detectAgentDuplicates` — does a file with this name already exist?

---

*Update when new patterns are adopted or anti-patterns are discovered in review.*

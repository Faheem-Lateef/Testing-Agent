# Product Context — QA Feature Engineer Agent

> **Status:** 4-phase Feature Engineer lifecycle complete
> **Last updated:** 2026-06-02

---

## 1. Vision

Build a **Node.js/TypeScript autonomous agent** that performs two roles:

### Role A — Autonomous Feature Engineer
Given a natural-language feature spec, the agent:
1. **Develops** — Generates complete, compilable full-stack code (backend Express + frontend React/Next)
2. **Tests** — Dynamically writes and executes Playwright E2E tests for the feature
3. **Self-heals** — Analyzes test failures, patches code, re-tests (up to 4 heal cycles)
4. **Reports** — Structured engineering report: dev log, test compliance, patch summary

### Role B — QA Regression Agent (original capability)
1. **Visual regression testing** — Screenshot vs Figma pixel diff + Claude Vision semantic diff
2. **API test generation** — Parse Express routes → generate → execute → validate
3. **Self-healing patch loop** — Bug found → Claude patch → verify → PR (local only)

---

## 2. Primary Workflows

### WF-1: Feature Engineering
```bash
tsx src/index.ts engineer "Add user login with JWT"
# or interactive:
tsx src/index.ts run  →  select "Engineer a feature"
```

Flow:
```
READING_CONTEXT (memory + drift check + dup scan)
  → PHASE_1: LLM generates backend + frontend code
  → tsc --noEmit (compile gate, max 3 attempts)
  → PHASE_2: LLM generates Playwright E2E test → src/ui/generated/
  → PHASE_3: Playwright executes test → passes __FEATURE_RESULT__ JSON
  → PHASE_4: Engineering report printed
  → [on failure] DEBUGGING: LLM generates targeted patch → re-test (max 4 cycles)
  → finally: writeProgressLog() → both memory-bank/ and .cursor/memory/
```

### WF-2: Blank-Canvas Start
When backend/frontend directories are empty:
```
scaffoldWorkspaceIfBlank() creates minimal TS project structure
  → isBlankCanvas: true → LLM prompt requests COMPLETE application (not incremental)
  → ROUTES_DIR / BASE_APP_URL / FRONTEND_APP_URL auto-injected
  → npm install --save-dev typescript @types/node bootstrap
```

### WF-3: AI Model Hot-Swap
```bash
tsx src/index.ts run  →  select "⚙ Switch Active AI Model"
# Options: Gemini 2.5 Flash | Claude 3.5 Sonnet | GPT-4o Mini
# Persisted to .env immediately
```

### WF-4: QA Cycle (legacy)
```bash
tsx src/index.ts run  →  select "Backend" | "Frontend" | "Full-stack"
```

---

## 3. CLI Commands

```bash
tsx src/index.ts run                    # Interactive menu
tsx src/index.ts engineer "<spec>"      # Direct feature engineering
tsx src/index.ts watch                  # File-watcher triggered QA
tsx src/index.ts webhook                # CI webhook server
```

---

## 4. v1 Scope

- ✅ Feature engineering (4-phase lifecycle)
- ✅ Blank-canvas project scaffolding
- ✅ AI model default + hot-swap
- ✅ Dual-location memory bank (memory-bank/ + .cursor/memory/)
- ✅ Duplicate file detection
- ✅ Visual regression testing (screenshot vs Figma)
- ✅ API test generation and execution
- ✅ Self-healing patch loop
- ✅ Self-evolution meta-review loop
- ❌ Phase 2: Slack notifications, SQLite history, multi-env (deferred)

---

## 5. Key Business Rules

| Rule | Value |
|------|-------|
| Memory writes | Always both `memory-bank/` AND `.cursor/memory/` |
| Model default | `google/gemini-2.5-flash` (auto-applied if `OPENROUTER_MODEL` missing) |
| Max heal attempts | 4 (`MAX_HEAL_ATTEMPTS`) |
| Max compile attempts | 3 (`MAX_COMPILE_ATTEMPTS`) |
| Max evolution generations | 3 |
| tsc gate | Always before writing to live source files |
| Progress log | Always written in `finally` block — never skipped |
| Git / PR | Never automatic — human reviews patched files manually |

---

*Update when product scope, workflows, or Phase 2 priorities change.*

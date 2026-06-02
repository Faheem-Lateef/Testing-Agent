# Product Context — Autonomous Full-Stack QA Agent

> **Status:** Phase 1 scaffolding complete — implementation pending
> **Last updated:** 2026-06-02

---

## 1. Vision

Build a **Node.js/TypeScript autonomous QA agent** that automatically performs three core capabilities:

1. **Visual regression testing** — Captures screenshots of the running app, fetches matching Figma design frames, diffs them pixel-by-pixel and semantically via Claude Vision, and reports exactly what's wrong and where.
2. **API test generation and execution** — Reads every Express route file, uses Claude to generate comprehensive test cases (happy path, edge cases, injection attempts, missing fields), fires them with axios, and validates status codes and response shapes.
3. **Self-healing patch loop** — When a bug is found, sends the source file + bug description to Claude, gets a corrected file back, writes it to disk, re-runs the failing test, and logs the outcome. Retries up to N times before flagging for human review. **Patches stay local — no automatic commits or PRs.**

### What Success Looks Like
- A developer runs `tsx src/index.ts run` and the agent autonomously finds UI mismatches vs Figma, API failures, patches code locally, and verifies fixes.
- Confirmed fixes are logged with file paths changed — the developer reviews and commits manually.
- Failures requiring human judgment are logged with full context — never silently ignored.
- CI can trigger the agent via webhook without timing out (`202 Accepted` + async run).

### v1 Scope Boundaries
- ✅ Visual diff (pixel + semantic), API test gen/run, self-healing patch loop (local only)
- ✅ Triggers: one-shot CLI, file watcher, CI webhook
- ❌ Automatic GitHub PR creation, git commit, or push
- ❌ Phase 2: Slack notifications, SQLite history, baseline CLI, response time budgets, multi-env (documented but deferred)

---

## 2. Problem Statement

| Pain Point | Agent Solution |
|------------|----------------|
| UI drift from Figma goes unnoticed | Automated screenshot vs design diff with Claude Vision analysis |
| API tests are manually written and stale | Claude generates tests from live route source on every run |
| Bug fixes require manual dev loop | Self-healing patch loop with verification (local file write) |
| QA doesn't integrate with CI | Webhook trigger with async execution |
| Route changes aren't re-tested automatically | chokidar file watcher on `ROUTES_DIR` |

---

## 3. Core Capabilities (The Three Pillars)

### Pillar 1 — Visual Regression
```
App route → Playwright screenshot → Figma frame fetch → pixelmatch diff
  → if mismatch > 2% → Claude Vision semantic diff → bug report → patch loop
```

### Pillar 2 — API Testing
```
Route files → regex parse → Claude test generation → axios execution
  → failed test → bug report → patch loop → re-run same test as verify
```

### Pillar 3 — Self-Healing (Local Only)
```
Bug report → Claude full-file patch → write to disk → verifyFn()
  → pass: 'fixed' (log success) | fail: append to context, retry (max N) | exhaust: 'human_review'
```

---

## 4. Module Map

| Directory | Responsibility |
|-----------|----------------|
| `src/ui/` | Browser capture, Figma fetch, pixel + semantic diff |
| `src/api/` | Route parsing, test generation, test execution |
| `src/patcher/` | Bug fixing, file write, retry loop |
| `src/trigger/` | File watcher, webhook server |
| `src/utils/` | Config (zod), types, logger |
| `src/orchestrator.ts` | Wires full QA cycle |
| `src/index.ts` | CLI: `run` \| `watch` \| `webhook` |

---

## 5. Primary Workflows

### WF-1: One-Shot QA Cycle (`run`)
```
index.ts run → orchestrator.runFullQACycle()
  → UI loop (FIGMA_ROUTE_MAP entries)
  → API loop (all parsed routes)
  → patch loop on failures; log fixed / human_review outcomes
```

### WF-2: File Watch (`watch`)
```
chokidar on ROUTES_DIR (2s debounce) → runFullQACycle()
```

### WF-3: CI Webhook (`webhook`)
```
POST /webhook/ci → 202 Accepted → runFullQACycle() async
```

---

## 6. Input / Output

### Inputs (Environment)
| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API (Vision, test gen, patching) |
| `FIGMA_API_TOKEN` | Figma REST API auth |
| `FIGMA_FILE_KEY` | Target Figma file |
| `BASE_APP_URL` | Running app URL (default `http://localhost:3000`) |
| `ROUTES_DIR` | Express routes directory |
| `MAX_PATCH_RETRIES` | Patch loop limit (default `3`) |

### Outputs
| Output | When |
|--------|------|
| Success log | Bug fixed and verified (`'fixed'`) — lists patched file paths |
| Warning log | `human_review` after retries exhausted |
| Temp artifacts | Screenshots, diffs, Figma frames |

---

## 7. Key Business Rules

| Rule | Value |
|------|-------|
| Pixel mismatch threshold | **2%** — below ignore, above triggers semantic diff + patch |
| Patch retries | `MAX_PATCH_RETRIES` (default 3) |
| Git / PR | **Never automatic** — human reviews and commits patched files |
| Failed patch context | Append failed file content to `bug.context` on each retry |
| HTTP test capture | All status codes valid (`validateStatus: () => true`) |

---

## 8. CLI Usage

```bash
tsx src/index.ts run        # one-shot QA cycle
tsx src/index.ts watch      # trigger on file changes
tsx src/index.ts webhook    # listen for CI POST events
```

---

## 9. Phase 2 Roadmap (Deferred)

- [ ] Optional GitHub PR helper (manual trigger only, not automatic)
- [ ] Slack notification on `human_review` with diff image
- [ ] SQLite test run history and flaky test tracking
- [ ] Snapshot baseline CLI — accept new Figma design as baseline
- [ ] `expectedMaxMs` response time budget on test cases
- [ ] `--env staging|production` multi-environment support

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **FIGMA_ROUTE_MAP** | Object mapping app routes (`'/login'`) to Figma node IDs (`'1:23'`) |
| **Bug report** | Structured object describing failure + source file + context |
| **verifyFn** | Async function re-running the failing check; returns boolean |
| **fixed** | Patch applied and verification passed — logged, not committed |
| **human_review** | Patch loop exhausted retries — needs human intervention |
| **Semantic diff** | Claude Vision comparison of screenshot vs Figma frame |

---

*Update when product scope, workflows, or Phase 2 priorities change.*

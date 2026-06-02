---
name: qa-feature-engineer
description: Autonomous Feature Engineer — full-stack development, dynamic Playwright tests, self-healing debugger, and engineering reports. Use for `tsx src/index.ts engineer "<spec>"` or extending the 4-phase lifecycle in src/orchestrator/featureEngineer.ts.
---

# QA Feature Engineer

Autonomous **Developer + QA Tester + Self-Healing Debugger** orchestrated by `src/orchestrator/featureEngineer.ts`.

## Run

```bash
tsx src/index.ts engineer "Add a coupon system: 10% off second purchase after first order"
```

Optional env: `ROUTES_DIR`, `FRONTEND_APP_URL`, `GIT_REPO_ROOT`. Backend/frontend default to `backend demo/ecommerce-*` or sibling `../ecommerce-*`.

## 4-Phase Lifecycle

| Phase | Module | Behavior |
|-------|--------|----------|
| **1 — Development** | `phase1Development.ts`, `openRouterPhases.ts`, `compilerSandbox.ts` | Analyze repos, inject `backend:` / `frontend:` files, compile all three targets (max **3** attempts) |
| **2 — Test architecture** | `phase2TestGen.ts` | OpenRouter writes `src/ui/generated/feature-{slug}.test.ts` (feature-specific Playwright journey) |
| **3 — Self-healing** | `phase3Runner.ts` | Run test via `npx tsx` (`headless: false`, `slowMo: 150` in generated script); heal bugs up to **4** cycles |
| **4 — Reporting** | `phase4Report.ts` | `[DEVELOPMENT LOG]`, `[TEST COMPLIANCE]`, `[PATCH SUMMARY]` |

## Limits

- `MAX_COMPILE_ATTEMPTS = 3` (Phase 1)
- `MAX_HEAL_ATTEMPTS = 4` (Phase 3)
- `MAX_EVOLUTION_ATTEMPTS` — deprecated alias for compile attempts

## Modules

| Path | Role |
|------|------|
| `featureEngineer/memoryBank.ts` | `.cursorrules`, `memory-bank/activeContext.md` |
| `featureEngineer/repoAnalyzer.ts` | Backend/frontend `src/` scan |
| `featureEngineer/codeAnchors.ts` | Anchor injection + full-file replace |
| `featureEngineer/fsm.ts` | States including `GENERATING_TESTS`, `REPORTING` |
| `featureEngineer/logging.ts` | `phaseLog`, `devLog`, `testLog`, `patchLog` |

Generated tests must print `__FEATURE_RESULT__` + JSON for the runner parser.

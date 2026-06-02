# Active Context — QA Feature Engineer Agent

> Canonical mirror: also see `memory-bank/activeContext.md` at repo root.
> **Last updated:** 2026-06-03
> Last run: (pending — auto-stamped after next agent run)

## Stack anchors

- **API prefix:** `/api/v1` (Express marketplace backend)
- **Database:** MongoDB via Mongoose
- **Errors:** `AppError` + `errorHandler` middleware
- **Frontend:** Next.js App Router, Tailwind CSS, LUXE design tokens
- **QA agent:** Node 20+ ESM, TypeScript strict, multi-provider AI (`temperature: 0.1`)

## Memory Bank Auto-Sync (HARDCODED)

Every agent memory write goes to BOTH:
- `memory-bank/` (repo root)
- `.cursor/memory/` (Cursor IDE)

Feature runs also write to **external project** `memory-bank/` via `finalizeProjectMemoryUpdate()`.

## AI provider & model configuration (multi-provider)

- **Any supported API key** via `AI_API_KEY` (auto-detects provider from prefix)
- Also accepts: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`
- Routing: `src/utils/providerRouter.ts` → correct base URL per provider
- **OpenRouter** `sk-or-…` | **Google** `AIza…` | **OpenAI** `sk-…` | **Anthropic** `sk-ant-…` | **Groq** `gsk_…`
- Override: `AI_PROVIDER=openrouter|google|openai|groq|anthropic`
- Defaults + hot-swap: `src/cli/modelConfig.ts` (provider-specific model menu)
- Startup: `🌐 [AI-PROVIDER]` + `printActiveModelLine()`

## External project sandbox

Generated apps live **outside** `d:\sqa` (sibling folder). Project memory at `<project>/memory-bank/`.

## Module map (key paths)

| Path | Role |
|------|------|
| `utils/providerRouter.ts` | Multi-provider key detect + API routing |
| `cli/modelConfig.ts` | Provider-aware model defaults + hot-swap |
| `orchestrator/featureEngineer/sandbox.ts` | External workspace isolation |
| `orchestrator/featureEngineer/memoryBank.ts` | `finalizeAgentMemoryUpdate` / `finalizeProjectMemoryUpdate` |

## Constraints

- Feature runs update external + agent memory in `finally`
- QA runs update agent memory only
- `loadMemoryBankSync()` is always the first operation

# Active Context — Memory Bank (repo root)

> Canonical mirror for the Feature Engineer. Also see `.cursor/memory/activeContext.md`.

## Stack anchors

- **API prefix:** `/api/v1` (Express marketplace backend)
- **Database:** MongoDB via Mongoose
- **Errors:** `AppError` + `errorHandler` middleware
- **Frontend:** Next.js App Router, Tailwind CSS, LUXE design tokens (`glass`, `accent`, Syne font)
- **QA agent:** Node 20+ ESM, TypeScript strict, OpenRouter `temperature: 0.1`

## Backend layout

- Routes aggregator: `src/routes/index.ts` — register feature routers with `router.use('...', featureRouter)`
- Services/controllers/repositories pattern under `src/`

## Constraints

- KISS / DRY — minimal additive diffs
- No blind full-file regex replacement for injections
- Compile gate: `npm run build` or `tsc --noEmit` after every write

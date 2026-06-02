# Autonomous Full-Stack QA Agent

An autonomous QA agent for **Express backends**. It discovers routes, runs live HTTP tests against your running API, optionally auto-fixes failures with OpenRouter, and prints a summary of errors and fixes.

For a deeper capability overview, see [docs/SQA_AGENT_CAPABILITIES.md](docs/SQA_AGENT_CAPABILITIES.md).

---

## Requirements

- **Node.js 20+**
- A **running Express API** (the agent sends real HTTP requests — it does not start your server)
- An **[OpenRouter](https://openrouter.ai/) API key** (for LLM test generation and auto-fix)

---

## Quick start

### 1. Install dependencies

```bash
npm install
```

Install Playwright browsers (only needed for UI/Figma regression):

```bash
npx playwright install chromium
```

### 2. Configure environment

Copy the example env file and add your OpenRouter credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENROUTER_API_KEY=your-key-here
OPENROUTER_MODEL=anthropic/claude-sonnet-4
AUTO_FIX_ON_FAILURE=true
```

That is the minimum. Route paths and app URL are **auto-discovered** when you paste a backend into this repo (see below).

### 3. Add your backend

Place any Express project in this directory, for example:

```
sqa/
├── ecommerce-backend/     ← your API
│   ├── src/routes/
│   ├── package.json
│   └── .env               ← PORT=3001 etc.
├── src/                   ← QA agent (do not move)
├── .env                   ← agent config
└── README.md
```

Supported route locations (first match wins):

- `src/routes`
- `routes`
- `src/api/routes`
- `app/routes`

The backend must list `express` in `package.json` dependencies.

### 4. Start your backend

In a **separate terminal**, run the target API:

```bash
cd ecommerce-backend
npm install
npm run dev
```

Confirm it responds (adjust port if needed):

```bash
curl http://localhost:3001/health
```

### 5. Run the agent

```bash
# Optional — see which backend was detected
npm run discover

# Full cycle: discover → test all routes → fix failures → summary
npm run run
```

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run run` | One full QA cycle (recommended) |
| `npm run discover` | List Express backends found in this directory |
| `npm run watch` | Re-run QA when route files change (2s debounce) |
| `npm run webhook` | Start webhook server on port 4040 (`POST /webhook/ci`) |
| `npm run typecheck` | TypeScript check |

Equivalent direct invocation:

```bash
npx tsx src/index.ts run
npx tsx src/index.ts discover
npx tsx src/index.ts watch
npx tsx src/index.ts webhook
```

---

## What happens on `run`

1. **Auto-discover** — Finds your backend folder, `ROUTES_DIR`, `BASE_APP_URL` (from backend `PORT`), and `GIT_REPO_ROOT`.
2. **Scan routes** — Parses every Express route in the routes directory.
3. **Test** — Runs domain-ordered API tests (auth → catalog → cart/order) via live Axios calls.
4. **E2E scenario** — If the API looks like an e-commerce app, runs signup → product → cart → order flows.
5. **Auto-fix** — On failures where a **success response was expected** (or on **5xx**), patches the target file via OpenRouter, compiles, and retests (up to `MAX_PATCH_RETRIES`).
6. **Report** — Prints **ERRORS FOUND & FIXES** and a **FINAL REPORT** to the console.

Example final output:

```
────────────────── ERRORS FOUND & FIXES ──────────────────
1. POST /api/v1/orders
   Error    : Expected 201, got 400
   File     : ecommerce-backend/src/services/orderService.ts
   Outcome  : fixed (1 attempt(s))

           INTEGRATION TEST RUN — FINAL REPORT
  Endpoints discovered     : 27
  Tests passed             : 56
  Tests failed             : 0
```

---

## Environment variables

### Required

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_MODEL` | Model id, e.g. `anthropic/claude-sonnet-4` |

### Auto-discovered (override if needed)

| Variable | Description |
|----------|-------------|
| `ROUTES_DIR` | Path to Express route files |
| `BASE_APP_URL` | Base URL of running API, e.g. `http://localhost:3001` |
| `GIT_REPO_ROOT` | Root of the backend repo (where patches are written) |
| `BACKEND_DIR` | Subfolder name when multiple backends exist, e.g. `ecommerce-backend` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_FIX_ON_FAILURE` | `true` | Patch and retest when tests fail |
| `MAX_PATCH_RETRIES` | `3` | Max patch attempts per failure |
| `FIGMA_API_TOKEN`, `FIGMA_FILE_KEY` | — | Enable UI regression vs Figma |
| `FIGMA_ROUTE_MAP`, `FIGMA_SOURCE_MAP` | `{}` | UI route → Figma node / source file |
| `GITHUB_TOKEN`, `GITHUB_REPO_*` | — | Open PR after verified fix |
| `WEBHOOK_PORT` | `4040` | Webhook server port |

---

## Example: ecommerce-backend

This repo includes a sample backend at `ecommerce-backend/`.

**Terminal 1 — API**

```bash
cd ecommerce-backend
npm run dev
```

**Terminal 2 — QA agent**

```bash
cd ..
npm run run
```

If port 3000 is busy, set `PORT=3001` in `ecommerce-backend/.env`. The agent reads that port during auto-discovery. You can also set explicitly in the agent `.env`:

```env
BASE_APP_URL=http://localhost:3001
BACKEND_DIR=ecommerce-backend
```

---

## Multiple backends

If more than one Express app exists in this directory, the agent uses the **first** one found. Pin a specific app:

```env
BACKEND_DIR=my-api
```

Or set paths manually:

```env
ROUTES_DIR=my-api/src/routes
BASE_APP_URL=http://localhost:4000
GIT_REPO_ROOT=my-api
```

---

## Watch mode (development)

Re-run the full QA cycle whenever route files change:

```bash
npm run watch
```

Requires `ROUTES_DIR` (auto-discovered on first `run` or set in `.env`). Keep your backend server running.

---

## Webhook mode (CI)

Start the webhook listener:

```bash
npm run webhook
```

Trigger a QA cycle from CI:

```bash
curl -X POST http://localhost:4040/webhook/ci
```

Returns `202 Accepted` immediately; the cycle runs in the background.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ROUTES_DIR is required` | Paste a backend with route files, or run `npm run discover`, or set `ROUTES_DIR` in `.env` |
| `Server unreachable` / status `0` | Start your backend; check `BASE_APP_URL` and port |
| OpenRouter `402` credits | Add credits at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) — tests still run with smoke/flow fallback; auto-fix needs credits |
| MongoDB / DB connection failed | Start database or fix backend `.env` (agent tests the API, not the DB directly) |
| Patches not picked up | Use a dev server with hot reload (`tsx watch`, `nodemon`) or restart the backend after patches |
| Wrong backend selected | Set `BACKEND_DIR` in agent `.env` |

---

## Project layout

```
src/
├── index.ts              CLI entry
├── orchestrator.ts       Wires UI + API phases
├── api/                  Route parsing, tests, E2E, auto-heal, reports
├── patcher/              OpenRouter patches + retry loop
├── trigger/              File watcher + webhook
├── ui/                   Playwright + Figma (optional)
└── utils/                Config, logger, backend discovery
```

---

## License

MIT

import { runFullQACycle } from './orchestrator.js';
import { runDiscoverCommand } from './discover.js';
import { startFileWatcher } from './trigger/fileWatcher.js';
import { startWebhookServer } from './trigger/webhookServer.js';
import { prepareEnvironment } from './utils/prepareEnvironment.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

const USAGE = `
qa-agent — Autonomous full-stack QA agent

Usage:
  tsx src/index.ts run        Auto-discover backend, test all routes, fix & summarize
  tsx src/index.ts discover   List Express backends detected in this directory
  tsx src/index.ts watch      Watch route files for changes
  tsx src/index.ts webhook    Start CI webhook server (POST /webhook/ci)

Paste any Express backend into this folder (e.g. ./my-api with src/routes).
Only OPENROUTER_API_KEY and OPENROUTER_MODEL are required in .env — routes are auto-discovered.

Optional:
  BACKEND_DIR=my-api          Pick backend when multiple are present
  AUTO_FIX_ON_FAILURE=true    Patch and retest on failures (default true)
`.trim();

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'discover') {
    await runDiscoverCommand();
    return;
  }

  await prepareEnvironment();

  switch (command) {
    case 'run':
      loadConfig();
      await runFullQACycle();
      break;
    case 'watch':
      loadConfig();
      await startFileWatcher();
      break;
    case 'webhook':
      loadConfig();
      await startWebhookServer();
      break;
    default:
      logger.error({ command: command ?? '(none)' }, 'Invalid command');
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Unhandled fatal error');
  process.exit(1);
});

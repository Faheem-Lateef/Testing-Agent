import chokidar from 'chokidar';

import { runFullQACycle } from '../orchestrator.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const DEBOUNCE_MS = 2000;

export async function startFileWatcher(): Promise<void> {
  const { ROUTES_DIR } = loadConfig();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  logger.info({ routesDir: ROUTES_DIR }, 'Starting file watcher');

  const watcher = chokidar.watch(ROUTES_DIR, {
    ignored: /node_modules/,
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', (filePath) => {
    logger.info({ filePath }, 'Route file changed');
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runFullQACycle().catch((err) => {
        logger.error({ err }, 'QA cycle failed after file change');
      });
    }, DEBOUNCE_MS);
  });

  watcher.on('error', (err) => {
    logger.error({ err }, 'File watcher error');
  });
}

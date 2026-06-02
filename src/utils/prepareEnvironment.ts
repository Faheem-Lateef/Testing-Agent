import { config as loadDotenv } from 'dotenv';

import { applyBackendDiscovery } from './backendDiscovery.js';
import { logger } from './logger.js';

/**
 * Auto-fill ROUTES_DIR, GIT_REPO_ROOT, and BASE_APP_URL from a pasted backend folder.
 * Call before loadConfig() when .env omits route paths.
 */
export async function prepareEnvironment(cwd: string = process.cwd()): Promise<void> {
  loadDotenv();

  if (process.env['ROUTES_DIR']?.trim()) {
    return;
  }

  const discovered = await applyBackendDiscovery(cwd);
  if (!discovered) {
    logger.warn(
      'No backend auto-discovered — set ROUTES_DIR manually or paste an Express app with src/routes',
    );
    return;
  }

  process.env['ROUTES_DIR'] = discovered.routesDir;
  process.env['GIT_REPO_ROOT'] = process.env['GIT_REPO_ROOT'] ?? discovered.rootPath;
  process.env['BASE_APP_URL'] = process.env['BASE_APP_URL'] ?? discovered.baseAppUrl;

  logger.info(
    {
      backend: discovered.name,
      routesDir: discovered.routesDir,
      baseAppUrl: process.env['BASE_APP_URL'],
      gitRepoRoot: process.env['GIT_REPO_ROOT'],
    },
    'Environment prepared from auto-discovery',
  );
}

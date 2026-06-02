import { discoverBackends } from './utils/backendDiscovery.js';
import { prepareEnvironment } from './utils/prepareEnvironment.js';
import { logger } from './utils/logger.js';

export async function runDiscoverCommand(cwd: string = process.cwd()): Promise<void> {
  await prepareEnvironment(cwd);
  const backends = await discoverBackends(cwd);

  if (backends.length === 0) {
    logger.error('No Express backends with route files found in this directory.');
    logger.info('Paste your backend as a subfolder (e.g. ./my-api) with src/routes/*.ts');
    process.exit(1);
  }

  logger.info(`Found ${backends.length} backend(s):`);
  for (const b of backends) {
    logger.info(
      {
        name: b.name,
        routesDir: b.routesDir,
        baseAppUrl: b.baseAppUrl,
        rootPath: b.rootPath,
      },
      `Backend: ${b.name}`,
    );
  }
}

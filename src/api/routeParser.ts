import fs from 'node:fs/promises';
import path from 'node:path';

import { logger } from '../utils/logger.js';
import type { HttpMethod, RouteMetadata } from '../utils/types.js';

const ROUTE_PATTERNS = [
  /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*(\w+))?/gi,
  /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*(\w+))?/gi,
];

const HTTP_METHODS = new Set<string>(['get', 'post', 'put', 'patch', 'delete']);

async function collectRouteFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ROUTES_DIR "${dir}": ${message}`);
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...(await collectRouteFiles(fullPath)));
    } else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractRoutesFromSource(source: string, filePath: string): RouteMetadata[] {
  const routes: RouteMetadata[] = [];
  const seen = new Set<string>();

  for (const pattern of ROUTE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const methodRaw = match[1];
      const routePath = match[2];
      if (!methodRaw || !routePath) continue;

      const method = methodRaw.toUpperCase() as HttpMethod;
      if (!HTTP_METHODS.has(methodRaw.toLowerCase())) continue;

      const key = `${method}:${routePath}:${filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      routes.push({
        method,
        path: routePath,
        filePath,
        handler: match[3] ?? 'anonymous',
      });
    }
  }

  return routes;
}

export async function parseRoutes(routesDir: string): Promise<RouteMetadata[]> {
  logger.debug({ routesDir }, 'Scanning route files');
  const files = await collectRouteFiles(routesDir);
  const allRoutes: RouteMetadata[] = [];

  for (const filePath of files) {
    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ filePath, err: message }, 'Skipping unreadable route file');
      continue;
    }
    allRoutes.push(...extractRoutesFromSource(source, filePath));
  }

  logger.info({ fileCount: files.length, routeCount: allRoutes.length }, 'Route scan complete');
  return allRoutes;
}

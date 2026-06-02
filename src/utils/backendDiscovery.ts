import fs from 'node:fs/promises';
import path from 'node:path';

import { logger } from './logger.js';

export interface DiscoveredBackend {
  name: string;
  rootPath: string;
  routesDir: string;
  port: number;
  baseAppUrl: string;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'src',
  'dist',
  'docs',
  '.cursor',
  '.git',
  'terminals',
]);

const ROUTE_DIR_CANDIDATES = [
  'src/routes',
  'routes',
  'src/api/routes',
  'app/routes',
];

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function hasRouteFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((name) => /\.(ts|js|mjs|cjs)$/.test(name));
  } catch {
    return false;
  }
}

async function readPortFromEnv(backendRoot: string): Promise<number> {
  const envPath = path.join(backendRoot, '.env');
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    const match = content.match(/^PORT=(\d+)/m);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  } catch {
    // no .env
  }
  return 3000;
}

async function resolveRoutesDir(backendRoot: string): Promise<string | null> {
  for (const candidate of ROUTE_DIR_CANDIDATES) {
    const full = path.join(backendRoot, candidate);
    if ((await pathExists(full)) && (await hasRouteFiles(full))) {
      return full;
    }
  }
  return null;
}

async function inspectBackendDir(dirPath: string, name: string): Promise<DiscoveredBackend | null> {
  const pkgPath = path.join(dirPath, 'package.json');
  if (!(await pathExists(pkgPath))) return null;

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return null;
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const isExpress = deps && ('express' in deps);
  if (!isExpress) return null;

  const routesDir = await resolveRoutesDir(dirPath);
  if (!routesDir) return null;

  const port = await readPortFromEnv(dirPath);
  return {
    name,
    rootPath: dirPath,
    routesDir,
    port,
    baseAppUrl: `http://localhost:${port}`,
  };
}

export async function discoverBackends(workspaceRoot: string): Promise<DiscoveredBackend[]> {
  const found: DiscoveredBackend[] = [];

  const rootBackend = await inspectBackendDir(workspaceRoot, path.basename(workspaceRoot));
  if (rootBackend) found.push(rootBackend);

  let entries;
  try {
    entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const dirPath = path.join(workspaceRoot, entry.name);
    const backend = await inspectBackendDir(dirPath, entry.name);
    if (backend) found.push(backend);
  }

  return found;
}

export async function applyBackendDiscovery(workspaceRoot: string): Promise<DiscoveredBackend | null> {
  const explicitDir = process.env['BACKEND_DIR']?.trim();
  if (explicitDir) {
    const resolved = path.resolve(workspaceRoot, explicitDir);
    const backend = await inspectBackendDir(resolved, path.basename(resolved));
    if (backend) return backend;
    logger.warn({ backendDir: explicitDir }, 'BACKEND_DIR set but no Express routes found');
  }

  const backends = await discoverBackends(workspaceRoot);
  if (backends.length === 0) return null;

  if (backends.length > 1) {
    logger.info(
      { backends: backends.map((b) => b.name) },
      'Multiple backends found — using the first match (set BACKEND_DIR to override)',
    );
  }

  const selected = backends[0]!;
  logger.info(
    {
      backend: selected.name,
      routesDir: selected.routesDir,
      baseAppUrl: selected.baseAppUrl,
    },
    'Auto-discovered backend',
  );
  return selected;
}

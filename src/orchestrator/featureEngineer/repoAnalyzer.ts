import fs from 'node:fs/promises';
import path from 'node:path';

import { pathExists } from './compilerSandbox.js';
import { phaseLog } from './logging.js';

async function listFiles(dir: string, depth = 0, maxDepth = 3): Promise<string[]> {
  if (depth > maxDepth) return [];
  const out: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.next') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await listFiles(full, depth + 1, maxDepth)));
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(full);
      }
    }
  } catch {
    return out;
  }
  return out;
}

async function readSnippet(filePath: string, maxChars = 2_000): Promise<string> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return text.slice(0, maxChars);
  } catch {
    return '';
  }
}

export interface RepoSnapshot {
  backendRoot: string;
  frontendRoot: string;
  summary: string;
  backendFiles: string[];
  frontendFiles: string[];
}

export async function analyzeRepositories(
  backendRoot: string,
  frontendRoot: string,
): Promise<RepoSnapshot> {
  phaseLog('PHASE_1_DEVELOPMENT', 'Analyzing ecommerce-backend and ecommerce-frontend repositories…');

  const backendFiles = (await pathExists(backendRoot))
    ? (await listFiles(path.join(backendRoot, 'src'))).map((f) => path.relative(backendRoot, f))
    : [];

  const frontendFiles = (await pathExists(frontendRoot))
    ? (await listFiles(path.join(frontendRoot, 'src'))).map((f) => path.relative(frontendRoot, f))
    : [];

  const routeIndex = path.join(backendRoot, 'src', 'routes', 'index.ts');
  const checkoutPage = path.join(frontendRoot, 'src', 'app', 'checkout', 'page.tsx');
  const orderService = path.join(backendRoot, 'src', 'services', 'orderService.ts');

  const snippets = [
    await readSnippet(routeIndex),
    await readSnippet(checkoutPage),
    await readSnippet(orderService),
  ].filter(Boolean);

  const summary = JSON.stringify(
    {
      backendFileCount: backendFiles.length,
      frontendFileCount: frontendFiles.length,
      sampleBackendPaths: backendFiles.slice(0, 40),
      sampleFrontendPaths: frontendFiles.slice(0, 40),
      keySnippets: snippets.map((s) => s.slice(0, 1_500)),
    },
    null,
    2,
  );

  return { backendRoot, frontendRoot, summary, backendFiles, frontendFiles };
}

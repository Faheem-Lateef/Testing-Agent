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

/** Content-based threshold below which we consider a project blank/empty. */
const BLANK_CANVAS_FILE_THRESHOLD = 5;

export interface RepoSnapshot {
  backendRoot: string;
  frontendRoot: string;
  summary: string;
  backendFiles: string[];
  frontendFiles: string[];
  /** True when one or both projects have fewer than 5 source files. */
  isBlankCanvas: boolean;
}

export async function analyzeRepositories(
  backendRoot: string,
  frontendRoot: string,
): Promise<RepoSnapshot> {
  phaseLog('PHASE_1_DEVELOPMENT', 'Analyzing backend and frontend repositories…');

  const backendExists = await pathExists(backendRoot);
  const frontendExists = await pathExists(frontendRoot);

  const backendFiles = backendExists
    ? (await listFiles(path.join(backendRoot, 'src'))).map((f) => path.relative(backendRoot, f))
    : [];

  const frontendFiles = frontendExists
    ? (await listFiles(path.join(frontendRoot, 'src'))).map((f) => path.relative(frontendRoot, f))
    : [];

  // Detect blank canvas: fewer real source files than the scaffold placeholders
  const realBackendFiles = backendFiles.filter(
    (f) => !f.includes('global.d.ts') && !f.endsWith('.d.ts'),
  );
  const realFrontendFiles = frontendFiles.filter(
    (f) => !f.includes('global.d.ts') && !f.endsWith('.d.ts'),
  );
  const isBlankCanvas =
    realBackendFiles.length < BLANK_CANVAS_FILE_THRESHOLD ||
    realFrontendFiles.length < BLANK_CANVAS_FILE_THRESHOLD;

  if (isBlankCanvas) {
    phaseLog('PHASE_1_DEVELOPMENT', '⚡ BLANK CANVAS detected — requesting complete project generation from OpenRouter');
  }

  // Sample key snippets from an existing project (empty strings for blank canvas)
  const routeIndex = path.join(backendRoot, 'src', 'routes', 'index.ts');
  const entryPage = path.join(frontendRoot, 'src', 'app', 'page.tsx');
  const orderService = path.join(backendRoot, 'src', 'services', 'orderService.ts');

  const snippets = [
    await readSnippet(routeIndex),
    await readSnippet(entryPage),
    await readSnippet(orderService),
  ].filter(Boolean);

  const summary = JSON.stringify(
    {
      isBlankCanvas,
      backendRoot,
      frontendRoot,
      backendExists,
      frontendExists,
      backendFileCount: backendFiles.length,
      frontendFileCount: frontendFiles.length,
      sampleBackendPaths: backendFiles.slice(0, 40),
      sampleFrontendPaths: frontendFiles.slice(0, 40),
      keySnippets: snippets.map((s) => s.slice(0, 1_500)),
    },
    null,
    2,
  );

  return { backendRoot, frontendRoot, summary, backendFiles, frontendFiles, isBlankCanvas };
}

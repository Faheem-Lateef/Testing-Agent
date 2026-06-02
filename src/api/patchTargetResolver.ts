import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveHandlerFilePath } from './handlerResolver.js';
import { loadConfig } from '../utils/config.js';
import type { RouteMetadata, TestResult } from '../utils/types.js';

const STACK_FILE_PATTERN =
  /(?:at\s+(?:\w+\.)?)?(?:\()?([A-Za-z]:[\\\/][^:\s"()]+?\.(?:ts|js)):(\d+):(\d+)/g;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function extractStackPaths(body: unknown): string[] {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? '');
  const paths: string[] = [];
  for (const match of text.matchAll(STACK_FILE_PATTERN)) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

function scorePatchCandidate(filePath: string): number {
  const normalized = normalizePath(filePath);
  if (/\/services\//i.test(normalized)) return 100;
  if (/\/controllers\//i.test(normalized)) return 80;
  if (/\/repositories\//i.test(normalized)) return 70;
  if (/\/middleware\//i.test(normalized)) return 40;
  if (/\/routes\//i.test(normalized)) return 20;
  return 10;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolvePatchTarget(
  route: RouteMetadata,
  result: TestResult,
): Promise<string> {
  const { GIT_REPO_ROOT } = loadConfig();
  const repoRoot = path.resolve(GIT_REPO_ROOT);
  const stackPaths = extractStackPaths(result.actualBody);

  const candidates: string[] = [];
  for (const stackPath of stackPaths) {
    const normalized = path.normalize(stackPath);
    if (normalizePath(normalized).includes(normalizePath(repoRoot))) {
      candidates.push(normalized);
      continue;
    }
    const relative = normalized.replace(/^.*[\\\/](src[\\\/].+)$/i, '$1');
    candidates.push(path.join(repoRoot, relative));
  }

  const handlerFile = await resolveHandlerFilePath(route);
  candidates.push(handlerFile);

  const ranked = [...new Set(candidates)]
    .filter((p) => !p.includes('node_modules'))
    .sort((a, b) => scorePatchCandidate(b) - scorePatchCandidate(a));

  for (const candidate of ranked) {
    const tsPath = candidate.endsWith('.js') ? candidate.replace(/\.js$/, '.ts') : candidate;
    if (await fileExists(tsPath)) return tsPath;
    if (await fileExists(candidate)) return candidate;
  }

  return handlerFile;
}

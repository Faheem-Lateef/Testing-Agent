/**
 * Duplicate File Detector — scans workspace source trees for:
 *  1. Name collisions: same filename appearing in different directories
 *  2. Content clones: different paths whose file content is byte-for-byte identical
 *
 * Run during READING_CONTEXT so the agent never generates code that already
 * exists under a different path, and never creates an accidental second copy
 * of a module that was just renamed or moved.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { engineerLog } from './logging.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NameCollision {
  /** Base filename (e.g. "userRoutes.ts") */
  name: string;
  /** All absolute paths that share this name */
  paths: string[];
}

export interface ContentClone {
  /** MD5 of the shared content */
  hash: string;
  /** All absolute paths with identical bytes */
  paths: string[];
  /** First 80 chars of the file for quick visual identification */
  preview: string;
}

export interface DuplicateReport {
  nameCollisions: NameCollision[];
  contentClones: ContentClone[];
  totalIssues: number;
  clean: boolean;
}

// ─── File walker ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'generated', '.git', 'coverage']);
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

async function walkFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }
  await recurse(root);
  return results;
}

// ─── Detectors ────────────────────────────────────────────────────────────────

function detectNameCollisions(files: string[]): NameCollision[] {
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const name = path.basename(f);
    const list = byName.get(name);
    if (list) list.push(f);
    else byName.set(name, [f]);
  }
  return Array.from(byName.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

async function detectContentClones(files: string[]): Promise<ContentClone[]> {
  const byHash = new Map<string, { paths: string[]; preview: string }>();

  await Promise.all(
    files.map(async (f) => {
      try {
        const content = await fs.readFile(f, 'utf-8');
        const trimmed = content.trim();
        if (trimmed.length < 20) return; // ignore tiny placeholder files
        const hash = crypto.createHash('md5').update(trimmed).digest('hex');
        const existing = byHash.get(hash);
        if (existing) {
          existing.paths.push(f);
        } else {
          byHash.set(hash, { paths: [f], preview: trimmed.slice(0, 80).replace(/\n/g, ' ') });
        }
      } catch { /* skip unreadable files */ }
    }),
  );

  return Array.from(byHash.entries())
    .filter(([, { paths }]) => paths.length > 1)
    .map(([hash, { paths, preview }]) => ({ hash, paths, preview }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scans all provided root directories for duplicate files.
 * Logs a summary with [DUPLICATE-DETECTOR] prefix.
 *
 * @param roots Absolute paths to scan (backend, frontend, qa-agent src, etc.)
 */
export async function detectDuplicateFiles(roots: string[]): Promise<DuplicateReport> {
  engineerLog('[DUPLICATE-DETECTOR] Scanning workspace for duplicate files…');

  const allFiles: string[] = [];
  for (const root of roots) {
    try {
      const found = await walkFiles(root);
      allFiles.push(...found);
    } catch { /* root may not exist on blank canvas — safe to skip */ }
  }

  engineerLog(`[DUPLICATE-DETECTOR] ${allFiles.length} source files indexed across ${roots.length} root(s)`);

  const [nameCollisions, contentClones] = await Promise.all([
    Promise.resolve(detectNameCollisions(allFiles)),
    detectContentClones(allFiles),
  ]);

  const totalIssues = nameCollisions.length + contentClones.length;
  const clean = totalIssues === 0;

  if (clean) {
    engineerLog('[DUPLICATE-DETECTOR] ✔ No duplicates found — workspace is clean');
  } else {
    if (nameCollisions.length > 0) {
      engineerLog(`[DUPLICATE-DETECTOR] ⚠ NAME COLLISIONS (${nameCollisions.length}):`);
      for (const col of nameCollisions) {
        engineerLog(`  "${col.name}" exists in ${col.paths.length} locations:`);
        for (const p of col.paths) {
          engineerLog(`    → ${p}`);
        }
      }
    }

    if (contentClones.length > 0) {
      engineerLog(`[DUPLICATE-DETECTOR] ⚠ CONTENT CLONES (${contentClones.length}):`);
      for (const clone of contentClones) {
        engineerLog(`  hash=${clone.hash.slice(0, 8)}… (${clone.paths.length} copies): "${clone.preview}…"`);
        for (const p of clone.paths) {
          engineerLog(`    → ${p}`);
        }
      }
    }

    engineerLog(
      `[DUPLICATE-DETECTOR] Total: ${totalIssues} issue(s) — ` +
      `${nameCollisions.length} name collision(s), ${contentClones.length} content clone(s)`,
    );
  }

  return { nameCollisions, contentClones, totalIssues, clean };
}

/**
 * Lightweight version: only checks the qa-agent's own src/ for internal
 * duplicates (faster, used in the standard READING_CONTEXT boot).
 */
export async function detectAgentDuplicates(qaAgentRoot: string): Promise<DuplicateReport> {
  return detectDuplicateFiles([path.join(qaAgentRoot, 'src')]);
}

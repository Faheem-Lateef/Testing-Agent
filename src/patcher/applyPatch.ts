import fs from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

async function verifyCompiles(filePath: string, content: string): Promise<boolean> {
  const ext = path.extname(filePath);
  if (!TYPESCRIPT_EXTENSIONS.has(ext)) {
    return true;
  }

  const tempPath = path.join(os.tmpdir(), `qa-agent-patch-${Date.now()}${ext}`);
  await writeFile(tempPath, content, 'utf-8');

  try {
    await execFileAsync('npx', ['tsc', '--noEmit', '--skipLibCheck', tempPath], {
      timeout: 60_000,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ filePath, err: message }, 'Patch failed compile gate');
    return false;
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function applyPatch(filePath: string, content: string): Promise<boolean> {
  const compiles = await verifyCompiles(filePath, content);
  if (!compiles) {
    return false;
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info({ filePath }, 'Patch applied to disk');
  return true;
}

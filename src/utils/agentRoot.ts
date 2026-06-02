import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the qa-agent repository root reliably (not just process.cwd()).
 * Cursor / npm may run the CLI from a subdirectory — memory must still land in d:\sqa.
 */
export function resolveAgentRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);

  for (let i = 0; i < 12; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
        if (pkg.name === 'qa-agent') return dir;
      } catch {
        // continue walking
      }
    }
    if (existsSync(path.join(dir, 'src', 'orchestrator', 'featureEngineer.ts'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: module lives at src/orchestrator/featureEngineer/*.ts → repo root is 3 levels up
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..');
}

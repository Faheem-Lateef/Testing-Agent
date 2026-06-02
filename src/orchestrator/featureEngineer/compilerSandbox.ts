import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { compilerLog } from './logging.js';
import type { CompileSandboxResult } from './types.js';

const COMPILE_COMMANDS: Record<'backend' | 'frontend' | 'qa-agent', string[]> = {
  'qa-agent': ['npm', 'run', 'typecheck'],
  backend: ['npm', 'run', 'build'],
  frontend: ['npm', 'run', 'build'],
};

function runInCwd(
  project: 'backend' | 'frontend' | 'qa-agent',
  cwd: string,
  commandParts: string[],
): CompileSandboxResult {
  const command = commandParts.join(' ');
  compilerLog(`Running: ${command} (cwd: ${cwd})`);

  try {
    const stdout = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    compilerLog(`Success: ${command}`);
    return {
      project,
      cwd,
      command,
      success: true,
      stdout: String(stdout),
      stderr: '',
      exitCode: 0,
    };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    const stdout = e.stdout?.toString() ?? '';
    const stderr = e.stderr?.toString() ?? '';
    const exitCode = e.status ?? 1;
    compilerLog(`Failed (exit ${exitCode}): ${command}`);
    return {
      project,
      cwd,
      command,
      success: false,
      stdout,
      stderr,
      exitCode,
    };
  }
}

export async function pathExists(dir: string): Promise<boolean> {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensures the TypeScript toolchain is bootstrapped in a freshly-scaffolded
 * project before attempting compilation. Only runs npm install when
 * node_modules is absent — skips for already-initialised projects.
 */
function ensureTypescriptInstalled(projectRoot: string, label: string): void {
  const nmPath = path.join(projectRoot, 'node_modules');
  if (existsSync(nmPath)) return;

  compilerLog(`${label} — node_modules absent, bootstrapping typescript…`);
  try {
    execSync(
      'npm install --save-dev typescript @types/node --no-audit --no-fund --prefer-offline --loglevel=error',
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        timeout: 180_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CI: '1' },
      },
    );
    compilerLog(`${label} — typescript bootstrap complete`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    compilerLog(`${label} — bootstrap warning (continuing): ${msg.slice(0, 200)}`);
  }
}

export async function verifyProjectCompile(
  project: 'backend' | 'frontend' | 'qa-agent',
  projectRoot: string,
): Promise<CompileSandboxResult> {
  if (!(await pathExists(projectRoot))) {
    compilerLog(`Skipping ${project} — path not found: ${projectRoot}`);
    return {
      project,
      cwd: projectRoot,
      command: '(skipped)',
      success: true,
      stdout: 'Project directory absent — treated as passing for blank-canvas run',
      stderr: '',
      exitCode: 0,
    };
  }

  const pkgPath = path.join(projectRoot, 'package.json');
  if (!(await pathExists(pkgPath))) {
    // No package.json — try tsc directly, bootstrap first
    ensureTypescriptInstalled(projectRoot, project);
    return runInCwd(project, projectRoot, ['npx', 'tsc', '--noEmit']);
  }

  // For scaffolded blank-canvas projects, ensure TypeScript is available
  if (project !== 'qa-agent') {
    ensureTypescriptInstalled(projectRoot, project);
  }

  let parts = COMPILE_COMMANDS[project];
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    if (project !== 'qa-agent' && !pkg.scripts?.['build']) {
      parts = ['npx', 'tsc', '--noEmit'];
    }
  } catch {
    parts = ['npx', 'tsc', '--noEmit'];
  }

  return runInCwd(project, projectRoot, parts);
}

export async function verifyAllTargets(
  backendRoot: string,
  frontendRoot: string,
  qaAgentRoot: string = process.cwd(),
): Promise<CompileSandboxResult[]> {
  const results = await Promise.all([
    verifyProjectCompile('backend', backendRoot),
    verifyProjectCompile('frontend', frontendRoot),
    verifyProjectCompile('qa-agent', qaAgentRoot),
  ]);
  return results;
}

export function gitRollbackWorkspace(cwd: string): void {
  compilerLog(`Git rollback: git checkout -- . in ${cwd}`);
  try {
    execSync('git checkout -- .', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    compilerLog('Rollback succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    compilerLog(`Rollback failed or not a git repo: ${message}`);
  }
}

export function formatCompileFailures(results: CompileSandboxResult[]): string {
  return results
    .filter((r) => !r.success)
    .map(
      (r) =>
        `[${r.project}] ${r.command}\nexit=${r.exitCode}\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`,
    )
    .join('\n\n---\n\n');
}

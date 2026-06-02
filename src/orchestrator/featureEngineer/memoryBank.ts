import fs from 'node:fs/promises';
import { readFileSync, mkdirSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { resolveAgentRoot } from '../../utils/agentRoot.js';
import { memoryLog } from './logging.js';
import type { FileChangeRecord, HealCycleRecord, ProjectMemoryBank } from './types.js';

// ─── Canonical write targets ───────────────────────────────────────────────────
// Every memory-write operation MUST update ALL of these directories so that
// loadMemoryBankSync() never reads a mix of current + stale context.
const MEMORY_WRITE_DIRS = ['memory-bank', '.cursor/memory'] as const;

function resolveWriteDir(cwd: string, dir: string): string {
  return path.join(cwd, dir);
}

/** Append `content` to `filename` in every canonical memory location. */
function appendToAllMemoryDirs(cwd: string, filename: string, content: string): void {
  for (const dir of MEMORY_WRITE_DIRS) {
    const dirPath = resolveWriteDir(cwd, dir);
    mkdirSync(dirPath, { recursive: true });
    appendFileSync(path.join(dirPath, filename), content, 'utf-8');
  }
}

/** Overwrite `filename` in every canonical memory location (for full syncs). */
export function syncToAllMemoryDirs(cwd: string, filename: string, content: string): void {
  for (const dir of MEMORY_WRITE_DIRS) {
    const dirPath = resolveWriteDir(cwd, dir);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(path.join(dirPath, filename), content, 'utf-8');
  }
  memoryLog(`Synced ${filename} → [${MEMORY_WRITE_DIRS.join(', ')}]`);
}

/** Create agent progress + activeContext stubs in both canonical dirs if missing. */
export function ensureAgentMemoryBankFiles(root: string): void {
  const progressStub = [
    '# QA Agent — Progress Log',
    '',
    '> Auto-appended by `writeProgressLog()` after every run.',
    '',
    '---',
    '',
  ].join('\n');

  const contextStub = [
    '# Active Context',
    '',
    '> **Last updated:** (pending first run)',
    '> Last run: (not yet run)',
    '',
    '---',
    '',
  ].join('\n');

  for (const dir of MEMORY_WRITE_DIRS) {
    const dirPath = resolveWriteDir(root, dir);
    mkdirSync(dirPath, { recursive: true });
    const progressPath = path.join(dirPath, 'progress.md');
    const contextPath = path.join(dirPath, 'activeContext.md');
    if (!existsSync(progressPath)) {
      writeFileSync(progressPath, progressStub, 'utf-8');
      memoryLog(`[MEMORY-BANK] Created ${dir}/progress.md`);
    }
    if (!existsSync(contextPath)) {
      writeFileSync(contextPath, contextStub, 'utf-8');
      memoryLog(`[MEMORY-BANK] Created ${dir}/activeContext.md`);
    }
  }
}

/**
 * Stamps Last updated + Last run lines without duplicating blockquote prefixes.
 * Handles `> Last updated:`, `> **Last updated:**`, and plain `Last updated:` formats.
 */
function stampContextHeaderContent(
  content: string,
  timestamp: string,
  runLine: string,
): string {
  const lastUpdatedLine = `> **Last updated:** ${timestamp}`;
  const lastRunLine = `> ${runLine}`;

  let c = content.trim().length > 0 ? content : '# Active Context\n\n';

  if (/last updated:/im.test(c)) {
    c = c.replace(/^[^\n]*last updated:[^\n]*$/im, lastUpdatedLine);
  } else {
    const h1 = c.match(/^#[^\n]+\n/m);
    if (h1?.index !== undefined) {
      const insertAt = h1.index + h1[0].length;
      c = `${c.slice(0, insertAt)}${lastUpdatedLine}\n${c.slice(insertAt)}`;
    } else {
      c = `${lastUpdatedLine}\n\n${c}`;
    }
  }

  if (/last run:/im.test(c)) {
    c = c.replace(/^[^\n]*last run:[^\n]*$/im, lastRunLine);
  } else if (/last updated:/im.test(c)) {
    c = c.replace(/(^> \*\*Last updated:\*\*[^\n]*\n)/im, `$1${lastRunLine}\n`);
  } else {
    c = `${lastUpdatedLine}\n${lastRunLine}\n\n${c}`;
  }

  return c;
}

function writeContextHeaderFile(
  filePath: string,
  featureSpec: string,
  outcome: 'SUCCESS' | 'FAILED',
  finalState: string,
  logPrefix: string,
): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const specSnippet = featureSpec.slice(0, 80);
  const runLine = `Last run: "${specSnippet}" → ${outcome} (${finalState})`;

  try {
    const prior = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
    const stamped = stampContextHeaderContent(prior, timestamp, runLine);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, stamped, 'utf-8');
    memoryLog(`${logPrefix} Context header stamped → ${timestamp} | ${outcome}`);
  } catch (err) {
    console.warn(`⚠  ${logPrefix} Could not stamp activeContext.md: ${String(err)}`);
  }
}

const MEMORY_CANDIDATES = [
  '.cursorrules',
  'memory-bank/activeContext.md',
  '.cursor/memory/activeContext.md',
  '.cursor/memory/systemArchitecture.md',
  '.cursor/memory/systemPatterns.md',
] as const;

async function readIfExists(absPath: string): Promise<string | null> {
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

function extractApiPrefix(text: string): string {
  const match = text.match(/\/api\/v\d+/i) ?? text.match(/app\.use\(['"`](\/api\/[^'"`]+)/);
  return match?.[0]?.startsWith('/') ? match[0] : match?.[1] ?? '/api/v1';
}

function extractDatabaseProfile(text: string): string {
  if (/mongodb|mongoose/i.test(text)) return 'MongoDB (Mongoose)';
  if (/postgres|prisma/i.test(text)) return 'PostgreSQL';
  if (/mysql/i.test(text)) return 'MySQL';
  return 'unknown — infer from GIT_REPO_ROOT backend';
}

function extractErrorUtility(text: string): string {
  if (/AppError/i.test(text)) return 'AppError utility';
  if (/errorHandler/i.test(text)) return 'central errorHandler middleware';
  return 'standard JSON { success, message } errors';
}

function extractFrontendStack(text: string): string {
  if (/next\.js|next dev/i.test(text)) return 'Next.js App Router';
  if (/react/i.test(text)) return 'React';
  return 'unknown frontend';
}

function extractDesignTokens(text: string): string[] {
  const tokens: string[] = [];
  if (/tailwind/i.test(text)) tokens.push('Tailwind CSS');
  if (/glass|accent-muted|gradient-text/i.test(text)) tokens.push('LUXE glass/accent tokens');
  if (/font-\[family-name:var\(--font-syne\)\]/i.test(text)) tokens.push('Syne display font');
  return tokens.length > 0 ? tokens : ['follow existing UI components in ecommerce-frontend'];
}

function extractConstraints(text: string): string[] {
  const constraints: string[] = [
    'TypeScript strict mode',
    'ESM modules',
    'OpenRouter temperature 0.1 for AI calls',
  ];
  if (/KISS/i.test(text)) constraints.push('KISS — minimal diff');
  if (/no automatic PR/i.test(text)) constraints.push('No automatic PR — local patches only');
  if (/stateless/i.test(text)) constraints.push('Stateless layer imports');
  return constraints;
}

function buildMemoryBank(sourcePath: string, rawContent: string): ProjectMemoryBank {
  return {
    sourcePath,
    rawContent: rawContent.slice(0, 24_000),
    apiVersionPrefix: extractApiPrefix(rawContent),
    databaseProfile: extractDatabaseProfile(rawContent),
    errorUtilityHint: extractErrorUtility(rawContent),
    frontendFramework: extractFrontendStack(rawContent),
    designTokens: extractDesignTokens(rawContent),
    constraints: extractConstraints(rawContent),
  };
}

/**
 * Detects when memory files in different locations have drifted out of sync
 * (e.g. memory-bank/activeContext.md vs .cursor/memory/activeContext.md).
 * Logs a warning for each drift pair — does NOT auto-merge (use syncToAllMemoryDirs).
 */
export async function checkMemoryDrift(cwd: string = process.cwd()): Promise<void> {
  const sharedFiles = ['activeContext.md', 'progress.md'];
  for (const filename of sharedFiles) {
    const contents: string[] = [];
    const found: string[] = [];
    for (const dir of MEMORY_WRITE_DIRS) {
      const p = path.join(cwd, dir, filename);
      if (existsSync(p)) {
        try {
          contents.push(readFileSync(p, 'utf-8').trim());
          found.push(`${dir}/${filename}`);
        } catch { /* skip */ }
      }
    }
    if (found.length > 1) {
      const allSame = contents.every((c) => c === contents[0]);
      if (!allSame) {
        memoryLog(
          `⚠ DRIFT DETECTED in ${filename} — locations have diverged: [${found.join(', ')}]. ` +
          `Call syncToAllMemoryDirs() to re-align.`,
        );
      }
    }
  }
}

/**
 * Load unified project memory before any code generation.
 */
export async function loadProjectMemoryBank(cwd: string = process.cwd()): Promise<ProjectMemoryBank> {
  memoryLog('Searching for architectural knowledge base files…');
  await checkMemoryDrift(cwd);

  const chunks: string[] = [];
  let primarySource = '(none)';

  for (const rel of MEMORY_CANDIDATES) {
    const abs = path.resolve(cwd, rel);
    const content = await readIfExists(abs);
    if (!content) continue;
    memoryLog(`Loaded: ${rel}`);
    if (primarySource === '(none)') primarySource = rel;
    chunks.push(`\n--- ${rel} ---\n${content}`);
  }

  if (chunks.length === 0) {
    memoryLog('No memory bank files found — using safe defaults');
    return buildMemoryBank('defaults', '');
  }

  const merged = chunks.join('\n');
  const bank = buildMemoryBank(primarySource, merged);

  memoryLog(`API prefix: ${bank.apiVersionPrefix}`);
  memoryLog(`Database: ${bank.databaseProfile}`);
  memoryLog(`Errors: ${bank.errorUtilityHint}`);
  memoryLog(`Frontend: ${bank.frontendFramework}`);
  memoryLog(`Design tokens: ${bank.designTokens.join(', ')}`);

  return bank;
}

export function formatMemoryBankForPrompt(bank: ProjectMemoryBank): string {
  return JSON.stringify(
    {
      apiVersionPrefix: bank.apiVersionPrefix,
      databaseProfile: bank.databaseProfile,
      errorUtilityHint: bank.errorUtilityHint,
      frontendFramework: bank.frontendFramework,
      designTokens: bank.designTokens,
      constraints: bank.constraints,
      excerpt: bank.rawContent.slice(0, 8_000),
    },
    null,
    2,
  );
}

// ─── Synchronous cold-boot loader ────────────────────────────────────────────
// Called as the ABSOLUTE FIRST operation in READING_CONTEXT state using the
// Node.js synchronous fs API so the memory bank is guaranteed to be available
// before any async I/O or LLM calls begin.

/**
 * Reads .cursorrules + memory-bank/activeContext.md synchronously using
 * fs.readFileSync. Prints the canonical "📂 [MEMORY-BANK]" log line.
 *
 * @param cwd Workspace root (defaults to process.cwd())
 */
export function loadMemoryBankSync(cwd: string = process.cwd()): ProjectMemoryBank {
  const chunks: string[] = [];
  let primarySource = '(none)';

  for (const rel of MEMORY_CANDIDATES) {
    const abs = path.resolve(cwd, rel);
    try {
      const content = readFileSync(abs, 'utf-8');
      if (content.trim()) {
        if (primarySource === '(none)') primarySource = rel;
        chunks.push(`\n--- ${rel} ---\n${content}`);
      }
    } catch {
      // file absent — skip silently
    }
  }

  if (chunks.length === 0) {
    console.log('📂 [MEMORY-BANK] No memory files found — using safe defaults.');
    return buildMemoryBank('defaults', '');
  }

  const merged = chunks.join('\n');
  const bank = buildMemoryBank(primarySource, merged);

  console.log('📂 [MEMORY-BANK] Loaded active context and system rules successfully.');
  memoryLog(`Sync-loaded ${chunks.length} memory file(s) — primary: ${primarySource}`);
  memoryLog(`API prefix: ${bank.apiVersionPrefix} | DB: ${bank.databaseProfile}`);

  return bank;
}

// ─── Active context header auto-stamp ────────────────────────────────────────

/**
 * Updates the "Last updated" and "Last run" header lines in activeContext.md
 * across BOTH canonical memory locations after every run.
 *
 * Only touches the metadata header — the architectural body is left intact.
 * Safe to call in `finally` blocks (uses sync fs).
 */
export function refreshActiveContextHeader(
  cwd: string,
  featureSpec: string,
  outcome: 'SUCCESS' | 'FAILED',
  finalState: string,
): void {
  ensureAgentMemoryBankFiles(cwd);
  for (const dir of MEMORY_WRITE_DIRS) {
    writeContextHeaderFile(
      path.join(cwd, dir, 'activeContext.md'),
      featureSpec,
      outcome,
      finalState,
      '[MEMORY-BANK]',
    );
  }
}

// ─── External project memory bank ────────────────────────────────────────────
// These functions operate exclusively on the EXTERNAL project directory
// (e.g. D:\car-rental-app\memory-bank\).  They NEVER touch the agent's own
// memory-bank/ or .cursor/memory/ trees.

/**
 * Seeds a fresh memory bank inside the external project directory.
 * Creates activeContext.md + progress.md if they don't already exist.
 * Called once when a new sandbox project is created.
 */
export function initProjectMemoryBank(projectRoot: string, projectSlug: string): void {
  const memoryDir = path.join(projectRoot, 'memory-bank');
  mkdirSync(memoryDir, { recursive: true });

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const activeContextContent = [
    `# Active Context — ${projectSlug}`,
    ``,
    `> **Last updated:** ${timestamp}`,
    `> Last run: (not yet run)`,
    ``,
    `---`,
    ``,
    `## Project`,
    ``,
    `- **Slug:** \`${projectSlug}\``,
    `- **Backend:** \`${path.join(projectRoot, 'backend')}\``,
    `- **Frontend:** \`${path.join(projectRoot, 'frontend')}\``,
    `- **Env:** \`${path.join(projectRoot, '.env')}\``,
    ``,
    `## Features Implemented`,
    ``,
    `*(auto-updated by Feature Engineer after each successful run)*`,
    ``,
    `## Routes`,
    ``,
    `*(auto-populated by Feature Engineer Phase 1)*`,
    ``,
    `## Schemas`,
    ``,
    `*(auto-populated by Feature Engineer Phase 1)*`,
    ``,
    `## Playwright Heal Cycles`,
    ``,
    `*(live logs appended by Feature Engineer Phase 3)*`,
    ``,
  ].join('\n');

  const progressContent = [
    `# Progress Log — ${projectSlug}`,
    ``,
    `> Auto-appended by QA Feature Engineer after every run.`,
    `> Tracks feature implementation, routes, schemas, and healing cycles.`,
    ``,
    `---`,
    ``,
  ].join('\n');

  const contextPath = path.join(memoryDir, 'activeContext.md');
  const progressPath = path.join(memoryDir, 'progress.md');

  if (!existsSync(contextPath)) {
    writeFileSync(contextPath, activeContextContent, 'utf-8');
    memoryLog(`[PROJECT-MEMORY] Created activeContext.md → ${contextPath}`);
  }
  if (!existsSync(progressPath)) {
    writeFileSync(progressPath, progressContent, 'utf-8');
    memoryLog(`[PROJECT-MEMORY] Created progress.md → ${progressPath}`);
  }
}

/**
 * Appends a structured progress entry to the EXTERNAL project's
 * memory-bank/progress.md. Completely separate from the agent's own logs.
 *
 * Use alongside writeProgressLog() — external project log only.
 */
export function writeProjectProgressLog(
  params: ProgressLogParams & { projectRoot: string },
): void {
  const { projectRoot, ...rest } = params;
  const memoryDir = path.join(projectRoot, 'memory-bank');
  const logPath = path.join(memoryDir, 'progress.md');

  const changes = rest.fileChanges ?? [];
  const cycles = rest.healCycles ?? [];
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const backendFiles = changes.filter((f) => f.repo === 'backend');
  const endpointLines =
    backendFiles.length > 0
      ? backendFiles.map((f) => `  - \`${f.relativePath}\``).join('\n')
      : '  - N/A';

  const healedCycles = cycles.filter(
    (h) => h.fixesApplied.length > 0 || h.debugAnalysis?.bugFound,
  );
  const bugsSection =
    healedCycles.length > 0
      ? healedCycles
          .map(
            (h) =>
              `  - Cycle ${h.cycle}: ${h.debugAnalysis?.rootCause ?? h.fixesApplied.join(', ')}`,
          )
          .join('\n')
      : '  - None';

  const lines: string[] = [
    `## [${timestamp}] ${rest.commandType}: ${rest.featureSpec.slice(0, 100)}`,
    ``,
    `- **Outcome**: ${rest.success ? 'SUCCESS ✓' : 'FAILED ✗'}`,
    `- **FSM State**: \`${rest.finalState}\``,
    ``,
    `### Files Changed (${changes.length})`,
  ];

  if (changes.length === 0) {
    lines.push('  - (none recorded)');
  } else {
    for (const f of changes) {
      lines.push(`  - [${f.repo}] **${f.action}**: \`${f.relativePath}\``);
    }
  }

  lines.push('', '### Endpoints Checked', endpointLines);
  lines.push('', '### Playwright Heal Cycles', bugsSection);

  if (rest.generatedTestPath) {
    lines.push('', '### Generated Test', `  - \`${rest.generatedTestPath}\``);
  }

  lines.push('', '---', '');

  const entry = lines.join('\n') + '\n';

  try {
    mkdirSync(memoryDir, { recursive: true });
    appendFileSync(logPath, entry, 'utf-8');
    console.log(`💾 [PROJECT-MEMORY] Progress log updated → ${logPath}`);
  } catch (err) {
    console.warn(`⚠  [PROJECT-MEMORY] Could not write project progress log: ${String(err)}`);
  }
}

/**
 * Stamps the "Last updated" and "Last run" header lines in the EXTERNAL
 * project's memory-bank/activeContext.md. Body is left intact.
 */
export function refreshProjectContextHeader(
  projectRoot: string,
  featureSpec: string,
  outcome: 'SUCCESS' | 'FAILED',
  finalState: string,
): void {
  writeContextHeaderFile(
    path.join(projectRoot, 'memory-bank', 'activeContext.md'),
    featureSpec,
    outcome,
    finalState,
    '[PROJECT-MEMORY]',
  );
}

/**
 * Guaranteed agent memory finalization: ensure files exist, append progress,
 * stamp activeContext header in memory-bank/ AND .cursor/memory/.
 */
export async function finalizeAgentMemoryUpdate(params: ProgressLogParams): Promise<void> {
  const root = params.qaAgentRoot ?? resolveAgentRoot();
  ensureAgentMemoryBankFiles(root);
  await writeProgressLog({ ...params, qaAgentRoot: root });
  refreshActiveContextHeader(
    root,
    params.featureSpec,
    params.success ? 'SUCCESS' : 'FAILED',
    params.finalState,
  );
  for (const dir of MEMORY_WRITE_DIRS) {
    const base = resolveWriteDir(root, dir);
    memoryLog(`[MEMORY-BANK] Updated ${path.join(base, 'progress.md')}`);
    memoryLog(`[MEMORY-BANK] Updated ${path.join(base, 'activeContext.md')}`);
  }
}

/**
 * Guaranteed external project memory finalization after a feature-engineer run.
 */
export function finalizeProjectMemoryUpdate(
  params: ProgressLogParams & { projectRoot: string },
): void {
  const { projectRoot, ...rest } = params;
  writeProjectProgressLog({ ...rest, projectRoot });
  refreshProjectContextHeader(
    projectRoot,
    rest.featureSpec,
    rest.success ? 'SUCCESS' : 'FAILED',
    rest.finalState,
  );
}

// ─── Progress log writer ──────────────────────────────────────────────────────

export interface ProgressLogParams {
  /** Short label for the command type, e.g. "feature-engineer" | "backend" | "frontend" | "fullstack" */
  commandType: string;
  featureSpec: string;
  success: boolean;
  finalState: string;
  fileChanges?: FileChangeRecord[];
  healCycles?: HealCycleRecord[];
  generatedTestPath?: string | null;
  /** Absolute path to the qa-agent workspace root (defaults to process.cwd()) */
  qaAgentRoot?: string;
}

/**
 * Appends a structured progress entry to memory-bank/progress.md.
 * Always runs — even on failure — via the finalization block.
 * Prints the canonical "💾 [MEMORY-BANK]" log line on success.
 */
export async function writeProgressLog(params: ProgressLogParams): Promise<void> {
  const root = params.qaAgentRoot ?? resolveAgentRoot();
  ensureAgentMemoryBankFiles(root);

  const changes = params.fileChanges ?? [];
  const cycles = params.healCycles ?? [];

  const timestamp = new Date()
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  // ── Endpoints section ─────────────────────────────────────────────────────
  const backendFiles = changes.filter((f) => f.repo === 'backend');
  const endpointLines =
    backendFiles.length > 0
      ? backendFiles.map((f) => `  - \`${f.relativePath}\``).join('\n')
      : '  - N/A';

  // ── Bugs fixed section ────────────────────────────────────────────────────
  const healedCycles = cycles.filter(
    (h) => h.fixesApplied.length > 0 || h.debugAnalysis?.bugFound,
  );
  const bugsSection =
    healedCycles.length > 0
      ? healedCycles
          .map(
            (h) =>
              `  - Cycle ${h.cycle}: ${h.debugAnalysis?.rootCause ?? h.fixesApplied.join(', ')}`,
          )
          .join('\n')
      : '  - None';

  const lines: string[] = [
    `## [${timestamp}] ${params.commandType}: ${params.featureSpec.slice(0, 100)}`,
    '',
    `- **Outcome**: ${params.success ? 'SUCCESS ✓' : 'FAILED ✗'}`,
    `- **FSM State**: \`${params.finalState}\``,
    '',
    `### Files Changed (${changes.length})`,
  ];

  if (changes.length === 0) {
    lines.push('  - (none recorded)');
  } else {
    for (const f of changes) {
      lines.push(`  - [${f.repo}] **${f.action}**: \`${f.relativePath}\``);
    }
  }

  lines.push('', '### Endpoints Checked');
  lines.push(endpointLines);

  lines.push('', '### Bugs Fixed');
  lines.push(bugsSection);

  if (params.generatedTestPath) {
    lines.push('', `### Generated Test`, `  - \`${params.generatedTestPath}\``);
  }

  lines.push('', '---', '');

  const entry = lines.join('\n') + '\n';

  try {
    // Write to EVERY canonical memory location so all dirs stay in sync.
    // mkdirSync used here for guaranteed creation even inside finally blocks.
    appendToAllMemoryDirs(root, 'progress.md', entry);
    console.log('💾 [MEMORY-BANK] Progress log updated automatically on disk.');
    memoryLog(`Progress appended → [${MEMORY_WRITE_DIRS.join(', ')}]/progress.md`);
  } catch (err) {
    console.warn(`⚠  [MEMORY-BANK] Could not write progress log: ${String(err)}`);
  }
}

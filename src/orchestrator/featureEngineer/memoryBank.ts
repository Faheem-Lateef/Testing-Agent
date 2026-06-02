import fs from 'node:fs/promises';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

import { memoryLog } from './logging.js';
import type { FileChangeRecord, HealCycleRecord, ProjectMemoryBank } from './types.js';

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
 * Load unified project memory before any code generation.
 */
export async function loadProjectMemoryBank(cwd: string = process.cwd()): Promise<ProjectMemoryBank> {
  memoryLog('Searching for architectural knowledge base files…');

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
  const root = params.qaAgentRoot ?? process.cwd();
  const dir = path.join(root, 'memory-bank');
  const logPath = path.join(dir, 'progress.md');

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
    // mkdirSync for guaranteed creation even in tight finally blocks
    mkdirSync(dir, { recursive: true });
    appendFileSync(logPath, entry, 'utf-8');
    console.log('💾 [MEMORY-BANK] Progress log updated automatically on disk.');
    memoryLog(`Progress appended → ${path.relative(root, logPath)}`);
  } catch (err) {
    console.warn(`⚠  [MEMORY-BANK] Could not write progress log: ${String(err)}`);
  }
}

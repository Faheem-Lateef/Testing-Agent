import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type {
  EvolutionAnalysis,
  EvolutionGenerationResult,
  EvolutionLoopResult,
  QaRunArtifacts,
  SelfImprovementPatch,
} from '../utils/types.js';

const execFileAsync = promisify(execFile);

export const MAX_SELF_EVOLUTION_GENERATIONS = 3;

const AGENT_SOURCE_FILES = [
  'src/api/testGenerator.ts',
  'src/api/domainBatchTestGenerator.ts',
  'src/api/testRunner.ts',
  'src/api/integrationRunner.ts',
  'src/ui/frontendRunner.ts',
  'src/orchestrator/selfEvolution.ts',
] as const;

function evolutionLog(message: string): void {
  console.log(`[EVOLUTION] ${message}`);
  logger.info({ evolution: true }, message);
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function resolveAgentPath(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

function buildCoverageEstimate(artifacts: QaRunArtifacts): QaRunArtifacts['coverageEstimate'] {
  const total = artifacts.integrationSummary.testsTotal;
  const passed = artifacts.integrationSummary.testsPassed;
  const failed = artifacts.integrationSummary.testsFailed;
  const consoleErrorCount =
    (artifacts.frontendE2e?.diagnostics.filter(
      (d) => d.type === 'console' || d.type === 'pageerror',
    ).length ?? 0) +
    (artifacts.frontendE2eError ? 1 : 0);

  const passRate = total > 0 ? passed / total : 1;
  const failureRate = total > 0 ? failed / total : 0;

  return { passRate, failureRate, consoleErrorCount };
}

export function enrichArtifactsCoverage(artifacts: QaRunArtifacts): QaRunArtifacts {
  return { ...artifacts, coverageEstimate: buildCoverageEstimate(artifacts) };
}

function buildExecutionSummary(artifacts: QaRunArtifacts, generation: number): string {
  return JSON.stringify(
    {
      generation,
      integration: artifacts.integrationSummary,
      frontendE2e: artifacts.frontendE2e
        ? {
            passed: artifacts.frontendE2e.passed,
            stepsCompleted: artifacts.frontendE2e.stepsCompleted,
            diagnostics: artifacts.frontendE2e.diagnostics,
          }
        : null,
      frontendE2eError: artifacts.frontendE2eError,
      coverageEstimate: artifacts.coverageEstimate,
    },
    null,
    2,
  );
}

async function loadAgentSources(): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  for (const rel of AGENT_SOURCE_FILES) {
    const abs = resolveAgentPath(rel);
    try {
      sources[rel] = await fs.readFile(abs, 'utf-8');
    } catch {
      sources[rel] = '(file not found)';
    }
  }
  return sources;
}

async function analyzePerformanceGaps(
  artifacts: QaRunArtifacts,
  generation: number,
): Promise<EvolutionAnalysis> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);
  const sources = await loadAgentSources();
  const summary = buildExecutionSummary(artifacts, generation);

  const prompt = `You are the meta-reviewer for an autonomous QA agent codebase (TypeScript, Playwright, Axios, OpenRouter).

Strictly evaluate the agent's own test coverage and implementation quality using the execution summary below.

Execution summary:
${summary}

Agent source files (current):
${Object.entries(sources)
  .map(([file, code]) => `--- ${file} ---\n${code.slice(0, 12_000)}`)
  .join('\n\n')}

Identify concrete gaps:
- Missing validation edge cases, query parameters, headers, or auth flows
- Missing UI input states, error boundaries, or cart/checkout edge cases
- Weak assertions or absent negative-path tests

If improvements are needed, return patches as FULL file contents for files under src/ only.
If no improvements are needed, return empty patches array.

Respond with pure JSON only — no markdown fences:
{
  "gaps": string[],
  "patches": [{ "filePath": string, "reason": string, "content": string }]
}`;

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 16_384,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(
    response.choices[0]?.message?.content,
    'self-evolution analysis',
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFences(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse evolution analysis JSON: ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { gaps: [], patches: [] };
  }

  const record = parsed as Record<string, unknown>;
  const gaps = Array.isArray(record['gaps'])
    ? record['gaps'].map((g) => String(g))
    : [];

  const patches: SelfImprovementPatch[] = [];
  if (Array.isArray(record['patches'])) {
    for (const item of record['patches']) {
      if (typeof item !== 'object' || item === null) continue;
      const patch = item as Record<string, unknown>;
      const filePath = String(patch['filePath'] ?? '');
      const content = String(patch['content'] ?? '');
      if (!filePath.startsWith('src/') || !content.trim()) continue;
      patches.push({
        filePath,
        reason: String(patch['reason'] ?? 'coverage gap'),
        content: stripMarkdownFences(content),
      });
    }
  }

  return { gaps, patches };
}

async function runProjectTypecheck(): Promise<boolean> {
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: process.cwd(),
      timeout: 120_000,
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    evolutionLog(`Typecheck failed: ${message}`);
    return false;
  }
}

async function applySelfPatches(
  patches: SelfImprovementPatch[],
): Promise<{ applied: string[]; rolledBack: string[]; backups: Map<string, string> }> {
  const backups = new Map<string, string>();
  const applied: string[] = [];

  for (const patch of patches) {
    const abs = resolveAgentPath(patch.filePath);
    evolutionLog(`Identified gap: ${patch.reason}. Modifying \`${patch.filePath}\` now...`);

    try {
      const previous = await fs.readFile(abs, 'utf-8');
      backups.set(patch.filePath, previous);
      await fs.writeFile(abs, patch.content, 'utf-8');
      applied.push(patch.filePath);
      evolutionLog(`Applied self-improvement patch to ${patch.filePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      evolutionLog(`Failed to write ${patch.filePath}: ${message}`);
    }
  }

  return { applied, rolledBack: [], backups };
}

async function rollbackFiles(backups: Map<string, string>): Promise<string[]> {
  const restored: string[] = [];
  for (const [rel, content] of backups) {
    const abs = resolveAgentPath(rel);
    await fs.writeFile(abs, content, 'utf-8');
    restored.push(rel);
    evolutionLog(`Rolled back ${rel} to pre-patch backup`);
  }
  return restored;
}

/**
 * Meta-review loop: analyze run → patch agent source → typecheck → re-run tests (max 3 generations).
 */
export async function runSelfEvolutionLoop(
  initialArtifacts: QaRunArtifacts,
  rerun: () => Promise<QaRunArtifacts>,
): Promise<EvolutionLoopResult> {
  let artifacts = enrichArtifactsCoverage(initialArtifacts);
  const results: EvolutionGenerationResult[] = [];

  evolutionLog('Starting meta-review and self-improvement loop');

  for (let generation = 1; generation <= MAX_SELF_EVOLUTION_GENERATIONS; generation++) {
    evolutionLog(`Generation ${generation}/${MAX_SELF_EVOLUTION_GENERATIONS} — analyzing performance gaps`);

    const analysis = await analyzePerformanceGaps(artifacts, generation);

    if (analysis.gaps.length === 0 && analysis.patches.length === 0) {
      evolutionLog('No improvement gaps identified — evolution complete');
      results.push({
        generation,
        gaps: [],
        filesModified: [],
        compilationPassed: true,
        rolledBack: [],
      });
      break;
    }

    for (const gap of analysis.gaps) {
      evolutionLog(`Gap: ${gap}`);
    }

    if (analysis.patches.length === 0) {
      evolutionLog('Gaps noted but no safe patches proposed — stopping evolution');
      results.push({
        generation,
        gaps: analysis.gaps,
        filesModified: [],
        compilationPassed: true,
        rolledBack: [],
      });
      break;
    }

    const { applied, backups } = await applySelfPatches(analysis.patches);

    evolutionLog('Running TypeScript compilation guard (npx tsc --noEmit)');
    const compilationPassed = await runProjectTypecheck();

    let rolledBack: string[] = [];
    if (!compilationPassed) {
      rolledBack = await rollbackFiles(backups);
      results.push({
        generation,
        gaps: analysis.gaps,
        filesModified: [],
        compilationPassed: false,
        rolledBack,
      });
      evolutionLog('Compilation failed — patches rolled back; stopping evolution');
      break;
    }

    evolutionLog('Compilation passed — restarting live frontend and backend test cycle');
    artifacts = enrichArtifactsCoverage(await rerun());

    results.push({
      generation,
      gaps: analysis.gaps,
      filesModified: applied,
      compilationPassed: true,
      rolledBack,
      retestArtifacts: artifacts,
    });

    if (artifacts.integrationSummary.testsFailed === 0 && !artifacts.frontendE2eError) {
      evolutionLog('Re-test shows no failures — ending evolution early');
      break;
    }
  }

  evolutionLog(`Self-evolution loop finished (${results.length} generation(s))`);

  return {
    generationsRun: results.length,
    results,
    finalArtifacts: artifacts,
  };
}

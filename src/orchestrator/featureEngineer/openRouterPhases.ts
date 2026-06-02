import OpenAI from 'openai';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../../utils/config.js';
import { formatMemoryBankForPrompt } from './memoryBank.js';
import { engineerLog } from './logging.js';
import type {
  CodeInjectionSpec,
  DebugAnalysisResponse,
  DevelopmentPhaseOutput,
  ProjectMemoryBank,
} from './types.js';

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json|typescript|tsx|ts)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function parseRepoFromPath(filePath: string): 'backend' | 'frontend' | undefined {
  if (/^backend:/i.test(filePath)) return 'backend';
  if (/^frontend:/i.test(filePath)) return 'frontend';
  if (/\.tsx$/i.test(filePath)) return 'frontend';
  return undefined;
}

function extractCodeBlocks(text: string): Array<{ filePath: string; content: string; repo?: 'backend' | 'frontend' }> {
  const blocks: Array<{ filePath: string; content: string; repo?: 'backend' | 'frontend' }> = [];
  const pattern = /```(?:typescript|tsx|ts)?\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const body = match[1]?.trim() ?? '';
    const pathMatch = body.match(/^\/\/\s*file:\s*(.+)$/m);
    const filePath = pathMatch?.[1]?.trim() ?? '';
    const content = pathMatch ? body.replace(/^\/\/\s*file:.+\n?/m, '').trim() : body;
    if (content) {
      blocks.push({ filePath, content, repo: filePath ? parseRepoFromPath(filePath) : undefined });
    }
  }
  return blocks;
}

/**
 * PHASE 1 — Full-stack developer: Mongoose, Express, Next.js UI.
 */
export async function runFullStackDevelopmentPhase(
  featureSpec: string,
  memory: ProjectMemoryBank,
  repoSummary: string,
  priorErrors?: string,
): Promise<DevelopmentPhaseOutput> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);

  const prompt = `You are a Senior Full-Stack Developer implementing a feature in an e-commerce monorepo.

DEVELOPMENT PHASE — output ONLY markdown code fences (TypeScript/TSX). NO prose outside fences.

Each fence MUST begin with: // file: backend:relative/path  OR  // file: frontend:relative/path

Examples:
// file: backend:src/models/Coupon.ts
// file: backend:src/routes/couponRoutes.ts
// file: backend:src/routes/index.ts  (add router.use line)
// file: frontend:src/app/checkout/page.tsx

REQUIREMENTS:
1. Database: Mongoose schemas/models with validation (codes, discount %, usage limits, expiry as needed).
2. Backend: controllers, services, routes under ${memory.apiVersionPrefix}, wire into routes/index.ts.
3. Frontend: physical UI fields, state handlers, buttons on checkout/cart as needed.
4. Use ${memory.errorUtilityHint}. Match ${memory.databaseProfile}.

KNOWLEDGE BASE:
${formatMemoryBankForPrompt(memory)}

REPOSITORY SNAPSHOT:
${repoSummary.slice(0, 10_000)}

FEATURE REQUEST:
${featureSpec}

${priorErrors ? `FIX THESE ERRORS:\n${priorErrors}` : ''}`;

  engineerLog('OpenRouter PHASE-1: full-stack development');

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 16_384,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      engineerLog('OpenRouter credits exhausted — empty development output');
      return { injections: [], rawBlocks: [] };
    }
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, 'full-stack development');
  const rawBlocks = extractCodeBlocks(text);

  const injections: CodeInjectionSpec[] = rawBlocks
    .filter((b) => b.filePath)
    .map((b) => {
      const rel = b.filePath.replace(/^(backend|frontend):/i, '');
      const isRouteIndex = /routes\/index\.ts$/i.test(rel);
      const isReact = /\.tsx$/i.test(rel);
      const lines = b.content.split('\n');
      return {
        filePath: b.filePath,
        anchorKind: isRouteIndex
          ? 'express_route_index'
          : isReact
            ? 'react_form_block'
            : 'file_append',
        linesToInsert: isRouteIndex || isReact ? lines : [],
        newFileContent: isRouteIndex || isReact ? undefined : b.content,
        replaceEntireFile: !isRouteIndex && !isReact,
      } satisfies CodeInjectionSpec;
    });

  return { injections, rawBlocks };
}

/**
 * PHASE 2 — Dynamic feature-specific Playwright journey in src/ui/generated/.
 */
export async function runFeatureTestGenerationPhase(
  featureSpec: string,
  memory: ProjectMemoryBank,
  repoSummary: string,
  outputFileName: string,
  frontendBaseUrl: string,
): Promise<string> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);

  const prompt = `You are a QA Automation Engineer writing ONE Playwright E2E test file.

Output a SINGLE markdown fence with TypeScript. First line: // file: qa-agent:src/ui/generated/${outputFileName}

The file MUST:
- Import { chromium } from 'playwright'
- Use headless: false, slowMo: 150
- Export async function runFeatureJourney(): Promise<{
    passed: boolean;
    steps: string[];
    error?: string;
    stackTrace?: string;
    subtotalBefore?: number;
    subtotalAfter?: number;
    discountPercent?: number;
    couponCode?: string;
  }>
- At bottom, if executed directly via tsx, print: console.log('__FEATURE_RESULT__' + JSON.stringify(await runFeatureJourney()))
- Base URL: ${frontendBaseUrl}
- Generate unique test user email qa-feature-\${Date.now()}@example.com password TestPass123!

Tailor steps EXACTLY to this feature (not generic smoke):
${featureSpec}

For coupon flows include:
  Step A: register/login
  Step B: first purchase via checkout UI
  Step C: extract coupon code from API response or UI
  Step D: second cart + apply coupon in discount field + Apply button
  Step E: assert final price is lower by expected discount %

Use resilient selectors (getByRole, getByPlaceholder, data-testid patterns).

KNOWLEDGE BASE:
${formatMemoryBankForPrompt(memory)}

APP CONTEXT:
${repoSummary.slice(0, 6_000)}`;

  engineerLog('OpenRouter PHASE-2: feature test generation');

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 12_288,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      return '';
    }
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, 'feature test gen');
  const blocks = extractCodeBlocks(text);
  return blocks[0]?.content ?? stripMarkdownFences(text);
}

/**
 * PHASE 3 — Self-healing debugger (JSON).
 */
export async function runSelfHealAnalysisPhase(
  failurePayload: string,
  memory: ProjectMemoryBank,
  repoSummary: string,
): Promise<DebugAnalysisResponse> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);

  const prompt = `You are the Self-Healing Debugger. Respond with PURE JSON only:
{
  "bugFound": boolean,
  "targetFile": string,
  "rootCause": string,
  "fixedInjectedCode": string,
  "layer": "mongoose" | "express" | "frontend" | "test" | "unknown",
  "replaceEntireFile": boolean
}

targetFile must use backend:path or frontend:path prefix.
fixedInjectedCode = complete fixed file OR snippet to inject at anchor.

FAILURE PAYLOAD:
${failurePayload.slice(0, 14_000)}

REPO:
${repoSummary.slice(0, 4_000)}

KNOWLEDGE BASE:
${formatMemoryBankForPrompt(memory)}`;

  engineerLog('OpenRouter PHASE-3: self-heal analysis');

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 8_192,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      return {
        bugFound: true,
        targetFile: '',
        rootCause: 'OpenRouter credits exhausted',
        fixedInjectedCode: '',
        layer: 'unknown',
      };
    }
    handleOpenRouterAuthError(err);
  }

  const text = stripMarkdownFences(
    extractCompletionText(response.choices[0]?.message?.content, 'self-heal'),
  );

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      bugFound: Boolean(parsed['bugFound']),
      targetFile: String(parsed['targetFile'] ?? ''),
      rootCause: String(parsed['rootCause'] ?? ''),
      fixedInjectedCode: String(parsed['fixedInjectedCode'] ?? ''),
      layer: (parsed['layer'] as DebugAnalysisResponse['layer']) ?? 'unknown',
      replaceEntireFile: Boolean(parsed['replaceEntireFile']),
    };
  } catch {
    return {
      bugFound: true,
      targetFile: '',
      rootCause: 'Invalid JSON from heal model',
      fixedInjectedCode: '',
      layer: 'unknown',
    };
  }
}

/** @deprecated */
export const runDevelopmentPhase = runFullStackDevelopmentPhase;
export const runDebugAnalysisPhase = runSelfHealAnalysisPhase;

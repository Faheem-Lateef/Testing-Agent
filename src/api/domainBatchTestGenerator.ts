import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { HttpMethod, RouteMetadata, TestCase } from '../utils/types.js';
import { domainLabel, type TestDomain } from './routeDomains.js';
import { generateFlowTestCases } from './flowTestGenerator.js';
import { getE2eSession } from './testSession.js';
import { generateSmokeTestCases } from './smokeTestGenerator.js';

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

export function routeKey(route: RouteMetadata): string {
  return `${route.method}:${route.path}:${route.filePath}`;
}

function isHttpMethod(value: string): value is HttpMethod {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value);
}

function parseTestRecord(
  record: Record<string, unknown>,
  route: RouteMetadata,
  index: number,
): TestCase {
  const method = String(record['method'] ?? route.method).toUpperCase();
  if (!isHttpMethod(method)) {
    throw new Error(`Invalid HTTP method "${method}" in test case "${String(record['name'])}"`);
  }

  const expectedStatus = Number(record['expectedStatus']);
  if (Number.isNaN(expectedStatus)) {
    throw new Error(`Missing or invalid expectedStatus in test case "${String(record['name'])}"`);
  }

  return {
    name: String(record['name'] ?? `test-${index}`),
    method,
    path: String(record['path'] ?? route.path),
    body:
      record['body'] !== undefined && typeof record['body'] === 'object' && record['body'] !== null
        ? (record['body'] as Record<string, unknown>)
        : undefined,
    headers:
      record['headers'] !== undefined &&
      typeof record['headers'] === 'object' &&
      record['headers'] !== null
        ? Object.fromEntries(
            Object.entries(record['headers'] as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          )
        : undefined,
    expectedStatus,
    expectedShape:
      record['expectedShape'] !== undefined &&
      typeof record['expectedShape'] === 'object' &&
      record['expectedShape'] !== null
        ? (record['expectedShape'] as TestCase['expectedShape'])
        : undefined,
  };
}

function domainScenarioBlock(domain: TestDomain): string {
  switch (domain) {
    case 'auth':
      return `Domain: Authentication & Security — registration/login sweeps, malformed payloads, 401/403 on protected routes without valid Bearer tokens.`;
    case 'catalog':
      return `Domain: Catalog & Products — public GET routes, invalid IDs, admin-only mutations (401 without auth), validation errors.`;
    case 'cart_order':
      return `Domain: Cart & Order Flow — cart item CRUD, empty cart checkout, invalid product IDs, missing auth (401), role errors (403).`;
    default:
      return '';
  }
}

async function readRoutesIndex(routesDir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(routesDir, 'index.ts'), 'utf-8');
  } catch {
    return '(routes index not found)';
  }
}

function buildBatchPrompt(
  routes: RouteMetadata[],
  sources: Map<string, string>,
  baseAppUrl: string,
  routesIndex: string,
  domain: TestDomain,
): string {
  const catalog = routes
    .map((route, index) => {
      const key = routeKey(route);
      const source = sources.get(key) ?? '';
      return `### Route ${index} (key: "${key}")
- Method: ${route.method}
- Router path: ${route.path}
- File: ${route.filePath}
\`\`\`
${source}
\`\`\``;
    })
    .join('\n\n');

  return `You are a senior backend QA engineer generating integration tests for an Express e-commerce API.

${domainScenarioBlock(domain)}
Base URL: ${baseAppUrl}
API mount: /api/v1 (combine with router.use mounts below)
Use FULL paths in each test (e.g. "/api/v1/auth/login").

routes/index.ts:
\`\`\`
${routesIndex}
\`\`\`

Routes in this batch:
${catalog}

For EACH route key, generate 4–6 test cases covering: happy path, malformed data, edge cases, auth/security where applicable.

Respond with pure JSON only — no markdown fences:
{
  "routes": [
    {
      "routeKey": "<exact key from above>",
      "tests": [
        { "name": string, "method": string, "path": string, "body": object?, "headers": object?, "expectedStatus": number, "expectedShape": object? }
      ]
    }
  ]
}

expectedShape values: "string" | "number" | "boolean" | "object" | "array" | "null".`;
}

async function generateSmokeBatch(routes: RouteMetadata[]): Promise<Map<string, TestCase[]>> {
  const result = new Map<string, TestCase[]>();
  const session = getE2eSession();

  for (const route of routes) {
    const source = await fs.readFile(route.filePath, 'utf-8');
    const cases = session
      ? generateFlowTestCases(route, source)
      : generateSmokeTestCases(route, source);
    result.set(routeKey(route), cases);
  }
  return result;
}

export async function generateDomainBatchTestCases(
  routes: RouteMetadata[],
  domain: TestDomain,
): Promise<{ tests: Map<string, TestCase[]>; usedOpenRouter: boolean }> {
  if (routes.length === 0) return { tests: new Map(), usedOpenRouter: false };

  const config = loadConfig();
  const sources = new Map<string, string>();

  for (const route of routes) {
    const key = routeKey(route);
    sources.set(key, await fs.readFile(route.filePath, 'utf-8'));
  }

  const routesDir = path.dirname(routes[0]!.filePath);
  const routesIndex = await readRoutesIndex(routesDir);
  const openai = createOpenRouterClient(config);

  logger.info(
    { domain: domainLabel(domain), routeCount: routes.length },
    'Generating domain batch test cases via OpenRouter',
  );

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [
        {
          role: 'user',
          content: buildBatchPrompt(routes, sources, config.BASE_APP_URL, routesIndex, domain),
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      logger.warn(
        { domain: domainLabel(domain) },
        'OpenRouter credits exhausted for batch — using smoke tests for this domain',
      );
      const smoke = await generateSmokeBatch(routes);
      return { tests: smoke, usedOpenRouter: false };
    }
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(
    response.choices[0]?.message?.content,
    `domain batch ${domain}`,
  );
  const parsed: unknown = JSON.parse(stripMarkdownFences(text));

  if (typeof parsed !== 'object' || parsed === null || !('routes' in parsed)) {
    throw new Error(`Invalid domain batch JSON for ${domain}`);
  }

  const routeEntries = (parsed as { routes: unknown }).routes;
  if (!Array.isArray(routeEntries)) {
    throw new Error(`Domain batch "routes" must be an array for ${domain}`);
  }

  const result = new Map<string, TestCase[]>();
  const routeByKey = new Map(routes.map((r) => [routeKey(r), r]));

  for (const entry of routeEntries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const key = String(record['routeKey'] ?? '');
    const route = routeByKey.get(key);
    if (!route) {
      logger.warn({ key }, 'Batch response contained unknown routeKey — skipping');
      continue;
    }
    const testsRaw = record['tests'];
    if (!Array.isArray(testsRaw)) continue;

    const tests = testsRaw.map((item, index) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`Invalid test at index ${index} for ${key}`);
      }
      return parseTestRecord(item as Record<string, unknown>, route, index);
    });

    result.set(key, tests);
    logger.info({ routeKey: key, count: tests.length }, 'OpenRouter test payloads ready for route');
  }

  for (const route of routes) {
    const key = routeKey(route);
    if (!result.has(key)) {
      logger.warn({ key }, 'No tests generated for route — using empty set');
      result.set(key, []);
    }
  }

  return { tests: result, usedOpenRouter: true };
}

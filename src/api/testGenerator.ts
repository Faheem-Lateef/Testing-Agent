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
import { generateSmokeTestCases } from './smokeTestGenerator.js';
import { domainLabel, type TestDomain } from './routeDomains.js';

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function isHttpMethod(value: string): value is HttpMethod {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(value);
}

function parseTestCases(raw: string, route: RouteMetadata): TestCase[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripMarkdownFences(raw));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse test JSON for ${route.path}: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Model returned non-array test cases for ${route.method} ${route.path}`);
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Invalid test case at index ${index} for ${route.path}`);
    }

    const record = item as Record<string, unknown>;
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
  });
}

async function readRoutesIndex(routeFilePath: string): Promise<string> {
  const indexPath = path.join(path.dirname(routeFilePath), 'index.ts');
  try {
    return await fs.readFile(indexPath, 'utf-8');
  } catch {
    return '(routes index not found)';
  }
}

function domainScenarioBlock(domain: TestDomain): string {
  switch (domain) {
    case 'auth':
      return `Domain focus — Authentication & Security:
- Registration and login sweeps with valid and malformed payloads
- Missing fields, invalid email/password formats, duplicate signup attempts
- Verify protected routes return 401 without Authorization header and 403 for wrong roles when applicable
- Include Bearer token tests only when prior login flow is implied; otherwise test unauthenticated access`;
    case 'catalog':
      return `Domain focus — Catalog & Products:
- Public GET list/detail routes without auth (happy path + invalid IDs)
- Query/filter edge cases where the handler supports them
- Admin-only POST/PUT/PATCH/DELETE: unauthorized (401), non-admin token if applicable, validation errors (400)
- Stock/inventory adjustment edge cases for product routes`;
    case 'cart_order':
      return `Domain focus — Cart & Order Flow:
- Add/update/remove cart items; empty body and invalid product IDs
- Checkout/place-order with empty cart, missing shipping fields, invalid ObjectId formats
- Authenticated user flows: missing token (401), wrong role (403)
- Order status updates with invalid state transitions`;
    default:
      return '';
  }
}

function buildPrompt(
  route: RouteMetadata,
  source: string,
  baseAppUrl: string,
  routesIndex: string,
  domain: TestDomain,
): string {
  const domainBlock = domainScenarioBlock(domain);

  return `You are a senior backend QA engineer. Generate comprehensive HTTP test cases for this Express route.

Testing domain: ${domainLabel(domain)}
${domainBlock}

Application:
- Base URL: ${baseAppUrl}
- API mount: app.use('/api/v1', apiRoutes) — combine with router.use mounts in routes/index.ts
- Use FULL request paths in each test case "path" field (e.g. "/api/v1/products", "/api/v1/auth/login"), not router-local paths like "/" alone

routes/index.ts (mount prefixes):
\`\`\`
${routesIndex}
\`\`\`

Route metadata:
- Method: ${route.method}
- Path: ${route.path} (relative to this router file — resolve to full URL path)
- Handler: ${route.handler}
- File: ${route.filePath}

Source file:
\`\`\`
${source}
\`\`\`

Generate test scenarios covering:
1. Happy path — valid request with expected success response
2. Edge cases — missing required fields, invalid types, empty strings, boundary values, very long strings, negative numbers
3. Security payloads — SQL injection strings in text fields, XSS-like strings where applicable
4. Auth scenarios — unauthorized access if auth middleware is present

Respond with a pure JSON array only — no markdown fences, no explanation. Each item:
{ "name": string, "method": string, "path": string, "body": object?, "headers": object?, "expectedStatus": number, "expectedShape": object? }

expectedShape values must be one of: "string", "number", "boolean", "object", "array", "null".`;
}

export type GenerateTestOptions = {
  domain: TestDomain;
  requireOpenRouter?: boolean;
};

export async function generateTestCases(
  route: RouteMetadata,
  options?: GenerateTestOptions,
): Promise<TestCase[]> {
  const config = loadConfig();
  const domain = options?.domain ?? 'other';
  const requireOpenRouter = options?.requireOpenRouter ?? false;

  let source: string;
  try {
    source = await fs.readFile(route.filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read route file ${route.filePath}: ${message}`);
  }

  const routesIndex = await readRoutesIndex(route.filePath);
  const openai = createOpenRouterClient(config);

  logger.info(
    { method: route.method, path: route.path, domain: domainLabel(domain) },
    'Generating test cases via OpenRouter',
  );

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [
        {
          role: 'user',
          content: buildPrompt(route, source, config.BASE_APP_URL, routesIndex, domain),
        },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      if (requireOpenRouter) {
        logger.fatal(
          { path: route.path },
          'OpenRouter credits exhausted — integration run requires a funded OpenRouter account',
        );
        process.exit(1);
      }
      logger.warn(
        { path: route.path },
        'OpenRouter credits exhausted — using deterministic smoke tests',
      );
      return generateSmokeTestCases(route, source);
    }
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, `route ${route.path}`);
  const testCases = parseTestCases(text, route);
  logger.debug({ count: testCases.length, path: route.path }, 'Test cases generated');
  return testCases;
}

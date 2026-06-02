import axios, { isAxiosError } from 'axios';

import { AXIOS_TIMEOUT_MS, loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { ExpectedShape, ShapeFieldType, TestCase, TestResult } from '../utils/types.js';

function buildRequestUrl(baseUrl: string, routePath: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${path}`;
}

function getJsType(value: unknown): ShapeFieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as ShapeFieldType;
}

function validateShape(body: unknown, expectedShape: ExpectedShape): string | null {
  if (typeof body !== 'object' || body === null) {
    return 'Response body is not an object';
  }

  const record = body as Record<string, unknown>;

  for (const [key, expectedType] of Object.entries(expectedShape)) {
    if (!(key in record)) {
      return `Missing key "${key}" in response body`;
    }

    const actualType = getJsType(record[key]);
    if (actualType !== expectedType) {
      return `Key "${key}" expected type "${expectedType}" but got "${actualType}"`;
    }
  }

  return null;
}

export async function runTestCase(testCase: TestCase): Promise<TestResult> {
  const { BASE_APP_URL } = loadConfig();
  const url = buildRequestUrl(BASE_APP_URL, testCase.path);
  const start = Date.now();

  try {
    const response = await axios({
      method: testCase.method.toLowerCase(),
      url,
      data: testCase.body,
      headers: testCase.headers,
      timeout: AXIOS_TIMEOUT_MS,
      validateStatus: () => true,
    });

    const responseTime = Date.now() - start;
    const statusMatch = response.status === testCase.expectedStatus;

    let shapeError: string | null = null;
    if (statusMatch && testCase.expectedShape) {
      shapeError = validateShape(response.data, testCase.expectedShape);
    }

    const passed = statusMatch && shapeError === null;
    const error = !statusMatch
      ? `Expected status ${testCase.expectedStatus} but got ${response.status}`
      : (shapeError ?? undefined);

    return {
      testCase,
      passed,
      actualStatus: response.status,
      actualBody: response.data,
      responseTime,
      error,
    };
  } catch (err) {
    const responseTime = Date.now() - start;
    const message = isAxiosError(err)
      ? (err.message ?? 'Axios request failed')
      : err instanceof Error
        ? err.message
        : String(err);

    logger.warn({ test: testCase.name, url, err: message }, 'Test request error');

    return {
      testCase,
      passed: false,
      actualStatus: isAxiosError(err) ? (err.response?.status ?? 0) : 0,
      actualBody: isAxiosError(err) ? (err.response?.data ?? null) : null,
      responseTime,
      error: message,
    };
  }
}

export async function runTestCases(testCases: TestCase[]): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const testCase of testCases) {
    results.push(await runTestCase(testCase));
  }
  return results;
}

import { resolvePatchTarget } from './patchTargetResolver.js';
import { recordFix, type FixOutcome } from './fixSummary.js';
import { runRetryLoop } from '../patcher/retryLoop.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { BugReport, RouteMetadata, TestCase, TestResult } from '../utils/types.js';
import { runTestCase } from './testRunner.js';

export function shouldAutoFix(result: TestResult, testCase: TestCase): boolean {
  if (result.passed) return false;
  if (result.actualStatus === 0) return false;
  if (result.actualStatus >= 500) return true;
  return testCase.expectedStatus < 400;
}

function buildBugReport(
  route: RouteMetadata,
  testCase: TestCase,
  result: TestResult,
  patchFile: string,
): BugReport {
  return {
    title: `Test failure: ${testCase.method} ${testCase.path}`,
    description: [
      `Route definition: ${route.method} ${route.path}`,
      `Test: ${testCase.name}`,
      `Expected status: ${testCase.expectedStatus}`,
      `Actual status: ${result.actualStatus}`,
      result.error ? `Assertion: ${result.error}` : '',
      `Response body: ${JSON.stringify(result.actualBody)}`,
      `Patch target: ${patchFile}`,
      'Fix the root cause so the endpoint returns the expected success response or a correct handled error.',
    ]
      .filter(Boolean)
      .join('\n'),
    filePath: patchFile,
    context: [],
  };
}

export async function attemptAutoHeal(
  route: RouteMetadata,
  testCase: TestCase,
  result: TestResult,
): Promise<{ outcome: FixOutcome; recheck: TestResult }> {
  const config = loadConfig();
  if (!config.AUTO_FIX_ON_FAILURE) {
    recordFix({
      testName: testCase.name,
      method: testCase.method,
      path: testCase.path,
      error: result.error ?? `HTTP ${result.actualStatus}`,
      patchFile: '(auto-fix disabled)',
      outcome: 'skipped',
      attempts: 0,
      note: 'Set AUTO_FIX_ON_FAILURE=true to enable',
    });
    return { outcome: 'skipped', recheck: result };
  }

  const patchFile = await resolvePatchTarget(route, result);

  logger.error(
    {
      method: testCase.method,
      path: testCase.path,
      status: result.actualStatus,
      patchFile,
    },
    'Test failure — entering auto-fix patch loop',
  );

  const bug = buildBugReport(route, testCase, result, patchFile);
  let attemptsUsed = 0;

  const loopOutcome = await runRetryLoop(bug, async () => {
    attemptsUsed++;
    const retry = await runTestCase(testCase);
    return retry.passed;
  });

  const recheck = await runTestCase(testCase);
  const outcome: FixOutcome = loopOutcome === 'fixed' && recheck.passed ? 'fixed' : 'failed';

  recordFix({
    testName: testCase.name,
    method: testCase.method,
    path: testCase.path,
    error: result.error ?? `Expected ${testCase.expectedStatus}, got ${result.actualStatus}`,
    patchFile,
    outcome,
    attempts: attemptsUsed,
    note:
      outcome === 'fixed'
        ? 'Patch verified — test passes on re-run'
        : 'Patch loop exhausted or test still failing',
  });

  if (outcome === 'fixed') {
    logger.info({ patchFile, test: testCase.name }, 'Auto-fix verified');
  } else {
    logger.warn({ patchFile, test: testCase.name }, 'Auto-fix did not resolve failure');
  }

  return { outcome, recheck };
}

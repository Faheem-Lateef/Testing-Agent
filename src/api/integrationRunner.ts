import { apiCall, authHeader, extractId } from './e2eClient.js';
import { runE2eFlows } from './e2eFlows.js';
import { getE2eSession, type E2eTestSession } from './testSession.js';
import { generateDomainBatchTestCases, routeKey } from './domainBatchTestGenerator.js';
import { verifyOpenRouterConnection } from './openRouterHealth.js';
import {
  createEmptySummary,
  printIntegrationSummary,
  type IntegrationRunSummary,
} from './integrationReport.js';
import { parseRoutes } from './routeParser.js';
import { domainLabel, getRouteDomain, sortRoutesByDomain, type TestDomain } from './routeDomains.js';
import { runTestCase } from './testRunner.js';
import { detectBackendProfile } from './backendProfile.js';
import { shouldAutoFix, attemptAutoHeal } from './autoHeal.js';
import { clearFixRecords, printFixSummary } from './fixSummary.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { RouteMetadata, TestCase, TestResult } from '../utils/types.js';

function logAxiosResponse(result: TestResult): void {
  logger.info(
    {
      test: result.testCase.name,
      method: result.testCase.method,
      path: result.testCase.path,
      expectedStatus: result.testCase.expectedStatus,
      actualStatus: result.actualStatus,
      responseTimeMs: result.responseTime,
      bodyPreview:
        typeof result.actualBody === 'object'
          ? JSON.stringify(result.actualBody).slice(0, 500)
          : result.actualBody,
    },
    result.passed ? 'Axios response — passed' : 'Axios response — failed',
  );
}

function isConnectionFailure(result: TestResult): boolean {
  return result.actualStatus === 0;
}

export async function runIntegrationApiPhase(): Promise<IntegrationRunSummary> {
  clearFixRecords();
  const config = loadConfig();
  const routes = sortRoutesByDomain(await parseRoutes(config.ROUTES_DIR));
  const profile = detectBackendProfile(routes);
  const summary = createEmptySummary(routes.length);
  summary.backendProfile = profile;
  summary.backendRoot = config.GIT_REPO_ROOT;

  try {
    await verifyOpenRouterConnection();
    summary.openRouterVerified = true;
  } catch {
    summary.openRouterVerified = false;
  }

  logger.info(
    { profile, routes: routes.length, autoFix: config.AUTO_FIX_ON_FAILURE },
    'Backend profile detected',
  );

  if (profile === 'ecommerce') {
    await runE2eFlows(summary);
    if (summary.aborted) {
      printFixSummary();
      printIntegrationSummary(summary);
      process.exit(1);
    }
    summary.e2eScenarioRan = true;
  } else {
    logger.info('Generic backend — running route tests only (no ecommerce E2E scenario)');
    summary.e2eScenarioRan = false;
  }

  logger.info(
    { endpointCount: routes.length, sequence: 'auth → catalog → cart_order' },
    'Testing all discovered endpoints',
  );

  let currentDomain: TestDomain | null = null;
  let domainRoutes: RouteMetadata[] = [];

  async function refreshCatalogProductForCart(session: E2eTestSession): Promise<void> {
    const created = await apiCall('POST', '/api/v1/products', {
      label: 'refresh-product-for-cart-tests',
      headers: authHeader(session.adminToken),
      body: {
        name: `QA Cart Product ${Date.now()}`,
        description: 'Product recreated for cart endpoint tests after catalog mutations.',
        price: 15,
        categoryId: session.categoryId,
        stock: 25,
      },
    });
    const id = extractId(created.data);
    if (id) session.productId = id;
  }

  async function flushDomainBatch(domain: TestDomain): Promise<void> {
    if (domainRoutes.length === 0) return;

    const session = getE2eSession();
    if (domain === 'cart_order' && session) {
      await refreshCatalogProductForCart(session);
    }

    const { tests: batchTests, usedOpenRouter } = await generateDomainBatchTestCases(
      domainRoutes,
      domain,
    );
    if (usedOpenRouter) {
      summary.openRouterGeneratedTests = true;
    }

    for (const route of domainRoutes) {
      const key = routeKey(route);
      const testCases = batchTests.get(key) ?? [];

      logger.info(
        { domain: domainLabel(domain), method: route.method, path: route.path, file: route.filePath },
        'Endpoint under test',
      );

      for (const testCase of testCases) {
        await executeTestCase(route, testCase, summary);
      }
    }

    domainRoutes = [];
  }

  for (const route of routes) {
    const domain = getRouteDomain(route);

    if (domain !== currentDomain) {
      if (currentDomain !== null) {
        await flushDomainBatch(currentDomain);
      }
      currentDomain = domain;
      domainRoutes = [];
      if (!summary.domainsExecuted.includes(domain)) {
        summary.domainsExecuted.push(domain);
      }
      logger.info({ domain: domainLabel(domain) }, '── Domain phase started ──');
    }

    domainRoutes.push(route);
  }

  if (currentDomain !== null) {
    await flushDomainBatch(currentDomain);
  }

  printFixSummary();
  printIntegrationSummary(summary);
  return summary;
}

async function executeTestCase(
  route: RouteMetadata,
  testCase: TestCase,
  summary: IntegrationRunSummary,
): Promise<void> {
  summary.testsTotal++;
  let result = await runTestCase(testCase);
  logAxiosResponse(result);

  if (isConnectionFailure(result)) {
    summary.testsFailed++;
    summary.aborted = true;
    summary.abortReason = `Server unreachable for ${testCase.path}: ${result.error ?? 'connection failed'}`;
    logger.fatal({ path: testCase.path }, 'HALT — start your backend server then re-run');
    printFixSummary();
    printIntegrationSummary(summary);
    process.exit(1);
  }

  if (result.passed) {
    summary.testsPassed++;
    return;
  }

  if (shouldAutoFix(result, testCase)) {
    const { outcome, recheck } = await attemptAutoHeal(route, testCase, result);
    if (outcome === 'fixed' && recheck.passed) {
      summary.testsPassed++;
      return;
    }
    result = recheck;
  }

  summary.testsFailed++;
  logger.warn(
    { name: testCase.name, path: testCase.path, error: result.error },
    'Test still failing after auto-fix attempt',
  );
}

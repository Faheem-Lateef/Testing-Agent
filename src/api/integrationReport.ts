import { logger } from '../utils/logger.js';
import { domainLabel } from './routeDomains.js';
import { getFixRecords } from './fixSummary.js';
import type { TestDomain } from './routeDomains.js';

export interface IntegrationRunSummary {
  endpointsDiscovered: number;
  testsTotal: number;
  testsPassed: number;
  testsFailed: number;
  selfHealedFiles: string[];
  domainsExecuted: TestDomain[];
  openRouterVerified: boolean;
  openRouterGeneratedTests: boolean;
  backendProfile?: string;
  backendRoot?: string;
  e2eScenarioRan?: boolean;
  aborted: boolean;
  abortReason?: string;
}

export function createEmptySummary(endpointsDiscovered: number): IntegrationRunSummary {
  return {
    endpointsDiscovered,
    testsTotal: 0,
    testsPassed: 0,
    testsFailed: 0,
    selfHealedFiles: [],
    domainsExecuted: [],
    openRouterVerified: false,
    openRouterGeneratedTests: false,
    aborted: false,
  };
}

export function printIntegrationSummary(summary: IntegrationRunSummary): void {
  const domains =
    summary.domainsExecuted.length > 0
      ? summary.domainsExecuted.map((d) => domainLabel(d)).join(' → ')
      : '(none)';

  const fixedFiles = [
    ...new Set(getFixRecords().filter((r) => r.outcome === 'fixed').map((r) => r.patchFile)),
  ];
  const healedList = fixedFiles.length > 0 ? fixedFiles.join(', ') : '(none)';

  const e2eLine = summary.e2eScenarioRan
    ? 'E2E scenario             : auth → catalog → cart → order (live data)'
    : 'E2E scenario             : skipped (generic backend profile)';

  const lines = [
    '',
    '══════════════════════════════════════════════════════════',
    '           INTEGRATION TEST RUN — FINAL REPORT',
    '══════════════════════════════════════════════════════════',
    ...(summary.backendRoot ? [`  Backend                  : ${summary.backendRoot}`] : []),
    ...(summary.backendProfile ? [`  Profile                  : ${summary.backendProfile}`] : []),
    `  Endpoints discovered     : ${summary.endpointsDiscovered}`,
    `  Tests executed           : ${summary.testsTotal}`,
    `  Tests passed             : ${summary.testsPassed}`,
    `  Tests failed             : ${summary.testsFailed}`,
    `  Auto-fix enabled         : ${summary.testsFailed === 0 ? 'yes' : 'see fix summary above'}`,
    `  OpenRouter verified      : ${summary.openRouterVerified ? 'yes' : 'no'}`,
    `  OpenRouter test payloads : ${summary.openRouterGeneratedTests ? 'yes' : 'no (flow/smoke fallback)'}`,
    e2eLine,
    `  Domain sequence          : ${domains}`,
    `  Files auto-fixed         : ${healedList}`,
    `  Run aborted              : ${summary.aborted ? 'yes' : 'no'}`,
    ...(summary.abortReason ? [`  Abort reason             : ${summary.abortReason}`] : []),
    '══════════════════════════════════════════════════════════',
    '',
  ];

  for (const line of lines) {
    logger.info(line);
  }
}

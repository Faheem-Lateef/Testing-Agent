import { runIntegrationApiPhase } from './api/integrationRunner.js';
import { openPullRequest } from './git/prManager.js';
import { runRetryLoop } from './patcher/retryLoop.js';
import { captureScreenshot } from './ui/screenshot.js';
import { fetchFigmaFrame } from './ui/figma.js';
import { compareImages } from './ui/pixelDiff.js';
import { runSemanticDiff } from './ui/semanticDiff.js';
import {
  getFigmaRouteMap,
  getFigmaSourceMap,
  loadConfig,
  PIXEL_MISMATCH_THRESHOLD,
} from './utils/config.js';
import { logger } from './utils/logger.js';
import type { BugReport, PatchOutcome } from './utils/types.js';

async function handlePatchOutcome(
  outcome: PatchOutcome,
  bug: BugReport,
): Promise<void> {
  if (outcome === 'fixed') {
    logger.info({ title: bug.title, file: bug.filePath }, 'Verified fix achieved');
    const prUrl = await openPullRequest(bug.title, bug.description, bug.filePath);
    if (prUrl) {
      logger.info({ prUrl }, 'Pull request created');
    }
    return;
  }

  logger.warn({ title: bug.title, file: bug.filePath }, 'Human review required');
}

async function runUiPhase(): Promise<void> {
  const config = loadConfig();
  const figmaRoutes = getFigmaRouteMap();
  const figmaSources = getFigmaSourceMap();
  const entries = Object.entries(figmaRoutes);

  if (entries.length === 0) {
    logger.info('No FIGMA_ROUTE_MAP entries — skipping UI phase');
    return;
  }

  if (!config.hasFigma) {
    logger.warn('Figma credentials not configured — skipping UI phase');
    return;
  }

  logger.info({ routes: entries.length }, 'Starting UI regression phase');

  for (const [route, nodeId] of entries) {
    logger.info({ route, nodeId }, 'UI compare started');

    const screenshotPath = await captureScreenshot(route);
    const figmaPath = await fetchFigmaFrame(nodeId);
    const { mismatchRatio, diffImagePath } = await compareImages(screenshotPath, figmaPath);

    logger.info({ route, mismatchRatio, diffImagePath }, 'Pixel diff result');

    if (mismatchRatio <= PIXEL_MISMATCH_THRESHOLD) {
      logger.info({ route }, 'UI within threshold — passed');
      continue;
    }

    const semanticIssues = await runSemanticDiff(screenshotPath, figmaPath);
    const sourceFile = figmaSources[route];

    if (!sourceFile) {
      logger.warn(
        { route },
        'No FIGMA_SOURCE_MAP entry — cannot patch UI defect automatically',
      );
      continue;
    }

    const bug: BugReport = {
      title: `UI regression on ${route}`,
      description: `Pixel mismatch ${(mismatchRatio * 100).toFixed(2)}% exceeds ${PIXEL_MISMATCH_THRESHOLD * 100}% threshold.\nSemantic issues: ${JSON.stringify(semanticIssues, null, 2)}`,
      filePath: sourceFile,
      context: [],
    };

    const outcome = await runRetryLoop(bug, async () => {
      const freshScreenshot = await captureScreenshot(route);
      const { mismatchRatio: freshRatio } = await compareImages(freshScreenshot, figmaPath);
      return freshRatio <= PIXEL_MISMATCH_THRESHOLD;
    });

    await handlePatchOutcome(outcome, bug);
  }
}

export async function runFullQACycle(): Promise<void> {
  loadConfig();
  logger.info('QA cycle started — auto-discover, test all routes, fix failures, summarize');

  await runUiPhase();
  await runIntegrationApiPhase();

  logger.info('QA cycle finished');
}

// Legacy API phase kept for reference — integrationRunner replaces it
export async function runApiPhase(): Promise<void> {
  await runIntegrationApiPhase();
}

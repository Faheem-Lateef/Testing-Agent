import { generateFix } from './bugFixer.js';
import { applyPatch } from './applyPatch.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { BugReport, PatchOutcome } from '../utils/types.js';

export async function runRetryLoop(
  bug: BugReport,
  verifyFn: () => Promise<boolean>,
): Promise<PatchOutcome> {
  const { MAX_PATCH_RETRIES } = loadConfig();
  const report: BugReport = { ...bug, context: [...bug.context] };

  for (let attempt = 1; attempt <= MAX_PATCH_RETRIES; attempt++) {
    logger.info({ attempt, max: MAX_PATCH_RETRIES, file: report.filePath }, 'Patch attempt');

    let patchedContent: string;
    try {
      patchedContent = await generateFix(report);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ attempt, err: message }, 'Patch generation failed');
      report.context.push(`Attempt ${attempt} generation error: ${message}`);
      continue;
    }

    const applied = await applyPatch(report.filePath, patchedContent);
    if (!applied) {
      report.context.push(`Attempt ${attempt} failed compile gate:\n${patchedContent}`);
      continue;
    }

    let verified = false;
    try {
      verified = await verifyFn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, err: message }, 'Verification function threw');
      report.context.push(`Attempt ${attempt} verified=false (error: ${message})\n${patchedContent}`);
      continue;
    }

    if (verified) {
      logger.info({ attempt, file: report.filePath }, 'Bug verified fixed');
      return 'fixed';
    }

    report.context.push(`Attempt ${attempt} failed verification:\n${patchedContent}`);
    logger.warn({ attempt }, 'Patch applied but verification failed');
  }

  logger.warn({ file: report.filePath }, 'Max patch retries exhausted — human review required');
  return 'human_review';
}

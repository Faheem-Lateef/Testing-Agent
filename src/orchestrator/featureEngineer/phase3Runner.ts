import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { phaseLog, engineerLog } from './logging.js';
import type { FeatureJourneyResult, TestMilestone } from './types.js';

const execFileAsync = promisify(execFile);

const RESULT_MARKER = '__FEATURE_RESULT__';

export function parseFeatureResult(stdout: string, stderr: string, exitCode: number): FeatureJourneyResult {
  const combined = `${stdout}\n${stderr}`;
  const line = combined.split('\n').find((l) => l.includes(RESULT_MARKER));
  if (line) {
    try {
      const json = line.slice(line.indexOf(RESULT_MARKER) + RESULT_MARKER.length);
      const parsed = JSON.parse(json) as FeatureJourneyResult;
      return {
        passed: Boolean(parsed.passed),
        steps: Array.isArray(parsed.steps) ? parsed.steps : [],
        error: parsed.error,
        stackTrace: parsed.stackTrace,
        subtotalBefore: parsed.subtotalBefore,
        subtotalAfter: parsed.subtotalAfter,
        discountPercent: parsed.discountPercent,
        couponCode: parsed.couponCode,
      };
    } catch {
      /* fall through */
    }
  }

  return {
    passed: exitCode === 0,
    steps: [],
    error: exitCode !== 0 ? stderr || stdout || `Process exited ${exitCode}` : undefined,
    stackTrace: stderr,
  };
}

export async function executeGeneratedFeatureTest(testFilePath: string): Promise<FeatureJourneyResult> {
  phaseLog('PHASE_3_SELF_HEALING', `Launching Playwright journey: ${testFilePath}`);

  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', testFilePath],
      {
        cwd: process.cwd(),
        timeout: 300_000,
        env: { ...process.env },
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const result = parseFeatureResult(stdout, stderr, 0);
    if (result.passed) {
      phaseLog('PHASE_3_SELF_HEALING', `Journey passed (${result.steps.length} steps)`);
    } else {
      phaseLog('PHASE_3_SELF_HEALING', `Journey failed: ${result.error ?? 'unknown'}`);
    }
    return result;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const result = parseFeatureResult(e.stdout ?? '', e.stderr ?? '', e.code ?? 1);
    engineerLog(`Playwright execution error: ${result.error ?? 'exec failed'}`);
    return result;
  }
}

export function milestonesFromJourney(result: FeatureJourneyResult): TestMilestone[] {
  const labels: Record<string, string> = {
    'A-open-register': 'Step A: Open registration',
    'A-register': 'Step A: Register / login test user',
    'B-browse': 'Step B: Browse / add product',
    'B-checkout': 'Step B: Complete first checkout',
    'C-extract-coupon': 'Step C: Extract coupon code',
    'D-apply-coupon': 'Step D: Apply coupon on second purchase',
    'E-price-assert': 'Step E: Discount math assertion',
  };

  if (result.steps.length === 0) {
    return [
      {
        id: 'journey',
        label: result.passed ? 'Full journey completed' : `Journey failed: ${result.error ?? 'error'}`,
        passed: result.passed,
      },
    ];
  }

  return result.steps.map((step, i) => ({
    id: step,
    label: labels[step] ?? `Milestone ${i + 1}: ${step}`,
    passed: true,
  }));
}

export function formatFailurePayload(result: FeatureJourneyResult): string {
  return JSON.stringify(
    {
      passed: result.passed,
      error: result.error,
      stackTrace: result.stackTrace,
      steps: result.steps,
      subtotalBefore: result.subtotalBefore,
      subtotalAfter: result.subtotalAfter,
      discountPercent: result.discountPercent,
      couponCode: result.couponCode,
    },
    null,
    2,
  );
}

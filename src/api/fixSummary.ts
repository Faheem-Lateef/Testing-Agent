import { logger } from '../utils/logger.js';

export type FixOutcome = 'fixed' | 'failed' | 'skipped';

export interface FixRecord {
  testName: string;
  method: string;
  path: string;
  error: string;
  patchFile: string;
  outcome: FixOutcome;
  attempts: number;
  note?: string;
}

const records: FixRecord[] = [];

export function recordFix(entry: FixRecord): void {
  records.push(entry);
}

export function getFixRecords(): FixRecord[] {
  return [...records];
}

export function clearFixRecords(): void {
  records.length = 0;
}

export function printFixSummary(): void {
  if (records.length === 0) {
    logger.info('No auto-fix attempts were required this run.');
    return;
  }

  const lines = [
    '',
    '────────────────── ERRORS FOUND & FIXES ──────────────────',
  ];

  records.forEach((r, index) => {
    lines.push('');
    lines.push(`${index + 1}. ${r.method} ${r.path}`);
    lines.push(`   Test     : ${r.testName}`);
    lines.push(`   Error    : ${r.error}`);
    lines.push(`   File     : ${r.patchFile}`);
    lines.push(`   Outcome  : ${r.outcome}${r.attempts > 0 ? ` (${r.attempts} attempt(s))` : ''}`);
    if (r.note) lines.push(`   Note     : ${r.note}`);
  });

  const fixed = records.filter((r) => r.outcome === 'fixed').length;
  const failed = records.filter((r) => r.outcome === 'failed').length;

  lines.push('');
  lines.push(`  Auto-fixed : ${fixed}  |  Could not fix : ${failed}  |  Total issues : ${records.length}`);
  lines.push('──────────────────────────────────────────────────────────');
  lines.push('');

  for (const line of lines) {
    logger.info(line);
  }
}

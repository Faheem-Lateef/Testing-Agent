import { devLog, patchLog, testLog } from './logging.js';
import type {
  FileChangeRecord,
  HealCycleRecord,
  LifecyclePhase,
  TestMilestone,
} from './types.js';

export interface EngineeringReportInput {
  featureSpec: string;
  phase: LifecyclePhase;
  fileChanges: FileChangeRecord[];
  generatedTestPath: string | null;
  milestones: TestMilestone[];
  healCycles: HealCycleRecord[];
  compileAttempts: number;
  healAttempts: number;
  success: boolean;
}

export function printEngineeringReport(input: EngineeringReportInput): string {
  const lines: string[] = [
    '',
    '══════════════════════════════════════════════════════════',
    '        AUTONOMOUS FEATURE ENGINEER — FINAL REPORT',
    '══════════════════════════════════════════════════════════',
    `Feature: ${input.featureSpec.slice(0, 120)}`,
    `Outcome: ${input.success ? 'SUCCESS' : 'FAILED'}`,
    '',
  ];

  lines.push('[DEVELOPMENT LOG] Files modified/created:');
  const backend = input.fileChanges.filter((f) => f.repo === 'backend');
  const frontend = input.fileChanges.filter((f) => f.repo === 'frontend');
  const qa = input.fileChanges.filter((f) => f.repo === 'qa-agent');

  if (backend.length === 0) lines.push('  Backend: (none recorded)');
  for (const f of backend) {
    const line = `  [backend] ${f.action}: ${f.relativePath}`;
    lines.push(line);
    devLog(line.trim());
  }

  if (frontend.length === 0) lines.push('  Frontend: (none recorded)');
  for (const f of frontend) {
    const line = `  [frontend] ${f.action}: ${f.relativePath}`;
    lines.push(line);
    devLog(line.trim());
  }

  for (const f of qa) {
    const line = `  [qa-agent] ${f.action}: ${f.relativePath}`;
    lines.push(line);
    devLog(line.trim());
  }

  if (input.generatedTestPath) {
    const t = `  Generated test: ${input.generatedTestPath}`;
    lines.push(t);
    devLog(t.trim());
  }

  lines.push('');
  lines.push('[TEST COMPLIANCE] User journey milestones:');
  for (const m of input.milestones) {
    const mark = m.passed ? '✓' : '✗';
    const line = `  ${mark} ${m.label}`;
    lines.push(line);
    testLog(line.trim());
  }

  if (input.milestones.every((m) => m.passed) && input.success) {
    testLog('Full journey: 100% milestone compliance');
  }

  lines.push('');
  lines.push('[PATCH SUMMARY] Self-healing cycles:');
  const summary = `  Compile-fix attempts (Phase 1): ${input.compileAttempts}`;
  const healSummary = `  Live-test heal cycles (Phase 3): ${input.healCycles.length} / max ${input.healAttempts}`;
  lines.push(summary);
  lines.push(healSummary);
  patchLog(summary.trim());
  patchLog(healSummary.trim());

  for (const h of input.healCycles) {
    const line = `  Cycle ${h.cycle}: ${h.journeyResult.passed ? 'PASS' : 'FAIL'} — ${h.fixesApplied.length} fix(es)`;
    lines.push(line);
    patchLog(line.trim());
    if (h.debugAnalysis?.rootCause) {
      lines.push(`    Root cause: ${h.debugAnalysis.rootCause}`);
    }
  }

  if (input.success) {
    patchLog(`Stability achieved after ${input.healCycles.length} heal cycle(s)`);
  }

  lines.push('══════════════════════════════════════════════════════════');
  lines.push('');

  const report = lines.join('\n');
  console.log(report);
  return report;
}

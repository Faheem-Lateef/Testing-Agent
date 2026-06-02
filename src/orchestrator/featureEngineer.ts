import path from 'node:path';

import { loadConfig, resetConfigCache } from '../utils/config.js';
import {
  formatCompileFailures,
  gitRollbackWorkspace,
  pathExists,
  verifyAllTargets,
} from './featureEngineer/compilerSandbox.js';
import { FeatureEngineerFsm } from './featureEngineer/fsm.js';
import { engineerLog, phaseLog } from './featureEngineer/logging.js';
import {
  loadMemoryBankSync,
  loadProjectMemoryBank,
  writeProgressLog,
  checkMemoryDrift,
  refreshActiveContextHeader,
} from './featureEngineer/memoryBank.js';
import { detectAgentDuplicates } from './featureEngineer/duplicateDetector.js';
import {
  scaffoldWorkspaceIfBlank,
  DEFAULT_BACKEND_URL,
  DEFAULT_FRONTEND_URL,
} from './featureEngineer/projectScaffolder.js';
import { runFullStackDevelopmentPhase, runSelfHealAnalysisPhase } from './featureEngineer/openRouterPhases.js';
import { applyDevelopmentFiles, applyHealFix } from './featureEngineer/phase1Development.js';
import { generateFeatureTest } from './featureEngineer/phase2TestGen.js';
import {
  executeGeneratedFeatureTest,
  formatFailurePayload,
  milestonesFromJourney,
} from './featureEngineer/phase3Runner.js';
import { printEngineeringReport } from './featureEngineer/phase4Report.js';
import { analyzeRepositories } from './featureEngineer/repoAnalyzer.js';
import type {
  FeatureEngineerOptions,
  FeatureEngineerResult,
  FileChangeRecord,
  HealCycleRecord,
} from './featureEngineer/types.js';
import { MAX_COMPILE_ATTEMPTS, MAX_HEAL_ATTEMPTS } from './featureEngineer/types.js';

export {
  MAX_COMPILE_ATTEMPTS,
  MAX_HEAL_ATTEMPTS,
  MAX_EVOLUTION_ATTEMPTS,
} from './featureEngineer/types.js';
export type { AgentState, FeatureEngineerOptions, FeatureEngineerResult } from './featureEngineer/types.js';

interface WorkspaceRoots {
  backendRoot: string;
  frontendRoot: string;
  qaAgentRoot: string;
}

async function resolveWorkspaceRoots(options: FeatureEngineerOptions): Promise<WorkspaceRoots> {
  const config = loadConfig();
  const qaAgentRoot = process.cwd();

  const candidates = [
    options.backendRoot,
    path.resolve(qaAgentRoot, 'backend demo', 'ecommerce-backend'),
    path.resolve(qaAgentRoot, '../ecommerce-backend'),
    config.GIT_REPO_ROOT,
  ].filter(Boolean) as string[];

  let backendRoot = path.resolve(candidates[0] ?? config.GIT_REPO_ROOT);
  for (const c of candidates) {
    const resolved = path.resolve(c);
    if (await pathExists(path.join(resolved, 'package.json'))) {
      backendRoot = resolved;
      break;
    }
  }

  const siblingFrontend = path.join(path.dirname(backendRoot), 'ecommerce-frontend');
  const demoFrontend = path.resolve(qaAgentRoot, 'backend demo', 'ecommerce-frontend');
  let frontendRoot = options.frontendRoot
    ? path.resolve(options.frontendRoot)
    : (await pathExists(siblingFrontend))
      ? siblingFrontend
      : demoFrontend;

  engineerLog(`Backend: ${backendRoot}`);
  engineerLog(`Frontend: ${frontendRoot}`);

  return { backendRoot, frontendRoot, qaAgentRoot };
}

function mergeChanges(target: FileChangeRecord[], incoming: FileChangeRecord[]): void {
  for (const c of incoming) {
    const idx = target.findIndex(
      (t) => t.repo === c.repo && t.relativePath === c.relativePath,
    );
    if (idx >= 0) target[idx] = c;
    else target.push(c);
  }
}

/**
 * Autonomous Feature Engineer — Developer + Tester + Self-Healing Debugger.
 *
 * PHASE 1: Full-stack development + compile guard
 * PHASE 2: Dynamic Playwright test in src/ui/generated/
 * PHASE 3: Live re-test with up to 4 heal cycles
 * PHASE 4: Engineering report
 */
export async function runFeatureEngineer(
  options: FeatureEngineerOptions,
): Promise<FeatureEngineerResult> {
  // ── GUARANTEED INIT: sync cold-boot memory load ────────────────────────
  // Runs as the ABSOLUTE FIRST operation using fs.readFileSync so the
  // memory bank is available before any async I/O, LLM calls, or FSM setup.
  const qaAgentRoot = process.cwd();
  const syncMemory = loadMemoryBankSync(qaAgentRoot);

  // ── STEP 1: Inject URL/path defaults before any loadConfig() call ────────
  // This guarantees blank-canvas runs never crash on missing ROUTES_DIR.
  const defaultBackendPath = path.resolve(qaAgentRoot, 'backend demo', 'ecommerce-backend');
  const defaultFrontendPath = path.resolve(qaAgentRoot, 'backend demo', 'ecommerce-frontend');

  if (!process.env['ROUTES_DIR']?.trim()) {
    const routesCandidate = path.join(options.backendRoot ?? defaultBackendPath, 'src', 'routes');
    process.env['ROUTES_DIR'] = routesCandidate;
    engineerLog(`[BLANK-CANVAS] ROUTES_DIR → ${routesCandidate}`);
  }
  if (!process.env['BASE_APP_URL']?.trim()) {
    process.env['BASE_APP_URL'] = DEFAULT_BACKEND_URL;
    engineerLog(`[BLANK-CANVAS] BASE_APP_URL → ${DEFAULT_BACKEND_URL}`);
  }
  if (!process.env['FRONTEND_APP_URL']?.trim()) {
    process.env['FRONTEND_APP_URL'] = DEFAULT_FRONTEND_URL;
    engineerLog(`[BLANK-CANVAS] FRONTEND_APP_URL → ${DEFAULT_FRONTEND_URL}`);
  }
  if (!process.env['GIT_REPO_ROOT']?.trim()) {
    process.env['GIT_REPO_ROOT'] = options.backendRoot ?? defaultBackendPath;
    engineerLog(`[BLANK-CANVAS] GIT_REPO_ROOT → ${process.env['GIT_REPO_ROOT']}`);
  }
  // Reset cache so loadConfig() picks up the injected defaults
  resetConfigCache();

  const fsm = new FeatureEngineerFsm();
  const roots = await resolveWorkspaceRoots(options);

  // ── STEP 2: Dynamic project scaffolding (mkdirSync + baseline files) ─────
  // Creates backend/frontend directory trees and installs the TypeScript
  // toolchain so the compilation sandbox never throws ENOENT on a blank run.
  const scaffold = scaffoldWorkspaceIfBlank(roots.backendRoot, roots.frontendRoot);
  if (scaffold.isBlankCanvas) {
    // Re-inject ROUTES_DIR with the confirmed backend root after scaffold
    process.env['ROUTES_DIR'] = path.join(roots.backendRoot, 'src', 'routes');
    resetConfigCache();
    engineerLog(`[BLANK-CANVAS] Scaffold complete — backend: ${roots.backendRoot} | frontend: ${roots.frontendRoot}`);
  }

  const config = loadConfig();
  const fileChanges: FileChangeRecord[] = [];
  const healCycles: HealCycleRecord[] = [];
  const compileAttempts: FeatureEngineerResult['attempts'] = [];
  let generatedTestPath: string | null = null;
  let testMilestones: FeatureEngineerResult['testMilestones'] = [];
  let priorErrors: string | undefined;
  let compileAttemptCount = 0;
  let currentPhase: FeatureEngineerResult['phase'] = 'PHASE_1_DEVELOPMENT';
  let journeyPassed = false;

  // ── Accumulate the result object so the finally block can always write it
  let result: FeatureEngineerResult | undefined;

  // Wrap the ENTIRE lifecycle in try/finally so writeProgressLog is called
  // 100% of the time — whether the run succeeds, fails, or throws.
  try {

    fsm.transition('READING_CONTEXT', 'Memory bank + repository analysis');

    // Run memory drift check and duplicate file scan in parallel before
    // any generation — catching stale/diverged context before the LLM sees it.
    const [memoryBank, , dupReport] = await Promise.all([
      loadProjectMemoryBank(roots.qaAgentRoot).then((mb) => mb ?? syncMemory),
      checkMemoryDrift(roots.qaAgentRoot),
      detectAgentDuplicates(roots.qaAgentRoot),
    ]);

    if (!dupReport.clean) {
      engineerLog(
        `⚠ Workspace has ${dupReport.totalIssues} duplicate file issue(s) — ` +
        `review [DUPLICATE-DETECTOR] log above before proceeding`,
      );
    }

    const repo = await analyzeRepositories(roots.backendRoot, roots.frontendRoot);
    // Merge scaffold detection with repo analysis for coherent blank-canvas flag
    const isBlankCanvas = scaffold.isBlankCanvas || repo.isBlankCanvas;

    // ─── PHASE 1: FULL-STACK DEVELOPMENT ─────────────────────────────────
    phaseLog('PHASE_1_DEVELOPMENT', 'The Developer — generate & inject application code');
    currentPhase = 'PHASE_1_DEVELOPMENT';

    let phase1CompileOk = false;

    for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt++) {
      compileAttemptCount = attempt;
      fsm.transition('INJECTING_CODE', `Development pass ${attempt}/${MAX_COMPILE_ATTEMPTS}`);

      const dev = await runFullStackDevelopmentPhase(
        options.featureSpec,
        memoryBank,
        repo.summary,
        priorErrors,
        isBlankCanvas,
      );

      const applied = await applyDevelopmentFiles(roots.backendRoot, roots.frontendRoot, dev);
      mergeChanges(fileChanges, applied);

      fsm.transition('COMPILING', 'Validate backend + frontend + qa-agent');
      const compileResults = await verifyAllTargets(
        roots.backendRoot,
        roots.frontendRoot,
        roots.qaAgentRoot,
      );
      compileAttempts.push({ attempt, state: 'COMPILING', compileResults });

      phase1CompileOk = compileResults.every((r) => r.success);
      if (phase1CompileOk) {
        phaseLog('PHASE_1_DEVELOPMENT', 'Compilation passed on all targets');
        break;
      }

      priorErrors = formatCompileFailures(compileResults);
      const heal = await runSelfHealAnalysisPhase(priorErrors, memoryBank, repo.summary);
      if (heal.bugFound && heal.fixedInjectedCode) {
        const fix = await applyHealFix(
          roots.backendRoot,
          roots.frontendRoot,
          heal.targetFile,
          heal.fixedInjectedCode,
          heal.replaceEntireFile,
        );
        if (fix) mergeChanges(fileChanges, [fix]);
      }

      if (attempt >= MAX_COMPILE_ATTEMPTS) {
        fsm.forceFailed('Phase 1 compile guard failed after max attempts');
        gitRollbackWorkspace(roots.backendRoot);
        gitRollbackWorkspace(roots.frontendRoot);
        const report = printEngineeringReport({
          featureSpec: options.featureSpec,
          phase: currentPhase,
          fileChanges,
          generatedTestPath,
          milestones: [],
          healCycles,
          compileAttempts: compileAttemptCount,
          healAttempts: MAX_HEAL_ATTEMPTS,
          success: false,
        });
        result = {
          finalState: 'FAILED',
          phase: currentPhase,
          fileChanges,
          generatedTestPath,
          testMilestones: [],
          healCycles,
          compileAttempts: compileAttemptCount,
          healAttempts: MAX_HEAL_ATTEMPTS,
          attempts: compileAttempts,
          memoryBank,
          engineeringReport: report,
          diagnosticReport: report,
        };
        return result;
      }
    }

    if (options.skipPlaywright) {
      fsm.forceCompleted('Playwright skipped by option');
      const report = printEngineeringReport({
        featureSpec: options.featureSpec,
        phase: 'PHASE_4_REPORTING',
        fileChanges,
        generatedTestPath: null,
        milestones: [],
        healCycles,
        compileAttempts: compileAttemptCount,
        healAttempts: 0,
        success: true,
      });
      result = {
        finalState: 'COMPLETED',
        phase: 'PHASE_4_REPORTING',
        fileChanges,
        generatedTestPath: null,
        testMilestones: [],
        healCycles,
        compileAttempts: compileAttemptCount,
        healAttempts: 0,
        attempts: compileAttempts,
        memoryBank,
        engineeringReport: report,
        diagnosticReport: report,
      };
      return result;
    }

    // ─── PHASE 2: DYNAMIC TEST ARCHITECTURE ────────────────────────────────
    phaseLog('PHASE_2_TEST_ARCHITECTURE', 'The Tester — generate feature-specific E2E script');
    currentPhase = 'PHASE_2_TEST_ARCHITECTURE';
    fsm.transition('GENERATING_TESTS', 'OpenRouter writes Playwright journey');

    generatedTestPath = await generateFeatureTest(
      options.featureSpec,
      memoryBank,
      repo.summary,
      roots.qaAgentRoot,
      config.FRONTEND_APP_URL,
    );

    mergeChanges(fileChanges, [
      {
        repo: 'qa-agent',
        relativePath: path.relative(roots.qaAgentRoot, generatedTestPath),
        absolutePath: generatedTestPath,
        action: 'created',
      },
    ]);

    const qaCompile = await verifyAllTargets(roots.backendRoot, roots.frontendRoot, roots.qaAgentRoot);
    if (!qaCompile.find((r) => r.project === 'qa-agent')?.success) {
      phaseLog('PHASE_2_TEST_ARCHITECTURE', 'Generated test typecheck failed — continuing to Phase 3');
    }

    // ─── PHASE 3: LIVE RE-TEST & SELF-HEALING ──────────────────────────────
    phaseLog('PHASE_3_SELF_HEALING', 'The Debugger — Playwright journey up to 4 heal cycles');
    currentPhase = 'PHASE_3_SELF_HEALING';

    for (let cycle = 1; cycle <= MAX_HEAL_ATTEMPTS; cycle++) {
      fsm.transition('TESTING', `Execute generated feature test (cycle ${cycle}/${MAX_HEAL_ATTEMPTS})`);

      const journeyResult = await executeGeneratedFeatureTest(generatedTestPath);
      const record: HealCycleRecord = {
        cycle,
        journeyResult,
        fixesApplied: [],
      };

      if (journeyResult.passed) {
        journeyPassed = true;
        testMilestones = milestonesFromJourney(journeyResult);
        healCycles.push(record);
        phaseLog('PHASE_3_SELF_HEALING', '100% journey success');
        break;
      }

      fsm.transition('DEBUGGING', 'Capture stack trace and route to development engine');
      const failurePayload = formatFailurePayload(journeyResult);
      const debug = await runSelfHealAnalysisPhase(failurePayload, memoryBank, repo.summary);
      record.debugAnalysis = debug;
      healCycles.push(record);

      if (debug.layer === 'test' || debug.targetFile.includes('generated')) {
        phaseLog('PHASE_3_SELF_HEALING', 'Regenerating feature test from heal feedback');
        generatedTestPath = await generateFeatureTest(
          `${options.featureSpec}\n\nFix test errors:\n${debug.rootCause}\n${debug.fixedInjectedCode}`,
          memoryBank,
          repo.summary,
          roots.qaAgentRoot,
          config.FRONTEND_APP_URL,
        );
        record.fixesApplied.push(`regenerated test: ${generatedTestPath}`);
      } else if (debug.bugFound && debug.fixedInjectedCode) {
        const fix = await applyHealFix(
          roots.backendRoot,
          roots.frontendRoot,
          debug.targetFile,
          debug.fixedInjectedCode,
          debug.replaceEntireFile,
        );
        if (fix) {
          mergeChanges(fileChanges, [fix]);
          record.fixesApplied.push(fix.relativePath);
        }
        fsm.transition('COMPILING', 'Re-verify after heal patch');
        const recompile = await verifyAllTargets(
          roots.backendRoot,
          roots.frontendRoot,
          roots.qaAgentRoot,
        );
        if (!recompile.every((r) => r.success)) {
          priorErrors = formatCompileFailures(recompile);
          record.fixesApplied.push('compile still failing after heal');
        }
      }

      if (cycle >= MAX_HEAL_ATTEMPTS) {
        phaseLog('PHASE_3_SELF_HEALING', 'Heal cycles exhausted — proceeding to report');
        gitRollbackWorkspace(roots.backendRoot);
        gitRollbackWorkspace(roots.frontendRoot);
        break;
      }
    }

    // ─── PHASE 4: REASSESSMENT & REPORTING ───────────────────────────────
    currentPhase = 'PHASE_4_REPORTING';
    if (fsm.current !== 'FAILED') {
      fsm.transition('REPORTING', 'Engineering summary');
    }

    if (journeyPassed) {
      fsm.forceCompleted('Feature delivered and verified');
    } else if (fsm.current === 'REPORTING') {
      fsm.forceFailed('Feature journey did not reach 100% success');
    }

    const report = printEngineeringReport({
      featureSpec: options.featureSpec,
      phase: currentPhase,
      fileChanges,
      generatedTestPath,
      milestones: testMilestones,
      healCycles,
      compileAttempts: compileAttemptCount,
      healAttempts: MAX_HEAL_ATTEMPTS,
      success: journeyPassed,
    });

    result = {
      finalState: fsm.current,
      phase: currentPhase,
      fileChanges,
      generatedTestPath,
      testMilestones,
      healCycles,
      compileAttempts: compileAttemptCount,
      healAttempts: MAX_HEAL_ATTEMPTS,
      attempts: compileAttempts,
      memoryBank,
      engineeringReport: report,
      diagnosticReport: report,
    };

    return result;

  } finally {
    // ── GUARANTEED FINALIZATION ────────────────────────────────────────────
    // Both calls below execute whether the try completes, returns early, or
    // throws — so no run is ever left unrecorded and no memory file goes stale.
    const succeeded = result?.finalState === 'COMPLETED';
    const finalState = result?.finalState ?? fsm.current;

    // 1. Append full run record to progress.md in BOTH memory locations
    await writeProgressLog({
      commandType: 'feature-engineer',
      featureSpec: options.featureSpec,
      success: succeeded,
      finalState,
      fileChanges: result?.fileChanges ?? fileChanges,
      healCycles: result?.healCycles ?? healCycles,
      generatedTestPath: result?.generatedTestPath ?? generatedTestPath,
      qaAgentRoot,
    });

    // 2. Stamp "Last updated" + "Last run" header in activeContext.md in BOTH locations
    refreshActiveContextHeader(
      qaAgentRoot,
      options.featureSpec,
      succeeded ? 'SUCCESS' : 'FAILED',
      finalState,
    );
  }
}

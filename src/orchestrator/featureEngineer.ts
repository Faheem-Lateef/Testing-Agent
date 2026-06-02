import path from 'node:path';

import { loadConfig, resetConfigCache } from '../utils/config.js';
import {
  formatCompileFailures,
  gitRollbackWorkspace,
  verifyAllTargets,
} from './featureEngineer/compilerSandbox.js';
import { FeatureEngineerFsm } from './featureEngineer/fsm.js';
import { engineerLog, phaseLog } from './featureEngineer/logging.js';
import {
  loadMemoryBankSync,
  loadProjectMemoryBank,
  checkMemoryDrift,
  initProjectMemoryBank,
  finalizeAgentMemoryUpdate,
  finalizeProjectMemoryUpdate,
} from './featureEngineer/memoryBank.js';
import { detectAgentDuplicates } from './featureEngineer/duplicateDetector.js';
import {
  resolveSandbox,
  bootstrapSandboxDirs,
  writeProjectEnv,
  logSandboxLocked,
} from './featureEngineer/sandbox.js';
import { scaffoldWorkspaceIfBlank } from './featureEngineer/projectScaffolder.js';
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
export type { SandboxConfig } from './featureEngineer/sandbox.js';

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
 * PHASE 1: Full-stack development + compile guard (external project sandbox)
 * PHASE 2: Dynamic Playwright test in src/ui/generated/
 * PHASE 3: Live re-test with up to 4 heal cycles
 * PHASE 4: Engineering report + external project memory bank update
 */
export async function runFeatureEngineer(
  options: FeatureEngineerOptions,
): Promise<FeatureEngineerResult> {
  const qaAgentRoot = process.cwd();

  // ── STEP 0: Sync cold-boot memory read (agent's own context) ─────────────
  // readFileSync — guaranteed before any async I/O or LLM calls.
  const syncMemory = loadMemoryBankSync(qaAgentRoot);

  // ── STEP 1: Resolve external sandbox ─────────────────────────────────────
  // All generated code lives OUTSIDE the agent directory — never nested inside.
  const sandbox = resolveSandbox(qaAgentRoot, {
    projectRoot: options.projectRoot,
    featureSpec: options.featureSpec,
  });

  logSandboxLocked(sandbox);

  // Bootstrap directories + write the project's own .env
  bootstrapSandboxDirs(sandbox);
  writeProjectEnv(sandbox);

  // Seed the project's standalone memory bank (creates files only if absent)
  initProjectMemoryBank(sandbox.projectRoot, sandbox.projectSlug);

  // ── STEP 2: Inject env defaults pointing at the EXTERNAL sandbox ──────────
  process.env['ROUTES_DIR']      = path.join(sandbox.backendRoot, 'src', 'routes');
  process.env['BASE_APP_URL']    = 'http://localhost:3001';
  process.env['FRONTEND_APP_URL']= 'http://localhost:5173';
  process.env['GIT_REPO_ROOT']   = sandbox.backendRoot;
  resetConfigCache();

  engineerLog(`[EXTERNAL-SANDBOX] ROUTES_DIR      → ${process.env['ROUTES_DIR']}`);
  engineerLog(`[EXTERNAL-SANDBOX] BASE_APP_URL    → ${process.env['BASE_APP_URL']}`);
  engineerLog(`[EXTERNAL-SANDBOX] FRONTEND_APP_URL→ ${process.env['FRONTEND_APP_URL']}`);
  engineerLog(`[EXTERNAL-SANDBOX] GIT_REPO_ROOT   → ${process.env['GIT_REPO_ROOT']}`);

  const fsm = new FeatureEngineerFsm();
  const backendRoot  = sandbox.backendRoot;
  const frontendRoot = sandbox.frontendRoot;

  // ── STEP 3: Scaffold blank project trees inside the external sandbox ──────
  const scaffold = scaffoldWorkspaceIfBlank(backendRoot, frontendRoot);
  if (scaffold.isBlankCanvas) {
    process.env['ROUTES_DIR'] = path.join(backendRoot, 'src', 'routes');
    resetConfigCache();
    engineerLog(`[EXTERNAL-SANDBOX] Scaffold complete — ${backendRoot} | ${frontendRoot}`);
  }

  loadConfig();
  const frontendAppUrl = 'http://localhost:5173';
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

    // Drift check + dup scan on the AGENT source (qa-agent src/) only.
    // External project duplication is handled per-run by the sandbox logic.
    const [memoryBank, , dupReport] = await Promise.all([
      loadProjectMemoryBank(qaAgentRoot).then((mb) => mb ?? syncMemory),
      checkMemoryDrift(qaAgentRoot),
      detectAgentDuplicates(qaAgentRoot),
    ]);

    if (!dupReport.clean) {
      engineerLog(
        `⚠ Agent workspace has ${dupReport.totalIssues} duplicate file issue(s) — ` +
        `review [DUPLICATE-DETECTOR] log above before proceeding`,
      );
    }

    const repo = await analyzeRepositories(backendRoot, frontendRoot);
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

      const applied = await applyDevelopmentFiles(backendRoot, frontendRoot, dev);
      mergeChanges(fileChanges, applied);

      fsm.transition('COMPILING', 'Validate backend + frontend + qa-agent');
      const compileResults = await verifyAllTargets(
        backendRoot,
        frontendRoot,
        qaAgentRoot,
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
          backendRoot,
          frontendRoot,
          heal.targetFile,
          heal.fixedInjectedCode,
          heal.replaceEntireFile,
        );
        if (fix) mergeChanges(fileChanges, [fix]);
      }

      if (attempt >= MAX_COMPILE_ATTEMPTS) {
        fsm.forceFailed('Phase 1 compile guard failed after max attempts');
        gitRollbackWorkspace(backendRoot);
        gitRollbackWorkspace(frontendRoot);
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
          projectRoot: sandbox.projectRoot,
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
        projectRoot: sandbox.projectRoot,
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
      qaAgentRoot,
      frontendAppUrl,
    );

    mergeChanges(fileChanges, [
      {
        repo: 'qa-agent',
        relativePath: path.relative(qaAgentRoot, generatedTestPath),
        absolutePath: generatedTestPath,
        action: 'created',
      },
    ]);

    const qaCompile = await verifyAllTargets(backendRoot, frontendRoot, qaAgentRoot);
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
          qaAgentRoot,
          frontendAppUrl,
        );
        record.fixesApplied.push(`regenerated test: ${generatedTestPath}`);
      } else if (debug.bugFound && debug.fixedInjectedCode) {
        const fix = await applyHealFix(
          backendRoot,
          frontendRoot,
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
          backendRoot,
          frontendRoot,
          qaAgentRoot,
        );
        if (!recompile.every((r) => r.success)) {
          priorErrors = formatCompileFailures(recompile);
          record.fixesApplied.push('compile still failing after heal');
        }
      }

      if (cycle >= MAX_HEAL_ATTEMPTS) {
        phaseLog('PHASE_3_SELF_HEALING', 'Heal cycles exhausted — proceeding to report');
        gitRollbackWorkspace(backendRoot);
        gitRollbackWorkspace(frontendRoot);
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
      projectRoot: sandbox.projectRoot,
      diagnosticReport: report,
    };

    return result;

  } finally {
    // ── GUARANTEED FINALIZATION ────────────────────────────────────────────
    // Both the EXTERNAL project memory-bank/ AND the agent's own memory dirs
    // must be updated on every run — success or failure.
    const succeeded = result?.finalState === 'COMPLETED';
    const finalState = result?.finalState ?? fsm.current;
    const sharedParams = {
      commandType: 'feature-engineer',
      featureSpec: options.featureSpec,
      success: succeeded,
      finalState,
      fileChanges: result?.fileChanges ?? fileChanges,
      healCycles: result?.healCycles ?? healCycles,
      generatedTestPath: result?.generatedTestPath ?? generatedTestPath,
    };

    // External project memory (isolated sandbox — never writes into agent repo)
    finalizeProjectMemoryUpdate({ ...sharedParams, projectRoot: sandbox.projectRoot });

    // Agent memory (memory-bank/ + .cursor/memory/ — always both)
    await finalizeAgentMemoryUpdate({ ...sharedParams, qaAgentRoot });
  }
}

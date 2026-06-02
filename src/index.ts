/**
 * QA Agent — interactive CLI entry point.
 *
 * Flow:
 *   1. Banner
 *   2. Env guardrail (prompt missing keys, write .env)
 *   3. Intent resolution (flags → menu → feature spec)
 *   4. Execute the chosen testing flow
 *
 * Usage:
 *   tsx src/index.ts run                              Interactive mode (select menu)
 *   tsx src/index.ts run --backend                   Backend API tests only
 *   tsx src/index.ts run --frontend                  Frontend E2E only
 *   tsx src/index.ts run --full-stack                Full-stack unified journey
 *   tsx src/index.ts run --prompt "Add coupon..."    Feature Engineer (auto full-stack)
 *   tsx src/index.ts engineer "<spec>"               Feature Engineer directly
 *   tsx src/index.ts discover                        List Express backends
 *   tsx src/index.ts watch                           Watch routes for changes
 *   tsx src/index.ts webhook                         CI webhook server
 */

import http from 'node:http';

import pc from 'picocolors';

import { runApiPhase, runFullQACycle } from './orchestrator.js';
import { runFeatureEngineer } from './orchestrator/featureEngineer.js';
import { runDiscoverCommand } from './discover.js';
import { startFileWatcher } from './trigger/fileWatcher.js';
import { startWebhookServer } from './trigger/webhookServer.js';
import { prepareEnvironment } from './utils/prepareEnvironment.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import {
  loadMemoryBankSync,
  finalizeAgentMemoryUpdate,
} from './orchestrator/featureEngineer/memoryBank.js';
import {
  printBanner,
  printPhaseHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printSection,
} from './cli/banner.js';
import { runEnvGuard, softValidateEnv, type EnvKeyProfile } from './cli/envGuard.js';
import {
  applyModelDefault,
  printActiveModelLine,
  promptModelSwitch,
} from './cli/modelConfig.js';
import {
  parseCliArgs,
  promptTestingIntent,
  promptFeatureSpec,
  promptProjectWorkspace,
  printIntentBadge,
  type TestingIntent,
} from './cli/menu.js';
import { resolveSandbox } from './orchestrator/featureEngineer/sandbox.js';

// ─── Backend health check ─────────────────────────────────────────────────────

async function verifyBackendConnection(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl);
      const options = {
        hostname: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
        path: '/health',
        method: 'GET',
        timeout: 4000,
      };
      const req = http.request(options, (res) => {
        resolve(res.statusCode !== undefined);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch {
      resolve(false);
    }
  });
}

// ─── Execution layers ─────────────────────────────────────────────────────────

async function executeBackend(): Promise<void> {
  printPhaseHeader('BACKEND', 'Route discovery · AI payload generation · Axios execution matrix');
  loadConfig();
  let success = false;
  try {
    await runApiPhase();
    success = true;
    printSuccess('Backend API phase complete');
  } finally {
    await finalizeAgentMemoryUpdate({
      commandType: 'backend',
      featureSpec: 'Backend API test suite',
      success,
      finalState: success ? 'COMPLETED' : 'FAILED',
    });
  }
}

async function executeFrontend(): Promise<void> {
  const { runFrontendE2eSweep } = await import('./ui/frontendRunner.js');
  printPhaseHeader('FRONTEND', 'Playwright browser · UI simulation · visual regression');
  loadConfig();
  let success = false;
  try {
    const result = await runFrontendE2eSweep();
    success = result.passed;
    printSuccess(`Frontend E2E complete — ${result.stepsCompleted} step(s)`);
    if (result.diagnostics.length > 0) {
      printSection('Diagnostics');
      for (const d of result.diagnostics) {
        printWarning(`[${d.type}] ${d.message}${d.url ? ` — ${d.url}` : ''}`);
      }
    }
  } finally {
    await finalizeAgentMemoryUpdate({
      commandType: 'frontend',
      featureSpec: 'Frontend E2E sweep',
      success,
      finalState: success ? 'COMPLETED' : 'FAILED',
    });
  }
}

async function executeFullStack(): Promise<void> {
  printPhaseHeader('FULL-STACK', 'Boot check · Playwright · API intercept · FSM self-healing');

  const config = loadConfig();
  printInfo(`Verifying backend at ${pc.bold(config.BASE_APP_URL)} …`);

  const alive = await verifyBackendConnection(config.BASE_APP_URL);
  if (alive) {
    printSuccess('Backend server reachable');
  } else {
    printWarning(`Backend did not respond at ${config.BASE_APP_URL} — tests will attempt anyway`);
  }

  let success = false;
  try {
    await runFullQACycle();
    success = true;
    printSuccess('Full-stack QA cycle complete');
  } finally {
    await finalizeAgentMemoryUpdate({
      commandType: 'fullstack',
      featureSpec: 'Full-stack QA cycle (backend + frontend + self-evolution)',
      success,
      finalState: success ? 'COMPLETED' : 'FAILED',
    });
  }
}

async function executeEngineer(featureSpec: string, workspacePath?: string): Promise<void> {
  printPhaseHeader('ENGINEER', 'Autonomous Feature Engineer — 4-phase lifecycle');
  printInfo(`Spec: ${pc.bold(pc.italic(featureSpec))}`);
  console.log('');

  // Resolve and confirm the external sandbox path before any code is written
  const qaAgentRoot = process.cwd();
  const defaultSandbox = resolveSandbox(qaAgentRoot, {
    projectRoot: workspacePath,
    featureSpec,
  });

  // Show the resolved path and let the user confirm / override it
  const confirmedPath = await promptProjectWorkspace(defaultSandbox.projectRoot);
  const finalSandbox = confirmedPath !== defaultSandbox.projectRoot
    ? resolveSandbox(qaAgentRoot, { projectRoot: confirmedPath, featureSpec })
    : defaultSandbox;

  const result = await runFeatureEngineer({
    featureSpec,
    projectRoot: finalSandbox.projectRoot,
  });

  if (result.finalState === 'COMPLETED') {
    printSuccess(`Feature delivered — project at: ${pc.cyan(result.projectRoot)}`);
  } else {
    printError(`Feature engineer ended in state: ${result.finalState}`);
    printInfo(`Partial output at: ${result.projectRoot}`);
  }

  process.exit(result.finalState === 'COMPLETED' ? 0 : 1);
}

// ─── run command ──────────────────────────────────────────────────────────────

async function handleRunCommand(intent?: TestingIntent, featurePrompt?: string, workspacePath?: string): Promise<void> {
  // ── Check core env keys (API key only) before showing the menu ────────────
  if (!intent) {
    await runEnvGuard(['core']);
  }

  // ── Intent resolution loop ─────────────────────────────────────────────────
  // When the user picks ⚙️ "Switch Active AI Model" we run the model switcher
  // then loop back to the main menu — no run is triggered until a real mode is
  // chosen.
  let resolvedIntent = intent;
  while (!resolvedIntent || resolvedIntent === 'switch-model') {
    if (resolvedIntent === 'switch-model') {
      await promptModelSwitch();
    }
    resolvedIntent = await promptTestingIntent();
  }

  // ── Profile-specific env guard (ROUTES_DIR, BASE_APP_URL, etc.) ───────────
  const profileMap: Record<Exclude<TestingIntent, 'switch-model'>, EnvKeyProfile[]> = {
    backend:   ['backend'],
    frontend:  ['frontend'],
    fullstack: ['backend', 'frontend'],
    engineer:  ['backend', 'frontend'],
  };

  await runEnvGuard(profileMap[resolvedIntent]);

  const softWarns = softValidateEnv();
  for (const w of softWarns) printWarning(w);

  // Print which model will be used for this run
  printActiveModelLine();
  printIntentBadge(resolvedIntent);

  // Auto-discover ROUTES_DIR / BASE_APP_URL from pasted backends if needed
  await prepareEnvironment();

  switch (resolvedIntent) {
    case 'backend':
      await executeBackend();
      break;

    case 'frontend':
      await executeFrontend();
      break;

    case 'fullstack':
      await executeFullStack();
      break;

    case 'engineer': {
      const spec = featurePrompt ?? (await promptFeatureSpec());
      await executeEngineer(spec, workspacePath);
      break;
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv);

  // Non-interactive commands skip banner + guard
  if (parsed.command === 'discover') {
    await runDiscoverCommand();
    return;
  }

  printBanner();

  // ── 1. Sync cold-boot memory read ────────────────────────────────────────
  if (parsed.command !== 'discover') {
    loadMemoryBankSync(process.cwd());
  }

  // ── 2. AI model default fallback ─────────────────────────────────────────
  // If OPENROUTER_MODEL is missing or empty, silently inject
  // google/gemini-2.5-flash and print the canonical log line.
  // Must run before any loadConfig() or LLM call.
  await applyModelDefault();

  switch (parsed.command) {
    case 'run': {
      await handleRunCommand(parsed.intent, parsed.featurePrompt, parsed.workspacePath);
      break;
    }

    case 'watch': {
      await runEnvGuard(['core']);
      loadConfig();
      await startFileWatcher();
      break;
    }

    case 'webhook': {
      await runEnvGuard(['core']);
      loadConfig();
      await startWebhookServer();
      break;
    }

    case 'engineer': {
      await runEnvGuard(['core', 'backend', 'frontend']);
      printActiveModelLine();
      printIntentBadge('engineer');
      // legacy positional args: tsx src/index.ts engineer "<spec>"
      const positional = process.argv.slice(3).join(' ').trim();
      const prefilled = parsed.featurePrompt ?? positional;
      const spec = prefilled || await promptFeatureSpec();

      if (!spec) {
        printError('Feature spec required. Example: tsx src/index.ts engineer "Add wishlist API"');
        process.exit(1);
      }
      await executeEngineer(spec, parsed.workspacePath);
      break;
    }

    default: {
      printError(`Unknown command: ${pc.bold(parsed.command || '(none)')}`);
      console.log('');
      console.log(pc.bold('Available commands:'));
      console.log(pc.dim('  tsx src/index.ts run                    Interactive test launcher'));
      console.log(pc.dim('  tsx src/index.ts run --backend           Backend API only'));
      console.log(pc.dim('  tsx src/index.ts run --frontend          Frontend E2E only'));
      console.log(pc.dim('  tsx src/index.ts run --full-stack        Full-stack unified flow'));
      console.log(pc.dim('  tsx src/index.ts run --prompt "<spec>"   Feature Engineer'));
      console.log(pc.dim('  tsx src/index.ts engineer "<spec>"       Feature Engineer (direct)'));
      console.log(pc.dim('  tsx src/index.ts discover                List detected backends'));
      console.log(pc.dim('  tsx src/index.ts watch                   Watch routes for changes'));
      console.log(pc.dim('  tsx src/index.ts webhook                 CI webhook server'));
      console.log('');
      process.exit(1);
    }
  }
}

main().catch((err: unknown) => {
  if ((err as NodeJS.ErrnoException)?.code === 'ERR_USE_AFTER_CLOSE') {
    // User hit Ctrl-C during a prompt — exit cleanly
    console.log('');
    printInfo('Interrupted by user');
    process.exit(0);
  }
  printError('Unhandled fatal error');
  logger.fatal({ err }, 'Unhandled fatal error');
  process.exit(1);
});

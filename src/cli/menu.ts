/**
 * Interactive testing-flow menu.
 * Provides a navigable terminal select for intent resolution and
 * utility helpers for argument-based intent detection.
 */

import { select, confirm } from '@inquirer/prompts';
import pc from 'picocolors';

// ─── Intent types ─────────────────────────────────────────────────────────────

export type TestingIntent =
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'engineer';

interface IntentChoice {
  name: string;
  value: TestingIntent;
  description: string;
}

const CHOICES: IntentChoice[] = [
  {
    value: 'backend',
    name: `${pc.cyan('①')}  ${pc.bold('Backend API Testing Only')}`,
    description: pc.dim('Route discovery · AI payload gen · Axios execution matrix · self-healing patches'),
  },
  {
    value: 'frontend',
    name: `${pc.magenta('②')}  ${pc.bold('Frontend E2E UI Testing Only')}`,
    description: pc.dim('Playwright browser · form simulation · visual regression · component sweep'),
  },
  {
    value: 'fullstack',
    name: `${pc.green('③')}  ${pc.bold('Full-Stack E2E Flow')} ${pc.dim('(Recommended)')}`,
    description: pc.dim('Backend + Frontend + network intercept + FSM self-healing + self-evolution loop'),
  },
  {
    value: 'engineer',
    name: `${pc.yellow('④')}  ${pc.bold('Feature Engineer')}`,
    description: pc.dim('Autonomous Dev → dynamic Playwright test → 4-cycle self-heal → engineering report'),
  },
];

// ─── Argument parsing ─────────────────────────────────────────────────────────

export interface ParsedArgs {
  command: string;
  intent?: TestingIntent;
  featurePrompt?: string;
  flags: Set<string>;
}

export function parseCliArgs(argv: string[]): ParsedArgs {
  const [, , rawCommand = '', ...rest] = argv;
  const command = rawCommand.toLowerCase();
  const flags = new Set<string>();
  const extra: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? '';
    if (arg === '--backend') { flags.add('backend'); }
    else if (arg === '--frontend') { flags.add('frontend'); }
    else if (arg === '--full-stack' || arg === '--fullstack') { flags.add('fullstack'); }
    else if (arg === '--prompt' || arg === '-p') {
      const val = rest[i + 1] ?? '';
      if (val && !val.startsWith('-')) {
        extra.push(val);
        i++;
      }
      flags.add('prompt');
    } else if (arg) {
      extra.push(arg);
    }
  }

  const featurePrompt = extra.join(' ').trim() || undefined;

  let intent: TestingIntent | undefined;
  if (flags.has('backend')) intent = 'backend';
  else if (flags.has('frontend')) intent = 'frontend';
  else if (flags.has('fullstack')) intent = 'fullstack';
  else if (flags.has('prompt') || featurePrompt) intent = 'engineer';

  return { command, intent, featurePrompt, flags };
}

// ─── Interactive menu ─────────────────────────────────────────────────────────

export async function promptTestingIntent(): Promise<TestingIntent> {
  console.log(
    pc.bold(pc.white('\n  Which testing flow would you like to execute today?\n')),
  );

  const intent = await select<TestingIntent>({
    message: 'Select mode',
    choices: CHOICES.map(({ value, name, description }) => ({
      value,
      name,
      description,
    })),
    pageSize: CHOICES.length,
  });

  return intent;
}

export async function promptFeatureSpec(prefill?: string): Promise<string> {
  const { input } = await import('@inquirer/prompts');
  const spec = await input({
    message: `${pc.bold('Describe the feature to engineer')}  ${pc.dim('(be specific)')}`,
    ...(prefill !== undefined ? { default: prefill } : {}),
    validate: (v) => (v.trim().length >= 10 ? true : 'Please describe the feature in at least 10 characters'),
  });
  return spec.trim();
}

export async function promptConfirmFullStack(): Promise<boolean> {
  return confirm({
    message: pc.dim('This will run both backend and frontend tests. Continue?'),
    default: true,
  });
}

// ─── Summary printers ─────────────────────────────────────────────────────────

export function printIntentBadge(intent: TestingIntent): void {
  const BADGES: Record<TestingIntent, string> = {
    backend:    pc.bgCyan(pc.black(pc.bold('  BACKEND API  '))),
    frontend:   pc.bgMagenta(pc.black(pc.bold('  FRONTEND E2E  '))),
    fullstack:  pc.bgGreen(pc.black(pc.bold('  FULL-STACK E2E  '))),
    engineer:   pc.bgYellow(pc.black(pc.bold('  FEATURE ENGINEER  '))),
  };

  const SUBTITLES: Record<TestingIntent, string> = {
    backend:   'Route parsing · AI payloads · Axios execution',
    frontend:  'Playwright UI simulation · visual regression',
    fullstack: 'Unified journey: backend + frontend + FSM healing',
    engineer:  '4-phase: develop → test-gen → self-heal → report',
  };

  console.log('');
  console.log(`${BADGES[intent]}  ${pc.dim(SUBTITLES[intent])}`);
  console.log('');
}

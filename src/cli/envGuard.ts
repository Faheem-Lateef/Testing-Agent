/**
 * Proactive .env guardrail — validates required keys before any command runs.
 * If a key is missing or empty it interactively prompts the user and writes
 * the answer back into .env so they never have to edit the file by hand.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { input } from '@inquirer/prompts';
import pc from 'picocolors';

import { detectProviderFromKey } from '../utils/providerRouter.js';

// ─── Key definitions ──────────────────────────────────────────────────────────

export type EnvKeyProfile = 'core' | 'backend' | 'frontend';

interface EnvKeySpec {
  key: string;
  profile: EnvKeyProfile[];
  description: string;
  placeholder: string;
  secret?: boolean;
}

const ENV_SPECS: EnvKeySpec[] = [
  {
    key: 'AI_API_KEY',
    profile: ['core', 'backend', 'frontend'],
    description:
      'AI API key — auto-detects provider (OpenRouter sk-or-…, Gemini AIza…, OpenAI sk-…, Claude sk-ant-…, Groq gsk_…)',
    placeholder: 'sk-or-… | AIza… | sk-ant-… | sk-proj-… | gsk_…',
    secret: true,
  },
  // AI_MODEL / OPENROUTER_MODEL auto-defaulted by applyModelDefault() in modelConfig.ts
  {
    key: 'ROUTES_DIR',
    profile: ['backend'],
    description: 'Relative path to your backend routes folder',
    placeholder: 'backend demo/ecommerce-backend/src/routes',
  },
  {
    key: 'BASE_APP_URL',
    profile: ['backend'],
    description: 'Running backend base URL (e.g. http://localhost:3001)',
    placeholder: 'http://localhost:3001',
  },
  {
    key: 'FRONTEND_APP_URL',
    profile: ['frontend'],
    description: 'Running frontend base URL (e.g. http://localhost:5173)',
    placeholder: 'http://localhost:5173',
  },
];

// ─── .env file parser / writer ────────────────────────────────────────────────

function parseEnvLines(content: string): Array<{ raw: string; key?: string; value?: string }> {
  return content.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return { raw };
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return { raw };
    return {
      raw,
      key: trimmed.slice(0, eqIdx).trim(),
      value: trimmed.slice(eqIdx + 1).trim(),
    };
  });
}

async function upsertEnvFile(envPath: string, key: string, value: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    // file does not exist yet — will create
  }

  const lines = parseEnvLines(content);
  let updated = false;

  const newLines = lines.map(({ raw, key: k }) => {
    if (k === key) {
      updated = true;
      return `${key}=${value}`;
    }
    return raw;
  });

  if (!updated) {
    newLines.push(`${key}=${value}`);
  }

  await fs.writeFile(envPath, newLines.join('\n'), 'utf-8');
}

// ─── Core guard logic ─────────────────────────────────────────────────────────

function resolveEnvPath(): string {
  return path.join(process.cwd(), '.env');
}

function getEnvValue(key: string): string {
  return (process.env[key] ?? '').trim();
}

const AI_KEY_ENV_VARS = [
  'AI_API_KEY',
  'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
] as const;

function hasAnyAiKey(): boolean {
  return AI_KEY_ENV_VARS.some((k) => getEnvValue(k).length > 0);
}

function specsForProfiles(profiles: EnvKeyProfile[]): EnvKeySpec[] {
  const set = new Set(profiles);
  return ENV_SPECS.filter((s) => s.profile.some((p) => set.has(p)));
}

/**
 * Check env keys required for the given profiles.
 * For each missing/empty key, prompt the user, write the answer to .env,
 * and inject it into process.env.
 *
 * @param profiles Which key groups to validate ('core' is always included)
 */
export async function runEnvGuard(profiles: EnvKeyProfile[]): Promise<void> {
  const envPath = resolveEnvPath();
  const allProfiles: EnvKeyProfile[] = ['core', ...profiles.filter((p) => p !== 'core')];
  const specs = specsForProfiles(allProfiles);
  const missing = specs.filter((s) => {
    if (s.key === 'AI_API_KEY' && hasAnyAiKey()) return false;
    return !getEnvValue(s.key);
  });

  if (missing.length === 0) return;

  console.log('');
  console.log(
    pc.bgYellow(pc.black(pc.bold(` ⚠  MISSING ENVIRONMENT VARIABLES (${missing.length}) `))),
  );
  console.log(pc.dim(`    ${envPath}`));
  console.log('');

  for (const spec of missing) {
    console.log(
      `  ${pc.red('✖')}  ${pc.bold(pc.red(spec.key))}  ${pc.dim('—')}  ${pc.dim(spec.description)}`,
    );
  }

  console.log('');
  console.log(
    pc.yellow('  The agent will prompt you for each missing value and save it to your .env file.'),
  );
  console.log('');

  for (const spec of missing) {
    const answer = await input({
      message: `${pc.bold(spec.key)}  ${pc.dim(`(${spec.description})`)}`,
      default: spec.placeholder,
      validate: (v) => (v.trim() ? true : `${spec.key} cannot be empty`),
    });

    const value = answer.trim();
    process.env[spec.key] = value;
    await upsertEnvFile(envPath, spec.key, value);
    console.log(
      `  ${pc.green('✔')}  ${pc.dim('Saved')} ${pc.bold(spec.key)} ${pc.dim('→ .env')}`,
    );
  }

  console.log('');
}

/**
 * Lightweight pre-flight check that only tests ALREADY-SET values for format.
 * Returns an array of warning strings (non-fatal).
 */
export function softValidateEnv(): string[] {
  const warnings: string[] = [];

  const aiKey =
    getEnvValue('AI_API_KEY') ||
    getEnvValue('OPENROUTER_API_KEY') ||
    getEnvValue('GOOGLE_API_KEY') ||
    getEnvValue('GEMINI_API_KEY') ||
    getEnvValue('OPENAI_API_KEY') ||
    getEnvValue('ANTHROPIC_API_KEY') ||
    getEnvValue('GROQ_API_KEY');

  if (aiKey) {
    const provider = detectProviderFromKey(aiKey);
    const known = ['openrouter', 'google', 'openai', 'groq', 'anthropic'] as const;
    if (!known.includes(provider)) {
      warnings.push('AI API key format not recognized — check your key');
    }
  }

  const baseUrl = getEnvValue('BASE_APP_URL');
  if (baseUrl && !baseUrl.startsWith('http')) {
    warnings.push('BASE_APP_URL should start with http:// or https://');
  }

  const frontendUrl = getEnvValue('FRONTEND_APP_URL');
  if (frontendUrl && !frontendUrl.startsWith('http')) {
    warnings.push('FRONTEND_APP_URL should start with http:// or https://');
  }

  return warnings;
}

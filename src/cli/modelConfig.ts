/**
 * AI Model Configuration — default fallback, hot-swap menu, .env persistence.
 *
 * Single source of truth for which OpenRouter model the agent uses at runtime.
 * All other modules read the active model via process.env.OPENROUTER_MODEL,
 * which this module guarantees is always set before any LLM call begins.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { select } from '@inquirer/prompts';
import pc from 'picocolors';

import { resetConfigCache } from '../utils/config.js';

// ─── Model registry ───────────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface ModelEntry {
  slug: string;
  label: string;
  badge: string;
  description: string;
}

export const CURATED_MODELS: ModelEntry[] = [
  {
    slug: 'google/gemini-2.5-flash',
    label: 'Google Gemini 2.5 Flash',
    badge: pc.bgGreen(pc.black(pc.bold(' GEMINI 2.5 FLASH '))),
    description: pc.dim('Default · Cost-effective · Fast reasoning · Ideal for code gen'),
  },
  {
    slug: 'anthropic/claude-3.5-sonnet',
    label: 'Anthropic Claude 3.5 Sonnet',
    badge: pc.bgMagenta(pc.black(pc.bold(' CLAUDE 3.5 SONNET '))),
    description: pc.dim('Advanced reasoning · Nuanced architecture · Best for complex features'),
  },
  {
    slug: 'openai/gpt-4o-mini',
    label: 'OpenAI GPT-4o Mini',
    badge: pc.bgCyan(pc.black(pc.bold(' GPT-4o MINI '))),
    description: pc.dim('Balanced speed/coding · Reliable output · Good for incremental fixes'),
  },
];

// ─── .env writer (shared util) ────────────────────────────────────────────────

function parseEnvLines(content: string): Array<{ raw: string; key?: string }> {
  return content.split('\n').map((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return { raw };
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) return { raw };
    return { raw, key: trimmed.slice(0, eqIdx).trim() };
  });
}

export async function upsertEnvFile(key: string, value: string): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    // will create
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

  if (!updated) newLines.push(`${key}=${value}`);

  await fs.writeFile(envPath, newLines.join('\n'), 'utf-8');
}

// ─── Active model helpers ─────────────────────────────────────────────────────

export function getActiveModel(): string {
  return (process.env['OPENROUTER_MODEL'] ?? '').trim() || DEFAULT_MODEL;
}

function modelEntry(slug: string): ModelEntry {
  return (
    CURATED_MODELS.find((m) => m.slug === slug) ?? {
      slug,
      label: slug,
      badge: pc.bgWhite(pc.black(pc.bold(` ${slug} `))),
      description: pc.dim('Custom model'),
    }
  );
}

// ─── Default fallback ─────────────────────────────────────────────────────────

/**
 * Called once at startup. If OPENROUTER_MODEL is absent or empty, silently
 * injects the default and prints the canonical initialization log.
 * Never prompts the user.
 */
export async function applyModelDefault(): Promise<void> {
  const current = (process.env['OPENROUTER_MODEL'] ?? '').trim();
  if (current) return; // already set — nothing to do

  process.env['OPENROUTER_MODEL'] = DEFAULT_MODEL;
  resetConfigCache();

  // Persist so subsequent runs don't need to repeat this
  await upsertEnvFile('OPENROUTER_MODEL', DEFAULT_MODEL);

  console.log(
    `🤖 ${pc.bgGreen(pc.black(pc.bold(' AI-CONFIG ')))}  No model selected. ` +
      `Defaulting to high-efficiency baseline: ${pc.bold(pc.green(DEFAULT_MODEL))}`,
  );
}

// ─── Model status line ────────────────────────────────────────────────────────

export function printActiveModelLine(): void {
  const slug = getActiveModel();
  const entry = modelEntry(slug);
  console.log(
    `${entry.badge}  ${pc.dim('Active model →')} ${pc.bold(pc.white(slug))}`,
  );
}

// ─── Interactive hot-swap ─────────────────────────────────────────────────────

/**
 * Shows a curated model selection menu, updates process.env + .env on disk,
 * resets the config cache, and prints a confirmation line.
 * Returns the newly selected model slug.
 */
export async function promptModelSwitch(): Promise<string> {
  console.log('');
  console.log(pc.bold(pc.white('  ⚙️  Switch Active AI Model\n')));

  const current = getActiveModel();

  const chosen = await select<string>({
    message: 'Select a model for this session',
    choices: CURATED_MODELS.map((m) => ({
      value: m.slug,
      name: `${m.badge}  ${pc.bold(m.label)}${m.slug === current ? pc.green('  ✓ current') : ''}`,
      description: m.description,
    })),
    pageSize: CURATED_MODELS.length,
  });

  // ── Apply everywhere that matters ────────────────────────────────────────
  process.env['OPENROUTER_MODEL'] = chosen;
  resetConfigCache();
  await upsertEnvFile('OPENROUTER_MODEL', chosen);

  const entry = modelEntry(chosen);
  console.log('');
  console.log(
    `  ${pc.green('✔')}  Active model updated → ${entry.badge}  ${pc.bold(pc.white(chosen))}`,
  );
  console.log(`  ${pc.dim('Saved to .env — all subsequent AI calls will use this model.')} `);
  console.log('');

  return chosen;
}

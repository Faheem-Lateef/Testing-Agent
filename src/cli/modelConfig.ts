/**
 * AI Model Configuration — provider-aware defaults, hot-swap menu, .env persistence.
 *
 * Supports OpenRouter, Google Gemini, OpenAI, Groq, and Anthropic keys.
 * Reads/writes both AI_MODEL and OPENROUTER_MODEL for backward compatibility.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { select } from '@inquirer/prompts';
import pc from 'picocolors';

import { resetConfigCache } from '../utils/config.js';
import {
  getActiveModelFromEnv,
  normalizeModelForProvider,
  resolveApiKeyFromEnv,
  resolveProviderProfile,
  printProviderLockedLine,
  type AIProvider,
} from '../utils/providerRouter.js';

// ─── Model registry (per provider) ───────────────────────────────────────────

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export interface ModelEntry {
  slug: string;
  label: string;
  badge: string;
  description: string;
}

export const MODELS_BY_PROVIDER: Record<AIProvider, ModelEntry[]> = {
  openrouter: [
    {
      slug: 'google/gemini-2.5-flash',
      label: 'Google Gemini 2.5 Flash',
      badge: pc.bgGreen(pc.black(pc.bold(' GEMINI 2.5 FLASH '))),
      description: pc.dim('Default · Fast · Cost-effective'),
    },
    {
      slug: 'anthropic/claude-3.5-sonnet',
      label: 'Anthropic Claude 3.5 Sonnet',
      badge: pc.bgMagenta(pc.black(pc.bold(' CLAUDE 3.5 SONNET '))),
      description: pc.dim('Advanced reasoning · Complex features'),
    },
    {
      slug: 'openai/gpt-4o-mini',
      label: 'OpenAI GPT-4o Mini',
      badge: pc.bgCyan(pc.black(pc.bold(' GPT-4o MINI '))),
      description: pc.dim('Balanced speed · Reliable patches'),
    },
  ],
  google: [
    {
      slug: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      badge: pc.bgGreen(pc.black(pc.bold(' GEMINI 2.5 FLASH '))),
      description: pc.dim('Direct Google API · Default'),
    },
    {
      slug: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      badge: pc.bgGreen(pc.black(pc.bold(' GEMINI 2.0 FLASH '))),
      description: pc.dim('Direct Google API · Fast'),
    },
  ],
  openai: [
    {
      slug: 'gpt-4o-mini',
      label: 'GPT-4o Mini',
      badge: pc.bgCyan(pc.black(pc.bold(' GPT-4o MINI '))),
      description: pc.dim('Direct OpenAI API · Default'),
    },
    {
      slug: 'gpt-4o',
      label: 'GPT-4o',
      badge: pc.bgCyan(pc.black(pc.bold(' GPT-4o '))),
      description: pc.dim('Direct OpenAI API · Stronger'),
    },
  ],
  groq: [
    {
      slug: 'llama-3.3-70b-versatile',
      label: 'Llama 3.3 70B',
      badge: pc.bgYellow(pc.black(pc.bold(' LLAMA 3.3 '))),
      description: pc.dim('Direct Groq API · Default'),
    },
  ],
  anthropic: [
    {
      slug: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      badge: pc.bgMagenta(pc.black(pc.bold(' CLAUDE 3.5 '))),
      description: pc.dim('Direct Anthropic API · Default'),
    },
    {
      slug: 'claude-3-5-haiku-20241022',
      label: 'Claude 3.5 Haiku',
      badge: pc.bgMagenta(pc.black(pc.bold(' CLAUDE HAIKU '))),
      description: pc.dim('Direct Anthropic API · Fast'),
    },
  ],
};

/** @deprecated Use MODELS_BY_PROVIDER — OpenRouter list kept for imports */
export const CURATED_MODELS = MODELS_BY_PROVIDER.openrouter;

// ─── .env writer ──────────────────────────────────────────────────────────────

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

async function persistActiveModel(slug: string, provider: AIProvider): Promise<void> {
  const normalized = normalizeModelForProvider(provider, slug);
  process.env['AI_MODEL'] = normalized;
  process.env['OPENROUTER_MODEL'] = normalized;
  resetConfigCache();
  await upsertEnvFile('AI_MODEL', normalized);
  await upsertEnvFile('OPENROUTER_MODEL', normalized);
}

// ─── Active model helpers ─────────────────────────────────────────────────────

export function getActiveModel(): string {
  if (!resolveApiKeyFromEnv()) {
    return (process.env['AI_MODEL'] ?? process.env['OPENROUTER_MODEL'] ?? '').trim() || DEFAULT_MODEL;
  }
  const profile = resolveProviderProfile();
  return getActiveModelFromEnv(profile);
}

export function getCuratedModelsForActiveProvider(): ModelEntry[] {
  if (!resolveApiKeyFromEnv()) return MODELS_BY_PROVIDER.openrouter;
  const profile = resolveProviderProfile();
  return MODELS_BY_PROVIDER[profile.provider];
}

function modelEntry(slug: string, provider: AIProvider): ModelEntry {
  const list = MODELS_BY_PROVIDER[provider];
  const normalized = normalizeModelForProvider(provider, slug);
  return (
    list.find((m) => m.slug === normalized || m.slug === slug) ?? {
      slug: normalized,
      label: normalized,
      badge: pc.bgWhite(pc.black(pc.bold(` ${normalized} `))),
      description: pc.dim('Custom model'),
    }
  );
}

// ─── Default fallback ─────────────────────────────────────────────────────────

/**
 * If no model is set, inject the default for the detected provider.
 * Prints provider + model lines when a key is present.
 */
export async function applyModelDefault(): Promise<void> {
  const keyInfo = resolveApiKeyFromEnv();
  if (!keyInfo) return;

  const profile = resolveProviderProfile();
  const current = (process.env['AI_MODEL'] ?? process.env['OPENROUTER_MODEL'] ?? '').trim();

  if (!current) {
    await persistActiveModel(profile.defaultModel, profile.provider);
    console.log(
      `🤖 ${pc.bgGreen(pc.black(pc.bold(' AI-CONFIG ')))}  No model selected. ` +
        `Defaulting to ${pc.bold(pc.green(profile.defaultModel))} (${profile.label})`,
    );
  }

  printProviderLockedLine(profile, getActiveModelFromEnv(profile));
}

// ─── Model status line ────────────────────────────────────────────────────────

export function printActiveModelLine(): void {
  if (!resolveApiKeyFromEnv()) {
    console.log(pc.dim('  No AI API key configured yet.'));
    return;
  }
  const profile = resolveProviderProfile();
  const slug = getActiveModelFromEnv(profile);
  const entry = modelEntry(slug, profile.provider);
  console.log(
    `${entry.badge}  ${pc.dim(`${profile.label} →`)} ${pc.bold(pc.white(slug))}`,
  );
}

// ─── Interactive hot-swap ─────────────────────────────────────────────────────

export async function promptModelSwitch(): Promise<string> {
  const profile = resolveProviderProfile();
  const models = MODELS_BY_PROVIDER[profile.provider];

  console.log('');
  console.log(
    pc.bold(pc.white(`  ⚙️  Switch Active AI Model (${profile.label})\n`)),
  );

  const current = getActiveModelFromEnv(profile);

  const chosen = await select<string>({
    message: 'Select a model for this session',
    choices: models.map((m) => ({
      value: m.slug,
      name: `${m.badge}  ${pc.bold(m.label)}${
        normalizeModelForProvider(profile.provider, m.slug) === current
          ? pc.green('  ✓ current')
          : ''
      }`,
      description: m.description,
    })),
    pageSize: models.length,
  });

  await persistActiveModel(chosen, profile.provider);

  const entry = modelEntry(chosen, profile.provider);
  console.log('');
  console.log(
    `  ${pc.green('✔')}  Active model updated → ${entry.badge}  ${pc.bold(pc.white(getActiveModel()))}`,
  );
  console.log(`  ${pc.dim('Saved to .env (AI_MODEL + OPENROUTER_MODEL).')} `);
  console.log('');

  return getActiveModel();
}

/**
 * Multi-provider AI routing — auto-detects API key type and wires the correct
 * OpenAI-compatible base URL (or Anthropic Messages API shim).
 *
 * Supported direct keys:
 *   OpenRouter  sk-or-...     OPENROUTER_API_KEY
 *   Google      AIza...       GOOGLE_API_KEY / GEMINI_API_KEY
 *   OpenAI      sk-proj-...   OPENAI_API_KEY
 *   Groq        gsk_...       GROQ_API_KEY
 *   Anthropic   sk-ant-...    ANTHROPIC_API_KEY
 *
 * Universal alias: AI_API_KEY (auto-detect from prefix)
 * Override:       AI_PROVIDER=openrouter|google|openai|groq|anthropic
 */

import OpenAI from 'openai';

export type AIProvider = 'openrouter' | 'google' | 'openai' | 'groq' | 'anthropic';

export interface ProviderProfile {
  provider: AIProvider;
  apiKey: string;
  keySource: string;
  baseURL: string;
  defaultModel: string;
  defaultHeaders: Record<string, string>;
  label: string;
}

const KEY_CANDIDATES: Array<{ env: string; provider?: AIProvider }> = [
  { env: 'AI_API_KEY' },
  { env: 'OPENROUTER_API_KEY', provider: 'openrouter' },
  { env: 'GOOGLE_API_KEY', provider: 'google' },
  { env: 'GEMINI_API_KEY', provider: 'google' },
  { env: 'OPENAI_API_KEY', provider: 'openai' },
  { env: 'ANTHROPIC_API_KEY', provider: 'anthropic' },
  { env: 'GROQ_API_KEY', provider: 'groq' },
];

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openrouter: 'OpenRouter',
  google: 'Google Gemini (direct)',
  openai: 'OpenAI (direct)',
  groq: 'Groq (direct)',
  anthropic: 'Anthropic Claude (direct)',
};

/** Detect provider from API key shape when AI_PROVIDER is not set. */
export function detectProviderFromKey(apiKey: string): AIProvider {
  const k = apiKey.trim();
  if (k.startsWith('sk-or-') || k.startsWith('or-')) return 'openrouter';
  if (k.startsWith('AIza')) return 'google';
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-proj-')) return 'openai';
  if (k.startsWith('sk-')) return 'openai';
  return 'openrouter';
}

function parseExplicitProvider(raw: string | undefined): AIProvider | null {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase();
  const map: Record<string, AIProvider> = {
    openrouter: 'openrouter',
    google: 'google',
    gemini: 'google',
    openai: 'openai',
    groq: 'groq',
    anthropic: 'anthropic',
    claude: 'anthropic',
  };
  return map[v] ?? null;
}

/** First non-empty API key from env (priority order in KEY_CANDIDATES). */
export function resolveApiKeyFromEnv(): { apiKey: string; keySource: string; hint?: AIProvider } | null {
  for (const { env, provider } of KEY_CANDIDATES) {
    const val = process.env[env]?.trim();
    if (val) return { apiKey: val, keySource: env, hint: provider };
  }
  return null;
}

export function resolveProviderProfile(): ProviderProfile {
  const explicit = parseExplicitProvider(process.env['AI_PROVIDER']);
  const resolved = resolveApiKeyFromEnv();

  if (!resolved) {
    throw new Error(
      'No AI API key found. Set AI_API_KEY (any provider) or OPENROUTER_API_KEY, GOOGLE_API_KEY, ' +
        'OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY in .env',
    );
  }

  const provider = explicit ?? resolved.hint ?? detectProviderFromKey(resolved.apiKey);

  const profiles: Record<AIProvider, Omit<ProviderProfile, 'provider' | 'apiKey' | 'keySource'>> = {
    openrouter: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultModel: 'google/gemini-2.5-flash',
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'QA Feature Engineer',
      },
      label: PROVIDER_LABELS.openrouter,
    },
    google: {
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      defaultModel: 'gemini-2.5-flash',
      defaultHeaders: {},
      label: PROVIDER_LABELS.google,
    },
    openai: {
      baseURL: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      defaultHeaders: {},
      label: PROVIDER_LABELS.openai,
    },
    groq: {
      baseURL: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      defaultHeaders: {},
      label: PROVIDER_LABELS.groq,
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com',
      defaultModel: 'claude-3-5-sonnet-20241022',
      defaultHeaders: {},
      label: PROVIDER_LABELS.anthropic,
    },
  };

  const base = profiles[provider];
  return {
    provider,
    apiKey: resolved.apiKey,
    keySource: resolved.keySource,
    ...base,
  };
}

/** Normalize model slug for the active provider (e.g. strip `google/` on direct Gemini). */
export function normalizeModelForProvider(provider: AIProvider, model: string): string {
  const m = model.trim();
  if (!m) return resolveProviderProfile().defaultModel;

  switch (provider) {
    case 'google':
      return m.replace(/^google\//i, '');
    case 'openai':
      return m.replace(/^openai\//i, '');
    case 'anthropic':
      return m
        .replace(/^anthropic\//i, '')
        .replace(/^claude-3\.5-sonnet$/i, 'claude-3-5-sonnet-20241022');
    case 'groq':
      return m.replace(/^groq\//i, '');
    case 'openrouter':
    default:
      return m;
  }
}

export function getActiveModelFromEnv(profile: ProviderProfile): string {
  const raw =
    process.env['AI_MODEL']?.trim() ||
    process.env['OPENROUTER_MODEL']?.trim() ||
    profile.defaultModel;
  return normalizeModelForProvider(profile.provider, raw);
}

// ─── Anthropic Messages API → OpenAI SDK shape ───────────────────────────────

type ChatMessage = { role: string; content: string };
type CreateParams = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
};

type CreateResult = {
  choices: Array<{ message: { content: string | null } }>;
};

class AnthropicCompatClient {
  constructor(private readonly apiKey: string) {}

  chat = {
    completions: {
      create: async (params: CreateParams): Promise<CreateResult> => {
        const systemParts = params.messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content);
        const messages = params.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

        const body = {
          model: params.model,
          max_tokens: params.max_tokens ?? 16_384,
          temperature: params.temperature ?? 0.1,
          ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
          messages,
        };

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await res.text();
          const err = new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 500)}`) as Error & {
            status?: number;
          };
          err.status = res.status;
          throw err;
        }

        const data = (await res.json()) as {
          content?: Array<{ type: string; text?: string }>;
        };
        const text =
          data.content?.find((b) => b.type === 'text')?.text ??
          data.content?.[0]?.text ??
          '';

        return { choices: [{ message: { content: text } }] };
      },
    },
  };
}

export type AIChatClient = OpenAI | AnthropicCompatClient;

/** Create the correct LLM client for the resolved provider profile. */
export function createAIClient(profile: ProviderProfile): AIChatClient {
  if (profile.provider === 'anthropic') {
    return new AnthropicCompatClient(profile.apiKey);
  }

  return new OpenAI({
    apiKey: profile.apiKey,
    baseURL: profile.baseURL,
    defaultHeaders: profile.defaultHeaders,
  });
}

export function printProviderLockedLine(profile: ProviderProfile, model: string): void {
  console.log(
    `🌐 [AI-PROVIDER] ${profile.label} — key from ${profile.keySource} — model: ${model}`,
  );
}

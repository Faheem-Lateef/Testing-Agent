import { config as loadDotenv } from 'dotenv';
import OpenAI from 'openai';
import { z } from 'zod';

import { logger } from './logger.js';
import type { FigmaRouteMap } from './types.js';
import {
  createAIClient,
  getActiveModelFromEnv,
  normalizeModelForProvider,
  resolveApiKeyFromEnv,
  resolveProviderProfile,
  type AIProvider,
  type ProviderProfile,
} from './providerRouter.js';

const envSchema = z.object({
  AI_PROVIDER: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  // Legacy name — kept for backward compatibility with existing .env files
  OPENROUTER_MODEL: z.string().optional(),
  BASE_APP_URL: z.string().url('must be a valid URL').optional(),
  FRONTEND_APP_URL: z.string().url('must be a valid URL').optional(),
  E2E_MOBILE_VIEWPORT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ROUTES_DIR: z.string().optional(),
  BACKEND_DIR: z.string().optional(),
  FIGMA_API_TOKEN: z.string().optional(),
  FIGMA_FILE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  MAX_PATCH_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  AUTO_FIX_ON_FAILURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  FIGMA_ROUTE_MAP: z.string().default('{}'),
  FIGMA_SOURCE_MAP: z.string().default('{}'),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  GITHUB_BASE_BRANCH: z.string().default('main'),
  GIT_REPO_ROOT: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

export type AppConfig = Omit<
  EnvConfig,
  'ROUTES_DIR' | 'BASE_APP_URL' | 'FRONTEND_APP_URL' | 'GIT_REPO_ROOT'
> & {
  ROUTES_DIR: string;
  BASE_APP_URL: string;
  FRONTEND_APP_URL: string;
  GIT_REPO_ROOT: string;
  hasFigma: boolean;
  hasGit: boolean;
  /** Resolved LLM provider (from key shape or AI_PROVIDER) */
  aiProvider: AIProvider;
  aiApiKey: string;
  /** Model slug normalized for the active provider */
  aiModel: string;
  /** @deprecated Use aiModel — same value, kept for existing call sites */
  OPENROUTER_MODEL: string;
  providerProfile: ProviderProfile;
};

let cached: AppConfig | null = null;

/**
 * Clears the in-memory config cache so the next loadConfig() call re-parses
 * process.env. Call this after programmatically injecting env defaults (e.g.
 * for blank-canvas feature engineer runs) before loadConfig() is invoked.
 */
export function resetConfigCache(): void {
  cached = null;
}

function parseJsonRecord(raw: string, label: string): FigmaRouteMap {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      logger.warn({ label }, 'Invalid JSON map — expected object');
      return {};
    }
    return parsed as FigmaRouteMap;
  } catch {
    logger.warn({ label }, 'Failed to parse JSON map — using empty object');
    return {};
  }
}

export function loadConfig(): AppConfig {
  if (cached) return cached;

  loadDotenv();

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || 'unknown';
      logger.error({ field, message: issue.message }, `Invalid or missing environment variable: ${field}`);
    }
    logger.fatal('Environment validation failed — check .env against .env.example');
    process.exit(1);
  }

  if (!resolveApiKeyFromEnv()) {
    logger.fatal(
      'No AI API key found. Set AI_API_KEY (auto-detects provider) or OPENROUTER_API_KEY, ' +
        'GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY',
    );
    process.exit(1);
  }

  let providerProfile: ProviderProfile;
  try {
    providerProfile = resolveProviderProfile();
  } catch (err) {
    logger.fatal({ err }, String(err));
    process.exit(1);
  }

  const aiModel = getActiveModelFromEnv(providerProfile);

  let routesDir = result.data.ROUTES_DIR;
  let baseAppUrl = result.data.BASE_APP_URL ?? 'http://localhost:3000';
  let frontendAppUrl = result.data.FRONTEND_APP_URL ?? baseAppUrl;
  let gitRepoRoot = result.data.GIT_REPO_ROOT ?? '.';

  if (!routesDir?.trim()) {
    // Provide a non-fatal fallback so blank-canvas Feature Engineer runs
    // can inject ROUTES_DIR programmatically after scaffolding the backend.
    // The agent will set process.env.ROUTES_DIR then call resetConfigCache()
    // before any route-dependent operation begins.
    routesDir = process.env['GIT_REPO_ROOT']
      ? `${process.env['GIT_REPO_ROOT']}/src/routes`
      : 'src/routes';
    logger.warn(
      { fallback: routesDir },
      'ROUTES_DIR not set — using fallback path. Set ROUTES_DIR in .env for persistent config.',
    );
  }

  cached = {
    ...result.data,
    ROUTES_DIR: routesDir,
    BASE_APP_URL: baseAppUrl,
    FRONTEND_APP_URL: frontendAppUrl,
    GIT_REPO_ROOT: gitRepoRoot,
    hasFigma: !!process.env['FIGMA_API_TOKEN'] && !!process.env['FIGMA_FILE_KEY'],
    hasGit: !!process.env['GITHUB_TOKEN'],
    aiProvider: providerProfile.provider,
    aiApiKey: providerProfile.apiKey,
    aiModel,
    OPENROUTER_MODEL: aiModel,
    providerProfile,
  };

  logger.debug(
    {
      baseAppUrl: cached.BASE_APP_URL,
      routesDir: cached.ROUTES_DIR,
      aiProvider: cached.aiProvider,
      aiModel: cached.aiModel,
      hasFigma: cached.hasFigma,
      hasGit: cached.hasGit,
    },
    'Config loaded',
  );

  return cached;
}

/** Create LLM client for the resolved provider (OpenRouter, Gemini, OpenAI, Groq, or Anthropic). */
export function createOpenRouterClient(config: AppConfig): OpenAI {
  return createAIClient(config.providerProfile) as unknown as OpenAI;
}

export function handleOpenRouterAuthError(err: unknown): never {
  const status =
    err instanceof OpenAI.APIError
      ? err.status
      : typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status: number }).status)
        : undefined;

  if (status === 401 || status === 403) {
    logger.error(
      { status },
      'Fatal auth error — check your API key (AI_API_KEY or provider-specific key in .env)',
    );
    process.exit(1);
  }
  throw err;
}

export { normalizeModelForProvider, resolveProviderProfile, type AIProvider, type ProviderProfile };

export function extractCompletionText(content: string | null | undefined, context: string): string {
  if (!content || typeof content !== 'string') {
    throw new Error(`No text response from OpenRouter for ${context}`);
  }
  return content;
}

export function getFigmaRouteMap(): FigmaRouteMap {
  return parseJsonRecord(loadConfig().FIGMA_ROUTE_MAP, 'FIGMA_ROUTE_MAP');
}

export function getFigmaSourceMap(): FigmaRouteMap {
  return parseJsonRecord(loadConfig().FIGMA_SOURCE_MAP, 'FIGMA_SOURCE_MAP');
}

export const AXIOS_TIMEOUT_MS = 10_000;
export const PIXEL_MISMATCH_THRESHOLD = 0.02;

import { config as loadDotenv } from 'dotenv';
import OpenAI from 'openai';
import { z } from 'zod';

import { logger } from './logger.js';
import type { FigmaRouteMap } from './types.js';

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, 'is required'),
  OPENROUTER_MODEL: z.string().min(1, 'is required'),
  BASE_APP_URL: z.string().url('must be a valid URL').optional(),
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

export type AppConfig = Omit<EnvConfig, 'ROUTES_DIR' | 'BASE_APP_URL' | 'GIT_REPO_ROOT'> & {
  ROUTES_DIR: string;
  BASE_APP_URL: string;
  GIT_REPO_ROOT: string;
  hasFigma: boolean;
  hasGit: boolean;
};

let cached: AppConfig | null = null;

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

  let routesDir = result.data.ROUTES_DIR;
  let baseAppUrl = result.data.BASE_APP_URL ?? 'http://localhost:3000';
  let gitRepoRoot = result.data.GIT_REPO_ROOT ?? '.';

  if (!routesDir?.trim()) {
    logger.fatal(
      'ROUTES_DIR is required — paste your backend into this workspace and run `tsx src/index.ts discover`, or set ROUTES_DIR in .env',
    );
    process.exit(1);
  }

  cached = {
    ...result.data,
    ROUTES_DIR: routesDir,
    BASE_APP_URL: baseAppUrl,
    GIT_REPO_ROOT: gitRepoRoot,
    hasFigma: !!process.env['FIGMA_API_TOKEN'] && !!process.env['FIGMA_FILE_KEY'],
    hasGit: !!process.env['GITHUB_TOKEN'],
  };

  logger.debug(
    {
      baseAppUrl: cached.BASE_APP_URL,
      routesDir: cached.ROUTES_DIR,
      openrouterModel: cached.OPENROUTER_MODEL,
      hasFigma: cached.hasFigma,
      hasGit: cached.hasGit,
    },
    'Config loaded',
  );

  return cached;
}

export function createOpenRouterClient(config: AppConfig): OpenAI {
  return new OpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Swiftlane QA Agent',
    },
  });
}

export function handleOpenRouterAuthError(err: unknown): never {
  if (err instanceof OpenAI.APIError && (err.status === 401 || err.status === 403)) {
    logger.error({ service: 'openrouter', status: err.status }, 'Fatal auth error — check OPENROUTER_API_KEY');
    process.exit(1);
  }
  throw err;
}

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

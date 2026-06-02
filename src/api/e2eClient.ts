import axios from 'axios';

import { AXIOS_TIMEOUT_MS, loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

export interface ApiCallResult {
  status: number;
  data: unknown;
  responseTimeMs: number;
}

function buildUrl(path: string): string {
  const { BASE_APP_URL } = loadConfig();
  const base = BASE_APP_URL.replace(/\/$/, '');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}

export async function apiCall(
  method: string,
  path: string,
  options?: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    label?: string;
  },
): Promise<ApiCallResult> {
  const start = Date.now();
  const response = await axios({
    method: method.toLowerCase(),
    url: buildUrl(path),
    data: options?.body,
    headers: options?.headers,
    timeout: AXIOS_TIMEOUT_MS,
    validateStatus: () => true,
  });

  const result: ApiCallResult = {
    status: response.status,
    data: response.data,
    responseTimeMs: Date.now() - start,
  };

  logger.info(
    {
      step: options?.label ?? path,
      method: method.toUpperCase(),
      path,
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      bodyPreview:
        typeof result.data === 'object' ? JSON.stringify(result.data).slice(0, 400) : result.data,
    },
    'E2E API call',
  );

  return result;
}

export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function extractId(data: unknown, keys: string[] = ['id', '_id']): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const root = data as Record<string, unknown>;
  const inner =
    typeof root['data'] === 'object' && root['data'] !== null
      ? (root['data'] as Record<string, unknown>)
      : root;

  for (const key of keys) {
    const value = inner[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return String(value);
    }
  }
  return null;
}

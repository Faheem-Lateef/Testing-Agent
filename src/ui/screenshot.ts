import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 900;

function buildUrl(baseUrl: string, route: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${base}${normalizedRoute}`;
}

function sanitizeRoute(route: string): string {
  return route.replace(/[^a-zA-Z0-9-_]/g, '_') || 'root';
}

export async function captureScreenshot(route: string, baseUrl?: string): Promise<string> {
  const { BASE_APP_URL } = loadConfig();
  const targetUrl = buildUrl(baseUrl ?? BASE_APP_URL, route);
  const outDir = path.join(os.tmpdir(), 'qa-agent', 'screenshots');
  const outPath = path.join(outDir, `${sanitizeRoute(route)}-${Date.now()}.png`);

  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    });

    logger.info({ targetUrl, viewport: `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}` }, 'Capturing screenshot');

    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outPath, fullPage: false });

    logger.debug({ outPath }, 'Screenshot saved');
    return outPath;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ targetUrl, err: message }, 'Screenshot capture failed');
    throw new Error(`Screenshot failed for ${targetUrl}: ${message}`);
  } finally {
    await browser.close();
  }
}

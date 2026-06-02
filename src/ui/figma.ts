import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import axios, { isAxiosError } from 'axios';

import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const FIGMA_IMAGE_SCALE = 2;

export function normalizeNodeId(nodeId: string): string {
  return nodeId.includes(':') ? nodeId : nodeId.replace(/-/g, ':');
}

function handleFigmaAuthError(status: number): void {
  if (status === 401 || status === 403) {
    logger.error({ service: 'figma', status }, 'Fatal auth error — check FIGMA_API_TOKEN');
    process.exit(1);
  }
}

export async function fetchFigmaFrame(nodeId: string, outputPath?: string): Promise<string> {
  const { FIGMA_API_TOKEN, FIGMA_FILE_KEY } = loadConfig();
  const normalizedId = normalizeNodeId(nodeId);
  const outDir = path.join(os.tmpdir(), 'qa-agent', 'figma');
  const outPath =
    outputPath ?? path.join(outDir, `${normalizedId.replace(/:/g, '-')}-${Date.now()}.png`);

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  let imageResponse;
  try {
    imageResponse = await axios.get<{ images: Record<string, string | null> }>(
      `${FIGMA_API_BASE}/images/${FIGMA_FILE_KEY}`,
      {
        params: { ids: normalizedId, format: 'png', scale: FIGMA_IMAGE_SCALE },
        headers: { 'X-Figma-Token': FIGMA_API_TOKEN },
        timeout: 30_000,
      },
    );
  } catch (err) {
    if (isAxiosError(err) && err.response) {
      handleFigmaAuthError(err.response.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Figma images API failed for node ${normalizedId}: ${message}`);
  }

  const imageUrl = imageResponse.data.images[normalizedId];
  if (!imageUrl) {
    throw new Error(`Figma returned no image URL for node ${normalizedId}`);
  }

  let pngBuffer: ArrayBuffer;
  try {
    const download = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });
    pngBuffer = download.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Figma image download failed for node ${normalizedId}: ${message}`);
  }

  await fs.writeFile(outPath, Buffer.from(pngBuffer));
  logger.debug({ nodeId: normalizedId, outPath }, 'Figma frame saved');
  return outPath;
}

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { logger } from '../utils/logger.js';

const PIXELMATCH_THRESHOLD = 0.1;

export interface PixelDiffResult {
  mismatchRatio: number;
  diffImagePath: string;
  mismatchedPixels: number;
  totalPixels: number;
}

async function readPng(filePath: string): Promise<PNG> {
  const buffer = await fs.readFile(filePath);
  return PNG.sync.read(buffer);
}

function cropRgba(png: PNG, width: number, height: number): Buffer {
  const cropped = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (png.width * y + x) << 2;
      const dstIdx = (width * y + x) << 2;
      png.data.copy(cropped, dstIdx, srcIdx, srcIdx + 4);
    }
  }
  return cropped;
}

export async function compareImages(
  screenshotPath: string,
  figmaPath: string,
  diffOutputPath?: string,
): Promise<PixelDiffResult> {
  const [imgA, imgB] = await Promise.all([readPng(screenshotPath), readPng(figmaPath)]);

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);
  const totalPixels = width * height;

  if (totalPixels === 0) {
    throw new Error('Cannot compare images with zero pixel area');
  }

  const dataA = cropRgba(imgA, width, height);
  const dataB = cropRgba(imgB, width, height);
  const diffData = Buffer.alloc(totalPixels * 4);

  const mismatchedPixels = pixelmatch(dataA, dataB, diffData, width, height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: false,
  });

  const mismatchRatio = mismatchedPixels / totalPixels;

  const diffPng = new PNG({ width, height });
  diffData.copy(diffPng.data);

  const outPath =
    diffOutputPath ??
    path.join(os.tmpdir(), 'qa-agent', 'diffs', `diff-${Date.now()}.png`);

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, PNG.sync.write(diffPng));

  logger.debug({ mismatchRatio, mismatchedPixels, totalPixels, outPath }, 'Pixel diff complete');

  return { mismatchRatio, diffImagePath: outPath, mismatchedPixels, totalPixels };
}

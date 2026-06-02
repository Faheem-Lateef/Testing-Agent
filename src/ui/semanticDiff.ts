import fs from 'node:fs/promises';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type { SemanticIssue } from '../utils/types.js';

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function parseSemanticIssues(raw: string): SemanticIssue[] {
  const cleaned = stripMarkdownFences(raw);
  const parsed: unknown = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Model returned non-array semantic diff');
  }

  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`Invalid semantic issue at index ${index}`);
    }

    const record = item as Record<string, unknown>;
    return {
      element: String(record['element'] ?? 'unknown'),
      issue: String(record['issue'] ?? ''),
      confidence: Number(record['confidence'] ?? 0),
    };
  });
}

async function readImageBase64(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read image ${filePath}: ${message}`);
  }
}

const SEMANTIC_PROMPT = `You are a senior UI QA engineer comparing two images:
- Image 1: the actual rendered UI (screenshot)
- Image 2: the Figma design spec (baseline)

Identify specific visual alignment defects: color mismatches, padding/spacing errors, font size or weight differences, border radius issues, missing or extra elements, and layout shifts.

Respond with a pure JSON array only — no markdown fences, no explanation:
[{ "element": string, "issue": string, "confidence": number }]

confidence is 0.0 to 1.0. Return an empty array [] if no meaningful defects exist.`;

export async function runSemanticDiff(
  screenshotPath: string,
  figmaPath: string,
): Promise<SemanticIssue[]> {
  const config = loadConfig();
  const [screenshotB64, figmaB64] = await Promise.all([
    readImageBase64(screenshotPath),
    readImageBase64(figmaPath),
  ]);

  const openai = createOpenRouterClient(config);

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshotB64}` },
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${figmaB64}` },
            },
            { type: 'text', text: SEMANTIC_PROMPT },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });
  } catch (err) {
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, 'semantic diff');
  const issues = parseSemanticIssues(text);
  logger.info({ issueCount: issues.length }, 'Semantic diff complete');
  return issues;
}

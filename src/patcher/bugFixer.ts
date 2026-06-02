import fs from 'node:fs/promises';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import type { BugReport } from '../utils/types.js';

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:\w+)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function buildFixPrompt(bug: BugReport, source: string): string {
  const contextBlock =
    bug.context.length > 0
      ? `\n\nPrevious failed patch attempts (do NOT repeat these):\n${bug.context.join('\n---\n')}`
      : '';

  return `You are a senior software engineer fixing a specific bug in a production codebase.

Bug title: ${bug.title}
Bug description: ${bug.description}
${contextBlock}

Fix ONLY the described bug. No unrelated refactoring. No explanation.

Return the complete corrected file contents — the full file, not a diff or snippet. No markdown fences.

Source file:
\`\`\`
${source}
\`\`\``;
}

export async function generateFix(bug: BugReport): Promise<string> {
  const config = loadConfig();

  let source: string;
  try {
    source = await fs.readFile(bug.filePath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${bug.filePath} for patching: ${message}`);
  }

  const openai = createOpenRouterClient(config);

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [{ role: 'user', content: buildFixPrompt(bug, source) }],
      temperature: 0.1,
      max_tokens: 8192,
    });
  } catch (err) {
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, `patch ${bug.filePath}`);
  const patched = stripMarkdownFences(text);

  if (!patched.trim()) {
    throw new Error(`Model returned empty patch for ${bug.filePath}`);
  }

  return patched;
}

import OpenAI from 'openai';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';

export async function verifyOpenRouterConnection(): Promise<void> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);

  logger.info(
    { model: config.aiModel, provider: config.aiProvider },
    'Verifying AI provider connectivity',
  );

  try {
    const response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      temperature: 0,
      max_tokens: 8,
    });

    const text = extractCompletionText(response.choices[0]?.message?.content, 'health check');
    if (!text.toUpperCase().includes('OK')) {
      logger.warn({ response: text }, 'OpenRouter responded but payload was unexpected');
    }

    logger.info('OpenRouter API key verified — model is reachable');
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      logger.warn(
        'OpenRouter credits exhausted — LLM test generation disabled; E2E flow tests will still run',
      );
      return;
    }
    handleOpenRouterAuthError(err);
  }
}

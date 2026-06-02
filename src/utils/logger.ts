import pino from 'pino';

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'qa-agent' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['apiKey', 'authorization', 'token', 'OPENROUTER_API_KEY', 'FIGMA_API_TOKEN'],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

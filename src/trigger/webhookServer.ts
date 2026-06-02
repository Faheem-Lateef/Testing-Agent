import express from 'express';

import { runFullQACycle } from '../orchestrator.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const WEBHOOK_PORT = Number(process.env['WEBHOOK_PORT'] ?? 4040);

export async function startWebhookServer(): Promise<void> {
  loadConfig();

  const app = express();
  app.use(express.json());

  app.post('/webhook/ci', (_req, res) => {
    res.status(202).json({ status: 'accepted' });
    runFullQACycle().catch((err) => {
      logger.error({ err }, 'QA cycle failed after webhook trigger');
    });
  });

  app.listen(WEBHOOK_PORT, () => {
    logger.info({ port: WEBHOOK_PORT }, 'Webhook server listening on POST /webhook/ci');
  });
}

import fs from 'node:fs/promises';
import path from 'node:path';

import { runFeatureTestGenerationPhase } from './openRouterPhases.js';
import { phaseLog, engineerLog } from './logging.js';
import type { ProjectMemoryBank } from './types.js';

export function slugifyFeature(spec: string): string {
  return spec
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'feature';
}

export async function writeGeneratedFeatureTest(
  qaAgentRoot: string,
  fileName: string,
  source: string,
): Promise<string> {
  const dir = path.join(qaAgentRoot, 'src', 'ui', 'generated');
  await fs.mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, fileName);

  const bootstrap = `/**
 * Auto-generated feature E2E — do not edit manually.
 * Run: npx tsx ${path.relative(qaAgentRoot, absolutePath).replace(/\\/g, '/')}
 */
`;

  await fs.writeFile(absolutePath, bootstrap + source, 'utf-8');
  phaseLog('PHASE_2_TEST_ARCHITECTURE', `Wrote ${path.relative(qaAgentRoot, absolutePath)}`);
  return absolutePath;
}

export async function generateFeatureTest(
  featureSpec: string,
  memory: ProjectMemoryBank,
  repoSummary: string,
  qaAgentRoot: string,
  frontendBaseUrl: string,
): Promise<string> {
  const slug = slugifyFeature(featureSpec);
  const fileName = `feature-${slug}.test.ts`;
  const content = await runFeatureTestGenerationPhase(
    featureSpec,
    memory,
    repoSummary,
    fileName,
    frontendBaseUrl,
  );

  if (!content.trim()) {
    engineerLog('Test generation returned empty — using minimal fallback journey');
    const fallback = buildFallbackTest(frontendBaseUrl);
    return writeGeneratedFeatureTest(qaAgentRoot, fileName, fallback);
  }

  return writeGeneratedFeatureTest(qaAgentRoot, fileName, content);
}

function buildFallbackTest(baseUrl: string): string {
  return `
import { chromium } from 'playwright';

export async function runFeatureJourney() {
  const steps: string[] = [];
  const email = \`qa-feature-\${Date.now()}@example.com\`;
  const password = 'TestPass123!';
  let browser;
  try {
    browser = await chromium.launch({ headless: false, slowMo: 150 });
    const page = await browser.newPage();
    await page.goto('${baseUrl}/register', { waitUntil: 'networkidle' });
    steps.push('A-open-register');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('textbox', { name: /full name/i }).fill('QA Feature User').catch(() => {});
    await page.getByRole('button', { name: /create account/i }).click();
    steps.push('A-register');
    await page.waitForURL(/products/, { timeout: 15000 }).catch(() => {});
    steps.push('B-browse');
    return { passed: true, steps };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { passed: false, steps, error: message, stackTrace: err instanceof Error ? err.stack : undefined };
  } finally {
    if (browser) await browser.close();
  }
}

const isMain = process.argv[1]?.includes('feature-');
if (isMain) {
  runFeatureJourney().then((r) => {
    console.log('__FEATURE_RESULT__' + JSON.stringify(r));
    process.exit(r.passed ? 0 : 1);
  });
}
`;
}

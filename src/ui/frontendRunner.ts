import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import { chromium, type Browser, type Locator, type Page } from 'playwright';

import {
  createOpenRouterClient,
  extractCompletionText,
  handleOpenRouterAuthError,
  loadConfig,
} from '../utils/config.js';
import { logger } from '../utils/logger.js';
import type {
  BrowserDiagnostic,
  FrontendE2eOptions,
  FrontendE2eResult,
  GeneratedCredentials,
} from '../utils/types.js';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const FAILURES_DIR = path.join(process.cwd(), 'temp', 'failures');

export class FrontendStepError extends Error {
  constructor(
    public readonly step: string,
    public readonly component: string,
    message: string,
  ) {
    super(`[${step}] ${component}: ${message}`);
    this.name = 'FrontendStepError';
  }
}

function buildUrl(base: string, route: string): string {
  const normalizedBase = base.replace(/\/$/, '');
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${normalizedBase}${normalizedRoute}`;
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

function fallbackCredentials(): GeneratedCredentials {
  const stamp = Date.now();
  return {
    email: `qa-e2e-${stamp}@example.com`,
    password: 'TestPass123!',
    name: 'QA E2E User',
  };
}

async function generateCredentials(): Promise<GeneratedCredentials> {
  const config = loadConfig();
  const openai = createOpenRouterClient(config);

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Generate unique test credentials for an e-commerce QA run. Respond with pure JSON only:
{ "email": string, "password": string, "name": string }
Use a realistic email like qa-user-<random>@example.com and password at least 10 chars with letters and numbers.`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && err.status === 402) {
      logger.warn('OpenRouter credits exhausted — using local fallback credentials for E2E');
      return fallbackCredentials();
    }
    handleOpenRouterAuthError(err);
  }

  const text = extractCompletionText(response.choices[0]?.message?.content, 'credentials');
  const parsed: unknown = JSON.parse(stripMarkdownFences(text));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('OpenRouter returned invalid credentials JSON');
  }

  const record = parsed as Record<string, unknown>;
  const email = String(record['email'] ?? '');
  const password = String(record['password'] ?? '');

  if (!email || !password) {
    throw new Error('OpenRouter credentials missing email or password');
  }

  return {
    email,
    password,
    name: record['name'] !== undefined ? String(record['name']) : undefined,
  };
}

function attachDiagnostics(page: Page, diagnostics: BrowserDiagnostic[]): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      diagnostics.push({
        type: 'console',
        message: msg.text(),
        url: page.url(),
      });
      logger.warn({ type: msg.type(), text: msg.text() }, 'Browser console');
    }
  });

  page.on('pageerror', (err) => {
    diagnostics.push({
      type: 'pageerror',
      message: err.message,
      url: page.url(),
    });
    logger.error({ err: err.message }, 'Unhandled page error');
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    diagnostics.push({
      type: 'requestfailed',
      message: `${request.method()} ${request.url()} — ${failure?.errorText ?? 'failed'}`,
      url: request.url(),
    });
    logger.warn({ url: request.url() }, 'Network request failed');
  });
}

async function saveFailureScreenshot(page: Page, step: string): Promise<string> {
  await fs.mkdir(FAILURES_DIR, { recursive: true });
  const filePath = path.join(FAILURES_DIR, `${step}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  logger.info({ filePath, step }, 'Failure screenshot saved');
  return filePath;
}

async function clickFirstVisible(page: Page, locators: Locator[], label: string): Promise<void> {
  for (const locator of locators) {
    if ((await locator.count()) > 0 && (await locator.first().isVisible().catch(() => false))) {
      await locator.first().click();
      return;
    }
  }
  throw new FrontendStepError('interaction', label, `No visible control matching ${label}`);
}

async function fillFirstVisible(page: Page, locators: Locator[], value: string, label: string): Promise<void> {
  for (const locator of locators) {
    const target = locator.first();
    if ((await locator.count()) > 0 && (await target.isVisible().catch(() => false))) {
      await target.fill(value);
      return;
    }
  }
  throw new FrontendStepError('form', label, `No visible input for ${label}`);
}

async function runRegistrationLoginStep(
  page: Page,
  baseUrl: string,
  credentials: GeneratedCredentials,
): Promise<void> {
  const loginUrl = buildUrl(baseUrl, '/login');
  await page.goto(loginUrl, { waitUntil: 'networkidle' });

  const registerTab = page.getByRole('link', { name: /register|sign up|create account/i });
  if ((await registerTab.count()) > 0) {
    await registerTab.first().click();
    await page.waitForTimeout(300);
  } else {
    const registerUrl = buildUrl(baseUrl, '/register');
    try {
      await page.goto(registerUrl, { waitUntil: 'networkidle', timeout: 8000 });
    } catch {
      logger.debug('No /register route — using /login form');
      await page.goto(loginUrl, { waitUntil: 'networkidle' });
    }
  }

  await fillFirstVisible(
    page,
    [
      page.locator('input[type="email"]'),
      page.locator('input[name="email"]'),
      page.getByPlaceholder(/email/i),
    ],
    credentials.email,
    'email',
  );

  await fillFirstVisible(
    page,
    [
      page.locator('input[type="password"]'),
      page.locator('input[name="password"]'),
      page.getByPlaceholder(/password/i),
    ],
    credentials.password,
    'password',
  );

  if (credentials.name) {
    try {
      await fillFirstVisible(
        page,
        [
          page.locator('input[name="name"]'),
          page.getByPlaceholder(/name|full name/i),
        ],
        credentials.name,
        'name',
      );
    } catch {
      logger.debug('Name field not present — continuing');
    }
  }

  await clickFirstVisible(
    page,
    [
      page.getByRole('button', { name: /register|sign up|create account|submit|login|sign in/i }),
      page.locator('button[type="submit"]'),
    ],
    'submit',
  );

  await page.waitForTimeout(1500);

  const url = page.url();
  const storedToken = await page.evaluate(`() => {
    const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    const tokenKey = keys.find((k) => /token|jwt|auth|access/i.test(k));
    if (!tokenKey) return null;
    return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey);
  }`);

  const authOk =
    (typeof storedToken === 'string' && storedToken.length > 8) ||
    /dashboard|account|home|shop|products/i.test(url);

  if (!authOk) {
    throw new FrontendStepError(
      'auth',
      'session/JWT',
      'No JWT/token in storage and URL did not reach dashboard or shop area after submit',
    );
  }

  logger.info({ url: page.url() }, 'Registration/login step passed');
}

async function navigateToProductPage(page: Page, baseUrl: string): Promise<void> {
  const catalogPaths = ['/products', '/shop', '/catalog', '/'];
  for (const route of catalogPaths) {
    try {
      await page.goto(buildUrl(baseUrl, route), { waitUntil: 'networkidle', timeout: 12_000 });
      const productLink = page.locator(
        'a[href*="/product"], a[href*="/products/"], [data-testid*="product"] a, .product-card a',
      );
      if ((await productLink.count()) > 0) {
        await productLink.first().click();
        await page.waitForLoadState('networkidle');
        return;
      }
    } catch {
      continue;
    }
  }
  throw new FrontendStepError('catalog', 'product link', 'Could not open a product detail page');
}

async function runCartCheckoutStep(page: Page): Promise<void> {
  await clickFirstVisible(
    page,
    [
      page.getByRole('button', { name: /add to cart|add to bag|buy now/i }),
      page.locator('[data-testid*="add-to-cart"]'),
      page.locator('button:has-text("Add")'),
    ],
    'Add to Cart',
  );

  await page.waitForTimeout(800);

  await clickFirstVisible(
    page,
    [
      page.getByRole('button', { name: /cart|view cart|bag/i }),
      page.locator('[data-testid*="cart"]'),
      page.locator('.cart-icon, .cart-toggle'),
    ],
    'open cart',
  ).catch(() => undefined);

  const cartPanel = page.locator(
    '[data-testid*="cart"], .cart-modal, .cart-drawer, [role="dialog"]:has-text("Cart"), .cart-summary',
  );
  const totalLocator = page.locator(
    'text=/total|subtotal|grand total/i, [data-testid*="total"], .cart-total, .order-total',
  );

  const panelVisible =
    (await cartPanel.count()) > 0 && (await cartPanel.first().isVisible().catch(() => false));
  const totalVisible =
    (await totalLocator.count()) > 0 && (await totalLocator.first().isVisible().catch(() => false));

  if (!panelVisible && !totalVisible) {
    throw new FrontendStepError('cart', 'cart modal', 'Cart panel or totals not visible after add');
  }

  const totalText = totalVisible ? await totalLocator.first().innerText() : '';
  if (totalText && !/\d/.test(totalText)) {
    throw new FrontendStepError('cart', 'total calculation', `Cart total missing numeric value: "${totalText}"`);
  }

  await clickFirstVisible(
    page,
    [
      page.getByRole('button', { name: /checkout|book now|proceed|place order/i }),
      page.locator('[data-testid*="checkout"]'),
    ],
    'Checkout/Book',
  );

  await page.waitForTimeout(1000);
  logger.info({ totalText, url: page.url() }, 'Cart & checkout step passed');
}

export async function runFrontendE2eSweep(
  options: FrontendE2eOptions = {},
): Promise<FrontendE2eResult> {
  const config = loadConfig();
  const baseUrl = options.baseUrl ?? config.FRONTEND_APP_URL;
  const mobile = options.mobile ?? config.E2E_MOBILE_VIEWPORT;
  const diagnostics: BrowserDiagnostic[] = [];
  const stepsCompleted: string[] = [];

  let browser: Browser | null = null;
  let failureScreenshot: string | undefined;
  let credentials: GeneratedCredentials = { email: '', password: '' };

  try {
    credentials = await generateCredentials();
    logger.info({ email: credentials.email, mobile }, 'Starting frontend E2E sweep');

    browser = await chromium.launch({ headless: false, slowMo: 150 });
    const context = await browser.newContext({
      viewport: mobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
    });
    const page = await context.newPage();
    attachDiagnostics(page, diagnostics);

    await runRegistrationLoginStep(page, baseUrl, credentials);
    stepsCompleted.push('registration-login');

    await navigateToProductPage(page, baseUrl);
    stepsCompleted.push('product-page');

    await runCartCheckoutStep(page);
    stepsCompleted.push('cart-checkout');

    const consoleErrors = diagnostics.filter((d) => d.type === 'console' || d.type === 'pageerror');
    if (consoleErrors.length > 0) {
      logger.warn({ count: consoleErrors.length }, 'Browser diagnostics captured during sweep');
    }

    return {
      passed: true,
      stepsCompleted,
      diagnostics,
      credentials,
    };
  } catch (err) {
    const step =
      err instanceof FrontendStepError ? err.step : 'frontend-e2e';
    const component =
      err instanceof FrontendStepError ? err.component : 'unknown';
    const message = err instanceof Error ? err.message : String(err);

    if (browser) {
      try {
        const pages = browser.contexts().flatMap((c) => c.pages());
        const page = pages[pages.length - 1];
        if (page) {
          failureScreenshot = await saveFailureScreenshot(page, step);
        }
      } catch {
        /* screenshot best-effort */
      }
    }

    throw new FrontendStepError(step, component, message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

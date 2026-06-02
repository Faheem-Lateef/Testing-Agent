import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import type { IntegrationRunSummary } from './integrationReport.js';
import { apiCall, authHeader, extractId } from './e2eClient.js';
import { setE2eSession, type E2eTestSession } from './testSession.js';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const API = '/api/v1';
const PASSWORD = 'TestPass123!';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}@qa-agent.test`;
}

async function promoteToAdmin(email: string): Promise<void> {
  const { GIT_REPO_ROOT } = loadConfig();
  const backendRoot = path.resolve(GIT_REPO_ROOT);
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(npx, ['tsx', 'scripts/promoteAdminRole.ts', email], {
    cwd: backendRoot,
    timeout: 30_000,
    shell: process.platform === 'win32',
  });
}

function recordStep(
  summary: IntegrationRunSummary,
  name: string,
  passed: boolean,
  detail?: string,
): void {
  summary.testsTotal++;
  if (passed) summary.testsPassed++;
  else {
    summary.testsFailed++;
    logger.warn({ step: name, detail }, 'E2E step failed');
  }
}

export async function runE2eFlows(summary: IntegrationRunSummary): Promise<void> {
  logger.info('Starting E2E scenario flows (auth → catalog → cart → order)');

  const health = await apiCall('GET', '/health', { label: 'health-check' });
  recordStep(summary, 'health-check', health.status === 200);

  const adminEmail = uniqueEmail('qa-admin');
  const userEmail = uniqueEmail('qa-user');

  const adminSignup = await apiCall('POST', `${API}/auth/signup`, {
    label: 'admin-signup',
    body: { name: 'QA Admin', email: adminEmail, password: PASSWORD },
  });
  recordStep(summary, 'admin-signup', adminSignup.status === 201);
  const adminTokenFromSignup = extractId(adminSignup.data);
  if (!adminTokenFromSignup && adminSignup.status !== 201) {
    logger.fatal('Cannot continue E2E — admin signup failed');
    summary.aborted = true;
    summary.abortReason = 'admin signup failed';
    return;
  }

  try {
    await promoteToAdmin(adminEmail);
    recordStep(summary, 'promote-admin-role', true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(summary, 'promote-admin-role', false, message);
    logger.fatal({ err: message }, 'Admin promotion failed — cannot test catalog admin routes');
    summary.aborted = true;
    summary.abortReason = message;
    return;
  }

  const adminLogin = await apiCall('POST', `${API}/auth/login`, {
    label: 'admin-login',
    body: { email: adminEmail, password: PASSWORD },
  });
  recordStep(summary, 'admin-login', adminLogin.status === 200);
  const adminToken = extractToken(adminLogin.data) ?? adminTokenFromSignup;
  if (!adminToken) {
    summary.aborted = true;
    summary.abortReason = 'no admin token';
    return;
  }

  const userSignup = await apiCall('POST', `${API}/auth/signup`, {
    label: 'user-signup',
    body: { name: 'QA Shopper', email: userEmail, password: PASSWORD },
  });
  recordStep(summary, 'user-signup', userSignup.status === 201);

  const userLogin = await apiCall('POST', `${API}/auth/login`, {
    label: 'user-login',
    body: { email: userEmail, password: PASSWORD },
  });
  recordStep(summary, 'user-login', userLogin.status === 200);
  const userToken = extractToken(userLogin.data);
  const userId = extractUserId(userLogin.data);
  if (!userToken || !userId) {
    summary.aborted = true;
    summary.abortReason = 'no user token';
    return;
  }

  const dupSignup = await apiCall('POST', `${API}/auth/signup`, {
    label: 'duplicate-signup-409',
    body: { name: 'Dup', email: userEmail, password: PASSWORD },
  });
  recordStep(summary, 'duplicate-signup-409', dupSignup.status === 409);

  const noAuthUsers = await apiCall('GET', `${API}/users`, { label: 'users-unauthorized-401' });
  recordStep(summary, 'users-unauthorized-401', noAuthUsers.status === 401);

  const adminUsers = await apiCall('GET', `${API}/users`, {
    label: 'users-admin-list',
    headers: authHeader(adminToken),
  });
  recordStep(summary, 'users-admin-list', adminUsers.status === 200);

  const categoryCreate = await apiCall('POST', `${API}/categories`, {
    label: 'create-category',
    headers: authHeader(adminToken),
    body: { name: `QA Category ${Date.now()}` },
  });
  recordStep(summary, 'create-category', categoryCreate.status === 201);
  const categoryId = extractId(categoryCreate.data);
  if (!categoryId) {
    summary.aborted = true;
    summary.abortReason = 'category create failed';
    return;
  }

  const categoriesList = await apiCall('GET', `${API}/categories`, { label: 'list-categories' });
  recordStep(summary, 'list-categories', categoriesList.status === 200);

  const categoryById = await apiCall('GET', `${API}/categories/${categoryId}`, {
    label: 'get-category-by-id',
  });
  recordStep(summary, 'get-category-by-id', categoryById.status === 200);

  const productCreate = await apiCall('POST', `${API}/products`, {
    label: 'create-product',
    headers: authHeader(adminToken),
    body: {
      name: `QA Product ${Date.now()}`,
      description: 'Integration test product description for QA agent.',
      price: 29.99,
      categoryId,
      stock: 50,
      images: [],
    },
  });
  recordStep(summary, 'create-product', productCreate.status === 201);
  const productId = extractId(productCreate.data);
  if (!productId) {
    summary.aborted = true;
    summary.abortReason = 'product create failed';
    return;
  }

  const productsList = await apiCall('GET', `${API}/products`, { label: 'browse-products' });
  recordStep(summary, 'browse-products', productsList.status === 200);

  const productById = await apiCall('GET', `${API}/products/${productId}`, {
    label: 'get-product-by-id',
  });
  recordStep(summary, 'get-product-by-id', productById.status === 200);

  const stockPatch = await apiCall('PATCH', `${API}/products/${productId}/stock`, {
    label: 'adjust-stock',
    headers: authHeader(adminToken),
    body: { adjustment: 10 },
  });
  recordStep(summary, 'adjust-stock', stockPatch.status === 200);

  const userCreateProduct = await apiCall('POST', `${API}/products`, {
    label: 'user-create-product-403',
    headers: authHeader(userToken),
    body: {
      name: 'Blocked',
      description: 'Should not be allowed for regular user role.',
      price: 1,
      categoryId,
      stock: 1,
    },
  });
  recordStep(summary, 'user-create-product-403', userCreateProduct.status === 403);

  const emptyCartOrder = await apiCall('POST', `${API}/orders`, {
    label: 'place-order-empty-cart-400',
    headers: authHeader(userToken),
    body: {
      shippingAddress: {
        street: '1 Test St',
        city: 'Testville',
        state: 'TS',
        zipCode: '12345',
        country: 'US',
      },
    },
  });
  recordStep(summary, 'place-order-empty-cart-400', emptyCartOrder.status === 400);

  const addCart = await apiCall('POST', `${API}/cart/items`, {
    label: 'add-to-cart',
    headers: authHeader(userToken),
    body: { productId, quantity: 2 },
  });
  recordStep(summary, 'add-to-cart', addCart.status === 200);

  const getCart = await apiCall('GET', `${API}/cart`, {
    label: 'get-cart',
    headers: authHeader(userToken),
  });
  recordStep(summary, 'get-cart', getCart.status === 200);

  const updateCart = await apiCall('PATCH', `${API}/cart/items/${productId}`, {
    label: 'update-cart-item',
    headers: authHeader(userToken),
    body: { quantity: 1 },
  });
  recordStep(summary, 'update-cart-item', updateCart.status === 200);

  const removeCartItem = await apiCall('DELETE', `${API}/cart/items/${productId}`, {
    label: 'remove-cart-item-before-checkout',
    headers: authHeader(userToken),
  });
  recordStep(summary, 'remove-cart-item-before-checkout', removeCartItem.status === 200);

  const addCartAgain = await apiCall('POST', `${API}/cart/items`, {
    label: 'add-to-cart-for-order',
    headers: authHeader(userToken),
    body: { productId, quantity: 1 },
  });
  recordStep(summary, 'add-to-cart-for-order', addCartAgain.status === 200);

  const placeOrder = await apiCall('POST', `${API}/orders`, {
    label: 'place-order',
    headers: authHeader(userToken),
    body: {
      shippingAddress: {
        street: '42 Order Lane',
        city: 'Ship City',
        state: 'SC',
        zipCode: '90210',
        country: 'US',
      },
    },
  });
  recordStep(summary, 'place-order', placeOrder.status === 201);
  const orderId = extractId(placeOrder.data);

  const myOrders = await apiCall('GET', `${API}/orders/my`, {
    label: 'my-orders',
    headers: authHeader(userToken),
  });
  recordStep(summary, 'my-orders', myOrders.status === 200);

  if (orderId) {
    const myOrder = await apiCall('GET', `${API}/orders/my/${orderId}`, {
      label: 'my-order-by-id',
      headers: authHeader(userToken),
    });
    recordStep(summary, 'my-order-by-id', myOrder.status === 200);

    const adminOrders = await apiCall('GET', `${API}/orders`, {
      label: 'admin-all-orders',
      headers: authHeader(adminToken),
    });
    recordStep(summary, 'admin-all-orders', adminOrders.status === 200);

    const statusUpdate = await apiCall('PATCH', `${API}/orders/${orderId}/status`, {
      label: 'admin-update-order-status',
      headers: authHeader(adminToken),
      body: { status: 'Processing' },
    });
    recordStep(summary, 'admin-update-order-status', statusUpdate.status === 200);
  }

  const invalidProductCart = await apiCall('POST', `${API}/cart/items`, {
    label: 'add-invalid-product-400',
    headers: authHeader(userToken),
    body: { productId: '507f1f77bcf86cd799439011', quantity: 1 },
  });
  recordStep(summary, 'add-invalid-product-404', invalidProductCart.status === 404);

  const clearCart = await apiCall('DELETE', `${API}/cart`, {
    label: 'clear-cart',
    headers: authHeader(userToken),
  });
  recordStep(summary, 'clear-cart', clearCart.status === 200);

  const session: E2eTestSession = {
    adminToken,
    userToken,
    adminEmail,
    userEmail,
    categoryId,
    productId,
    orderId: orderId ?? '',
    userId,
  };
  setE2eSession(session);

  logger.info(
    { categoryId, productId, orderId },
    'E2E session ready — per-endpoint tests will use live tokens and IDs',
  );
}

function extractToken(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const root = data as Record<string, unknown>;
  const inner =
    typeof root['data'] === 'object' && root['data'] !== null
      ? (root['data'] as Record<string, unknown>)
      : null;
  if (!inner || typeof inner['token'] !== 'string') return null;
  return inner['token'];
}

function extractUserId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const root = data as Record<string, unknown>;
  const inner =
    typeof root['data'] === 'object' && root['data'] !== null
      ? (root['data'] as Record<string, unknown>)
      : null;
  const user =
    inner && typeof inner['user'] === 'object' && inner['user'] !== null
      ? (inner['user'] as Record<string, unknown>)
      : null;
  if (!user) return null;
  if (typeof user['id'] === 'string') return user['id'];
  if (user['id'] && typeof user['id'] === 'object') return String(user['id']);
  return null;
}

import type { HttpMethod, RouteMetadata, TestCase } from '../utils/types.js';
import { getE2eSession } from './testSession.js';

const API_PREFIX = '/api/v1';

const FILE_MOUNT: Record<string, string> = {
  authRoutes: 'auth',
  userRoutes: 'users',
  categoryRoutes: 'categories',
  productRoutes: 'products',
  cartRoutes: 'cart',
  orderRoutes: 'orders',
};

function mountFromFile(filePath: string): string | null {
  const base = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.(ts|js)$/, '') ?? '';
  return FILE_MOUNT[base] ?? null;
}

function fullPath(mount: string, routePath: string, session: NonNullable<ReturnType<typeof getE2eSession>>): string {
  let suffix = routePath;
  if (suffix.includes(':id') && mount === 'categories') {
    suffix = suffix.replace(':id', session.categoryId);
  } else if (suffix.includes(':id') && mount === 'products') {
    suffix = suffix.replace(':id', session.productId);
  } else if (suffix.includes(':id') && mount === 'users') {
    suffix = suffix.replace(':id', session.userId);
  } else if (suffix.includes(':productId')) {
    suffix = suffix.replace(':productId', session.productId);
  } else if (suffix.includes(':id') && mount === 'orders' && routePath.includes('/my/')) {
    suffix = suffix.replace(':id', session.orderId);
  } else if (suffix.includes(':id') && mount === 'orders') {
    suffix = suffix.replace(':id', session.orderId);
  }

  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `${API_PREFIX}/${mount}${normalized === '/' ? '' : normalized}`.replace(/\/+/g, '/');
}

function routeRequiresAuth(source: string, method: HttpMethod, routePath: string): boolean {
  if (/router\.use\([^)]*\bauthenticate\b/.test(source)) return true;
  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `router\\.${method.toLowerCase()}\\(\\s*['"\`]${escaped}['"\`][^;]*\\)`,
    'i',
  );
  const match = source.match(pattern);
  if (!match) return false;
  return /\bauthenticate\b/.test(match[0]);
}

function needsAdmin(source: string, method: HttpMethod, routePath: string): boolean {
  if (/router\.use\([^)]*\badminOnly\b/.test(source)) return true;

  const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `router\\.${method.toLowerCase()}\\(\\s*['"\`]${escaped}['"\`][^;]*\\)`,
    'i',
  );
  const match = source.match(pattern);
  if (!match) return /\badminOnly\b/.test(source);
  return /\badminOnly\b/.test(match[0]);
}

export function generateFlowTestCases(route: RouteMetadata, source: string): TestCase[] {
  const session = getE2eSession();
  if (!session) return [];

  const mount = mountFromFile(route.filePath);
  if (!mount) return [];

  const path = fullPath(mount, route.path, session);
  const authed = routeRequiresAuth(source, route.method, route.path);
  const admin = needsAdmin(source, route.method, route.path);
  const token = admin ? session.adminToken : authed ? session.userToken : undefined;
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  const tests: TestCase[] = [];

  if (mount === 'auth' && route.path === '/signup') {
    tests.push({
      name: `flow ${route.method} ${path} duplicate email`,
      method: route.method,
      path,
      body: { name: 'Dup', email: session.userEmail, password: 'TestPass123!' },
      expectedStatus: 409,
    });
    return tests;
  }

  if (mount === 'auth' && route.path === '/login') {
    tests.push({
      name: `flow ${route.method} ${path} valid login`,
      method: route.method,
      path,
      body: { email: session.userEmail, password: 'TestPass123!' },
      expectedStatus: 200,
      expectedShape: { success: 'boolean' },
    });
    tests.push({
      name: `flow ${route.method} ${path} bad password`,
      method: route.method,
      path,
      body: { email: session.userEmail, password: 'wrong-password-xyz' },
      expectedStatus: 401,
    });
    return tests;
  }

  if (
    (mount === 'products' || mount === 'categories' || mount === 'users') &&
    route.method === 'DELETE'
  ) {
    return [];
  }

  if (mount === 'cart' && route.path === '/items' && route.method === 'POST') {
    tests.push({
      name: `flow ${route.method} ${path} invalid product`,
      method: route.method,
      path,
      headers: { Authorization: `Bearer ${session.userToken}` },
      body: { productId: '507f1f77bcf86cd799439011', quantity: 1 },
      expectedStatus: 404,
    });
    tests.push({
      name: `flow ${route.method} ${path} add product`,
      method: route.method,
      path,
      headers: { Authorization: `Bearer ${session.userToken}` },
      body: { productId: session.productId, quantity: 1 },
      expectedStatus: 200,
      expectedShape: { success: 'boolean' },
    });
    return tests;
  }

  let expectedStatus = 200;
  if (mount === 'auth') expectedStatus = 400;
  else if (authed && !token) expectedStatus = 401;
  else if (admin && route.method === 'POST') expectedStatus = 201;
  else if (route.method === 'POST' && mount === 'orders') expectedStatus = 400;
  else if (route.method === 'GET' && route.path.includes(':') && !session.orderId && mount === 'orders') {
    expectedStatus = 404;
  } else if (!authed && route.method === 'GET' && !route.path.includes(':')) {
    expectedStatus = 200;
  } else if (authed && admin && route.method === 'GET') {
    expectedStatus = 200;
  } else if (authed && !admin && route.method === 'POST') {
    expectedStatus = route.path === '/' && mount === 'orders' ? 400 : 403;
  } else if (route.method === 'DELETE' && mount === 'users') {
    expectedStatus = 204;
  } else if (mount === 'cart' && route.path.includes('/items/') && route.method === 'DELETE') {
    expectedStatus = 404;
  } else if (mount === 'cart' && route.path.includes('/items/') && route.method === 'PATCH') {
    expectedStatus = 200;
  } else if (route.method === 'DELETE' || route.method === 'PUT' || route.method === 'PATCH') {
    expectedStatus = admin ? 200 : authed ? 200 : 401;
  }

  const body =
    route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH'
      ? buildBody(mount, route, session)
      : undefined;

  tests.push({
    name: `flow ${route.method} ${path}`,
    method: route.method,
    path,
    body,
    headers,
    expectedStatus,
    expectedShape:
      expectedStatus >= 200 && expectedStatus < 300 && expectedStatus !== 204
        ? { success: 'boolean' }
        : undefined,
  });

  return tests;
}

function buildBody(
  mount: string,
  route: RouteMetadata,
  session: NonNullable<ReturnType<typeof getE2eSession>>,
): Record<string, unknown> | undefined {
  if (mount === 'categories' && route.method === 'POST') {
    return { name: `Flow Category ${Date.now()}` };
  }
  if (mount === 'products' && route.method === 'POST') {
    return {
      name: `Flow Product ${Date.now()}`,
      description: 'Flow test product created during per-endpoint pass.',
      price: 9.99,
      categoryId: session.categoryId,
      stock: 5,
    };
  }
  if (mount === 'cart' && route.path === '/items') {
    return { productId: session.productId, quantity: 1 };
  }
  if (mount === 'cart' && route.path.includes('/items/')) {
    return { quantity: 2 };
  }
  if (mount === 'orders' && route.path === '/') {
    return {
      shippingAddress: {
        street: '9 Flow St',
        city: 'Flow City',
        state: 'FC',
        zipCode: '11111',
        country: 'US',
      },
    };
  }
  if (mount === 'orders' && route.path.includes('/status')) {
    return { status: 'Processing' };
  }
  if (mount === 'products' && route.path.includes('/stock')) {
    return { adjustment: 5 };
  }
  if (mount === 'users' && route.path.includes('/block')) {
    return { isBlocked: false };
  }
  return {};
}

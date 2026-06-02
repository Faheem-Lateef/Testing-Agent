import type { HttpMethod, RouteMetadata, TestCase } from '../utils/types.js';

const API_PREFIX = '/api/v1';
const PLACEHOLDER_ID = '507f1f77bcf86cd799439011';

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

function resolveFullPath(mount: string, routePath: string): string {
  const suffix = routePath.replace(/:id/g, PLACEHOLDER_ID).replace(/:productId/g, PLACEHOLDER_ID);
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

function expectedStatus(
  method: HttpMethod,
  routePath: string,
  authed: boolean,
  mount: string,
): number {
  if (mount === 'auth' && (routePath === '/signup' || routePath === '/login')) {
    return 400;
  }
  if (authed) return 401;
  if (method === 'GET') {
    return routePath.includes(':') ? 404 : 200;
  }
  return 400;
}

export function generateSmokeTestCases(route: RouteMetadata, source: string): TestCase[] {
  const mount = mountFromFile(route.filePath);
  if (!mount) return [];

  const fullPath = resolveFullPath(mount, route.path);
  const authed = routeRequiresAuth(source, route.method, route.path);
  const status = expectedStatus(route.method, route.path, authed, mount);

  return [
    {
      name: `smoke ${route.method} ${fullPath}`,
      method: route.method,
      path: fullPath,
      body: route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH' ? {} : undefined,
      expectedStatus: status,
      expectedShape: status === 200 ? { success: 'boolean' } : undefined,
    },
  ];
}

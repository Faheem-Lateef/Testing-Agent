import type { RouteMetadata } from '../utils/types.js';

export type BackendProfile = 'ecommerce' | 'generic';

export function detectBackendProfile(routes: RouteMetadata[]): BackendProfile {
  const paths = routes.map((r) => `${r.filePath}:${r.path}`).join(' ');
  const hasAuth =
    /authRoutes|\/signup|\/login|auth\//i.test(paths) ||
    routes.some((r) => r.path === '/signup' || r.path === '/login');
  const hasCart = /cartRoutes|\/cart/i.test(paths);
  const hasOrders = /orderRoutes|\/orders/i.test(paths);
  const hasProducts = /productRoutes|\/products/i.test(paths);

  if (hasAuth && (hasCart || hasOrders) && hasProducts) {
    return 'ecommerce';
  }
  return 'generic';
}

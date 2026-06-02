import path from 'node:path';

import type { RouteMetadata } from '../utils/types.js';

export type TestDomain = 'auth' | 'catalog' | 'cart_order' | 'other';

const DOMAIN_ORDER: TestDomain[] = ['auth', 'catalog', 'cart_order', 'other'];

const FILE_DOMAIN: Record<string, TestDomain> = {
  authRoutes: 'auth',
  userRoutes: 'auth',
  categoryRoutes: 'catalog',
  productRoutes: 'catalog',
  cartRoutes: 'cart_order',
  orderRoutes: 'cart_order',
};

const METHOD_ORDER: Record<string, number> = {
  POST: 0,
  GET: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
};

export function getRouteDomain(route: RouteMetadata): TestDomain {
  const base = path.basename(route.filePath).replace(/\.(ts|js)$/, '');
  return FILE_DOMAIN[base] ?? 'other';
}

export function sortRoutesByDomain(routes: RouteMetadata[]): RouteMetadata[] {
  return [...routes].sort((a, b) => {
    const domainDelta = DOMAIN_ORDER.indexOf(getRouteDomain(a)) - DOMAIN_ORDER.indexOf(getRouteDomain(b));
    if (domainDelta !== 0) return domainDelta;

    const fileDelta = a.filePath.localeCompare(b.filePath);
    if (fileDelta !== 0) return fileDelta;

    const methodDelta = (METHOD_ORDER[a.method] ?? 99) - (METHOD_ORDER[b.method] ?? 99);
    if (methodDelta !== 0) return methodDelta;

    return a.path.localeCompare(b.path);
  });
}

export function domainLabel(domain: TestDomain): string {
  switch (domain) {
    case 'auth':
      return 'Authentication & Security';
    case 'catalog':
      return 'Catalog & Products';
    case 'cart_order':
      return 'Cart & Order Flow';
    default:
      return 'Other';
  }
}

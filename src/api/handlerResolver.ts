import fs from 'node:fs/promises';
import path from 'node:path';

import type { HttpMethod, RouteMetadata } from '../utils/types.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveHandlerNameFromSource(
  source: string,
  method: HttpMethod,
  routePath: string,
  fallback: string,
): string {
  const escaped = escapeRegex(routePath);
  const linePattern = new RegExp(
    `router\\.${method.toLowerCase()}\\(\\s*['"\`]${escaped}['"\`][^;]*`,
    'i',
  );
  const lineMatch = source.match(linePattern);
  if (!lineMatch) return fallback;

  const identifiers = [...lineMatch[0].matchAll(/,\s*(\w+)\s*(?=,|\))/g)].map((m) => m[1]);
  const handler = identifiers.at(-1);
  return handler && !handler.endsWith('Validation') ? handler : (identifiers.at(-2) ?? fallback);
}

function resolveImportPath(source: string, handlerName: string): string | null {
  const importPattern = new RegExp(
    `import\\s*\\{[^}]*\\b${escapeRegex(handlerName)}\\b[^}]*\\}\\s*from\\s*['"\`]([^'"\`]+)['"\`]`,
  );
  const match = source.match(importPattern);
  return match?.[1] ?? null;
}

export async function resolveHandlerFilePath(route: RouteMetadata): Promise<string> {
  const source = await fs.readFile(route.filePath, 'utf-8');
  const handlerName = resolveHandlerNameFromSource(source, route.method, route.path, route.handler);
  const importPath = resolveImportPath(source, handlerName);

  if (!importPath) {
    return route.filePath;
  }

  const resolved = path.resolve(path.dirname(route.filePath), importPath);
  const withTs = resolved.endsWith('.js') ? resolved.replace(/\.js$/, '.ts') : resolved;
  return withTs;
}

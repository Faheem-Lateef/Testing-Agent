import fs from 'node:fs/promises';
import path from 'node:path';

import { engineerLog } from './logging.js';
import type { CodeAnchorKind, CodeAnchorMatch, CodeInjectionSpec } from './types.js';

/** Blind whole-file regex replacement is forbidden. */
export function assertNoBlindReplacement(): void {
  engineerLog('Injection policy: additive anchor inserts only — no blind regex/file wipe');
}

export function findExpressRouteIndexAnchor(content: string, filePath: string): CodeAnchorMatch | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/router\.use\s*\(|app\.use\s*\(/.test(line) && /\/api\//.test(line)) {
      return {
        kind: 'express_route_index',
        filePath,
        lineIndex: i,
        lineContent: line.trim(),
        confidence: 0.9,
      };
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (/export\s+default\s+router/.test(line)) {
      return {
        kind: 'express_router_use',
        filePath,
        lineIndex: i - 1,
        lineContent: line.trim(),
        confidence: 0.7,
      };
    }
  }
  return null;
}

export function findReactFormAnchor(content: string, filePath: string): CodeAnchorMatch | null {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/<form[\s>]/.test(line) || /onSubmit=\{/.test(line)) {
      return {
        kind: 'react_form_block',
        filePath,
        lineIndex: i,
        lineContent: line.trim(),
        confidence: 0.85,
      };
    }
  }
  return null;
}

export function resolveAnchor(
  content: string,
  filePath: string,
  kind: CodeAnchorKind,
): CodeAnchorMatch | null {
  switch (kind) {
    case 'express_route_index':
    case 'express_router_use':
      return findExpressRouteIndexAnchor(content, filePath);
    case 'react_form_block':
      return findReactFormAnchor(content, filePath);
    case 'react_component_export':
      return findExpressRouteIndexAnchor(content, filePath);
    case 'file_append':
      return {
        kind: 'file_append',
        filePath,
        lineIndex: content.split('\n').length,
        lineContent: '',
        confidence: 1,
      };
    default:
      return null;
  }
}

/**
 * Insert lines immediately after anchor line — never replaces entire file via regex.
 */
export function injectAtAnchor(fileContent: string, anchor: CodeAnchorMatch, linesToInsert: string[]): string {
  const lines = fileContent.split('\n');
  const insertAt = Math.min(anchor.lineIndex + 1, lines.length);
  const block = linesToInsert.filter((l) => l.trim().length > 0);
  const merged = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)];
  return merged.join('\n');
}

export async function applyInjectionSpec(
  projectRoot: string,
  spec: CodeInjectionSpec,
): Promise<{ absolutePath: string; previousContent: string; newContent: string }> {
  assertNoBlindReplacement();

  const absolutePath = path.isAbsolute(spec.filePath)
    ? spec.filePath
    : path.resolve(projectRoot, spec.filePath);

  let previousContent = '';
  try {
    previousContent = await fs.readFile(absolutePath, 'utf-8');
  } catch {
    previousContent = '';
  }

  let newContent: string;

  if (spec.replaceEntireFile && spec.newFileContent) {
    newContent = spec.newFileContent;
    engineerLog(`Full replace: ${spec.filePath}`);
  } else if (spec.newFileContent && !previousContent.trim()) {
    newContent = spec.newFileContent;
    engineerLog(`Creating new file at anchor: ${spec.filePath}`);
  } else {
    const anchor = resolveAnchor(previousContent, spec.filePath, spec.anchorKind);
    if (!anchor) {
      throw new Error(`No code anchor found in ${spec.filePath} for kind ${spec.anchorKind}`);
    }
    engineerLog(
      `Anchor hit ${spec.anchorKind} @ line ${anchor.lineIndex + 1} in ${spec.filePath}: ${anchor.lineContent.slice(0, 80)}`,
    );
    newContent = injectAtAnchor(previousContent, anchor, spec.linesToInsert);
  }

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, newContent, 'utf-8');

  return { absolutePath, previousContent, newContent };
}

export function suggestRouteIndexPath(backendRoot: string): string {
  return path.join(backendRoot, 'src', 'routes', 'index.ts');
}

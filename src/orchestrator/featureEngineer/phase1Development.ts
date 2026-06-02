import fs from 'node:fs/promises';
import path from 'node:path';

import { applyInjectionSpec } from './codeAnchors.js';
import { engineerLog } from './logging.js';
import type { CodeInjectionSpec, DevelopmentPhaseOutput, FileChangeRecord } from './types.js';

export interface ParsedFileBlock {
  repo: 'backend' | 'frontend';
  relativePath: string;
  content: string;
}

/** Parse `// file: backend:src/...` or `// file: frontend:src/...` */
export function parseFileBlocks(output: DevelopmentPhaseOutput): ParsedFileBlock[] {
  const blocks: ParsedFileBlock[] = [];

  for (const raw of output.rawBlocks) {
    if (!raw.filePath) continue;
    const parsed = parseFilePathToken(raw.filePath, raw.repo);
    if (parsed) blocks.push({ ...parsed, content: raw.content });
  }

  for (const inj of output.injections) {
    const parsed = parseFilePathToken(inj.filePath);
    if (!parsed) continue;
    const content = inj.newFileContent ?? inj.linesToInsert.join('\n');
    if (!content.trim()) continue;
    blocks.push({ ...parsed, content });
  }

  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = `${b.repo}:${b.relativePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFilePathToken(
  token: string,
  repoHint?: 'backend' | 'frontend',
): Omit<ParsedFileBlock, 'content'> | null {
  const trimmed = token.trim();
  const prefixed = trimmed.match(/^(backend|frontend):(.+)$/i);
  if (prefixed) {
    return {
      repo: prefixed[1]!.toLowerCase() as 'backend' | 'frontend',
      relativePath: prefixed[2]!.replace(/\\/g, '/'),
    };
  }
  if (repoHint) {
    return { repo: repoHint, relativePath: trimmed.replace(/\\/g, '/') };
  }
  if (/\.tsx$/i.test(trimmed)) return { repo: 'frontend', relativePath: trimmed };
  return { repo: 'backend', relativePath: trimmed };
}

export async function applyDevelopmentFiles(
  backendRoot: string,
  frontendRoot: string,
  output: DevelopmentPhaseOutput,
): Promise<FileChangeRecord[]> {
  const blocks = parseFileBlocks(output);
  const changes: FileChangeRecord[] = [];

  for (const block of blocks) {
    const root = block.repo === 'frontend' ? frontendRoot : backendRoot;
    const absolutePath = path.resolve(root, block.relativePath);

    let previous = '';
    try {
      previous = await fs.readFile(absolutePath, 'utf-8');
    } catch {
      previous = '';
    }

    const isNew = !previous.trim();
    const spec: CodeInjectionSpec = {
      filePath: block.relativePath,
      anchorKind: /\.tsx$/i.test(block.relativePath)
        ? 'react_form_block'
        : /routes\/index\.ts$/i.test(block.relativePath)
          ? 'express_route_index'
          : 'file_append',
      linesToInsert: [],
      newFileContent: block.content,
      replaceEntireFile: isNew || block.content.split('\n').length > 30,
    };

    try {
      if (spec.replaceEntireFile && !isNew) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, block.content, 'utf-8');
        engineerLog(`Full file update (${block.repo}): ${block.relativePath}`);
      } else if (isNew) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, block.content, 'utf-8');
        engineerLog(`Created (${block.repo}): ${block.relativePath}`);
      } else {
        spec.linesToInsert = block.content.split('\n');
        spec.newFileContent = undefined;
        await applyInjectionSpec(root, spec);
        engineerLog(`Anchor inject (${block.repo}): ${block.relativePath}`);
      }

      changes.push({
        repo: block.repo,
        relativePath: block.relativePath,
        absolutePath,
        action: isNew ? 'created' : 'modified',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      engineerLog(`Skipped ${block.relativePath}: ${message}`);
      if (isNew) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, block.content, 'utf-8');
        changes.push({
          repo: block.repo,
          relativePath: block.relativePath,
          absolutePath,
          action: 'created',
        });
      }
    }
  }

  return changes;
}

export async function applyHealFix(
  backendRoot: string,
  frontendRoot: string,
  targetFile: string,
  fixedCode: string,
  replaceEntireFile?: boolean,
): Promise<FileChangeRecord | null> {
  if (!targetFile.trim() || !fixedCode.trim()) return null;

  const parsed = parseFilePathToken(targetFile);
  if (!parsed) return null;

  const root = parsed.repo === 'frontend' ? frontendRoot : backendRoot;
  const absolutePath = path.resolve(root, parsed.relativePath);

  let previous = '';
  try {
    previous = await fs.readFile(absolutePath, 'utf-8');
  } catch {
    previous = '';
  }

  if (replaceEntireFile || !previous.trim()) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, fixedCode, 'utf-8');
  } else {
    await applyInjectionSpec(root, {
      filePath: parsed.relativePath,
      anchorKind: /\.tsx$/i.test(parsed.relativePath) ? 'react_form_block' : 'file_append',
      linesToInsert: fixedCode.split('\n'),
    });
  }

  return {
    repo: parsed.repo,
    relativePath: parsed.relativePath,
    absolutePath,
    action: previous.trim() ? 'modified' : 'created',
  };
}

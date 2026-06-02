import path from 'node:path';

import axios, { isAxiosError } from 'axios';
import { simpleGit } from 'simple-git';

import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function resolveRepoRoot(filePath: string, configuredRoot?: string): string {
  if (configuredRoot && configuredRoot !== '.') {
    return path.resolve(configuredRoot);
  }
  return path.resolve(path.dirname(filePath));
}

export async function openPullRequest(
  title: string,
  body: string,
  changedFilePath: string,
): Promise<string | null> {
  const config = loadConfig();

  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO_OWNER || !config.GITHUB_REPO_NAME) {
    logger.warn('GitHub credentials not configured — skipping PR creation');
    return null;
  }

  const repoRoot = resolveRepoRoot(changedFilePath, config.GIT_REPO_ROOT);
  const branchName = `fix/qa-agent-${slugify(title)}-${Date.now()}`;
  const git = simpleGit(repoRoot);

  try {
    await git.checkoutLocalBranch(branchName);
    await git.add('.');
    await git.commit(`fix: ${title}\n\n${body}`);
    await git.push(['origin', branchName, '--set-upstream']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, repoRoot }, 'Git push failed');
    throw new Error(`Failed to push fix branch: ${message}`);
  }

  try {
    const response = await axios.post<{ html_url: string }>(
      `https://api.github.com/repos/${config.GITHUB_REPO_OWNER}/${config.GITHUB_REPO_NAME}/pulls`,
      {
        title: `fix: ${title}`,
        head: branchName,
        base: config.GITHUB_BASE_BRANCH,
        body,
      },
      {
        headers: {
          Authorization: `Bearer ${config.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        timeout: 30_000,
      },
    );

    logger.info({ url: response.data.html_url }, 'Pull request opened');
    return response.data.html_url;
  } catch (err) {
    if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
      logger.error({ status: err.response.status }, 'Fatal GitHub auth error — check GITHUB_TOKEN');
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`GitHub PR creation failed: ${message}`);
  }
}

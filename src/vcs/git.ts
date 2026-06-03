import { execSync } from 'node:child_process';

import type { Commit, VcsProvider } from '../types';

export function runGit(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function parseSemver(tag: string, prefix: string): number[] {
  return tag.slice(prefix.length).split('.').map(Number);
}

export function findLatestTag(tags: string[], prefix: string): string | null {
  const matching = tags.filter((t) => t.startsWith(prefix));
  if (matching.length === 0) return null;
  return (
    matching.sort((a, b) => {
      const verA = parseSemver(a, prefix);
      const verB = parseSemver(b, prefix);
      for (let i = 0; i < 3; i++) {
        const diff = (verB[i] ?? 0) - (verA[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    })[0] ?? null
  );
}

export function resolveGitTag(name: string, allTags: string[]): string | null {
  return findLatestTag(allTags, `${name}-v`) || findLatestTag(allTags, 'v');
}

export function getGitCommits(
  name: string,
  watch: string[],
  allTags: string[],
  cwd: string,
): Commit[] {
  const lastTag = resolveGitTag(name, allTags);
  const watchPaths = watch.join(' ');
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';

  // Using shell-safe single quotes and disabling signature lines to prevent parsing corruption
  const gitCmd = watchPaths
    ? `git log ${range} --no-show-signature --format='%H|%an|%ad|%s' --date=short -- ${watchPaths}`
    : `git log ${range} --no-show-signature --format='%H|%an|%ad|%s' --date=short`;

  return runGit(gitCmd, cwd)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      const hash = parts[0] ?? '';
      const author = parts[1] ?? '';
      const date = parts[2] ?? '';
      const msgParts = parts.slice(3);
      const message = msgParts.join('|').trim();

      const ccMatch = message.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

      const type = ccMatch ? (ccMatch[1] ?? 'other') : 'other';
      const scope = ccMatch ? (ccMatch[2] ?? null) : null;
      const isBreaking = (ccMatch && !!ccMatch[3]) || message.includes('BREAKING CHANGE');
      const description = ccMatch ? (ccMatch[4] ?? message) : message;

      return {
        hash,
        shortHash: hash.slice(0, 7),
        author,
        date,
        message,
        type,
        scope,
        isBreaking,
        description,
      };
    });
}

export class GitVcsProvider implements VcsProvider {
  private allTags: string[] | null = null;

  constructor(private cwd: string) { }

  private getAllTags(): string[] {
    if (this.allTags === null) {
      this.allTags = runGit('git tag', this.cwd)
        .split('\n')
        .map((t) => t.trim()) // Strips carriage returns (\r) and trailing whitespaces
        .filter(Boolean);
    }
    return this.allTags;
  }

  async getCommits(name: string, watch: string[]): Promise<Commit[]> {
    const tags = this.getAllTags();
    return getGitCommits(name, watch, tags, this.cwd);
  }

  async commit(message: string): Promise<void> {
    runGit('git add .', this.cwd);
    runGit(`git commit -m "${message}"`, this.cwd);
  }

  async tag(tagName: string): Promise<void> {
    runGit(`git tag ${tagName}`, this.cwd);
  }
}

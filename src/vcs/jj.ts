import { execSync } from 'node:child_process';

import type { Commit, VcsProvider } from '../types';

export function runJj(cmd: string, cwd: string): string {
  try {
    return execSync(`jj --color=never ${cmd}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  } catch {
    return '';
  }
}

function parseSemver(tag: string, prefix: string): number[] {
  return tag.slice(prefix.length).split('.').map(Number);
}

export function findLatestJjTag(tags: string[], prefix: string): string | null {
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

export function resolveJjTag(name: string, allTags: string[]): string | null {
  return findLatestJjTag(allTags, `${name}-v`) || findLatestJjTag(allTags, 'v');
}

export function getJjCommits(
  name: string,
  watch: string[],
  allTags: string[],
  cwd: string,
): Commit[] {
  const lastTag = resolveJjTag(name, allTags);

  // FIXED: Double quotes explicitly escape the literal tag name for the jj revset engine
  const range = lastTag ? `"${lastTag}"..@ & ~root()` : `::@ & ~root()`;

  // Calling `.short(40)` to cast the CommitId into a 40-character hex String for template concatenation
  const template =
    'commit_id.short(40) ++ "|" ++ author.name() ++ "|" ++ author.timestamp().format("%Y-%m-%d") ++ "|" ++ description.first_line() ++ "\\n"';

  const watchPaths = watch.join(' ');
  // Appending --color=never to strip ANSI escape codes so hashes can be parsed cleanly
  const jjCmd = watchPaths
    ? `log --no-graph -r '${range}' -T '${template}' -- ${watchPaths}`
    : `log --no-graph -r '${range}' -T '${template}'`;

  return runJj(jjCmd, cwd)
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

export class JjVcsProvider implements VcsProvider {
  private allTags: string[] | null = null;

  constructor(private cwd: string) { }

  private getAllTags(): string[] {
    if (this.allTags === null) {
      // Must enforce --color=never to prevent ANSI escape codes from failing the startsWith prefix checks
      const raw = runJj('tag list', this.cwd);
      this.allTags = raw
        .split('\n')
        .map((line) => {
          const parts = line.split(':');
          return (parts[0] ?? '').trim();
        })
        .filter(Boolean);
    }
    return this.allTags;
  }

  async getCommits(name: string, watch: string[]): Promise<Commit[]> {
    const tags = this.getAllTags();
    return getJjCommits(name, watch, tags, this.cwd);
  }

  async commit(message: string): Promise<void> {
    runJj(`commit -m "${message}"`, this.cwd);
  }

  async tag(tagName: string): Promise<void> {
    // Appending --allow-move to update the tag reference cleanly if it already exists
    runJj(`tag set "${tagName}" -r @- --allow-move`, this.cwd);
  }
}

import { execSync } from 'node:child_process';

import { Effect, Layer } from 'effect';

import type { Commit } from '../types';

import { VcsProviderService, type VcsProvider } from './index';

export function runJj(
  cmd: string,
  cwd: string,
  opts = { withStdio: false },
): Effect.Effect<string, never> {
  return Effect.sync(() => {
    try {
      const colorFlag = opts.withStdio ? '' : '--color=never';
      return execSync(`jj ${colorFlag} ${cmd}`, {
        cwd,
        encoding: 'utf8',
        stdio: opts.withStdio ? [] : ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  });
}

function parseSemver(tag: string, prefix: string): number[] {
  const versionStr = tag.slice(prefix.length);
  return versionStr.split('.').map((part) => {
    const val = Number.parseInt(part, 10);
    return Number.isNaN(val) ? 0 : val;
  });
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
  exclude: string[] = [],
): Effect.Effect<Commit[], never> {
  const lastTag = resolveJjTag(name, allTags);

  let range = lastTag ? `"${lastTag}"..@ & ~root()` : `::@ & ~root()`;

  if (exclude && exclude.length > 0) {
    for (const ext of exclude) {
      range += ` & ~file("${ext}")`;
    }
  }

  const template =
    'commit_id.short(40) ++ "|" ++ author.name() ++ "|" ++ author.timestamp().format("%Y-%m-%d") ++ "|" ++ description.first_line() ++ "\\n"';

  const watchPaths = watch.join(' ');
  const jjCmd = watchPaths
    ? `log --no-graph -r '${range}' -T '${template}' -- ${watchPaths}`
    : `log --no-graph -r '${range}' -T '${template}'`;

  return runJj(jjCmd, cwd).pipe(
    Effect.map((output) =>
      output
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
        }),
    ),
  );
}

// Service Factory Implementation
export function makeJjVcsProvider(cwd: string): VcsProvider {
  const getAllTags = (): Effect.Effect<string[], never> => {
    return runJj('tag list', cwd).pipe(
      Effect.map((output) => {
        return output
          .split('\n')
          .map((line) => {
            const parts = line.split(':');
            return (parts[0] ?? '').trim();
          })
          .filter(Boolean);
      }),
    );
  };

  return VcsProviderService.of({
    getCommits: (name, watch, exclude = []) =>
      getAllTags().pipe(Effect.flatMap((tags) => getJjCommits(name, watch, tags, cwd, exclude))),

    getLatestTag: (name) =>
      getAllTags().pipe(
        Effect.map((tags) => {
          if (typeof name === 'string') {
            const specificPrefix = `${name}-v`;
            const specificTag = findLatestJjTag(tags, specificPrefix);
            if (specificTag) return specificTag.slice(specificPrefix.length);
          } else {
            const genericPrefix = 'v';
            const genericTag = findLatestJjTag(tags, genericPrefix);
            if (genericTag) return genericTag.slice(genericPrefix.length);
          }
          return null;
        }),
      ),

    commit: (message) => runJj(`commit -m "${message}"`, cwd).pipe(Effect.asVoid),

    tag: (tagName) => runJj(`tag set "${tagName}" -r @- --allow-move`, cwd).pipe(Effect.asVoid),
  });
}

// Live Layer Factory for JJ
export const JjVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeJjVcsProvider(cwd)),
  );

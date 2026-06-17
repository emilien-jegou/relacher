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

export function getJjCommits(
  name: string,
  watch: string[],
  lastCommit: string | null,
  cwd: string,
  exclude: string[] = [],
): Effect.Effect<Commit[], never> {
  let range = lastCommit ? `"${lastCommit}"..@ & ~root()` : `::@ & ~root()`;

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

export function getJjHeadCommit(cwd: string): Effect.Effect<string, never> {
  return runJj('log --no-graph -r @ -T commit_id', cwd);
}

export function findJjLastReleaseCommit(
  packageName: string,
  currentVersion: string,
  cwd: string,
): Effect.Effect<string | null, never> {
  return runJj('log --no-graph -T \'commit_id ++ "\\n"\' -- .relacher.lock', cwd).pipe(
    Effect.map((output) => {
      const hashes = output
        .split('\n')
        .map((h) => h.trim())
        .filter(Boolean);
      if (hashes.length === 0) return null;

      let lastMatchingHash: string | null = null;

      for (const hash of hashes) {
        try {
          const content = execSync(`jj file show .relacher.lock -r ${hash}`, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });

          const data = JSON.parse(content);
          const version = data.packages?.[packageName]?.version;

          if (version === currentVersion) {
            lastMatchingHash = hash;
          } else {
            return lastMatchingHash;
          }
        } catch {
          return lastMatchingHash;
        }
      }

      return lastMatchingHash;
    }),
  );
}

export function isJjDirty(cwd: string): Effect.Effect<boolean, never> {
  return Effect.gen(function*() {
    // 1. Check if current commit @ is not empty
    const currentStatus = yield* runJj(
      'log --no-graph -r @ -T \'if(empty, "empty", "not-empty")\'',
      cwd,
    );
    if (currentStatus.trim() === 'not-empty') {
      return true;
    }

    // 2. Check if there are any commits without a description in the history (excluding root and the current commit)
    const historyDescriptions = yield* runJj(
      'log --no-graph -r "::@ & ~@ & ~root()" -T \'if(description, "1", "0")\'',
      cwd,
    );
    if (historyDescriptions.includes('0')) {
      return true;
    }

    return false;
  });
}

// Service Factory Implementation
export function makeJjVcsProvider(cwd: string): VcsProvider {
  return VcsProviderService.of({
    getCommits: (name, watch, lastCommit, exclude = []) =>
      getJjCommits(name, watch, lastCommit, cwd, exclude),

    getHeadCommit: () => getJjHeadCommit(cwd),

    findLastReleaseCommit: (packageName, currentVersion) =>
      findJjLastReleaseCommit(packageName, currentVersion, cwd),

    commit: (message) => runJj(`commit -m "${message}"`, cwd).pipe(Effect.asVoid),

    isDirty: () => isJjDirty(cwd),
  });
}

// Live Layer Factory for JJ
export const JjVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeJjVcsProvider(cwd)),
  );

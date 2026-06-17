import { execSync } from 'node:child_process';

import { Effect, Layer } from 'effect';

import type { Commit } from '../types';

import { VcsProviderService, type VcsProvider } from './index';

export function runGit(cmd: string, cwd: string): Effect.Effect<string, never> {
  return Effect.sync(() => {
    try {
      return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  });
}

export function getGitCommits(
  name: string,
  watch: string[],
  lastCommit: string | null,
  cwd: string,
  exclude: string[] = [],
): Effect.Effect<Commit[], never> {
  const range = lastCommit ? `${lastCommit}..HEAD` : 'HEAD';

  const paths = [...watch];
  if (exclude && exclude.length > 0) {
    paths.push(...exclude.map((e) => `:(exclude)${e}`));
  }

  const watchPaths = paths.join(' ');
  const gitCmd = watchPaths
    ? `git log ${range} --no-show-signature --format='%H|%an|%ad|%s' --date=short -- ${watchPaths}`
    : `git log ${range} --no-show-signature --format='%H|%an|%ad|%s' --date=short`;

  return runGit(gitCmd, cwd).pipe(
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

export function getGitHeadCommit(cwd: string): Effect.Effect<string, never> {
  return runGit('git rev-parse HEAD', cwd);
}

export function findGitLastReleaseCommit(
  packageName: string,
  currentVersion: string,
  cwd: string,
): Effect.Effect<string | null, never> {
  return runGit('git log --format="%H" -- .relacher.lock', cwd).pipe(
    Effect.map((output) => {
      const hashes = output
        .split('\n')
        .map((h) => h.trim())
        .filter(Boolean);
      if (hashes.length === 0) return null;

      let lastMatchingHash = hashes[0] || null;

      for (const hash of hashes) {
        try {
          const content = execSync(`git show ${hash}:.relacher.lock`, {
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

export function isGitDirty(cwd: string): Effect.Effect<boolean, never> {
  return runGit('git diff --name-only', cwd).pipe(
    Effect.map((output) => output.trim().length > 0),
  );
}

// Service Factory Implementation
export function makeGitVcsProvider(cwd: string): VcsProvider {
  return VcsProviderService.of({
    getCommits: (name, watch, lastCommit, exclude = []) =>
      getGitCommits(name, watch, lastCommit, cwd, exclude),

    getHeadCommit: () => getGitHeadCommit(cwd),

    findLastReleaseCommit: (packageName, currentVersion) =>
      findGitLastReleaseCommit(packageName, currentVersion, cwd),

    commit: (message) =>
      runGit('git add .', cwd).pipe(
        Effect.flatMap(() => runGit(`git commit -m "${message}"`, cwd)),
        Effect.asVoid,
      ),

    isDirty: () => isGitDirty(cwd),
  });
}

// Live Layer Factory for Git
export const GitVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeGitVcsProvider(cwd)),
  );

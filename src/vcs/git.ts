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

function parseSemver(tag: string, prefix: string): number[] {
  const versionStr = tag.slice(prefix.length);
  return versionStr.split('.').map((part) => {
    const val = Number.parseInt(part, 10);
    return Number.isNaN(val) ? 0 : val;
  });
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
  exclude: string[] = [],
): Effect.Effect<Commit[], never> {
  const lastTag = resolveGitTag(name, allTags);
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';

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

// Service Factory Implementation
export function makeGitVcsProvider(cwd: string): VcsProvider {
  const getAllTags = (): Effect.Effect<string[], never> => {
    return runGit('git tag', cwd).pipe(
      Effect.map((output) =>
        output
          .split('\n')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    );
  };

  return VcsProviderService.of({
    getCommits: (name, watch, exclude = []) =>
      getAllTags().pipe(Effect.flatMap((tags) => getGitCommits(name, watch, tags, cwd, exclude))),

    getLatestTag: (name) =>
      getAllTags().pipe(
        Effect.map((tags) => {
          if (typeof name === 'string') {
            const specificPrefix = `${name}-v`;
            const specificTag = findLatestTag(tags, specificPrefix);
            if (specificTag) return specificTag.slice(specificPrefix.length);
          } else {
            const genericPrefix = 'v';
            const genericTag = findLatestTag(tags, genericPrefix);
            if (genericTag) return genericTag.slice(genericPrefix.length);
          }
          return null;
        }),
      ),

    commit: (message) =>
      runGit('git add .', cwd).pipe(
        Effect.flatMap(() => runGit(`git commit -m "${message}"`, cwd)),
        Effect.asVoid,
      ),

    tag: (tagName) => runGit(`git tag ${tagName}`, cwd).pipe(Effect.asVoid),
  });
}

// Live Layer Factory for Git
export const GitVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeGitVcsProvider(cwd)),
  );

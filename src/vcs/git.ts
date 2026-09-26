import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';

import type { Commit } from '../types';

import { parseCommitLine } from './commit';
import { isGitTracked, isInsideGitWorkTree } from './common';
import { VcsError, VcsProviderService, type VcsProvider } from './index';

const execFileAsync = promisify(execFile);

function normalizeArgs(cmdOrArgs: string | string[]): string[] {
  if (Array.isArray(cmdOrArgs)) return cmdOrArgs;
  const matches = cmdOrArgs.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const args = matches.map((arg) => {
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      return arg.slice(1, -1);
    }
    return arg;
  });
  if (args[0] === 'git') args.shift();
  return args;
}

export function runGit(cmdOrArgs: string | string[], cwd: string): Effect.Effect<string, VcsError> {
  const args = normalizeArgs(cmdOrArgs);
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim();
    },
    catch: (error) =>
      new VcsError({
        message: `Git command failed: git ${args.join(' ')}`,
        command: `git ${args.join(' ')}`,
        cause: error,
      }),
  });
}

export function isGitTrackedSync(filePath: string, cwd: string): boolean {
  if (!isInsideGitWorkTree(cwd)) return true;
  return isGitTracked(filePath, cwd);
}

export function parseGitLogOutput(output: string): Commit[] {
  return output
    .split('\n')
    .map(parseCommitLine)
    .filter((c): c is Commit => c !== null);
}

export function getGitCommits(
  watch: string[],
  lastCommit: string | null,
  cwd: string,
  exclude: string[] = [],
): Effect.Effect<Commit[], VcsError> {
  const range = lastCommit ? `${lastCommit}..HEAD` : 'HEAD';
  const args = ['log', range, '--no-show-signature', '--format=%H|%an|%ad|%s', '--date=short'];

  const pathSpecs = [...watch];
  if (exclude.length > 0) {
    pathSpecs.push(...exclude.map((e) => `:(exclude)${e}`));
  }

  if (pathSpecs.length > 0) {
    args.push('--', ...pathSpecs);
  }

  return runGit(args, cwd).pipe(Effect.map(parseGitLogOutput));
}

export function makeGitVcsProvider(cwd: string): VcsProvider {
  return VcsProviderService.of({
    getCommits: (watch, lastCommit, exclude = []) =>
      getGitCommits(watch, lastCommit, cwd, exclude),

    getHeadCommit: () => runGit(['rev-parse', 'HEAD'], cwd),

    getFileAtCommit: (filePath, commitHash) =>
      Effect.sync(() => {
        try {
          return execFileSync('git', ['show', `${commitHash}:${filePath}`], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch {
          return null;
        }
      }),

    getFileHistoryCommits: (filePath) =>
      runGit(['log', '--format=%H', '--', filePath], cwd).pipe(
        Effect.map((out) =>
          out
            .split('\n')
            .map((h) => h.trim())
            .filter(Boolean),
        ),
      ),

    isTracked: (filePath) => Effect.sync(() => isGitTrackedSync(filePath, cwd)),

    commit: (message) =>
      runGit(['add', '.'], cwd).pipe(
        Effect.flatMap(() => runGit(['commit', '-m', message], cwd)),
        Effect.asVoid,
      ),

    isDirty: () =>
      runGit(['status', '--porcelain'], cwd).pipe(
        Effect.map((output) => output.trim().length > 0),
      ),
  });
}

export const GitVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeGitVcsProvider(cwd)),
  );

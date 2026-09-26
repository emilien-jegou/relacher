import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, Layer } from 'effect';

import type { Commit } from '../types';

import { parseCommitLine } from './commit';
import { isInsideJjWorkTree, isJjTracked } from './common';
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
  if (args[0] === 'jj') args.shift();
  return args;
}

export function runJj(cmdOrArgs: string | string[], cwd: string): Effect.Effect<string, VcsError> {
  const args = normalizeArgs(cmdOrArgs);
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync('jj', ['--color=never', ...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim();
    },
    catch: (error) =>
      new VcsError({
        message: `Jujutsu command failed: jj ${args.join(' ')}`,
        command: `jj ${args.join(' ')}`,
        cause: error,
      }),
  });
}

export function isJjTrackedSync(filePath: string, cwd: string): boolean {
  if (!isInsideJjWorkTree(cwd)) return true;
  return isJjTracked(filePath, cwd);
}

export function getJjCommits(
  watch: string[],
  lastCommit: string | null,
  cwd: string,
  exclude: string[] = [],
): Effect.Effect<Commit[], VcsError> {
  let revset = lastCommit ? `"${lastCommit}"..@ & ~root()` : `::@ & ~root()`;

  for (const ext of exclude) {
    revset += ` & ~files("${ext}")`;
  }

  const template =
    'commit_id.short(40) ++ "|" ++ author.name() ++ "|" ++ author.timestamp().format("%Y-%m-%d") ++ "|" ++ description.first_line() ++ "\\n"';

  const args = ['log', '--no-graph', '-r', revset, '-T', template];
  if (watch.length > 0) {
    args.push('--', ...watch);
  }

  return runJj(args, cwd).pipe(
    Effect.map((output) =>
      output
        .split('\n')
        .map(parseCommitLine)
        .filter((c): c is Commit => c !== null),
    ),
  );
}

export function makeJjVcsProvider(cwd: string): VcsProvider {
  return VcsProviderService.of({
    getCommits: (watch, lastCommit, exclude = []) =>
      getJjCommits(watch, lastCommit, cwd, exclude),

    getHeadCommit: () => runJj(['log', '--no-graph', '-r', '@', '-T', 'commit_id'], cwd),

    getFileAtCommit: (filePath, commitHash) =>
      Effect.sync(() => {
        try {
          return execFileSync('jj', ['--color=never', 'file', 'show', filePath, '-r', commitHash], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
        } catch {
          return null;
        }
      }),

    getFileHistoryCommits: (filePath) =>
      runJj(['log', '--no-graph', '-T', 'commit_id ++ "\\n"', '--', filePath], cwd).pipe(
        Effect.map((out) =>
          out
            .split('\n')
            .map((h) => h.trim())
            .filter(Boolean),
        ),
      ),

    isTracked: (filePath) => Effect.sync(() => isJjTrackedSync(filePath, cwd)),

    commit: (message) => runJj(['commit', '-m', message], cwd).pipe(Effect.asVoid),

    isDirty: () =>
      Effect.gen(function* () {
        const currentStatus = yield* runJj(
          ['log', '--no-graph', '-r', '@', '-T', 'if(empty, "empty", "not-empty")'],
          cwd,
        );
        if (currentStatus.trim() === 'not-empty') return true;

        const historyDescriptions = yield* runJj(
          ['log', '--no-graph', '-r', '::@ & ~@ & ~root()', '-T', 'if(description, "1", "0")'],
          cwd,
        );
        return historyDescriptions.includes('0');
      }),
  });
}

export const JjVcsProviderLive = (cwd: string) =>
  Layer.effect(
    VcsProviderService,
    Effect.sync(() => makeJjVcsProvider(cwd)),
  );

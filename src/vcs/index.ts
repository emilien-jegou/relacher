import { Context, Data, type Effect } from 'effect';

import type { Commit } from '../types';

export class VcsError extends Data.TaggedError('VcsError')<{
  readonly message: string;
  readonly command?: string;
  readonly cause?: unknown;
}> {}

export interface VcsProvider {
  readonly getCommits: (
    watch: string[],
    lastCommit: string | null,
    exclude?: string[],
  ) => Effect.Effect<Commit[], VcsError>;

  readonly getHeadCommit: () => Effect.Effect<string, VcsError>;

  readonly commit: (message: string) => Effect.Effect<void, VcsError>;

  readonly isDirty: () => Effect.Effect<boolean, VcsError>;

  readonly findLastReleaseCommit?: (
    packageName: string,
    currentVersion: string,
  ) => Effect.Effect<string | null, VcsError>;

  readonly getFileAtCommit?: (
    filePath: string,
    commitHash: string,
  ) => Effect.Effect<string | null, VcsError>;

  readonly getFileHistoryCommits?: (
    filePath: string,
  ) => Effect.Effect<string[], VcsError>;

  readonly isTracked?: (
    filePath: string,
  ) => Effect.Effect<boolean, VcsError>;
}

export const VcsProviderService = Context.Service<VcsProvider>('VcsProviderService');

export * from './git';
export * from './jj';
export * from './common';

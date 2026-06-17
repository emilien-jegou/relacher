import { Context, type Effect } from 'effect';

import type { Commit } from '../types';

export interface VcsProvider {
  readonly getCommits: (
    name: string,
    watch: string[],
    lastCommit: string | null,
    exclude?: string[],
  ) => Effect.Effect<Commit[], Error>;

  readonly getHeadCommit: () => Effect.Effect<string, Error>;

  readonly findLastReleaseCommit: (
    packageName: string,
    currentVersion: string,
  ) => Effect.Effect<string | null, Error>;

  readonly commit: (message: string) => Effect.Effect<void, Error>;

  readonly isDirty: () => Effect.Effect<boolean, Error>;
}

export const VcsProviderService = Context.Service<VcsProvider>('VcsProviderService');

export * from './git';
export * from './jj';

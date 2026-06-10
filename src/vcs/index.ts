import { Context, Effect } from 'effect';

import type { Commit } from '../types';

export interface VcsProvider {
  readonly getCommits: (
    name: string,
    watch: string[],
    exclude?: string[],
  ) => Effect.Effect<Commit[], Error>;

  readonly getLatestTag: (name?: string) => Effect.Effect<string | null, Error>;

  readonly commit: (message: string) => Effect.Effect<void, Error>;

  readonly tag: (tagName: string) => Effect.Effect<void, Error>;
}

export const VcsProviderService = Context.Service<VcsProvider>('VcsProviderService');

export * from './git';
export * from './jj';

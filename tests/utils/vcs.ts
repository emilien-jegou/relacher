import { Effect } from 'effect';

import type { VcsProvider } from '../../src/vcs';

export function createMockVcs(overrides: Partial<VcsProvider> = {}): VcsProvider {
  return {
    getCommits: () => Effect.succeed([]),
    getHeadCommit: () => Effect.succeed('mock-hash-1234567'),
    getFileAtCommit: () => Effect.succeed(null),
    getFileHistoryCommits: () => Effect.succeed([]),
    isTracked: () => Effect.succeed(true),
    isDirty: () => Effect.succeed(false),
    commit: () => Effect.void,
    ...overrides,
  };
}

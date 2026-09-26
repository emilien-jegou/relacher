import { describe, expect, it } from 'bun:test';

import { Effect } from 'effect';

import { createPackageList } from '../src/builder';
import { prepare } from '../src/prepare';
import { makeVcsVersionManager, VersionManagerService } from '../src/versioning';

import { createMockVcs } from './utils/vcs';

describe('Release Groups Synchronization', () => {
  it('should synchronize bumps across all packages in a declared group', async () => {
    const mockVcs = createMockVcs({
      getCommits: () =>
        Effect.succeed([
          {
            hash: '1234567',
            shortHash: '1234567',
            author: 'Dev',
            date: '2026-09-26',
            message: 'feat: new feature triggering minor bump',
            type: 'feat',
            scope: null,
            isBreaking: false,
            description: 'new feature triggering minor bump',
          },
        ]),
    });

    const vm = makeVcsVersionManager(mockVcs);

    // Package list declaring a 3-package release group
    const list = createPackageList([
      {
        name: '@scope/core',
        watch: ['packages/core'],
        versionFallback: { readFallback: () => '1.0.0' },
        updates: [],
      },
      {
        name: '@scope/cli',
        watch: ['packages/cli'],
        versionFallback: { readFallback: () => '1.0.0' },
        updates: [],
      },
      {
        name: '@scope/web',
        watch: ['packages/web'],
        versionFallback: { readFallback: () => '1.0.0' },
        updates: [],
      },
    ]).group('suite', '@scope/core', '@scope/cli', '@scope/web');

    const result = await Effect.runPromise(
      Effect.provideService(prepare(list, { cwd: '/mock' }), VersionManagerService, vm),
    );

    const core = result.deps.find((d) => d.name === '@scope/core');
    const cli = result.deps.find((d) => d.name === '@scope/cli');
    const web = result.deps.find((d) => d.name === '@scope/web');

    expect(core?.bump).toBe('minor');
    expect(cli?.bump).toBe('minor');
    expect(web?.bump).toBe('minor');

    expect(core?.newVersion).toBe('1.1.0');
    expect(cli?.newVersion).toBe('1.1.0');
    expect(web?.newVersion).toBe('1.1.0');
  });
});

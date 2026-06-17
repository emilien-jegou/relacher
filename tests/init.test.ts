import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import { log } from '../src/display';
import { init } from '../src/init';
import { run } from '../src/run';
import { VcsProviderService } from '../src/vcs';

import { mktemp } from './utils/repo';

describe('Lockfile Initialization (init) and Release (run) Dirty Checks', () => {
  let warnSpy: any;

  beforeEach(() => {
    warnSpy = spyOn(log, 'warn').mockImplementation(() => { });
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should return early and do nothing if .relacher.lock already exists', async () => {
    using temp = mktemp();
    const lockPath = path.resolve(temp.path, '.relacher.lock');
    const existingContent = JSON.stringify({ packages: { existing: { version: '1.0.0' } } });
    fs.writeFileSync(lockPath, existingContent, 'utf8');

    let commitCalled = false;
    const mockVcs = {
      getCommits: () => Effect.succeed([]),
      getHeadCommit: () => Effect.succeed('mock-hash'),
      findLastReleaseCommit: () => Effect.succeed(null),
      isDirty: () => Effect.succeed(false),
      commit: () => {
        commitCalled = true;
        return Effect.void;
      },
    };

    const packages = [{ name: 'pkg-a', updates: [] }];

    await Effect.runPromise(
      init(packages, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, mockVcs)),
    );

    expect(commitCalled).toBe(false);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(existingContent);
  });

  it('should create .relacher.lock using versionFallback and commit', async () => {
    using temp = mktemp();
    const lockPath = path.resolve(temp.path, '.relacher.lock');

    let committedMessage = '';
    const mockVcs = {
      getCommits: () => Effect.succeed([]),
      getHeadCommit: () => Effect.succeed('mock-hash'),
      findLastReleaseCommit: () => Effect.succeed(null),
      isDirty: () => Effect.succeed(false),
      commit: (message: string) => {
        committedMessage = message;
        return Effect.void;
      },
    };

    const packages = [
      {
        name: 'pkg-stable',
        versionFallback: {
          readFallback: () => '1.2.3',
        },
        updates: [],
      },
      {
        name: 'pkg-pre',
        versionFallback: {
          readFallback: () => '2.0.0-rc.1',
        },
        updates: [],
      },
      {
        name: 'pkg-no-fallback',
        updates: [],
      },
    ];

    await Effect.runPromise(
      init(packages, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, mockVcs)),
    );

    expect(fs.existsSync(lockPath)).toBe(true);

    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lockData).toEqual({
      packages: {
        'pkg-stable': {
          version: '1.2.3',
          lastStableVersion: '1.2.3',
        },
        'pkg-pre': {
          version: '2.0.0-rc.1',
        },
        'pkg-no-fallback': {
          version: '0.0.0',
          lastStableVersion: '0.0.0',
        },
      },
    });

    expect(committedMessage).toContain('chore: initialize .relacher.lock');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should fall back to 0.0.0 and warn if reading versionFallback fails', async () => {
    using temp = mktemp();
    const lockPath = path.resolve(temp.path, '.relacher.lock');

    const mockVcs = {
      getCommits: () => Effect.succeed([]),
      getHeadCommit: () => Effect.succeed('mock-hash'),
      findLastReleaseCommit: () => Effect.succeed(null),
      isDirty: () => Effect.succeed(false),
      commit: () => Effect.void,
    };

    const packages = [
      {
        name: 'pkg-error',
        versionFallback: {
          readFallback: () => {
            throw new Error('Read failed');
          },
        },
        updates: [],
      },
    ];

    await Effect.runPromise(
      init(packages, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, mockVcs)),
    );

    expect(fs.existsSync(lockPath)).toBe(true);

    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lockData.packages['pkg-error']).toEqual({
      version: '0.0.0',
      lastStableVersion: '0.0.0',
    });

    expect(warnSpy).toHaveBeenCalled();
    const warnings = warnSpy.mock.calls.map((call: any) => call[0]);
    expect(warnings).toContain('Version fallback failed for package pkg-error');
    expect(warnings).toContain(
      'One or more package failed to retrieve their version, update .relacher.lockfile manually.',
    );
  });

  it('should refuse to initialize if the repository is dirty', async () => {
    using temp = mktemp();

    const mockVcs = {
      getCommits: () => Effect.succeed([]),
      getHeadCommit: () => Effect.succeed('mock-hash'),
      findLastReleaseCommit: () => Effect.succeed(null),
      isDirty: () => Effect.succeed(true),
      commit: () => Effect.void,
    };

    const packages = [{ name: 'pkg-a', updates: [] }];

    const program = init(packages, { cwd: temp.path }).pipe(
      Effect.provideService(VcsProviderService, mockVcs),
    );

    expect(Effect.runPromise(program)).rejects.toThrow();
  });

  it('should refuse to run release if the repository is dirty', async () => {
    const mockVcs = {
      getCommits: () => Effect.succeed([]),
      getHeadCommit: () => Effect.succeed('mock-hash'),
      findLastReleaseCommit: () => Effect.succeed(null),
      isDirty: () => Effect.succeed(true),
      commit: () => Effect.void,
    };

    const preparedUpdate = {
      isEmpty: false,
      isInvalid: false,
      deps: [
        {
          name: 'pkg-a',
          currentVersion: '1.0.0',
          newVersion: '1.1.0',
          bump: 'minor',
          commits: [],
          updates: [],
        },
      ],
    } as any;

    const program = run(preparedUpdate, { cwd: '/mock-path' }).pipe(
      Effect.provideService(VcsProviderService, mockVcs),
    );

    expect(Effect.runPromise(program)).rejects.toThrow();
  });
});

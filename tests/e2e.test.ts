import { describe, it, expect } from 'bun:test';

import { Effect } from 'effect';

import { loadCargoDeps } from '../src/builder';
import { prepare } from '../src/prepare';
import { run } from '../src/run';
import { regexUpdate } from '../src/updater';
import { VcsProviderService } from '../src/vcs';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeVcsVersionManager, VersionManagerService } from '../src/versioning';
import type { SizePatterns } from '../src/versioning/types';

import { cargo } from './utils/cargo';
import { mktemp, repo } from './utils/repo';
import { reportTest } from './utils/report';
import { toml } from './utils/toml';

const sizes: SizePatterns = {
  major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
  minor: { pattern: '^feat|^revert' },
  patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
  skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
};

describe('End-to-End Prepare Pipeline', () => {
  it('should fully process a complex repository lifecycle', async () => {
    using temp = mktemp();

    const git = repo(temp.path).commit('chore: init', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['pkg/*']).build())
        .update('pkg/core/Cargo.toml', () =>
          toml().section('package').kv('name', 'core').kv('version', '1.0.0').build(),
        )
        .update('pkg/api/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'api')
            .kv('version', '2.1.0')
            .section('dependencies')
            .kv('core', { path: '../core' })
            .build(),
        )
        .update('.relacher.lock', () =>
          JSON.stringify(
            {
              packages: {
                core: { version: '1.0.0', lastStableVersion: '1.0.0' },
                api: { version: '2.1.0', lastStableVersion: '2.1.0' },
              },
            },
            null,
            2,
          ),
        )
        .update('README.md', () => `API Version v2.1.0`),
    );

    git.commit('fix(engine)!: rewrite memory allocator', (c) =>
      c.update('pkg/core/src/lib.rs', () => '// memory safely allocated!'),
    );

    git.commit('docs: update comments', (c) =>
      c.update('pkg/api/src/lib.rs', () => '// this uses core memory allocator'),
    );

    const configuredDeps = loadCargoDeps(temp.path).onPackageBump(
      'api',
      regexUpdate('./README.md', {
        search: 'v[0-9]+\\.[0-9]+\\.[0-9]+',
        replace: 'v{{version}}',
      }),
    );

    const vcs = makeJjVcsProvider(temp.path);
    const vm = makeVcsVersionManager(vcs, { sizes });

    const reports = await Effect.runPromise(
      Effect.provideService(prepare(configuredDeps, { cwd: temp.path }), VersionManagerService, vm),
    );

    reportTest(reports.deps)
      .length(2)
      .expectBump('core', 'major')
      .expectNewVersion('core', '2.0.0')
      .expectBump('api', 'minor')
      .expectNewVersion('api', '2.2.0');

    const apiReport = reports.deps.find((r) => r.name === 'api');
    const regexUp = apiReport?.updates.find((u) => u.kind === 'regex');
    expect(regexUp).toBeDefined();
    if (regexUp && regexUp.kind === 'regex') {
      expect(regexUp.preparedData.resolvedReplace).toBe('v2.2.0');
    }
  }, 30000);

  it('should deeply resolve diamond and chained workspace members', async () => {
    using diamondTemp = mktemp();
    const vcs = makeJjVcsProvider(diamondTemp.path);

    repo(diamondTemp.path)
      .commit('chore: init diamond', (c) =>
        c
          .update('Cargo.toml', () =>
            toml().section('workspace').kv('members', ['crates/*']).build(),
          )
          .update('crates/core/Cargo.toml', () => cargo().package('core', '1.0.0').build())
          .update('crates/db/Cargo.toml', () =>
            cargo().package('db', '1.0.0').dependency('core', { path: '../core' }).build(),
          )
          .update('crates/logger/Cargo.toml', () =>
            cargo().package('logger', '1.0.0').dependency('core', { path: '../core' }).build(),
          )
          .update('crates/api/Cargo.toml', () =>
            cargo()
              .package('api', '1.0.0')
              .dependency('db', { path: '../db' })
              .dependency('logger', { path: '../logger' })
              .build(),
          )
          .update('crates/cli/Cargo.toml', () =>
            cargo().package('cli', '1.0.0').dependency('api', { path: '../api' }).build(),
          )
          .update('.relacher.lock', () =>
            JSON.stringify(
              {
                packages: {
                  core: { version: '1.0.0', lastStableVersion: '1.0.0' },
                  db: { version: '1.0.0', lastStableVersion: '1.0.0' },
                  logger: { version: '1.0.0', lastStableVersion: '1.0.0' },
                  api: { version: '1.0.0', lastStableVersion: '1.0.0' },
                  cli: { version: '1.0.0', lastStableVersion: '1.0.0' },
                },
              },
              null,
              2,
            ),
          ),
      )
      .commit('fix(core)!: complete architectural rework', (c) =>
        c.update('crates/core/src/lib.rs', () => '// broken api'),
      )
      .commit('feat(cli): new command interface', (c) =>
        c.update('crates/cli/src/main.rs', () => '// shiny'),
      );

    const configuredDeps = loadCargoDeps(diamondTemp.path);
    const vm = makeVcsVersionManager(vcs, { sizes });

    const reports = await Effect.runPromise(
      Effect.provideService(
        prepare(configuredDeps, { cwd: diamondTemp.path }),
        VersionManagerService,
        vm,
      ),
    );

    reportTest(reports.deps)
      .length(5)
      .expectBump('core', 'major')
      .expectBump('logger', 'minor')
      .expectBump('db', 'minor')
      .expectBump('api', 'patch')
      .expectBump('cli', 'minor');
  }, 30000);

  it('should execute a full 3-cycle release process verifying diffs and history', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    // ==========================================================
    // CYCLE 0: INITIAL SETUP
    // ==========================================================
    r.commit('chore: init', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/core/Cargo.toml', () =>
          cargo().package('core', '1.0.0').build(),
        )
        .update('crates/api/Cargo.toml', () =>
          cargo().package('api', '1.0.0').dependency('core', { path: '../core' }).build(),
        )
        .update('.relacher.lock', () =>
          JSON.stringify(
            {
              packages: {
                core: { version: '1.0.0', lastStableVersion: '1.0.0' },
                api: { version: '1.0.0', lastStableVersion: '1.0.0' },
              },
            },
            null,
            2,
          ),
        ),
    );

    // ==========================================================
    // CYCLE 1: Feature on core
    // ==========================================================
    r.commit('feat(core): add authentication engine', (c) =>
      c.update('crates/core/src/lib.rs', () => '// auth engine'),
    );

    const vcs1 = makeJjVcsProvider(temp.path);
    const deps1 = loadCargoDeps(temp.path);
    const vm1 = makeVcsVersionManager(vcs1, { sizes });

    const reports1 = await Effect.runPromise(
      Effect.provideService(prepare(deps1, { cwd: temp.path }), VersionManagerService, vm1),
    );

    reportTest(reports1.deps)
      .expectBump('core', 'minor')
      .expectNewVersion('core', '1.1.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.0.1');

    await Effect.runPromise(
      run(reports1, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs1)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.0.1"');

    let lockfile = JSON.parse(r.readFile('.relacher.lock'));
    expect(lockfile.packages['core'].version).toBe('1.1.0');
    expect(lockfile.packages['api'].version).toBe('1.0.1');

    // ==========================================================
    // CYCLE 2: Bugfix directly on API
    // ==========================================================
    r.commit('fix(api): resolve routing bug', (c) =>
      c.update('crates/api/src/main.rs', () => '// fixed routing'),
    );

    const vcs2 = makeJjVcsProvider(temp.path);
    const deps2 = loadCargoDeps(temp.path);
    const vm2 = makeVcsVersionManager(vcs2, { sizes });

    const reports2 = await Effect.runPromise(
      Effect.provideService(prepare(deps2, { cwd: temp.path }), VersionManagerService, vm2),
    );

    reportTest(reports2.deps)
      .expectBump('core', 'skip')
      .expectNewVersion('core', '1.1.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.0.2');

    await Effect.runPromise(
      run(reports2, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs2)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0"'); // Unchanged
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.0.2"'); // Bumped

    lockfile = JSON.parse(r.readFile('.relacher.lock'));
    expect(lockfile.packages['core'].version).toBe('1.1.0');
    expect(lockfile.packages['api'].version).toBe('1.0.2');

    // ==========================================================
    // CYCLE 3: Breaking change on core
    // ==========================================================
    r.commit('fix(core)!: breaking database migration', (c) =>
      c.update('crates/core/src/db.rs', () => '// breaking changes'),
    );

    const vcs3 = makeJjVcsProvider(temp.path);
    const deps3 = loadCargoDeps(temp.path);
    const vm3 = makeVcsVersionManager(vcs3, { sizes });

    const reports3 = await Effect.runPromise(
      Effect.provideService(prepare(deps3, { cwd: temp.path }), VersionManagerService, vm3),
    );

    reportTest(reports3.deps)
      .expectBump('core', 'major')
      .expectNewVersion('core', '2.0.0')
      .expectBump('api', 'minor')
      .expectNewVersion('api', '1.1.0');

    await Effect.runPromise(
      run(reports3, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs3)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "2.0.0"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.1.0"');

    lockfile = JSON.parse(r.readFile('.relacher.lock'));
    expect(lockfile.packages['core'].version).toBe('2.0.0');
    expect(lockfile.packages['api'].version).toBe('1.1.0');

    // ==========================================================
    // VERIFY FINAL COMMIT HISTORY GRAPH
    // ==========================================================
    const logs = r.getLogs();

    expect(logs[0]).toInclude('chore: release core-v2.0.0, api-v1.1.0');
    expect(logs[1]).toInclude('fix(core)!: breaking database migration');
    expect(logs[2]).toInclude('chore: release api-v1.0.2');
    expect(logs[3]).toInclude('fix(api): resolve routing bug');
    expect(logs[4]).toInclude('chore: release core-v1.1.0, api-v1.0.1');
    expect(logs[5]).toInclude('feat(core): add authentication engine');
    expect(logs[6]).toInclude('chore: init');
  }, 30000);
});

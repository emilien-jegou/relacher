import { describe, it, expect } from 'bun:test';

import { Effect } from 'effect';

import { loadCargoDeps } from '../src/builder';
import { finalizeReports, prepare } from '../src/prepare';
import { run } from '../src/run';
import { VcsProviderService } from '../src/vcs';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeRCVersionManager, VersionManagerService } from '../src/versioning';
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

describe('RC End-to-End Pipeline', () => {
  it('should process a full RC lifecycle', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/core/Cargo.toml', () => cargo().package('core', '1.1.0-beta.0').build())
        .update('crates/api/Cargo.toml', () =>
          cargo().package('api', '1.1.0-rc.0').dependency('core', { path: '../core' }).build(),
        ),
    );

    // CYCLE 1: Start RC mode
    r.commit('feat(core): add auth engine', (c) =>
      c.update('crates/core/src/lib.rs', () => '// auth engine'),
    );

    const vcs1 = makeJjVcsProvider(temp.path);
    const deps1 = loadCargoDeps(temp.path);
    const vm1 = makeRCVersionManager(vcs1, { sizes });

    const reports1 = await Effect.runPromise(
      Effect.provideService(prepare(deps1, { cwd: temp.path }), VersionManagerService, vm1),
    );

    reportTest(reports1.deps)
      .expectNewVersion('core', '1.1.0-rc.0')
      .expectNewVersion('api', '1.1.0-rc.1');

    await Effect.runPromise(
      run(reports1, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs1)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0-rc.0"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.1.0-rc.1"');

    // ==========================================================
    // CYCLE 2: Increment RC
    // ==========================================================
    r.commit('fix(core): auth bug', (c) =>
      c.update('crates/core/src/lib.rs', () => '// auth bug fix'),
    );

    const vcs2 = makeJjVcsProvider(temp.path);
    const deps2 = loadCargoDeps(temp.path);
    const vm2 = makeRCVersionManager(vcs2, { sizes });

    const reports2 = await Effect.runPromise(
      Effect.provideService(prepare(deps2, { cwd: temp.path }), VersionManagerService, vm2),
    );

    reportTest(reports2.deps)
      .expectBump('core', 'patch')
      .expectNewVersion('core', '1.1.0-rc.1')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.1.0-rc.2');

    await Effect.runPromise(
      run(reports2, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs2)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0-rc.1"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.1.0-rc.2"');

    // ==========================================================
    // CYCLE 3: Graduate RC
    // ==========================================================
    r.commit('fix(core): final polish', (c) =>
      c.update('crates/core/src/lib.rs', () => '// ready'),
    );

    const vcs3 = makeJjVcsProvider(temp.path);
    const deps3 = loadCargoDeps(temp.path);

    // Enabling upgradeReady strips RC and promotes version to final
    const vm3 = makeRCVersionManager(vcs3, { sizes, upgradeReady: true });

    const reports3 = await Effect.runPromise(
      Effect.provideService(prepare(deps3, { cwd: temp.path }), VersionManagerService, vm3),
    );

    const coreReport = reports3.deps.find((r) => r.name === 'core');
    const apiReport = reports3.deps.find((r) => r.name === 'api');

    expect(coreReport?.newVersion).not.toInclude('-rc');
    expect(apiReport?.newVersion).not.toInclude('-rc');

    await Effect.runPromise(
      run(reports3, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs3)),
    );

    expect(r.readFile('crates/core/Cargo.toml')).not.toInclude('-rc');
    expect(r.readFile('crates/api/Cargo.toml')).not.toInclude('-rc');
  }, 30000);

  it('Verification: reports assign skipTag correctly based on VersionManager configuration', () => {
    const rcManager = makeRCVersionManager({} as any, { upgradeReady: false, tagPrereleases: false });

    const reports = finalizeReports(
      [
        {
          name: 'core',
          currentVersion: '1.0.0',
          newVersion: '1.1.0-rc.0',
          bump: 'minor',
          commits: [],
          updates: [],
          depends: [],
        } as any,
      ],
      rcManager,
    );

    expect(reports[0]).toBeDefined();
    expect(reports[0]!.skipTag).toBe(true);
  });
});

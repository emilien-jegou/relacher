import { describe, it, expect } from 'bun:test';

import { Effect } from 'effect';

import { loadCargoDeps } from '../src/builder';
import { prepare } from '../src/prepare';
import { run } from '../src/run';
import { VcsProviderService } from '../src/vcs';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeRCVersionManager, VersionManagerService } from '../src/versioning';
import type { SizePatterns } from '../src/versioning/types';

import { mktemp, repo } from './utils/repo';
import { reportTest } from './utils/report';
import { toml } from './utils/toml';

const sizes: SizePatterns = {
  major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
  minor: { pattern: '^feat|^revert' },
  patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
  skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
};

describe('Stable Version Promotion & Base Tracking', () => {
  /**
   * Description of the Issue:
   * When pre-release tagging is disabled, a package can successfully bump to `3.2.0-rc.0`
   * on disk while its latest tag in Git remains `3.1.2`.
   *
   * Upon promoting to stable (leaving RC mode):
   * 1. Version Detection Bug:
   *    The fallback version (`3.2.0-rc.0`) must be prioritized over the older Git tag (`3.1.2`)
   *    even though it doesn't start with the Git tag prefix string.
   *
   * 2. Decrement Guesswork Bug:
   *    If the last stable version is purely inferred from `3.2.0-rc.0` by decrementing,
   *    it guesses `3.1.0` (decrementing minor, resetting patch to 0). This causes correct
   *    release segment highlights to display `3.1.0 <3.2.0-rc.0> → 3.2.0` instead of `3.1.2`.
   *
   * Solution:
   * By querying and preserving the actual stable tag from Git history (`3.1.2`) alongside the
   * current fallback version, we correctly display `3.1.2 <3.2.0-rc.0> → 3.2.0`.
   */
  it('should prioritize pre-release fallback and track the exact Git tag (3.1.2) during stable promotion', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    // ==========================================================
    // CYCLE 0: INITIAL SETUP (cli_tool-v3.1.2)
    // ==========================================================
    r.commit('chore: init', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/cli_tool/Cargo.toml', () =>
          toml().section('package').kv('name', 'cli_tool').kv('version', '3.1.2').build(),
        )
        .update('.relacher.lock', () =>
          JSON.stringify(
            {
              packages: {
                cli_tool: { version: '3.1.2', lastStableVersion: '3.1.2' },
              },
            },
            null,
            2,
          ),
        ),
    );

    // ==========================================================
    // CYCLE 1: Feature on cli_tool -> v3.2.0-rc.0
    // ==========================================================
    r.commit('feat(cli): support new config formats', (c) =>
      c.update('crates/cli_tool/src/main.rs', () => '// config formats'),
    );

    const vcs1 = makeJjVcsProvider(temp.path);
    const deps1 = loadCargoDeps(temp.path);
    const vm1 = makeRCVersionManager(vcs1, { sizes, upgradeReady: false }); // in RC mode, tagPrereleases defaults to false

    const reports1 = await Effect.runPromise(
      Effect.provideService(prepare(deps1, { cwd: temp.path }), VersionManagerService, vm1),
    );

    reportTest(reports1.deps)
      .expectBump('cli_tool', 'minor')
      .expectNewVersion('cli_tool', '3.2.0-rc.0');

    await Effect.runPromise(
      run(reports1, { cwd: temp.path }).pipe(Effect.provideService(VcsProviderService, vcs1)),
    );

    // Verify version is updated to 3.2.0-rc.0 on disk
    expect(r.readFile('crates/cli_tool/Cargo.toml')).toInclude('version = "3.2.0-rc.0"');

    // Verify lockfile version
    const lockfile = JSON.parse(r.readFile('.relacher.lock'));
    expect(lockfile.packages['cli_tool'].version).toBe('3.2.0-rc.0');

    // ==========================================================
    // CYCLE 2: Promote to stable -> v3.2.0
    // ==========================================================
    r.commit('fix(cli): minor thread issue', (c) =>
      c.update('crates/cli_tool/src/main.rs', (x) => x + '\n// resolve thread issue'),
    );

    const vcs2 = makeJjVcsProvider(temp.path);
    const deps2 = loadCargoDeps(temp.path);
    const vm2 = makeRCVersionManager(vcs2, { sizes, upgradeReady: true }); // Outside RC mode

    const reports2 = await Effect.runPromise(
      Effect.provideService(prepare(deps2, { cwd: temp.path }), VersionManagerService, vm2),
    );

    const cliReport = reports2.deps.find((x) => x.name === 'cli_tool');
    expect(cliReport).toBeDefined();

    if (cliReport) {
      // 1. Current version must be correctly read as 3.2.0-rc.0 (from Cargo.toml)
      expect(cliReport.currentVersion).toBe('3.2.0-rc.0');

      // 2. The stable tag baseline must be correctly preserved as 3.1.2 (from lockfile)
      expect(cliReport.lastStableVersion).toBe('3.1.2');

      // 3. The new version must be promoted to the expected minor stable release 3.2.0
      expect(cliReport.newVersion).toBe('3.2.0');
    }
  }, 30000);
});

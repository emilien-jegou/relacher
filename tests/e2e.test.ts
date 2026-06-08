import { describe, it, expect } from 'bun:test';

import { cargoDeps } from '../src/builder';
import { prepare, getCurrentVersion } from '../src/prepare';
import { run } from '../src/run';
import type { SizePatterns, VcsProvider } from '../src/types';
import { regexUpdate } from '../src/updater';
import { JjVcsProvider } from '../src/vcs/jj';

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

    const git = repo(temp.path)
      .commit('chore: init', (c) =>
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
          .update('README.md', () => `API Version v2.1.0`),
      )
      .tag('core-v1.0.0')
      .tag('api-v2.1.0');

    git.commit('fix(engine)!: rewrite memory allocator', (c) =>
      c.update('pkg/core/src/lib.rs', () => '// memory safely allocated!'),
    );

    git.commit('docs: update comments', (c) =>
      c.update('pkg/api/src/lib.rs', () => '// this uses core memory allocator'),
    );

    const configuredDeps = cargoDeps(temp.path).on('api', (c) =>
      c.update(
        regexUpdate({
          path: './README.md',
          search: 'v[0-9]+\\.[0-9]+\\.[0-9]+',
          replace: 'v{{version}}',
        }),
      ),
    );

    const vcs = new JjVcsProvider(temp.path);
    const reports = await prepare(configuredDeps, vcs, { cwd: temp.path, sizes });

    reportTest(reports)
      .length(2)
      .expectBump('core', 'major')
      .expectNewVersion('core', '2.0.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '2.1.1');

    const apiReport = reports.find((r) => r.name === 'api');
    const regexUp = apiReport?.updates.find((u) => u.kind === 'regex');
    expect(regexUp).toBeDefined();
    if (regexUp && regexUp.kind === 'regex') {
      expect(regexUp.params.resolvedReplace).toBe('v2.1.1');
    }
  });

  it('should deeply resolve diamond and chained workspace members', async () => {
    using diamondTemp = mktemp();
    const vcs = new JjVcsProvider(diamondTemp.path);

    repo(diamondTemp.path)
      .commit('chore: init diamond', (c) =>
        c
          .update('Cargo.toml', () =>
            toml().section('workspace').kv('members', ['crates/*']).build(),
          )
          .update('crates/core/Cargo.toml', () =>
            toml().section('package').kv('name', 'core').kv('version', '1.0.0').build(),
          )
          .update('crates/db/Cargo.toml', () =>
            toml()
              .section('package')
              .kv('name', 'db')
              .kv('version', '1.0.0')
              .section('dependencies')
              .kv('core', { path: '../core' })
              .build(),
          )
          .update('crates/logger/Cargo.toml', () =>
            toml()
              .section('package')
              .kv('name', 'logger')
              .kv('version', '1.0.0')
              .section('dependencies')
              .kv('core', { path: '../core' })
              .build(),
          )
          .update('crates/api/Cargo.toml', () =>
            toml()
              .section('package')
              .kv('name', 'api')
              .kv('version', '1.0.0')
              .section('dependencies')
              .kv('db', { path: '../db' })
              .kv('logger', { path: '../logger' })
              .build(),
          )
          .update('crates/cli/Cargo.toml', () =>
            toml()
              .section('package')
              .kv('name', 'cli')
              .kv('version', '1.0.0')
              .section('dependencies')
              .kv('api', { path: '../api' })
              .build(),
          ),
      )
      .tag('core-v1.0.0')
      .tag('db-v1.0.0')
      .tag('logger-v1.0.0')
      .tag('api-v1.0.0')
      .tag('cli-v1.0.0')

      .commit('fix(core)!: complete architectural rework', (c) =>
        c.update('crates/core/src/lib.rs', () => '// broken api'),
      )
      .commit('feat(cli): new command interface', (c) =>
        c.update('crates/cli/src/main.rs', () => '// shiny'),
      );

    const configuredDeps = cargoDeps(diamondTemp.path);
    const reports = await prepare(configuredDeps, vcs, { cwd: diamondTemp.path, sizes });

    reportTest(reports)
      .length(5)
      .expectBump('core', 'major')
      .expectBump('logger', 'patch')
      .expectBump('db', 'patch')
      .expectBump('api', 'patch')
      .expectBump('cli', 'minor');
  });

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
          toml().section('package').kv('name', 'core').kv('version', '1.0.0').build(),
        )
        .update('crates/api/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'api')
            .kv('version', '1.0.0')
            .section('dependencies')
            .kv('core', { path: '../core' })
            .build(),
        ),
    )
      .tag('core-v1.0.0')
      .tag('api-v1.0.0');

    // ==========================================================
    // CYCLE 1: Feature on core
    // ==========================================================
    r.commit('feat(core): add authentication engine', (c) =>
      c.update('crates/core/src/lib.rs', () => '// auth engine'),
    );

    const vcs1 = new JjVcsProvider(temp.path);
    const deps1 = cargoDeps(temp.path);
    const reports1 = await prepare(deps1, vcs1, { cwd: temp.path, sizes });

    reportTest(reports1)
      .expectBump('core', 'minor')
      .expectNewVersion('core', '1.1.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.0.1');

    await run(reports1, vcs1, { cwd: temp.path });

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.0.1"');
    expect(r.getTags()).toEqual(['api-v1.0.0', 'api-v1.0.1', 'core-v1.0.0', 'core-v1.1.0']);

    // ==========================================================
    // CYCLE 2: Bugfix directly on API
    // ==========================================================
    r.commit('fix(api): resolve routing bug', (c) =>
      c.update('crates/api/src/main.rs', () => '// fixed routing'),
    );

    const vcs2 = new JjVcsProvider(temp.path);
    const deps2 = cargoDeps(temp.path);
    const reports2 = await prepare(deps2, vcs2, { cwd: temp.path, sizes });

    reportTest(reports2)
      .expectBump('core', 'skip')
      .expectNewVersion('core', '1.1.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.0.2');

    await run(reports2, vcs2, { cwd: temp.path });

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "1.1.0"'); // Unchanged
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.0.2"'); // Bumped
    expect(r.getTags()).not.toContain('core-v1.1.1');
    expect(r.getTags()).toContain('api-v1.0.2');

    // ==========================================================
    // CYCLE 3: Breaking change on core
    // ==========================================================
    r.commit('fix(core)!: breaking database migration', (c) =>
      c.update('crates/core/src/db.rs', () => '// breaking changes'),
    );

    const vcs3 = new JjVcsProvider(temp.path);
    const deps3 = cargoDeps(temp.path);
    const reports3 = await prepare(deps3, vcs3, { cwd: temp.path, sizes });

    reportTest(reports3)
      .expectBump('core', 'major')
      .expectNewVersion('core', '2.0.0')
      .expectBump('api', 'patch')
      .expectNewVersion('api', '1.0.3');

    await run(reports3, vcs3, { cwd: temp.path });

    expect(r.readFile('crates/core/Cargo.toml')).toInclude('version = "2.0.0"');
    expect(r.readFile('crates/api/Cargo.toml')).toInclude('version = "1.0.3"');
    expect(r.getTags()).toContain('core-v2.0.0');
    expect(r.getTags()).toContain('api-v1.0.3');

    // ==========================================================
    // VERIFY FINAL COMMIT HISTORY GRAPH
    // ==========================================================
    const logs = r.getLogs();

    expect(logs[0]).toInclude('chore: release core-v2.0.0, api-v1.0.3');
    expect(logs[1]).toInclude('fix(core)!: breaking database migration');
    expect(logs[2]).toInclude('chore: release api-v1.0.2'); // Corrected from core-v1.1.0, api-v1.0.2
    expect(logs[3]).toInclude('fix(api): resolve routing bug');
    expect(logs[4]).toInclude('chore: release core-v1.1.0, api-v1.0.1');
    expect(logs[5]).toInclude('feat(core): add authentication engine');
    expect(logs[6]).toInclude('chore: init');
  });
});

describe('getCurrentVersion tag parsing unit tests', () => {
  it('should isolate the semantic version string from various common tag templates', async () => {
    const mockVcsWithTag = (tagValue: string | null): VcsProvider =>
      ({
        getLatestTag: async () => tagValue,
        getCommits: async () => [],
      }) as unknown as VcsProvider;

    const mockConfig = { name: 'workspace-crate' } as any;

    expect(
      await getCurrentVersion(mockConfig, mockVcsWithTag('workspace-crate-v1.2.3'), ''),
    ).toEqual({
      version: '1.2.3',
      isFallback: false,
    });

    expect(
      await getCurrentVersion(mockConfig, mockVcsWithTag('workspace-crate/v2.10.0-beta.1'), ''),
    ).toEqual({
      version: '2.10.0-beta.1',
      isFallback: false,
    });

    expect(await getCurrentVersion(mockConfig, mockVcsWithTag('v3.0.1'), '')).toEqual({
      version: '3.0.1',
      isFallback: false,
    });

    expect(await getCurrentVersion(mockConfig, mockVcsWithTag('4.0.0'), '')).toEqual({
      version: '4.0.0',
      isFallback: false,
    });
  });
});

import { describe, it, expect } from 'bun:test';
import path from 'node:path';

import { Effect } from 'effect';

import { loadCargoDeps } from '../src/builder';
import { prepare } from '../src/prepare';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeVcsVersionManager, VersionManagerService } from '../src/versioning';

import { mktemp, repo } from './utils/repo';
import { toml } from './utils/toml';

const sizes = {
  major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
  minor: { pattern: '^feat|^revert' },
  patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
  skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
};

describe('Advanced Cargo Workspace Builder & Graph Resolver', () => {
  it('should resolve workspace inheritance with workspace = true', () => {
    using temp = mktemp();
    repo(temp.path).commit('init workspace inheritance', (c) =>
      c
        .update('Cargo.toml', () =>
          toml()
            .section('workspace')
            .kv('members', ['crates/*'])
            .section('workspace.dependencies')
            .kv('math', { path: 'crates/math', version: '0.1.0' })
            .build(),
        )
        .update('crates/math/Cargo.toml', () =>
          toml().section('package').kv('name', 'math').kv('version', '0.1.0').build(),
        )
        .update('crates/server/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'server')
            .kv('version', '1.0.0')
            .section('dependencies')
            .kv('math', { workspace: true })
            .build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(2);

    const server = deps.find((d) => d.name === 'server');
    const math = deps.find((d) => d.name === 'math');

    expect(server).toBeDefined();
    expect(math).toBeDefined();
    expect(server?.depends).toContain('math');
  });

  it('should discover target-specific path dependencies', () => {
    using temp = mktemp();
    repo(temp.path).commit('init target-specific deps', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/app/Cargo.toml', () =>
          `
[package]
name = "app"
version = "1.0.0"

[target.'cfg(target_os = "linux")'.dependencies]
linux-helper = { path = "../../libs/linux-helper" }
`.trim(),
        )
        .update('libs/linux-helper/Cargo.toml', () =>
          toml().section('package').kv('name', 'linux-helper').kv('version', '0.1.0').build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(2);

    const app = deps.find((d) => d.name === 'app');
    const helper = deps.find((d) => d.name === 'linux-helper');

    expect(app).toBeDefined();
    expect(helper).toBeDefined();
    expect(app?.depends).toContain('linux-helper');
  });

  it('should handle multi-pattern globbing structures', () => {
    using temp = mktemp();
    repo(temp.path).commit('init multiple glob directories', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/*', 'libs/*']).build(),
        )
        .update('crates/app/Cargo.toml', () =>
          toml().section('package').kv('name', 'app').kv('version', '1.0.0').build(),
        )
        .update('libs/helper/Cargo.toml', () =>
          toml().section('package').kv('name', 'helper').kv('version', '0.1.0').build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.name)).toContainValues(['app', 'helper']);
  });

  it('should ignore changes in nested sub-packages unless they are coupled', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init nested sub-project', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/oyui-tasker/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'oyui-tasker')
            .kv('version', '0.0.7')
            .section('dependencies')
            .kv('oyui-tasker-derive', { path: './derive' })
            .build(),
        )
        .update('crates/oyui-tasker/derive/Cargo.toml', () =>
          toml().section('package').kv('name', 'oyui-tasker-derive').kv('version', '0.0.7').build(),
        ),
    )
      .tag('oyui-tasker-v0.0.7')
      .tag('oyui-tasker-derive-v0.0.7');

    // Make a commit that ONLY touches the nested subdirectory
    r.commit('feat(oyui-tasker-derive): add procedural macro rule', (c) =>
      c.update('crates/oyui-tasker/derive/src/lib.rs', () => '// new macro rule'),
    );

    const vcs = makeJjVcsProvider(temp.path);
    const deps = loadCargoDeps(temp.path); // Not coupled!

    const vm = makeVcsVersionManager(vcs, { sizes });

    const reports = await Effect.runPromise(
      Effect.provideService(
        prepare(deps, {
          cwd: temp.path,
          excludeNestedWatches: true,
        }),
        VersionManagerService,
        vm,
      ),
    );

    const parent = reports.deps.find((x) => x.name === 'oyui-tasker');
    const derive = reports.deps.find((x) => x.name === 'oyui-tasker-derive');

    expect(parent).toBeDefined();
    expect(derive).toBeDefined();

    // The sub-package (derive) should receive the commit-based and final bump
    expect(derive?.originalBump).toBe('minor');
    expect(derive?.bump).toBe('minor');
    expect(derive?.newVersion).toBe('0.1.0');

    // The parent package's original bump (from commits alone) must be 'skip'
    // because the nested watch path changes were successfully excluded.
    expect(parent?.originalBump).toBe('skip');

    // The parent package receives a cascaded 'patch' bump to ensure it correctly
    // rolls up the new version of its local dependency.
    expect(parent?.bump).toBe('patch');
    expect(parent?.newVersion).toBe('0.0.8');
  });

  it('should discover the root package in a non-virtual workspace', () => {
    using temp = mktemp();
    repo(temp.path).commit('init non-virtual workspace', (c) =>
      c
        .update('Cargo.toml', () =>
          `
[package]
name = "root-app"
version = "1.0.0"

[workspace]
members = ["crates/*"]
`.trim(),
        )
        .update('crates/sub-crate/Cargo.toml', () =>
          toml().section('package').kv('name', 'sub-crate').kv('version', '0.1.0').build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(2);

    const rootApp = deps.find((d) => d.name === 'root-app');
    const subCrate = deps.find((d) => d.name === 'sub-crate');

    expect(rootApp).toBeDefined();
    expect(subCrate).toBeDefined();
    expect(rootApp?.watch).toEqual(['.']);
    expect(subCrate?.watch).toEqual(['crates/sub-crate']);
  });

  it('should traverse upwards from subdirectories to discover the workspace root', () => {
    using temp = mktemp();
    repo(temp.path).commit('init workspace at subdirectory', (c) =>
      c
        .update('workspace/Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/*']).build(),
        )
        .update('workspace/crates/math/Cargo.toml', () =>
          toml().section('package').kv('name', 'math').kv('version', '0.1.0').build(),
        )
        .update('workspace/crates/server/Cargo.toml', () =>
          toml().section('package').kv('name', 'server').kv('version', '1.0.0').build(),
        ),
    );

    const runDir = path.join(temp.path, 'workspace/crates/server');
    const deps = loadCargoDeps(runDir);

    expect(deps).toHaveLength(2);
    expect(deps.map((d) => d.name)).toContainValues(['math', 'server']);
  });

  it('should handle standalone non-workspace projects correctly', () => {
    using temp = mktemp();
    repo(temp.path).commit('init standalone package', (c) =>
      c.update('Cargo.toml', () =>
        toml().section('package').kv('name', 'single-crate').kv('version', '0.5.0').build(),
      ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.name).toBe('single-crate');
    expect(deps[0]?.watch).toEqual(['.']);
  });

  it('should recursively discover nested local path dependencies outside workspace members', () => {
    using temp = mktemp();
    repo(temp.path).commit('init nested crates', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/app/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'app')
            .kv('version', '1.0.0')
            .section('dependencies')
            .kv('local-lib', { path: '../../libs/local-lib' })
            .build(),
        )
        .update('libs/local-lib/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'local-lib')
            .kv('version', '0.1.0')
            .section('dependencies')
            .kv('deep-helper', { path: '../deep-helper' })
            .build(),
        )
        .update('libs/deep-helper/Cargo.toml', () =>
          toml().section('package').kv('name', 'deep-helper').kv('version', '0.0.1').build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    expect(deps).toHaveLength(3);

    const app = deps.find((d) => d.name === 'app');
    const localLib = deps.find((d) => d.name === 'local-lib');
    const deepHelper = deps.find((d) => d.name === 'deep-helper');

    expect(app).toBeDefined();
    expect(localLib).toBeDefined();
    expect(deepHelper).toBeDefined();

    expect(app?.depends).toContain('local-lib');
    expect(localLib?.depends).toContain('deep-helper');
  });

  it('should tie and synchronize version bumps between coupled dependencies using a real VCS', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init coupled project', (c) =>
      c
        .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
        .update('crates/oyui-tasker/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'oyui-tasker')
            .kv('version', '0.0.7')
            .section('dependencies')
            .kv('oyui-tasker-derive', { path: './derive' })
            .build(),
        )
        .update('crates/oyui-tasker/derive/Cargo.toml', () =>
          toml().section('package').kv('name', 'oyui-tasker-derive').kv('version', '0.0.7').build(),
        ),
    )
      .tag('oyui-tasker-v0.0.7')
      .tag('oyui-tasker-derive-v0.0.7');

    r.commit('feat(oyui-tasker): updating oyui', (c) =>
      c.update('crates/oyui-tasker/src/lib.rs', () => '// new feature'),
    );

    const vcs = makeJjVcsProvider(temp.path);
    const deps = loadCargoDeps(temp.path).couple('oyui-tasker', 'oyui-tasker-derive');

    const vm = makeVcsVersionManager(vcs, { sizes });

    const reports = await Effect.runPromise(
      Effect.provideService(prepare(deps, { cwd: temp.path }), VersionManagerService, vm),
    );

    const parent = reports.deps.find((x) => x.name === 'oyui-tasker');
    const derive = reports.deps.find((x) => x.name === 'oyui-tasker-derive');

    expect(parent).toBeDefined();
    expect(derive).toBeDefined();

    expect(parent?.bump).toBe('minor');
    expect(derive?.bump).toBe('minor');

    expect(parent?.newVersion).toBe('0.1.0');
    expect(derive?.newVersion).toBe('0.1.0');
  });
});

import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { loadCargoDeps } from '../src/builder';
import { regexUpdate, type UpdateAction } from '../src/updater';

import { mktemp, repo } from './utils/repo';
import { toml } from './utils/toml';

const initMockWorkspace = (tempPath: string) => {
  return repo(tempPath).commit('init workspace', (c) =>
    c
      .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
      .update('Cargo.lock', () =>
        `
[[package]]
name = "math"
version = "0.1.0"

[[package]]
name = "parking_lot"
version = "0.12.5"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "93857453250e3077bd71ff98b6a65ea6621a19bb0f559a85248955ac12c45a1a"

[[package]]
name = "server"
version = "1.0.0"
dependencies = [
 "math",
 "parking_lot",
]
`.trim(),
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
          .kv('math', { path: '../math' })
          .build(),
      ),
  );
};

const initNestedMockWorkspace = (tempPath: string) => {
  return repo(tempPath).commit('init nested workspace', (c) =>
    c
      // Note: 'libs/*' is intentionally omitted from workspace members
      .update('Cargo.toml', () =>
        toml().section('workspace').kv('members', ['crates/main_app']).build(),
      )
      .update('Cargo.lock', () =>
        `
[[package]]
name = "main_app"
version = "1.0.0"
dependencies = [
 "hidden_lib",
]

[[package]]
name = "hidden_lib"
version = "0.1.0"
`.trim(),
      )
      .update('crates/main_app/Cargo.toml', () =>
        toml()
          .section('package')
          .kv('name', 'main_app')
          .kv('version', '1.0.0')
          .section('dependencies')
          // Linked dynamically via path, outside of the standard workspace crates/ dir
          .kv('hidden_lib', { path: '../../libs/hidden_lib' })
          .build(),
      )
      .update('libs/hidden_lib/Cargo.toml', () =>
        toml().section('package').kv('name', 'hidden_lib').kv('version', '0.1.0').build(),
      ),
  );
};

describe('Cargo Workspace Builder', () => {
  it('should auto-discover workspace members and inter-dependencies', () => {
    using temp = mktemp();
    initMockWorkspace(temp.path);

    const deps = loadCargoDeps(temp.path);

    expect(deps).toBeArray();
    expect(deps).toHaveLength(2);

    const math = deps.find((d) => d.name === 'math');
    const server = deps.find((d) => d.name === 'server');

    // Check Auto-discovery paths
    expect(math?.watch).toEqual(['crates/math']);
    expect(server?.watch).toEqual(['crates/server']);

    // Check built-in TOML updater
    const tomlUpdate = math?.updates?.[0];
    expect(tomlUpdate).toBeDefined();
    expect(tomlUpdate!.kind).toEqual('toml');
    expect(tomlUpdate!.path).toEqual('crates/math/Cargo.toml');
    expect(tomlUpdate!.params).toBeInstanceOf(Function);

    // Check Cargo.lock auto-updater (Fallback tomlUpdate advanced matcher)
    const lockUpdate = math?.updates?.[1];
    expect(lockUpdate).toBeDefined();
    expect(lockUpdate!.kind).toEqual('toml');
    expect(lockUpdate!.path).toEqual('Cargo.lock');
    expect(lockUpdate!.params).toBeInstanceOf(Function);

    // Check Graph Dependency Injection
    expect(server?.depends).toContain('math');
    expect(math?.depends).toBeEmpty();
  });

  it('should always update workspace dependencies in the root Cargo.toml', () => {
    using temp = mktemp();
    repo(temp.path).commit('init workspace with path inheritance', (c) =>
      c
        .update('Cargo.toml', () =>
          `
[workspace]
resolver = "2"
members = ["crates/math"]

[workspace.dependencies]
math = { path = "crates/math", version = "0.1.0" }
ratatui = "0.30"
`.trim(),
        )
        .update('crates/math/Cargo.toml', () =>
          toml().section('package').kv('name', 'math').kv('version', '0.1.0').build(),
        ),
    );

    const deps = loadCargoDeps(temp.path);
    const math = deps.find((d) => d.name === 'math');
    expect(math).toBeDefined();

    const wsUpdate = math?.updates?.find((u) => u.kind === 'toml' && u.path === 'Cargo.toml');
    expect(wsUpdate).toBeDefined();

    // Ensure it is not skipped
    const skipped = wsUpdate!._skipIf(temp.path);
    expect(skipped).toBeFalse();

    const report = {
      name: 'math',
      bump: 'minor',
      newVersion: '0.2.0',
    } as any;

    const resolved = wsUpdate!.prepare({
      newVersion: '0.2.0',
      globalCommits: [],
      crateCommits: [],
    });

    resolved.apply(report, [report], temp.path);

    const updatedRootCargo = fs.readFileSync(path.join(temp.path, 'Cargo.toml'), 'utf8');
    expect(updatedRootCargo).toContain('math = { path = "crates/math", version = "0.2.0" }');
    expect(updatedRootCargo).toContain('ratatui = "0.30"');
  });

  it('should correctly locate and update the root Cargo.toml in a nested workspace', () => {
    using temp = mktemp();
    repo(temp.path).commit('init nested workspace structure', (c) =>
      c
        .update('workspace/Cargo.toml', () =>
          `
[workspace]
resolver = "2"
members = ["crates/math"]

[workspace.dependencies]
math = { path = "crates/math", version = "0.1.0" }
`.trim(),
        )
        .update('workspace/crates/math/Cargo.toml', () =>
          toml().section('package').kv('name', 'math').kv('version', '0.1.0').build(),
        ),
    );

    // Run cargoDeps from the deep package directory
    const runDir = path.join(temp.path, 'workspace/crates/math');
    const deps = loadCargoDeps(runDir);
    const math = deps.find((d) => d.name === 'math');
    expect(math).toBeDefined();

    // Select the workspace update action specifically (containing parent segment '..')
    const wsUpdate = math?.updates?.find((u) => u.kind === 'toml' && u.path.includes('..'));
    expect(wsUpdate).toBeDefined();
    expect(wsUpdate!.path).toEqual('../../Cargo.toml');

    // Ensure it is not skipped
    const skipped = wsUpdate!._skipIf(runDir);
    expect(skipped).toBeFalse();

    const report = {
      name: 'math',
      bump: 'minor',
      newVersion: '0.2.0',
    } as any;

    const resolved = wsUpdate!.prepare({
      newVersion: '0.2.0',
      globalCommits: [],
      crateCommits: [],
    });

    resolved.apply(report, [report], runDir);

    const updatedRootCargo = fs.readFileSync(path.join(temp.path, 'workspace/Cargo.toml'), 'utf8');
    expect(updatedRootCargo).toContain('math = { path = "crates/math", version = "0.2.0" }');
  });

  it('should dynamically discover nested packages via path dependencies not in workspace members', () => {
    using temp = mktemp();
    initNestedMockWorkspace(temp.path);

    const deps = loadCargoDeps(temp.path);

    expect(deps).toBeArray();
    expect(deps).toHaveLength(2);

    const mainApp = deps.find((d) => d.name === 'main_app');
    const hiddenLib = deps.find((d) => d.name === 'hidden_lib');

    expect(mainApp).toBeDefined();
    expect(hiddenLib).toBeDefined();

    // Ensure paths were correctly resolved recursively
    expect(mainApp?.watch).toEqual(['crates/main_app']);
    expect(hiddenLib?.watch).toEqual(['libs/hidden_lib']);

    // Ensure the dependency relationship was maintained
    expect(mainApp?.depends).toContain('hidden_lib');
    expect(hiddenLib?.depends).toBeEmpty();
  });

  it('should support fluent builder API via .on()', () => {
    using temp = mktemp();
    initMockWorkspace(temp.path);

    const deps = loadCargoDeps(temp.path).onPackageBump(
      'server',
      regexUpdate('./Dockerfile', {
        search: 'v.*',
        replace: 'v{{version}}',
      }),
    );

    const server = deps.find((d) => d.name === 'server');
    expect(server?.updates).toHaveLength(4);
    const update = server?.updates?.[3]; // dockerfile update
    expect(update).toBeDefined();
    expect(update!.kind).toBe('regex');
    expect((update as any).path || update!.path).toBe('./Dockerfile');
    expect(update!.params.replace).toBe('v{{version}}');
  });

  it('should preserve TOML formatting and comments when performing updates', () => {
    using temp = mktemp();
    const filePath = path.join(temp.path, 'Cargo.toml');
    const originalToml = `
# This is a root comment
[package]
name = "math"
version = "0.1.0" # Inline package comment

# Dependencies section comment
[dependencies]
bytes = { version = "1.0", features = ["std"] } # Inline table comment
# Another comment
memchr = "2.5"
`.trim();

    fs.writeFileSync(filePath, originalToml, 'utf8');

    const deps = loadCargoDeps(temp.path);
    const math = deps.find((d) => d.name === 'math');
    const update = math?.updates?.find((u) => u.kind === 'toml' && u.path === 'Cargo.toml');

    expect(update).toBeDefined();

    const report = {
      name: 'math',
      bump: 'minor',
      newVersion: '0.2.0',
    } as any;

    // Call .prepare first to resolve the action
    const resolvedAction = update!.prepare({
      newVersion: '0.2.0',
      globalCommits: [],
      crateCommits: [],
    });

    // Execute .apply on the resolved action
    resolvedAction.apply(report, [report], temp.path);

    const updatedToml = fs.readFileSync(filePath, 'utf8');

    // Confirm that the target package version was updated
    expect(updatedToml).toContain('version = "0.2.0" # Inline package comment');

    // Confirm that the rest of the layout, structure, and comments remain unmodified
    expect(updatedToml).toContain('# This is a root comment');
    expect(updatedToml).toContain('# Dependencies section comment');
    expect(updatedToml).toContain(
      'bytes = { version = "1.0", features = ["std"] } # Inline table comment',
    );
    expect(updatedToml).toContain('# Another comment');
    expect(updatedToml).toContain('memchr = "2.5"');
  });
});

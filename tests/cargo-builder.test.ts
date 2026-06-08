import { describe, it, expect } from 'bun:test';

import { cargoDeps } from '../src/builder';
import { regexUpdate } from '../src/updater';

import { mktemp, repo } from './utils/repo';
import { toml } from './utils/toml';

const initMockWorkspace = (tempPath: string) => {
  return repo(tempPath).commit('init workspace', (c) =>
    c
      .update('Cargo.toml', () => toml().section('workspace').kv('members', ['crates/*']).build())
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

describe('Cargo Workspace Builder', () => {
  it('should auto-discover workspace members and inter-dependencies', () => {
    using temp = mktemp();
    initMockWorkspace(temp.path);

    const deps = cargoDeps(temp.path);

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
    expect(tomlUpdate!.params.path).toEqual('crates/math/Cargo.toml');

    // Check Graph Dependency Injection
    expect(server?.depends).toContain('math');
    expect(math?.depends).toBeEmpty();
  });

  it('should support fluent builder API via .on()', () => {
    using temp = mktemp();
    initMockWorkspace(temp.path);

    const deps = cargoDeps(temp.path).on('server', (c) =>
      c.update(
        regexUpdate({
          path: './Dockerfile',
          search: 'v.*',
          replace: 'v{{version}}',
        }),
      ),
    );

    const server = deps.find((d) => d.name === 'server');
    expect(server?.updates).toHaveLength(2); // The default toml one + the new regex one
    const update = server?.updates?.[1];
    expect(update).toBeDefined();
    expect(update!.kind).toBe('regex');
    expect(update!.path).toBe('./Dockerfile');
    expect(update!.params.replace).toBe('v{{version}}');
  });
});

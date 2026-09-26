import { describe, expect, it } from 'bun:test';

import { loadCargoDeps } from '../src/builder';
import { createRelacher } from '../src/orchestrator';
import { cargo } from './utils/cargo';
import { mktemp, repo } from './utils/repo';
import { toml } from './utils/toml';

describe('Forced Release E2E with Jujutsu', () => {
  it('should force a patch release when there are no commits using force: true', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init ocklog', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/ocklog']).build(),
        )
        .update('crates/ocklog/Cargo.toml', () =>
          cargo().package('ocklog', '0.0.1', { publish: false }).build(),
        ),
    );

    const deps = loadCargoDeps(temp.path, { includePrivate: true });
    expect(deps).toHaveLength(1);

    const relacher = createRelacher({
      cwd: temp.path,
      vcs: 'jj',
      packages: deps,
    });

    // 1. Without force, it should be empty
    const normalUpdates = await relacher.prepare({ mode: 'release' });
    expect(normalUpdates.isEmpty).toBe(true);

    // 2. With force: true, it should force a patch release
    const forcedUpdates = await relacher.prepare({ mode: 'release', force: true });
    expect(forcedUpdates.isEmpty).toBe(false);
    expect(forcedUpdates.deps).toHaveLength(1);
    expect(forcedUpdates.deps[0]?.name).toBe('ocklog');
    expect(forcedUpdates.deps[0]?.bump).toBe('patch');
    expect(forcedUpdates.deps[0]?.currentVersion).toBe('0.0.1');
    expect(forcedUpdates.deps[0]?.newVersion).toBe('0.0.2');
  });

  it('should force a minor release when force: "minor" is specified', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init ocklog', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/ocklog']).build(),
        )
        .update('crates/ocklog/Cargo.toml', () =>
          cargo().package('ocklog', '0.0.1', { publish: false }).build(),
        ),
    );

    const deps = loadCargoDeps(temp.path, { includePrivate: true });

    const relacher = createRelacher({
      cwd: temp.path,
      vcs: 'jj',
      packages: deps,
    });

    const forcedUpdates = await relacher.prepare({ mode: 'release', force: 'minor' });
    expect(forcedUpdates.isEmpty).toBe(false);
    expect(forcedUpdates.deps[0]?.bump).toBe('minor');
    expect(forcedUpdates.deps[0]?.newVersion).toBe('0.1.0');
  });

  it('should support package-specific force via forcePackages', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init workspace', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/*']).build(),
        )
        .update('crates/ocklog/Cargo.toml', () =>
          cargo().package('ocklog', '0.0.1', { publish: false }).build(),
        )
        .update('crates/helper/Cargo.toml', () =>
          cargo().package('helper', '1.0.0', { publish: false }).build(),
        ),
    );

    const deps = loadCargoDeps(temp.path, { includePrivate: true });
    expect(deps).toHaveLength(2);

    const relacher = createRelacher({
      cwd: temp.path,
      vcs: 'jj',
      packages: deps,
    });

    // Only force 'ocklog', 'helper' should remain skipped
    const updates = await relacher.prepare({
      mode: 'release',
      forcePackages: { ocklog: 'patch' },
    });

    expect(updates.isEmpty).toBe(false);
    const ocklogReport = updates.deps.find((d) => d.name === 'ocklog');
    const helperReport = updates.deps.find((d) => d.name === 'helper');

    expect(ocklogReport?.bump).toBe('patch');
    expect(ocklogReport?.newVersion).toBe('0.0.2');
    expect(helperReport?.bump).toBe('skip');
  });
});

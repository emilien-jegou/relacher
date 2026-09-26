import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { loadCargoDeps } from '../src/builder';
import { createRelacher } from '../src/orchestrator';
import { regexUpdate } from '../src/updater';

import { cargo } from './utils/cargo';
import { mktemp, repo } from './utils/repo';
import { toml } from './utils/toml';

describe('UpdateAction onlyOn filter and Pre-Release skipping', () => {
  it('should skip changelogs and version sync on pre-release, then apply them on stable release', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    // Initial commit establishing baseline 1.0.0
    r.commit('chore: init app', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/app']).build(),
        )
        .update('crates/app/Cargo.toml', () =>
          cargo().package('app', '1.0.0', { publish: false }).build(),
        )
        .update('flake.nix', () => 'version = "1.0.0";'),
    );

    // Feature commit that triggers a minor bump
    r.commit('feat(app): add experimental feature', (c) =>
      c.update('crates/app/src/lib.rs', () => '// experimental feature'),
    );

    const deps = loadCargoDeps(temp.path, { includePrivate: true })
      // withChangelogs() defaults to onlyOn: ['major', 'minor', 'patch']
      .withChangelogs()
      // syncVersion configured only for stable releases
      .syncVersion('app', './flake.nix', 'version = "[^"]+"', 'version = "{{version}}"', {
        onlyOn: ['major', 'minor', 'patch'],
      });

    const relacher = createRelacher({
      cwd: temp.path,
      vcs: 'jj',
      packages: deps,
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: PRE-RELEASE MODE (-rc.0)
    // ──────────────────────────────────────────────────────────────────────────
    const preReleaseUpdate = await relacher.prepare({ mode: 'pre-release' });

    expect(preReleaseUpdate.isEmpty).toBe(false);
    const preReport = preReleaseUpdate.deps[0]!;
    expect(preReport.newVersion).toBe('1.1.0-rc.0');

    // Only Cargo.toml and Cargo.lock should be in updates.
    // CHANGELOG.md and flake.nix MUST be filtered out because onlyOn excludes 'pre'!
    const preUpdatePaths = preReport.updates.map((u) => u.targetPath);
    expect(preUpdatePaths).toContain('crates/app/Cargo.toml');
    expect(preUpdatePaths).not.toContain('crates/app/CHANGELOG.md');
    expect(preUpdatePaths).not.toContain('./flake.nix');

    // Execute pre-release run
    await relacher.run(preReleaseUpdate);

    // Verify Cargo.toml was updated to RC
    expect(r.readFile('crates/app/Cargo.toml')).toContain('version = "1.1.0-rc.0"');

    // Verify CHANGELOG.md was NOT created or modified
    expect(fs.existsSync(path.join(temp.path, 'crates/app/CHANGELOG.md'))).toBe(false);

    // Verify flake.nix was NOT modified
    expect(r.readFile('flake.nix')).toBe('version = "1.0.0";');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: STABLE GRADUATION (1.1.0)
    // ──────────────────────────────────────────────────────────────────────────
    const stableUpdate = await relacher.prepare({ mode: 'release' });

    expect(stableUpdate.isEmpty).toBe(false);
    const stableReport = stableUpdate.deps[0]!;
    expect(stableReport.newVersion).toBe('1.1.0');

    // Now on stable release, CHANGELOG.md and flake.nix MUST be active!
    const stableUpdatePaths = stableReport.updates.map((u) => u.targetPath);
    expect(stableUpdatePaths).toContain('crates/app/Cargo.toml');
    expect(stableUpdatePaths).toContain('crates/app/CHANGELOG.md');
    expect(stableUpdatePaths).toContain('./flake.nix');

    // Execute stable release run
    await relacher.run(stableUpdate);

    // Verify Cargo.toml graduated to final stable version
    expect(r.readFile('crates/app/Cargo.toml')).toContain('version = "1.1.0"');

    // Verify CHANGELOG.md now exists and contains the feature release notes
    expect(fs.existsSync(path.join(temp.path, 'crates/app/CHANGELOG.md'))).toBe(true);
    const changelogContent = r.readFile('crates/app/CHANGELOG.md');
    expect(changelogContent).toContain('## [1.1.0]');
    expect(changelogContent).toContain('add experimental feature');

    // Verify flake.nix was updated to 1.1.0
    expect(r.readFile('flake.nix')).toBe('version = "1.1.0";');
  });

  it('should only execute actions on specified bump sizes (e.g. only on major)', async () => {
    using temp = mktemp();
    const r = repo(temp.path);

    r.commit('chore: init app', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/app']).build(),
        )
        .update('crates/app/Cargo.toml', () =>
          cargo().package('app', '1.0.0', { publish: false }).build(),
        )
        .update('MIGRATION.md', () => '# Migration Guide for v1'),
    );

    // Commit that triggers a MINOR bump
    r.commit('feat(app): add new endpoint', (c) =>
      c.update('crates/app/src/lib.rs', () => '// new endpoint'),
    );

    const deps = loadCargoDeps(temp.path, { includePrivate: true }).onPackageBump(
      'app',
      regexUpdate('MIGRATION.md', {
        search: '# Migration Guide for v.*',
        replace: '# Migration Guide for v{{version}}',
        // Restrict this update to MAJOR bumps only!
        onlyOn: ['major'],
      }),
    );

    const relacher = createRelacher({
      cwd: temp.path,
      vcs: 'jj',
      packages: deps,
    });

    // 1. Minor bump test: MIGRATION.md should be skipped
    const minorUpdate = await relacher.prepare({ mode: 'release' });
    expect(minorUpdate.deps[0]?.bump).toBe('minor');
    const minorPaths = minorUpdate.deps[0]!.updates.map((u) => u.targetPath);
    expect(minorPaths).not.toContain('MIGRATION.md');

    // 2. Breaking change commit that triggers a MAJOR bump
    r.commit('feat(app)!: remove legacy authentication', (c) =>
      c.update('crates/app/src/lib.rs', () => '// breaking change'),
    );

    // Major bump test: MIGRATION.md MUST be included now
    const majorUpdate = await relacher.prepare({ mode: 'release' });
    expect(majorUpdate.deps[0]?.bump).toBe('major');
    const majorPaths = majorUpdate.deps[0]!.updates.map((u) => u.targetPath);
    expect(majorPaths).toContain('MIGRATION.md');

    // Apply and verify
    await relacher.run(majorUpdate);
    expect(r.readFile('MIGRATION.md')).toBe('# Migration Guide for v2.0.0');
  });
});

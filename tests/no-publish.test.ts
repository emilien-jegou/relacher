import { describe, it, expect } from 'bun:test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadCargoDeps } from '../src/builder/cargo';
import { loadPnpmDeps } from '../src/builder/pnpm';

import { mktemp } from './utils/repo';
import { toml } from './utils/toml';

describe('No-Publish and VCS Tracking Filters', () => {
  it('Cargo: should skip packages where publish = false', () => {
    using temp = mktemp();
    const root = temp.path;

    // Init git so isPathTracked returns true
    execSync('git init', { cwd: root });

    fs.mkdirSync(path.join(root, 'crates/secret'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'Cargo.toml'),
      toml().section('workspace').kv('members', ['crates/*']).build(),
    );
    fs.writeFileSync(
      path.join(root, 'crates/secret/Cargo.toml'),
      toml()
        .section('package')
        .kv('name', 'secret')
        .kv('version', '0.1.0')
        .kv('publish', false)
        .build(),
    );
    execSync('git add .', { cwd: root });

    const deps = loadCargoDeps(root);
    expect(deps.find((d) => d.name === 'secret')).toBeUndefined();
  });

  it('pnpm: should skip packages where private = true', () => {
    using temp = mktemp();
    const root = temp.path;

    execSync('git init', { cwd: root });

    fs.mkdirSync(path.join(root, 'packages/app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"');
    fs.writeFileSync(
      path.join(root, 'packages/app/package.json'),
      JSON.stringify({ name: '@scope/app', version: '1.0.0', private: true }),
    );
    execSync('git add .', { cwd: root });

    const deps = loadPnpmDeps(root);
    expect(deps.find((d) => d.name === '@scope/app')).toBeUndefined();
  });

  it('VCS: should skip files not tracked by git', () => {
    using temp = mktemp();
    const root = temp.path;

    execSync('git init', { cwd: root });

    // Create a package, but don't git add it
    fs.mkdirSync(path.join(root, 'packages/untracted'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"');
    fs.writeFileSync(
      path.join(root, 'packages/untracted/package.json'),
      JSON.stringify({ name: 'untracked-pkg', version: '1.0.0' }),
    );

    const deps = loadPnpmDeps(root);
    expect(deps.find((d) => d.name === 'untracked-pkg')).toBeUndefined();
  });

  it('pnpm: should include packages that are public and tracked', () => {
    using temp = mktemp();
    const root = temp.path;

    execSync('git init', { cwd: root });

    fs.mkdirSync(path.join(root, 'packages/public'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"');
    fs.writeFileSync(
      path.join(root, 'packages/public/package.json'),
      JSON.stringify({ name: 'public-pkg', version: '1.0.0' }),
    );
    execSync('git add .', { cwd: root });

    const deps = loadPnpmDeps(root);
    expect(deps.find((d) => d.name === 'public-pkg')).toBeDefined();
  });
});

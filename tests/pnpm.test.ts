import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadPnpmDeps, pnpmProject, pnpmWorkspace } from '../src/builder/pnpm';

describe('PNPM Builder Pipeline', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should parse single pnpmProject dependencies correctly', () => {
    const pkgJson = {
      name: 'single-app',
      version: '1.0.0',
    };
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

    const list = pnpmProject(tempDir);
    expect(list).toHaveLength(1);
    expect(list[0]).toBeDefined();
    expect(list[0]!.name).toBe('single-app');
    expect(list[0]!.watch).toEqual(['.']);
    expect(list[0]!.updates).toHaveLength(1);
    expect(list[0]!.updates[0]!.kind).toBe('json');
  });

  it('should parse complex multi-package pnpmWorkspace setups', () => {
    // 1. Setup workspace configuration
    fs.writeFileSync(
      path.join(tempDir, 'pnpm-workspace.yaml'),
      `
packages:
  - 'packages/*'
  - 'services/api'
      `.trim(),
    );

    // Create package directories
    fs.mkdirSync(path.join(tempDir, 'packages/core'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'packages/utils'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'services/api'), { recursive: true });

    // Create package.json for @workspace/core
    const coreJson = {
      name: '@workspace/core',
      version: '1.0.0',
      dependencies: {
        '@workspace/utils': 'workspace:*',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'packages/core/package.json'),
      JSON.stringify(coreJson, null, 2),
    );

    // Create package.json for @workspace/utils
    const utilsJson = {
      name: '@workspace/utils',
      version: '1.0.0',
    };
    fs.writeFileSync(
      path.join(tempDir, 'packages/utils/package.json'),
      JSON.stringify(utilsJson, null, 2),
    );

    // Create package.json for @workspace/api
    const apiJson = {
      name: '@workspace/api',
      version: '2.0.0',
      devDependencies: {
        '@workspace/core': 'workspace:*',
      },
      peerDependencies: {
        '@workspace/utils': 'workspace:*',
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'services/api/package.json'),
      JSON.stringify(apiJson, null, 2),
    );

    const list = pnpmWorkspace(tempDir);

    expect(list).toHaveLength(3);

    // Verify @workspace/utils configuration
    const utils = list.find((item) => item.name === '@workspace/utils');
    expect(utils).toBeDefined();
    expect(utils?.depends).toEqual([]);
    expect(utils?.watch).toEqual(['packages/utils']);

    // Verify @workspace/core dependency on @workspace/utils
    const core = list.find((item) => item.name === '@workspace/core');
    expect(core).toBeDefined();
    expect(core?.depends).toEqual(['@workspace/utils']);
    expect(core?.watch).toEqual(['packages/core']);

    // Verify @workspace/api complex dependency on both core and utils
    const api = list.find((item) => item.name === '@workspace/api');
    expect(api).toBeDefined();
    expect(api?.depends).toContain('@workspace/core');
    expect(api?.depends).toContain('@workspace/utils');
    expect(api?.watch).toEqual(['services/api']);
  });

  it('should auto-detect workspace vs single project configurations using pnpmDeps', () => {
    // 1. Verify isolated project detection (no pnpm-workspace.yaml)
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'isolated-project' }),
    );

    let list = loadPnpmDeps(tempDir);
    expect(list).toHaveLength(1);
    expect(list[0]).toBeDefined();
    expect(list[0]!.name).toBe('isolated-project');

    // 2. Add pnpm-workspace.yaml and verify fallback auto-triggers workspace logic
    fs.writeFileSync(
      path.join(tempDir, 'pnpm-workspace.yaml'),
      `
packages:
  - 'crates/*'
      `,
    );
    fs.mkdirSync(path.join(tempDir, 'crates/engine'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'crates/engine/package.json'),
      JSON.stringify({ name: 'engine-pkg' }),
    );

    list = loadPnpmDeps(tempDir);
    expect(list).toHaveLength(1);
    expect(list[0]).toBeDefined();
    expect(list[0]!.name).toBe('engine-pkg');
    expect(list[0]!.watch).toEqual(['crates/engine']);
  });
});

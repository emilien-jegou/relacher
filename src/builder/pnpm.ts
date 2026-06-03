import fs from 'node:fs';
import path from 'node:path';

import type { DependencyConfig } from '../types';

import { decorateList, type DependencyList } from './shared';

/**
 * Loads a single project package configuration from package.json.
 */
export function pnpmProject(cwd: string): DependencyList {
  const configs: DependencyConfig[] = [];
  const pJsonPath = path.join(cwd, 'package.json');

  if (fs.existsSync(pJsonPath)) {
    try {
      const fileContent = fs.readFileSync(pJsonPath, 'utf8');
      const parsed = JSON.parse(fileContent);
      if (parsed.name) {
        configs.push({
          name: parsed.name,
          watch: ['.'],
          depends: [],
          updates: [
            {
              kind: 'regex',
              path: 'package.json',
              search: '"version"\\s*:\\s*"[^"]+"',
              replace: '"version": "{{version}}"',
            },
          ],
        });
      }
    } catch { }
  }

  return decorateList(configs);
}

/**
 * Parses pnpm-workspace.yaml to identify target members and versioning topologies.
 */
export function pnpmWorkspace(cwd: string): DependencyList {
  const configs: DependencyConfig[] = [];
  const workspaceYamlPath = path.join(cwd, 'pnpm-workspace.yaml');
  let globPatterns: string[] = [];

  if (fs.existsSync(workspaceYamlPath)) {
    const content = fs.readFileSync(workspaceYamlPath, 'utf8');
    const lines = content.split('\n');
    let inPackages = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('packages:')) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed && !line.startsWith(' ') && !trimmed.startsWith('-')) {
          inPackages = false;
          continue;
        }
        const match = trimmed.match(/^-\s*['"]?([^'"]+)['"]?/);
        if (match && match[1]) {
          globPatterns.push(match[1]);
        }
      }
    }
  }

  const packageInfos: { name: string; memberPath: string; content: string }[] = [];

  for (const pattern of globPatterns) {
    const cleanPattern = pattern.replace(/\\/g, '/');
    if (cleanPattern.endsWith('/*')) {
      const parentDir = path.join(cwd, cleanPattern.slice(0, -2));
      if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
        const subdirs = fs.readdirSync(parentDir);
        for (const subdir of subdirs) {
          const pJsonPath = path.join(parentDir, subdir, 'package.json');
          if (fs.existsSync(pJsonPath)) {
            try {
              const fileContent = fs.readFileSync(pJsonPath, 'utf8');
              const parsed = JSON.parse(fileContent);
              if (parsed.name) {
                packageInfos.push({
                  name: parsed.name,
                  memberPath: path.dirname(pJsonPath),
                  content: fileContent,
                });
              }
            } catch { }
          }
        }
      }
    } else {
      const pJsonPath = path.join(cwd, cleanPattern, 'package.json');
      if (fs.existsSync(pJsonPath)) {
        try {
          const fileContent = fs.readFileSync(pJsonPath, 'utf8');
          const parsed = JSON.parse(fileContent);
          if (parsed.name) {
            packageInfos.push({
              name: parsed.name,
              memberPath: path.dirname(pJsonPath),
              content: fileContent,
            });
          }
        } catch { }
      }
    }
  }

  for (const info of packageInfos) {
    const relativePath = path.relative(cwd, info.memberPath);
    const relativePJson = path.join(relativePath, 'package.json');

    const parsed = JSON.parse(info.content);
    const depends: string[] = [];

    const allDeps = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
      ...parsed.peerDependencies,
    };

    for (const other of packageInfos) {
      if (other.name === info.name) continue;
      if (allDeps[other.name] !== undefined) {
        depends.push(other.name);
      }
    }

    configs.push({
      name: info.name,
      watch: [relativePath],
      depends,
      updates: [
        {
          kind: 'regex',
          path: relativePJson,
          search: '"version"\\s*:\\s*"[^"]+"',
          replace: '"version": "{{version}}"',
        },
      ],
    });
  }

  return decorateList(configs);
}

/**
 * Auto-detects whether the workspace configuration exists, reverting to single packages.
 */
export function pnpmDeps(cwd: string): DependencyList {
  const workspaceYamlPath = path.join(cwd, 'pnpm-workspace.yaml');
  if (fs.existsSync(workspaceYamlPath)) {
    return pnpmWorkspace(cwd);
  }
  return pnpmProject(cwd);
}

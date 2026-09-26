import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { PackageConfig } from '../types';
import { jsonFallback, jsonUpdate } from '../updater';
import { isPathTrackedSync } from '../vcs/common';

import { createPackageList, type PackageList } from './shared';

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface DiscoveredPackage {
  name: string;
  memberPath: string;
  parsed: PackageJson;
  rawContent: string;
}

export function pnpmProject(cwd: string): PackageList {
  const configs: PackageConfig[] = [];
  const pJsonPath = path.join(cwd, 'package.json');

  if (fs.existsSync(pJsonPath)) {
    try {
      const fileContent = fs.readFileSync(pJsonPath, 'utf8');
      const parsed = JSON.parse(fileContent) as PackageJson;

      const isPublishable = parsed.private !== true;
      const isTracked = isPathTrackedSync(pJsonPath, cwd);

      if (parsed.name && isPublishable && isTracked) {
        configs.push({
          name: parsed.name,
          manifestPath: 'package.json',
          watch: ['.'],
          depends: [],
          versionFallback: jsonFallback({
            path: 'package.json',
            read: (p) => p.version,
          }),
          updates: [
            jsonUpdate('package.json', (p, report) => {
              p.version = report.newVersion;
            }).skipIf((c) => !fs.existsSync(path.join(c, 'package.json'))),
          ],
        });
      }
    } catch {}
  }

  return createPackageList(configs);
}

export function pnpmWorkspace(cwd: string): PackageList {
  const configs: PackageConfig[] = [];
  const workspaceYamlPath = path.join(cwd, 'pnpm-workspace.yaml');
  let patterns: string[] = [];

  if (fs.existsSync(workspaceYamlPath)) {
    try {
      const parsedYaml = parseYaml(fs.readFileSync(workspaceYamlPath, 'utf8'));
      if (parsedYaml && Array.isArray(parsedYaml.packages)) {
        patterns = parsedYaml.packages.filter((p: unknown): p is string => typeof p === 'string');
      }
    } catch {}
  }

  const discovered: DiscoveredPackage[] = [];

  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/\\/g, '/');
    if (cleanPattern.endsWith('/*')) {
      const parentDir = path.join(cwd, cleanPattern.slice(0, -2));
      if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
        for (const subdir of fs.readdirSync(parentDir)) {
          const pJsonPath = path.join(parentDir, subdir, 'package.json');
          if (fs.existsSync(pJsonPath)) {
            try {
              const rawContent = fs.readFileSync(pJsonPath, 'utf8');
              const parsed = JSON.parse(rawContent) as PackageJson;
              if (parsed.name) {
                discovered.push({
                  name: parsed.name,
                  memberPath: path.dirname(pJsonPath),
                  parsed,
                  rawContent,
                });
              }
            } catch {}
          }
        }
      }
    } else {
      const pJsonPath = path.join(cwd, cleanPattern, 'package.json');
      if (fs.existsSync(pJsonPath)) {
        try {
          const rawContent = fs.readFileSync(pJsonPath, 'utf8');
          const parsed = JSON.parse(rawContent) as PackageJson;
          if (parsed.name) {
            discovered.push({
              name: parsed.name,
              memberPath: path.dirname(pJsonPath),
              parsed,
              rawContent,
            });
          }
        } catch {}
      }
    }
  }

  const publishableTracked = discovered.filter((info) => {
    if (info.parsed.private === true) return false;
    const pJsonPath = path.join(info.memberPath, 'package.json');
    return isPathTrackedSync(pJsonPath, cwd);
  });

  for (const info of publishableTracked) {
    const relativePath = path.relative(cwd, info.memberPath);
    const posixRelativePath = relativePath.split(path.sep).join(path.posix.sep);
    const relativePJson = posixRelativePath
      ? path.posix.join(posixRelativePath, 'package.json')
      : 'package.json';

    const allDeps = {
      ...info.parsed.dependencies,
      ...info.parsed.devDependencies,
      ...info.parsed.peerDependencies,
    };

    const depends = publishableTracked
      .filter((other) => other.name !== info.name && allDeps[other.name] !== undefined)
      .map((other) => other.name);

    configs.push({
      name: info.name,
      manifestPath: relativePJson,
      watch: [posixRelativePath || '.'],
      depends,
      versionFallback: jsonFallback({
        path: relativePJson,
        read: (p) => p.version,
      }),
      updates: [
        jsonUpdate(relativePJson, (targetParsed, report, reports) => {
          targetParsed.version = report.newVersion;

          const depSections = [
            'dependencies',
            'devDependencies',
            'peerDependencies',
            'optionalDependencies',
          ] as const;

          for (const depReport of reports) {
            if (depReport.name === report.name) continue;

            for (const section of depSections) {
              if (targetParsed[section] && targetParsed[section][depReport.name]) {
                const currentVal = targetParsed[section][depReport.name];
                if (typeof currentVal === 'string') {
                  const match = currentVal.match(/^((?:workspace:)?([~^]?))/);
                  const prefix = match ? match[1] : '';
                  targetParsed[section][depReport.name] = `${prefix}${depReport.newVersion}`;
                }
              }
            }
          }
        }).skipIf((c) => !fs.existsSync(path.join(c, relativePJson))),
      ],
    });
  }

  return createPackageList(configs);
}

export function loadPnpmDeps(cwd: string): PackageList {
  if (fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) {
    return pnpmWorkspace(cwd);
  }
  return pnpmProject(cwd);
}

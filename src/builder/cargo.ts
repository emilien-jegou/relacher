import fs from 'node:fs';
import path from 'node:path';

import type { DependencyConfig } from '../types';
import { regexUpdate, tomlUpdate, tomlFallback } from '../updater';

import { decorateList, type DependencyList } from './shared';

export interface CargoBuilderOptions {
  syncWorkspaceDeps?: boolean;
}

/**
 * Loads a single Cargo project from a target Cargo.toml.
 */
export function cargoProject(cwd: string): DependencyList {
  const configs: DependencyConfig[] = [];
  const rootCargo = path.join(cwd, 'Cargo.toml');

  if (fs.existsSync(rootCargo)) {
    const fileContent = fs.readFileSync(rootCargo, 'utf8');
    const nameMatch = fileContent.match(/^name\s*=\s*"([^"]+)"/m);
    const parsedName = nameMatch?.[1] ?? '';
    if (parsedName) {
      configs.push({
        name: parsedName,
        watch: ['.'],
        depends: [],
        versionFallback: tomlFallback({ path: 'Cargo.toml', toml: 'package.version' }),
        updates: [tomlUpdate({ path: 'Cargo.toml', toml: 'package.version' })],
      });
    }
  }

  return decorateList(configs);
}

/**
 * Loads a Cargo workspace, tracking member paths, dependency links, and recursive nested paths.
 */
export function cargoWorkspace(cwd: string, options?: CargoBuilderOptions): DependencyList {
  const configs: DependencyConfig[] = [];
  const rootCargo = path.join(cwd, 'Cargo.toml');
  const discoveredPaths = new Set<string>();

  if (fs.existsSync(rootCargo)) {
    const content = fs.readFileSync(rootCargo, 'utf8');
    const membersMatch = content.match(/members\s*=\s*\[([^\]]+)\]/);
    if (membersMatch && membersMatch[1]) {
      const rawMembers = membersMatch[1].split(',').map((m) => m.replace(/["\s]/g, ''));
      const crateInfos: { name: string; memberPath: string; content: string }[] = [];

      for (const member of rawMembers) {
        if (!member) continue;
        const globPath = path.join(cwd, member);
        const cargoPaths = globPath.endsWith('*')
          ? fs.existsSync(path.dirname(globPath))
            ? fs
              .readdirSync(path.dirname(globPath))
              .map((dir) => path.join(path.dirname(globPath), dir, 'Cargo.toml'))
            : []
          : [path.join(globPath, 'Cargo.toml')];

        for (const p of cargoPaths) {
          if (fs.existsSync(p)) {
            const memberPath = path.dirname(p);
            discoveredPaths.add(memberPath);
            const fileContent = fs.readFileSync(p, 'utf8');
            const nameMatch = fileContent.match(/^name\s*=\s*"([^"]+)"/m);
            const parsedName = nameMatch?.[1] ?? '';
            if (parsedName) {
              crateInfos.push({
                name: parsedName,
                memberPath,
                content: fileContent,
              });
            }
          }
        }
      }

      // Discover nested packages dynamically via path dependencies
      let i = 0;
      while (i < crateInfos.length) {
        const info = crateInfos[i]!;
        const pathDepsMatch = [
          ...info.content.matchAll(/([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/g),
        ];
        for (const match of pathDepsMatch) {
          const depName = match[1];
          const depPath = match[2];

          // Verify matches are defined strings to resolve TypeScript's undefined safety warnings
          if (typeof depName !== 'string' || typeof depPath !== 'string') {
            continue;
          }

          const fullDepPath = path.resolve(info.memberPath, depPath);

          if (!discoveredPaths.has(fullDepPath)) {
            discoveredPaths.add(fullDepPath);
            const cargoPath = path.join(fullDepPath, 'Cargo.toml');

            if (fs.existsSync(cargoPath)) {
              const fileContent = fs.readFileSync(cargoPath, 'utf8');
              const nameMatch = fileContent.match(/^name\s*=\s*"([^"]+)"/m);
              const parsedName = nameMatch?.[1] ?? depName;

              crateInfos.push({
                name: parsedName,
                memberPath: fullDepPath,
                content: fileContent,
              });
            }
          }
        }
        i++;
      }

      for (const info of crateInfos) {
        const relativePath = path.relative(cwd, info.memberPath);
        const posixRelativePath = relativePath.split(path.sep).join(path.posix.sep);
        const relativeCargo = posixRelativePath
          ? path.posix.join(posixRelativePath, 'Cargo.toml')
          : 'Cargo.toml';

        const depends: string[] = [];
        for (const other of crateInfos) {
          if (other.name === info.name) continue;
          const depPattern = new RegExp(`^\\s*${other.name}\\s*=`, 'm');
          if (depPattern.test(info.content)) {
            depends.push(other.name);
          }
        }

        const updates = [tomlUpdate({ path: relativeCargo, toml: 'package.version' })];

        if (options?.syncWorkspaceDeps) {
          updates.push(
            regexUpdate({
              path: 'Cargo.toml',
              search: `(${info.name}\\s*=\\s*\\{[^}]*version\\s*=\\s*")[^"]+(")`,
              replace: `$1{{version}}$2`,
            }),
          );
        }

        configs.push({
          name: info.name,
          watch: [posixRelativePath || '.'],
          depends,
          versionFallback: tomlFallback({ path: relativeCargo, toml: 'package.version' }),
          updates,
        });
      }
    }
  }

  return decorateList(configs);
}

export function cargoDeps(cwd: string, options?: CargoBuilderOptions): DependencyList {
  const rootCargo = path.join(cwd, 'Cargo.toml');
  if (fs.existsSync(rootCargo)) {
    const content = fs.readFileSync(rootCargo, 'utf8');
    if (content.includes('members =')) {
      return cargoWorkspace(cwd, options);
    }
    if (content.includes('package =') || content.match(/^name\s*=/m)) {
      return cargoProject(cwd);
    }
  }
  return decorateList([]);
}

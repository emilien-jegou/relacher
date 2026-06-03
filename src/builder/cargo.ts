import fs from 'node:fs';
import path from 'node:path';

import type { DependencyConfig } from '../types';

import { decorateList, type DependencyList } from './shared';

/**
 * Loads a single Cargo project from a target Cargo.toml.
 */
export function cargoProject(cwd: string): DependencyList {
  const configs: DependencyConfig[] = [];
  const rootCargo = path.join(cwd, 'Cargo.toml');

  if (fs.existsSync(rootCargo)) {
    const fileContent = fs.readFileSync(rootCargo, 'utf8');
    const nameMatch = fileContent.match(/^name\s*=\s*"([^"]+)"/m);
    const parsedName = nameMatch && nameMatch[1] ? nameMatch[1] : '';
    if (parsedName) {
      configs.push({
        name: parsedName,
        watch: ['.'],
        depends: [],
        updates: [{ kind: 'toml', path: 'Cargo.toml', toml: 'package.version' }],
      });
    }
  }

  return decorateList(configs);
}

/**
 * Loads a Cargo workspace, tracking member paths and dependency links.
 */
export function cargoWorkspace(cwd: string): DependencyList {
  const configs: DependencyConfig[] = [];
  const rootCargo = path.join(cwd, 'Cargo.toml');

  if (fs.existsSync(rootCargo)) {
    const content = fs.readFileSync(rootCargo, 'utf8');
    const membersMatch = content.match(/members\s*=\s*\[([^\]]+)\]/);
    if (membersMatch && membersMatch[1]) {
      const rawMembers = membersMatch[1].split(',').map((m) => m.replace(/["\s]/g, ''));
      const crateInfos: { name: string; memberPath: string; content: string }[] = [];

      for (const member of rawMembers) {
        const globPath = path.join(cwd, member);
        const cargoPaths = globPath.endsWith('*')
          ? fs
            .readdirSync(path.dirname(globPath))
            .map((dir) => path.join(path.dirname(globPath), dir, 'Cargo.toml'))
          : [path.join(globPath, 'Cargo.toml')];

        for (const p of cargoPaths) {
          if (fs.existsSync(p)) {
            const fileContent = fs.readFileSync(p, 'utf8');
            const nameMatch = fileContent.match(/^name\s*=\s*"([^"]+)"/m);
            const parsedName = nameMatch && nameMatch[1] ? nameMatch[1] : '';
            if (parsedName) {
              crateInfos.push({
                name: parsedName,
                memberPath: path.dirname(p),
                content: fileContent,
              });
            }
          }
        }
      }

      for (const info of crateInfos) {
        const relativePath = path.relative(cwd, info.memberPath);
        const relativeCargo = path.join(relativePath, 'Cargo.toml');

        const depends: string[] = [];
        for (const other of crateInfos) {
          if (other.name === info.name) continue;
          const depPattern = new RegExp(`^${other.name}\\s*=`, 'm');
          if (depPattern.test(info.content)) {
            depends.push(other.name);
          }
        }

        configs.push({
          name: info.name,
          watch: [relativePath],
          depends,
          updates: [{ kind: 'toml', path: relativeCargo, toml: 'package.version' }],
        });
      }
    }
  }

  return decorateList(configs);
}

/**
 * Auto-detects whether the directory corresponds to a workspace or single-project setup.
 */
export function cargoDeps(cwd: string): DependencyList {
  const rootCargo = path.join(cwd, 'Cargo.toml');
  if (fs.existsSync(rootCargo)) {
    const content = fs.readFileSync(rootCargo, 'utf8');
    if (content.includes('members =')) {
      return cargoWorkspace(cwd);
    }
    if (content.includes('package =') || content.match(/^name\s*=/m)) {
      return cargoProject(cwd);
    }
  }
  return decorateList([]);
}

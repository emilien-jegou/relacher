import path from 'node:path';

import type { PackageConfig } from '../types';

export function normalizePosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

export function toPosixRelative(fromDir: string, targetPath: string): string {
  const rel = path.relative(fromDir, targetPath);
  return normalizePosixPath(rel);
}

export function getNestedExcludedPaths(
  currentPkg: PackageConfig,
  allPackages: PackageConfig[],
): string[] {
  const exclude: string[] = [];
  const currentWatches = currentPkg.watch || [];

  for (const other of allPackages) {
    if (other.name === currentPkg.name) continue;

    const isCoupled =
      (currentPkg.coupled || []).includes(other.name) ||
      (other.coupled || []).includes(currentPkg.name) ||
      (Boolean(currentPkg.group) && currentPkg.group === other.group);

    if (isCoupled) continue;

    for (const wp of currentWatches) {
      const wpNorm = path.normalize(wp).replace(/\\/g, '/');
      for (const owp of other.watch || []) {
        const owpNorm = path.normalize(owp).replace(/\\/g, '/');
        const relative = path.relative(wpNorm, owpNorm);
        const isNested =
          relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
        if (isNested) {
          exclude.push(owp);
        }
      }
    }
  }

  return exclude;
}

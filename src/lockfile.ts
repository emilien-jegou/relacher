import fs from 'node:fs';
import path from 'node:path';

import type { DependencyUpdateReport } from './types';

export interface LockfileData {
  packages: Record<
    string,
    {
      version: string;
      lastStableVersion?: string;
    }
  >;
}

export function readLockfile(cwd: string): LockfileData {
  const lockPath = path.resolve(cwd, '.relacher.lock');
  if (fs.existsSync(lockPath)) {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      return { packages: {} };
    }
  }
  return { packages: {} };
}

export function writeLockfile(cwd: string, data: LockfileData): void {
  const lockPath = path.resolve(cwd, '.relacher.lock');
  fs.writeFileSync(lockPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function updateLockfile(cwd: string, reports: DependencyUpdateReport[]): void {
  const lockfile = readLockfile(cwd);
  if (!lockfile.packages) {
    lockfile.packages = {};
  }
  for (const dep of reports) {
    if (dep.bump !== 'skip') {
      const isPrerelease = dep.newVersion.includes('-');
      const previousEntry = lockfile.packages[dep.name];

      let lastStable = previousEntry?.lastStableVersion || previousEntry?.version;
      if (!isPrerelease) {
        lastStable = dep.newVersion;
      }

      lockfile.packages[dep.name] = {
        version: dep.newVersion,
        lastStableVersion: lastStable,
      };
    }
  }
  writeLockfile(cwd, lockfile);
}

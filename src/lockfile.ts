import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import type { DependencyUpdateReport } from './types';
import type { VcsError, VcsProvider } from './vcs';
import { inferLastStableVersion } from './versioning/semver';

export interface LockfilePackageEntry {
  version: string;
  lastStableVersion?: string;
}

export interface LockfileData {
  packages: Record<string, LockfilePackageEntry>;
}

export const LOCKFILE_NAME = '.relacher.lock';

export function readLockfile(cwd: string): LockfileData {
  const lockPath = path.resolve(cwd, LOCKFILE_NAME);
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
  const lockPath = path.resolve(cwd, LOCKFILE_NAME);
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

      let lastStable =
        previousEntry?.lastStableVersion ||
        previousEntry?.version ||
        dep.lastStableVersion ||
        (dep.currentVersion && !dep.currentVersion.includes('-')
          ? dep.currentVersion
          : inferLastStableVersion(dep.currentVersion));

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

export function findLastReleaseCommit(
  vcs: VcsProvider,
  packageName: string,
  targetVersion: string,
): Effect.Effect<string | null, VcsError> {
  return Effect.gen(function* () {
    if (!vcs.getFileHistoryCommits || !vcs.getFileAtCommit) {
      return null;
    }

    const hashes = yield* vcs.getFileHistoryCommits(LOCKFILE_NAME);
    if (hashes.length === 0) return null;

    let foundMatch = false;
    let earliestMatchingHash: string | null = null;

    // Hashes are ordered from newest to oldest
    for (const hash of hashes) {
      const content = yield* vcs.getFileAtCommit(LOCKFILE_NAME, hash);
      if (!content) continue;

      try {
        const data = JSON.parse(content) as LockfileData;
        const version = data.packages?.[packageName]?.version;

        if (version === targetVersion) {
          foundMatch = true;
          earliestMatchingHash = hash;
        } else if (foundMatch) {
          // Reached an older version before targetVersion was introduced
          return earliestMatchingHash;
        }
      } catch {
        if (foundMatch) return earliestMatchingHash;
      }
    }

    return earliestMatchingHash;
  }) as Effect.Effect<string | null, VcsError>;
}

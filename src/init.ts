import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import { log } from './display';
import { LOCKFILE_NAME, writeLockfile, type LockfileData } from './lockfile';
import type { PackageConfig } from './types';
import { VcsProviderService, type VcsProvider } from './vcs';

export function init(
  packages: PackageConfig[],
  options: { cwd?: string } = {},
): Effect.Effect<void, Error, VcsProvider> {
  return Effect.gen(function* () {
    const cwd = options.cwd || process.cwd();
    const lockPath = path.resolve(cwd, LOCKFILE_NAME);

    if (fs.existsSync(lockPath)) return;

    const vcs = yield* VcsProviderService;
    const isDirty = yield* vcs.isDirty();
    if (isDirty) {
      return yield* Effect.fail(
        new Error('Cannot initialize lockfile: repository has dirty status.'),
      );
    }

    const lockfile: LockfileData = { packages: {} };
    let warnFlag = false;

    for (const pkg of packages) {
      let version = '0.0.0';
      if (pkg.versionFallback) {
        try {
          const fallback = pkg.versionFallback.readFallback(cwd);
          if (fallback) version = fallback;
        } catch {
          log.warn(`Version fallback failed for package ${pkg.name}`);
          warnFlag = true;
        }
      }

      const isPrerelease = version.includes('-');
      lockfile.packages[pkg.name] = {
        version,
        lastStableVersion: isPrerelease ? undefined : version,
      };
    }

    if (warnFlag) {
      log.warn(
        'One or more package failed to retrieve their version, update .relacher.lockfile manually.',
      );
    }

    writeLockfile(cwd, lockfile);
    yield* vcs.commit('chore: initialize .relacher.lock\n\nInitialized package versions.');
  }) as Effect.Effect<void, Error, VcsProvider>;
}

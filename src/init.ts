import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import { log } from './display';
import { writeLockfile, type LockfileData } from './lockfile';
import type { PackageConfig } from './types';
import { VcsProviderService, type VcsProvider } from './vcs';

/**
 * Initializes the `.relacher.lock` file if it does not exist.
 * It resolves the version using each package's `versionFallback`,
 * creates the lockfile, and commits it to establish the baseline.
 */
export function init(
  packages: PackageConfig[],
  options: { cwd?: string } = {},
): Effect.Effect<void, Error, VcsProvider> {
  return Effect.gen(function*() {
    const cwd = options.cwd || process.cwd();
    const lockPath = path.resolve(cwd, '.relacher.lock');

    if (fs.existsSync(lockPath)) {
      return;
    }

    const vcs = yield* VcsProviderService;

    // Check for dirty repository status
    const isDirty = yield* vcs.isDirty();
    if (isDirty) {
      return yield* Effect.fail(
        new Error('Cannot initialize lockfile: repository has dirty status.'),
      );
    }

    const lockfile: LockfileData = { packages: {} };

    let warn_flag = false;
    for (const pkg of packages) {
      let version = '0.0.0';
      if (pkg.versionFallback) {
        try {
          const fallback = pkg.versionFallback.readFallback(cwd);
          if (fallback) {
            version = fallback;
          }
        } catch (_) {
          log.warn(`Version fallback failed for package ${pkg.name}`);
          warn_flag = true;
          // Fall back to default version if reading fails
        }
      }

      const isPrerelease = version.includes('-');
      lockfile.packages[pkg.name] = {
        version,
        lastStableVersion: isPrerelease ? undefined : version,
      };
    }

    if (warn_flag) {
      log.warn(
        'One or more package failed to retrieve their version, update .relacher.lockfile manually.',
      );
    }

    writeLockfile(cwd, lockfile);

    const commitMessage = `chore: initialize .relacher.lock\n\nInitialized package versions from workspace fallbacks.`;
    yield* vcs.commit(commitMessage);
  }) as Effect.Effect<void, Error, VcsProvider>;
}

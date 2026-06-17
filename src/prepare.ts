import fs from 'node:fs';
import path from 'node:path';

import { Effect, Option } from 'effect';

import type {
  Commit,
  PackageConfig,
  DependencyUpdateReport,
  IntermediateReport,
  PrepareOptions,
  PreparedUpdate,
  DependencyError,
} from './types';
import type { UpdateAction, UpdateActionResolved } from './updater';
import { VcsProviderService } from './vcs';
import { VersionManagerService, type VersionManager } from './versioning';
import type { BumpSize } from './versioning/types';

export function isBumpSizeMatch(actual: BumpSize, pattern: BumpSize): boolean {
  if (typeof actual === 'string' && typeof pattern === 'string') {
    return actual === pattern;
  }
  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof pattern === 'object' &&
    pattern !== null
  ) {
    if (actual.kind === 'pre' && pattern.kind === 'pre') {
      if (pattern.size === undefined || pattern.size === null) {
        return true;
      }
      return actual.size === pattern.size;
    }
  }
  return false;
}

export function isUpdateActive(bump: BumpSize, onlyOn?: BumpSize[]): boolean {
  if (!onlyOn) {
    if (typeof bump === 'string') {
      return bump !== 'skip';
    }
    return true;
  }
  return onlyOn.some((b) => isBumpSizeMatch(bump, b));
}

export function topologicalSort(items: IntermediateReport[]): IntermediateReport[] {
  const processed = new Set<string>();
  const processing = new Set<string>();
  const sorted: IntermediateReport[] = [];
  function visit(item: IntermediateReport) {
    if (processing.has(item.name) || processed.has(item.name)) return;
    processing.add(item.name);
    for (const depName of item.depends) {
      const depItem = items.find((r) => r.name === depName);
      if (depItem) visit(depItem);
    }
    processing.delete(item.name);
    processed.add(item.name);
    sorted.push(item);
  }
  items.forEach((item) => visit(item));
  return sorted;
}

export function initReportItems(
  packages: PackageConfig[],
  cwd: string,
  excludeNestedWatches = false,
): Effect.Effect<IntermediateReport[], Error, VersionManager> {
  return Effect.gen(function*() {
    const versionManager = yield* VersionManagerService;
    const reports: IntermediateReport[] = [];
    for (const dep of packages) {
      const {
        version: currentVersion,
        isFallback,
        lastStableVersion,
      } = yield* versionManager.getCurrentVersion(dep, cwd);
      const isMissingVersion = currentVersion === null;
      const actualVersion = currentVersion || '0.0.0';

      const exclude: string[] = [];
      const watchPaths = dep.watch || [];

      if (excludeNestedWatches) {
        for (const other of packages) {
          if (other.name === dep.name) continue;

          const isCoupled =
            ((dep as any).coupled || []).includes(other.name) ||
            ((other as any).coupled || []).includes(dep.name);
          if (isCoupled) continue;

          const otherWatchPaths = other.watch || [];
          for (const wp of watchPaths) {
            const wpNorm = path.normalize(wp).replace(/\\/g, '/');
            for (const owp of otherWatchPaths) {
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
      }

      // Pass cwd to ensure it reads the correct .relacher.lock
      const allCommits = yield* versionManager.getCommits(dep, exclude, cwd);
      let commitsSincePreRelease = [...allCommits];

      // Exclude commits packaged prior to the current pre-released version
      if (versionManager.isRCMode && actualVersion.includes('-')) {
        const releaseIndex = commitsSincePreRelease.findIndex((c) => {
          const message = c.message;
          const normalized = message.toLowerCase();
          if (!normalized.includes('release')) return false;

          const escName = dep.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const escVer = actualVersion.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

          const patterns = [
            new RegExp(`${escName}[-_\\s@]*v?${escVer}`, 'i'),
            new RegExp(`v?${escVer}`, 'i'),
          ];

          return patterns.some((p) => p.test(message));
        });

        if (releaseIndex !== -1) {
          commitsSincePreRelease = commitsSincePreRelease.slice(0, releaseIndex);
        }
      }

      const selfBump = versionManager.evaluateCommitsBump(commitsSincePreRelease);

      let isErroneous = isMissingVersion;
      for (const u of dep.updates || []) {
        if (u._skipIf?.(cwd)) {
          continue;
        }
        const isActive = isUpdateActive(selfBump, u.onlyOn);
        if (isActive && u.required) {
          const filePath = path.resolve(cwd, u.path);
          if (!fs.existsSync(filePath)) {
            isErroneous = true;
            break;
          }
        }
      }

      reports.push({
        name: dep.name,
        currentVersion: actualVersion,
        newVersion: actualVersion,
        lastStableVersion: lastStableVersion || null,
        bump: selfBump,
        originalBump: selfBump,
        commits: allCommits,
        commitsSincePreRelease,
        updates: dep.updates || [],
        depends: dep.depends || [],
        isErroneous,
        isFirstRelease: isFallback,
        coupled: (dep as any).coupled || [],
      } as any);
    }
    return reports;
  }) as Effect.Effect<IntermediateReport[], Error, VersionManager>;
}

export function prepare(
  packages: PackageConfig[] & { errors?: Array<{ name: string; message: string }> },
  options: PrepareOptions = {},
): Effect.Effect<PreparedUpdate, Error, VersionManager> {
  return Effect.gen(function*() {
    // Prevent execution if there are configuration errors in the package list
    if (packages.errors && packages.errors.length > 0) {
      return {
        isEmpty: true,
        deps: [],
        isInvalid: true,
        errors: packages.errors.map((err) => ({
          name: err.name,
          message: err.message,
        })) as DependencyError[],
        isDirty: false,
      };
    }

    const versionManager = yield* VersionManagerService;
    const vcsOption = yield* Effect.serviceOption(VcsProviderService);
    const isDirty = Option.isSome(vcsOption) ? yield* vcsOption.value.isDirty() : false;

    const cwd = options.cwd || process.cwd();

    const items = yield* initReportItems(packages, cwd, options.excludeNestedWatches);
    const sorted = topologicalSort(items);
    versionManager.propagateBumps(sorted);
    versionManager.propagateCoupledBumps(sorted);

    const deps = finalizeReports(sorted, versionManager);

    const isEmpty = deps.every((r) => r.bump === 'skip');
    const erroneousDeps = deps.filter((r) => r.isErroneous);

    if (erroneousDeps.length > 0) {
      return {
        isEmpty,
        deps,
        isInvalid: true,
        errors: erroneousDeps.map((r) => ({
          name: r.name,
          message: `Package ${r.name} is missing a version or a required update file.`,
        })) as DependencyError[],
        isDirty,
      };
    }

    return {
      isEmpty,
      deps,
      isInvalid: false,
      isDirty,
    };
  }) as Effect.Effect<PreparedUpdate, Error, VersionManager>;
}

export function finalizeReports(
  sorted: IntermediateReport[],
  versionManager?: VersionManager,
): DependencyUpdateReport[] {
  const allCommitsMap = new Map<string, Commit>();
  for (const item of sorted) {
    for (const c of item.commits) {
      allCommitsMap.set(c.hash, c);
    }
  }
  const globalCommits = Array.from(allCommitsMap.values());

  return sorted.map((item) => {
    // Git tags are no longer managed, skipping tag operations entirely
    const skipTag = true;

    // Determine the action bump (checking if output is pre-release)
    let actionBump = item.bump;
    if (item.newVersion.includes('-')) {
      const match = item.newVersion.match(/-([a-zA-Z0-9]+)(?:\.\d+)?$/);
      const preSize = match ? match[1] : 'rc';
      actionBump = { kind: 'pre', size: preSize };
    }

    return {
      name: item.name,
      currentVersion: item.currentVersion,
      newVersion: item.newVersion,
      lastStableVersion: item.lastStableVersion,
      bump: item.bump,
      originalBump: item.originalBump,
      commits: item.commits,
      commitsSincePreRelease: item.commitsSincePreRelease,
      updates: mapResolvedUpdates(
        item.updates,
        item.newVersion,
        item.commits,
        globalCommits,
        actionBump,
        item.commitsSincePreRelease,
      ),
      depends: item.depends,
      isErroneous: item.isErroneous,
      isFirstRelease: item.isFirstRelease,
      coupled: (item as any).coupled || [],
      skipTag,
    };
  });
}

export function mapResolvedUpdates(
  updates: UpdateAction[],
  newVersion: string,
  crateCommits: Commit[],
  globalCommits: Commit[],
  bump: BumpSize = 'patch',
  commitsSincePreRelease?: Commit[],
): UpdateActionResolved[] {
  const activeUpdates = updates.filter((u) => isUpdateActive(bump, u.onlyOn));

  return activeUpdates.map((act) =>
    act.prepare({
      newVersion,
      crateCommits,
      globalCommits,
      commitsSincePreRelease,
    } as any),
  );
}

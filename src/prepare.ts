import fs from 'node:fs';
import path from 'node:path';

import { Effect, Option } from 'effect';

import { readLockfile } from './lockfile';
import type {
  Commit,
  DependencyError,
  DependencyUpdateReport,
  IntermediateReport,
  PackageConfig,
  PreparedUpdate,
  PrepareOptions,
} from './types';
import type { UpdateAction, UpdateActionResolved } from './updater';
import { VcsProviderService } from './vcs';
import { VersionManagerService, type VersionManager } from './versioning';
import { isBumpEqual, isPreRelease } from './versioning/bump';
import type { BumpSize } from './versioning/types';
import { getNestedExcludedPaths } from './workspace/paths';

export function isBumpSizeMatch(actual: BumpSize, pattern: BumpSize): boolean {
  if (typeof actual === 'string' && typeof pattern === 'string') {
    return actual === pattern;
  }
  if (isPreRelease(actual) && isPreRelease(pattern)) {
    if (pattern.size === undefined || pattern.size === null) return true;
    return actual.size === pattern.size;
  }
  return false;
}

export function isUpdateActive(bump: BumpSize, onlyOn?: BumpSize[]): boolean {
  if (!onlyOn) {
    return typeof bump === 'string' ? bump !== 'skip' : true;
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

  for (const item of items) {
    visit(item);
  }
  return sorted;
}

function resolvePackageBump(
  name: string,
  evaluatedBump: BumpSize,
  options: PrepareOptions,
): BumpSize {
  // 1. Check specific package overrides
  if (options.forcePackages && name in options.forcePackages) {
    return options.forcePackages[name]!;
  }

  // 2. Check global force flag
  if (options.force) {
    if (typeof options.force === 'boolean') {
      return evaluatedBump === 'skip' ? 'patch' : evaluatedBump;
    }
    return options.force;
  }

  return evaluatedBump;
}

export function initReportItems(
  packages: PackageConfig[],
  cwd: string,
  options: PrepareOptions = {},
): Effect.Effect<IntermediateReport[], Error, VersionManager> {
  return Effect.gen(function* () {
    const versionManager = yield* VersionManagerService;
    const cachedLockfile = readLockfile(cwd);
    const reports: IntermediateReport[] = [];

    for (const dep of packages) {
      const {
        version: currentVersion,
        isFallback,
        lastStableVersion,
      } = versionManager.getCurrentVersion(dep, cachedLockfile, cwd);

      const isMissingVersion = currentVersion === null;
      const actualVersion = currentVersion || '0.0.0';

      const exclude = options.excludeNestedWatches ? getNestedExcludedPaths(dep, packages) : [];
      const allCommits = yield* versionManager.getCommits(dep, cachedLockfile, exclude, cwd);
      let commitsSincePreRelease = [...allCommits];

      if (versionManager.isRCMode && actualVersion.includes('-')) {
        const releaseIndex = commitsSincePreRelease.findIndex((c) =>
          c.message.toLowerCase().includes(`release:`) && c.message.includes(actualVersion),
        );
        if (releaseIndex !== -1) {
          commitsSincePreRelease = commitsSincePreRelease.slice(0, releaseIndex);
        }
      }

      let selfBump = versionManager.evaluateCommitsBump(commitsSincePreRelease);

      // If graduating an existing pre-release to stable (e.g. 1.1.0-rc.0 -> 1.1.0),
      // ensure it is never skipped even if no new commits were added after the RC was cut.
      if (!versionManager.isRCMode && actualVersion.includes('-') && selfBump === 'skip') {
        selfBump = 'patch';
      }

      selfBump = resolvePackageBump(dep.name, selfBump, options);

      let isErroneous = isMissingVersion;
      for (const u of dep.updates || []) {
        if (u.shouldSkip(cwd)) continue;
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
        coupled: dep.coupled || [],
        group: dep.group,
        isErroneous,
        isFirstRelease: isFallback,
      });
    }

    return reports;
  }) as Effect.Effect<IntermediateReport[], Error, VersionManager>;
}

export function prepare(
  packages: PackageConfig[] & { errors?: Array<{ name: string; message: string }> },
  options: PrepareOptions = {},
): Effect.Effect<PreparedUpdate, Error, VersionManager> {
  return Effect.gen(function* () {
    if (packages.errors && packages.errors.length > 0) {
      return {
        isEmpty: true,
        deps: [],
        isInvalid: true,
        errors: packages.errors.map((err) => ({
          name: err.name,
          message: err.message,
        })),
        isDirty: false,
      };
    }

    const versionManager = yield* VersionManagerService;
    const vcsOption = yield* Effect.serviceOption(VcsProviderService);
    const isDirty = Option.isSome(vcsOption) ? yield* vcsOption.value.isDirty() : false;

    const cwd = options.cwd || process.cwd();

    // Packages passed in were already validated and tracked by the builder.
    const items = yield* initReportItems(packages, cwd, options);
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
        })),
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
    let actionBump = item.bump;
    if (item.newVersion.includes('-')) {
      const match = item.newVersion.match(/-([a-zA-Z0-9]+)(?:\.\d+)?$/);
      const preSize = match ? match[1] : 'rc';
      actionBump = { kind: 'pre', size: preSize };
    }

    const skipTag = versionManager ? !versionManager.shouldTag(item.newVersion) : true;

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
      coupled: item.coupled || [],
      group: item.group,
      isErroneous: item.isErroneous,
      isFirstRelease: item.isFirstRelease,
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
  return updates
    .filter((u) => isUpdateActive(bump, u.onlyOn))
    .map((act) =>
      act.prepare({
        newVersion,
        crateCommits,
        globalCommits,
        commitsSincePreRelease,
      }),
    );
}

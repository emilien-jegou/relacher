import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import type {
  Commit,
  DependencyConfig,
  DependencyUpdateReport,
  IntermediateReport,
  PrepareOptions,
} from './types';
import type { UpdateAction, UpdateActionResolved } from './updater';
import { VersionManagerService, type VersionManager } from './versioning';
import type { BumpSize } from './versioning/types';

export function isBumpSizeMatch(actual: BumpSize, pattern: BumpSize): boolean {
  if (typeof actual === 'string' && typeof pattern === 'string') {
    return actual === pattern;
  }
  if (typeof actual === 'object' && actual !== null && typeof pattern === 'object' && pattern !== null) {
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
  cargoDeps: DependencyConfig[],
  cwd: string,
  excludeNestedWatches = false,
): Effect.Effect<IntermediateReport[], Error, VersionManager> {
  return Effect.gen(function*() {
    const versionManager = yield* VersionManagerService;
    const reports: IntermediateReport[] = [];
    for (const dep of cargoDeps) {
      const { version: currentVersion, isFallback, lastStableVersion } = yield* versionManager.getCurrentVersion(
        dep,
        cwd,
      );
      const isMissingVersion = currentVersion === null;
      const actualVersion = currentVersion || '0.0.0';

      const exclude: string[] = [];
      const watchPaths = dep.watch || [];

      if (excludeNestedWatches) {
        for (const other of cargoDeps) {
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

      const allCommits = yield* versionManager.getCommits(dep, exclude);
      let commitsSincePreRelease = [...allCommits];

      // Exclude commits packaged prior to the current pre-released version
      if (versionManager.isRCMode && actualVersion.includes('-')) {
        const releaseIndex = commitsSincePreRelease.findIndex((c) => {
          const message = c.message;
          const normalized = message.toLowerCase();
          if (!normalized.includes('release')) return false;

          const escName = dep.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const escVer = actualVersion.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

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
  cargoDeps: DependencyConfig[],
  options: PrepareOptions = {},
): Effect.Effect<DependencyUpdateReport[], Error, VersionManager> {
  return Effect.gen(function*() {
    const versionManager = yield* VersionManagerService;
    const cwd = options.cwd || process.cwd();

    const items = yield* initReportItems(cargoDeps, cwd, options.excludeNestedWatches);
    const sorted = topologicalSort(items);
    versionManager.propagateBumps(sorted);
    versionManager.propagateCoupledBumps(sorted);

    return finalizeReports(sorted, versionManager.isRCMode, versionManager);
  }) as Effect.Effect<DependencyUpdateReport[], Error, VersionManager>;
}

export function finalizeReports(
  sorted: IntermediateReport[],
  isRCMode: boolean,
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
    const skipTag = versionManager && versionManager.shouldTag ? !versionManager.shouldTag(item.newVersion) : false;

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
        isRCMode,
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
  isRCMode?: boolean,
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

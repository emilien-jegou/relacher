import { Effect, Layer } from 'effect';

import { readLockfile } from '../lockfile';
import { VcsProviderService, type VcsProvider } from '../vcs';

import { defaultCascadeRules, defaultSizes } from './default-data';
import type { BumpSize, CascadeRules, SizePatterns } from './types';
import { defaultBumpVersion, matchBumpSize } from './utils';

import { VersionManagerService } from '.';

const getBumpPriority = (bump: BumpSize): number => {
  if (typeof bump === 'string') {
    if (bump === 'major') return 4;
    if (bump === 'minor') return 3;
    if (bump === 'patch') return 2;
    return 0; // skip
  }
  if (bump && bump.kind === 'pre') {
    return 1;
  }
  return 0;
};

const isBumpSizeEqual = (a: BumpSize, b: BumpSize): boolean => {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    if (a.kind === 'pre' && b.kind === 'pre') {
      return a.size === b.size;
    }
  }
  return false;
};

const getBumpSizeByPriority = (priorityValue: number, originalBump: BumpSize): BumpSize => {
  if (priorityValue === 4) return 'major';
  if (priorityValue === 3) return 'minor';
  if (priorityValue === 2) return 'patch';
  if (priorityValue === 1) {
    if (typeof originalBump === 'object' && originalBump !== null && originalBump.kind === 'pre') {
      return originalBump;
    }
    return { kind: 'pre' };
  }
  return 'skip';
};

const isVersionGreater = (v1: string, v2: string): boolean => {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number);
  const parts2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return true;
    if (p1 < p2) return false;
  }
  return false;
};

export const makeVcsVersionManager = (
  vcs: VcsProvider,
  options?: {
    sizes?: SizePatterns;
    cascade?: CascadeRules;
    bumpVersionImpl?: (version: string, size: BumpSize) => string;
    isRCMode?: boolean;
    tagPrereleases?: boolean;
  },
) => {
  const sizes = options?.sizes ?? defaultSizes;
  const cascadeRules = options?.cascade ?? {};
  const bumpVersionImpl = options?.bumpVersionImpl ?? defaultBumpVersion;
  const isRCMode = options?.isRCMode ?? false;
  const tagPrereleases = options?.tagPrereleases ?? false;

  return VersionManagerService.of({
    isRCMode,
    tagPrereleases,

    shouldTag: (version: string) => {
      const isPrerelease = version.includes('-');
      return !isPrerelease || tagPrereleases;
    },

    getCurrentVersion: (dep, cwd) =>
      Effect.sync(() => {
        const lockfile = readLockfile(cwd);
        const entry = lockfile.packages?.[dep.name];
        const lockVersion = entry?.version ?? null;
        const lastStableFromLock = entry?.lastStableVersion ?? lockVersion;

        let fallbackVersion: string | null = null;
        if (dep.versionFallback) {
          fallbackVersion = dep.versionFallback.readFallback(cwd);
        }

        // Prioritize workspace fallback if it holds a pre-release version equal to or exceeding the lock base
        if (fallbackVersion && lockVersion) {
          const isFallbackRC = fallbackVersion.includes('-');
          if (isFallbackRC) {
            const fallbackBase = fallbackVersion.split('-')[0] || '';
            const lockBase = lockVersion.split('-')[0] || '';
            if (fallbackBase === lockBase || isVersionGreater(fallbackBase, lockBase)) {
              return {
                version: fallbackVersion,
                isFallback: false,
                lastStableVersion: lastStableFromLock,
              };
            }
          }
        }

        if (lockVersion) {
          return { version: lockVersion, isFallback: false, lastStableVersion: lastStableFromLock };
        }

        if (fallbackVersion) {
          return { version: fallbackVersion, isFallback: true, lastStableVersion: null };
        }

        return { version: null, isFallback: false, lastStableVersion: null };
      }),

    getCommits: (dep, excludePaths, cwd) => {
      const lockfile = readLockfile(cwd);
      const entry = lockfile.packages?.[dep.name];
      const lockVersion = entry?.version ?? null;

      if (!lockVersion) {
        return vcs.getCommits(dep.name, dep.watch || [], null, excludePaths);
      }

      return vcs
        .findLastReleaseCommit(dep.name, lockVersion)
        .pipe(
          Effect.flatMap((lastCommit) =>
            vcs.getCommits(dep.name, dep.watch || [], lastCommit, excludePaths),
          ),
        );
    },

    evaluateCommitsBump: (commits) => {
      let maxBump: BumpSize = 'skip';
      for (const commit of commits) {
        const commitBump = matchBumpSize(commit.message, sizes);
        if (getBumpPriority(commitBump) > getBumpPriority(maxBump)) {
          maxBump = commitBump;
        }
      }
      return maxBump;
    },

    propagateBumps: (sorted) => {
      const activeRules: Record<string, BumpSize> = {
        patch: 'patch',
        minor: 'patch',
        major: 'patch',
      };

      // Helper to merge cascade rules from both flat and legacy nested structures defensively
      const mergeRules = (rules: any) => {
        if (!rules) return;
        for (const [key, val] of Object.entries(rules)) {
          if (typeof val === 'string') {
            activeRules[key] = val as BumpSize;
          } else if (val && typeof val === 'object') {
            for (const [subKey, subVal] of Object.entries(val)) {
              if (typeof subVal === 'string') {
                activeRules[subKey] = subVal as BumpSize;
              }
            }
          }
        }
      };

      mergeRules(defaultCascadeRules);
      mergeRules(cascadeRules);

      for (const item of sorted) {
        let maxCascadedBump: BumpSize = 'skip';

        for (const depName of item.depends) {
          const depItem = sorted.find((r) => r.name === depName);
          if (depItem && depItem.bump !== 'skip') {
            const depBumpKey =
              typeof depItem.bump === 'string'
                ? depItem.bump
                : depItem.bump.kind === 'pre'
                  ? depItem.bump.size
                    ? `pre-${depItem.bump.size}`
                    : 'pre'
                  : 'patch';

            const cascadedResult = activeRules[depBumpKey];
            if (
              cascadedResult &&
              getBumpPriority(cascadedResult) > getBumpPriority(maxCascadedBump)
            ) {
              maxCascadedBump = cascadedResult;
            }
          }
        }

        // Apply the cascaded bump only if its priority exceeds the package's existing bump
        if (getBumpPriority(maxCascadedBump) > getBumpPriority(item.bump)) {
          item.bump = maxCascadedBump;
        }

        item.newVersion =
          item.bump !== 'skip'
            ? bumpVersionImpl(item.currentVersion, item.bump)
            : item.currentVersion;
      }
    },

    propagateCoupledBumps: (sorted) => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of sorted) {
          const coupledNames = (item as any).coupled || [];
          for (const name of coupledNames) {
            const other = sorted.find((r) => r.name === name);
            if (other) {
              const itemPri = getBumpPriority(item.bump);
              const otherPri = getBumpPriority(other.bump);
              const maxPriority = Math.max(itemPri, otherPri);

              let targetBump: BumpSize;
              if (maxPriority === itemPri) {
                targetBump = item.bump;
              } else if (maxPriority === otherPri) {
                targetBump = other.bump;
              } else {
                targetBump = getBumpSizeByPriority(maxPriority, item.bump);
              }

              if (!isBumpSizeEqual(item.bump, targetBump)) {
                item.bump = targetBump;
                changed = true;
              }
              if (!isBumpSizeEqual(other.bump, targetBump)) {
                other.bump = targetBump;
                changed = true;
              }
            }
          }
        }
      }

      for (const item of sorted) {
        item.newVersion =
          item.bump !== 'skip'
            ? bumpVersionImpl(item.currentVersion, item.bump)
            : item.currentVersion;
      }
    },

    bumpVersion: (currentVersion, size) => bumpVersionImpl(currentVersion, size),
  });
};

export const VcsVersionManagerLive = (options?: { sizes?: SizePatterns; cascade?: CascadeRules }) =>
  Layer.effect(
    VersionManagerService,
    Effect.gen(function*() {
      const vcs = yield* VcsProviderService;
      return makeVcsVersionManager(vcs, options);
    }),
  );

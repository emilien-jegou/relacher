import { Context, Effect, Layer } from 'effect';

import { findLastReleaseCommit, type LockfileData } from '../lockfile';
import type { Commit, IntermediateReport, PackageConfig } from '../types';
import { VcsProviderService, type VcsProvider } from '../vcs';

import {
  getBumpByPriority,
  getBumpPriority,
  isBumpEqual,
  isBumpGreater,
  isPreRelease,
} from './bump';
import { defaultCascadeRules, defaultSizes } from './default-data';
import type { BumpSize, CascadeRules, SizePatterns } from './types';
import { defaultBumpVersion, isVersionGreater, matchBumpSize } from './utils';

export interface VersionManager {
  readonly isRCMode: boolean;
  readonly tagPrereleases: boolean;
  readonly getCurrentVersion: (
    dep: PackageConfig,
    cachedLockfile: LockfileData,
    cwd: string,
  ) => { version: string | null; isFallback: boolean; lastStableVersion?: string | null };
  readonly getCommits: (
    dep: PackageConfig,
    cachedLockfile: LockfileData,
    excludePaths: string[],
    cwd: string,
  ) => Effect.Effect<Commit[], Error>;
  readonly evaluateCommitsBump: (commits: Commit[]) => BumpSize;
  readonly propagateBumps: (sorted: IntermediateReport[]) => void;
  readonly propagateCoupledBumps: (sorted: IntermediateReport[]) => void;
  readonly bumpVersion: (currentVersion: string, size: BumpSize) => string;
  readonly shouldTag: (version: string) => boolean;
}

export const VersionManagerService = Context.Service<VersionManager>('VersionManager');

export const makeVcsVersionManager = (
  vcs: VcsProvider,
  options?: {
    sizes?: SizePatterns;
    cascade?: CascadeRules;
    bumpVersionImpl?: (version: string, size: BumpSize) => string;
    isRCMode?: boolean;
    tagPrereleases?: boolean;
  },
): VersionManager => {
  const sizes = options?.sizes ?? defaultSizes;
  const cascadeRules = options?.cascade ?? {};
  const bumpVersionImpl = options?.bumpVersionImpl ?? defaultBumpVersion;
  const isRCMode = options?.isRCMode ?? false;
  const tagPrereleases = options?.tagPrereleases ?? false;

  return VersionManagerService.of({
    isRCMode,
    tagPrereleases,

    shouldTag: (version: string) => !version.includes('-') || tagPrereleases,

    getCurrentVersion: (dep, lockfile, cwd) => {
      const entry = lockfile.packages?.[dep.name];
      const lockVersion = entry?.version ?? null;
      const lastStableFromLock = entry?.lastStableVersion ?? lockVersion;

      let fallbackVersion: string | null = null;
      if (dep.versionFallback) {
        fallbackVersion = dep.versionFallback.readFallback(cwd);
      }

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
    },

    getCommits: (dep, lockfile, excludePaths) => {
      const entry = lockfile.packages?.[dep.name];
      const lockVersion = entry?.version ?? null;

      if (!lockVersion) {
        return vcs.getCommits(dep.watch || [], null, excludePaths);
      }

      // In stable release mode, if the package was in pre-release (e.g. 1.1.0-rc.0),
      // we query commits since the last STABLE version (e.g. 1.0.0) so that all commits
      // developed during the RC cycle are included in the final changelog and bump.
      const targetVersion =
        !isRCMode && lockVersion.includes('-') && entry?.lastStableVersion
          ? entry.lastStableVersion
          : lockVersion;

      const findCommitEffect =
        typeof vcs.findLastReleaseCommit === 'function'
          ? vcs.findLastReleaseCommit(dep.name, targetVersion)
          : findLastReleaseCommit(vcs, dep.name, targetVersion);

      return findCommitEffect.pipe(
        Effect.flatMap((lastCommit) =>
          vcs.getCommits(dep.watch || [], lastCommit, excludePaths),
        ),
      );
    },

    evaluateCommitsBump: (commits) => {
      let max: BumpSize = 'skip';
      for (const commit of commits) {
        const commitBump = matchBumpSize(commit.message, sizes);
        if (isBumpGreater(commitBump, max)) {
          max = commitBump;
        }
      }
      return max;
    },

    propagateBumps: (sorted) => {
      const activeRules: Record<string, BumpSize> = {
        patch: 'patch',
        minor: 'patch',
        major: 'patch',
      };

      const mergeRules = (rules: CascadeRules | undefined) => {
        if (!rules) return;
        for (const [key, val] of Object.entries(rules)) {
          if (typeof val === 'string' || (typeof val === 'object' && val !== null)) {
            activeRules[key] = val;
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
                : isPreRelease(depItem.bump)
                  ? depItem.bump.size
                    ? `pre-${depItem.bump.size}`
                    : 'pre'
                  : 'patch';

            const cascadedResult = activeRules[depBumpKey];
            if (cascadedResult && isBumpGreater(cascadedResult, maxCascadedBump)) {
              maxCascadedBump = cascadedResult;
            }
          }
        }

        if (isBumpGreater(maxCascadedBump, item.bump)) {
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
          const coupledNames = item.coupled || [];
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
                targetBump = getBumpByPriority(
                  maxPriority,
                  isPreRelease(item.bump) ? item.bump : undefined,
                );
              }

              if (!isBumpEqual(item.bump, targetBump)) {
                item.bump = targetBump;
                changed = true;
              }
              if (!isBumpEqual(other.bump, targetBump)) {
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
    Effect.gen(function* () {
      const vcs = yield* VcsProviderService;
      return makeVcsVersionManager(vcs, options);
    }),
  );

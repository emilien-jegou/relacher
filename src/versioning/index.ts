import { Context, Effect } from 'effect';

import type { Commit, PackageConfig, IntermediateReport } from '../types';

import type { BumpSize } from './types';

// 1. Service Interface Definition (Sync returns restored for non-IO methods)
export interface VersionManager {
  readonly isRCMode: boolean;
  readonly tagPrereleases: boolean;
  readonly getCurrentVersion: (
    dep: PackageConfig,
    cwd: string,
  ) => Effect.Effect<
    { version: string | null; isFallback: boolean; lastStableVersion?: string | null },
    Error
  >;
  readonly getCommits: (
    dep: PackageConfig,
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

export * from './vcs-version-manager';
export * from './rc-version-manager';

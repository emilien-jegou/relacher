import type { UpdateAction, UpdateActionResolved, VersionFallback } from './updater';
import type { BumpSize } from './versioning/types';

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  type: string;
  scope: string | null;
  isBreaking: boolean;
  description: string;
}

export interface ChangelogContext {
  version: string;
  date: string;
  commits: Commit[];
  commitsSincePreRelease?: Commit[];
}

export interface PackageConfig {
  name: string;
  watch?: string[];
  updates: UpdateAction[];
  versionFallback?: VersionFallback;
  depends?: string[];
}

export interface PrepareOptions {
  cwd?: string;
  excludeNestedWatches?: boolean;
}

export interface DependencyError {
  name: string;
  message: string;
}

export type PreparedUpdate = {
  isEmpty: boolean;
  deps: DependencyUpdateReport[];
  isDirty?: boolean;
} & ({ isInvalid: true; errors: DependencyError[] } | { isInvalid: false });

export interface DependencyUpdateReport {
  name: string;
  currentVersion: string;
  lastStableVersion?: string | null;
  newVersion: string;
  bump: BumpSize;
  originalBump?: BumpSize;
  commits: Commit[];
  commitsSincePreRelease?: Commit[];
  updates: UpdateActionResolved[];
  depends?: string[];
  skipTag?: boolean;
  isErroneous?: boolean;
  isFirstRelease?: boolean;
}

export interface IntermediateReport {
  name: string;
  currentVersion: string;
  newVersion: string;
  bump: BumpSize;
  lastStableVersion?: string | null;
  originalBump?: BumpSize;
  commits: Commit[];
  commitsSincePreRelease?: Commit[];
  updates: UpdateAction[];
  depends: string[];
  isErroneous?: boolean;
  isFirstRelease?: boolean;
}

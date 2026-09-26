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
  manifestPath?: string;
  watch?: string[];
  updates: UpdateAction[];
  versionFallback?: VersionFallback;
  depends?: string[];
  coupled?: string[];
  group?: string;
}

// In src/types.ts:
export interface PrepareOptions {
  cwd?: string;
  excludeNestedWatches?: boolean;
  /** Force a bump size across all packages (e.g. true for patch, or 'minor' / 'major') */
  force?: boolean | BumpSize;
  /** Selectively force bump sizes for specific packages */
  forcePackages?: Record<string, BumpSize>;
}

export interface PrepareOptions {
  cwd?: string;
  excludeNestedWatches?: boolean;
}

export interface DependencyError {
  name: string;
  message: string;
}

export interface BaseReport<TUpdates> {
  name: string;
  currentVersion: string;
  newVersion: string;
  lastStableVersion?: string | null;
  bump: BumpSize;
  originalBump?: BumpSize;
  commits: Commit[];
  commitsSincePreRelease?: Commit[];
  updates: TUpdates;
  depends: string[];
  coupled?: string[];
  group?: string;
  isErroneous?: boolean;
  isFirstRelease?: boolean;
}

export type IntermediateReport = BaseReport<UpdateAction[]>;

export interface DependencyUpdateReport extends BaseReport<UpdateActionResolved[]> {
  skipTag?: boolean;
}

export type PreparedUpdate = {
  isEmpty: boolean;
  deps: DependencyUpdateReport[];
  isDirty?: boolean;
} & (
  | { isInvalid: true; errors: DependencyError[] }
  | { isInvalid: false; errors?: DependencyError[] }
);

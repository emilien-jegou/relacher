import type { UpdateAction, UpdateActionResolved, VersionFallback } from './updater';
import type { VcsProvider } from './vcs';

export type BumpSize = 'major' | 'minor' | 'patch' | 'skip';

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string; // The full commit message
  type: string; // e.g., 'feat', 'fix', 'chore'
  scope: string | null; // e.g., 'ui', 'api'
  isBreaking: boolean; // true if contains '!' or 'BREAKING CHANGE'
  description: string; // The text after the colon
}

export interface ChangelogContext {
  version: string;
  date: string;
  commits: Commit[];
}

export interface DependencyConfig {
  name: string;
  watch?: string[];
  updates: UpdateAction[];
  versionFallback?: VersionFallback;
  depends?: string[];
}

export interface PatternConfig {
  pattern: string;
}

export interface SizePatterns {
  major: PatternConfig;
  minor: PatternConfig;
  patch: PatternConfig;
  skip: PatternConfig;
}

export interface CascadeRules {
  skip?: Record<BumpSize, BumpSize>;
  patch?: Record<BumpSize, BumpSize>;
  minor?: Record<BumpSize, BumpSize>;
  major?: Record<BumpSize, BumpSize>;
}

/**
 * Configuration options for the `prepare` process.
 */
export interface PrepareOptions {
  /**
   * The directory from which to run VCS commands and locate repository files.
   * Defaults to `process.cwd()`.
   *
   * @example
   * ```typescript
   * const options = { cwd: "/path/to/my-workspace" };
   * ```
   */
  cwd?: string;

  /**
   * Custom regular expression patterns to match commit messages and categorize
   * them into Semantic Versioning bump sizes (major, minor, patch, or skip).
   *
   * @example
   * ```typescript
   * const options = {
   *   sizes: {
   *     major: { pattern: "^BREAKING CHANGE" },
   *     minor: { pattern: "^feat|^revert" },
   *     patch: { pattern: "^fix|^refactor" },
   *     skip: { pattern: "^chore|^docs" }
   *   }
   * };
   * ```
   */
  sizes?: SizePatterns;

  /**
   * Custom cascade rules defining how semver bumps propagate upwards from
   * dependencies to parent packages.
   *
   * For example, this decides if a `minor` bump in a sub-crate should trigger a
   * `patch` bump in the workspace root package.
   *
   * @example
   * ```typescript
   * const options = {
   *   cascade: {
   *     skip: { major: "patch", minor: "patch", patch: "patch" },
   *     patch: { major: "patch", minor: "patch", patch: "patch" },
   *     minor: { major: "minor", minor: "minor", patch: "minor" },
   *     major: { major: "major", minor: "major", patch: "major" }
   *   }
   * };
   * ```
   */
  cascade?: CascadeRules;

  /**
   * Automatically subtract watch paths of sub-packages when they are physically nested
   * inside a parent package's watch path (unless they are explicitly coupled).
   *
   * This prevents commits made strictly inside a sub-package (such as a procedural macro
   * crate inside its parent crate folder) from incorrectly triggering a commit-based bump
   * on the parent package itself.
   *
   * @example
   * ```typescript
   * const options = { excludeNestedWatches: true };
   * ```
   */
  excludeNestedWatches?: boolean;
}

export interface DependencyUpdateReport {
  name: string;
  currentVersion: string;
  newVersion: string;
  bump: BumpSize;
  originalBump?: BumpSize;
  commits: Commit[];
  updates: UpdateActionResolved[];
  depends?: string[];
  isErroneous?: boolean;
  isFirstRelease?: boolean;
}

export interface IntermediateReport {
  name: string;
  currentVersion: string;
  newVersion: string;
  bump: BumpSize;
  originalBump?: BumpSize;
  commits: Commit[];
  updates: UpdateAction[];
  depends: string[];
  isErroneous?: boolean;
  isFirstRelease?: boolean;
}

export type { VcsProvider };

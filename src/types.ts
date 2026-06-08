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

export interface PrepareOptions {
  sizes?: SizePatterns;
  cascade?: CascadeRules;
  cwd?: string;
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

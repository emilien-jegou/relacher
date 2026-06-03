import type { VcsProvider } from './vcs';

export type BumpSize = "major" | "minor" | "patch" | "skip";

export interface Commit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;          // The full commit message
  type: string;             // e.g., 'feat', 'fix', 'chore'
  scope: string | null;     // e.g., 'ui', 'api'
  isBreaking: boolean;      // true if contains '!' or 'BREAKING CHANGE'
  description: string;      // The text after the colon
}

export interface ChangelogContext {
  version: string;
  date: string;
  commits: Commit[];
}

export interface ChangelogUpdate {
  kind: "changelog";
  path: string;
  global?: boolean;
  template?: (ctx: ChangelogContext) => string;
  resolvedBlock?: string;
}

export interface TomlUpdate {
  kind: "toml";
  path: string;
  toml: string;
}

export interface RegexUpdate {
  kind: "regex";
  path: string;
  search: string;
  replace: string;
  resolvedReplace?: string;
}

export type UpdateAction = TomlUpdate | RegexUpdate | ChangelogUpdate;

export interface DependencyConfig {
  name: string;
  watch?: string[];
  updates?: UpdateAction[];
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
  updates: UpdateAction[];
  depends?: string[];
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
}

export const defaultSizes: SizePatterns = {
  major: { pattern: "^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE" },
  minor: { pattern: "^feat|^revert" },
  patch: { pattern: "^fix|^build|^refactor|^nit|^style" },
  skip: { pattern: "^release|^chore|^infra|^docs|^test|^ci|^build" },
};

export const defaultCascadeRules: Required<CascadeRules> = {
  skip: { skip: 'skip', patch: 'patch', minor: 'patch', major: 'patch' },
  patch: { skip: 'patch', patch: 'patch', minor: 'minor', major: 'minor' },
  minor: { skip: 'minor', patch: 'minor', minor: 'minor', major: 'minor' },
  major: { skip: 'major', patch: 'major', minor: 'major', major: 'major' },
};

export type { VcsProvider };

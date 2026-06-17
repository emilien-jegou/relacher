export type PreRelease = { kind: 'pre'; size?: string };
export type BumpSize = 'major' | 'minor' | 'patch' | PreRelease | 'skip';

export interface PatternConfig {
  pattern: string;
}

export interface SizePatterns {
  major: PatternConfig;
  minor: PatternConfig;
  patch: PatternConfig;
  skip: PatternConfig;
}

export type CascadeRules = Record<string, BumpSize>;

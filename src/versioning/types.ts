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

export interface CascadeRules {
  skip?: Record<string, BumpSize>;
  patch?: Record<string, BumpSize>;
  minor?: Record<string, BumpSize>;
  major?: Record<string, BumpSize>;
  [key: string]: Record<string, BumpSize> | undefined;
}

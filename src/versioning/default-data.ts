import type { CascadeRules, SizePatterns } from './types';

export const defaultSizes: SizePatterns = {
  major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
  minor: { pattern: '^feat|^revert' },
  patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
  skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
};

export const defaultCascadeRules: Required<CascadeRules> = {
  skip: { skip: 'skip', patch: 'patch', minor: 'patch', major: 'patch' },
  patch: { skip: 'patch', patch: 'patch', minor: 'minor', major: 'minor' },
  minor: { skip: 'minor', patch: 'minor', minor: 'minor', major: 'minor' },
  major: { skip: 'major', patch: 'major', minor: 'major', major: 'major' },
};

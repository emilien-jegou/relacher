import type { CascadeRules, SizePatterns } from './types';

export const defaultSizes: SizePatterns = {
  major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
  minor: { pattern: '^feat|^revert' },
  patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
  skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
};

export const defaultCascadeRules: CascadeRules = {
  skip: 'skip',
  patch: 'patch',
  minor: 'patch',
  major: 'minor',
};

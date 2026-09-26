import { bumpStableVersion, inferLastStableVersion, isVersionGreater, parseSemVer } from './semver';
import type { BumpSize, SizePatterns } from './types';

export { inferLastStableVersion, isVersionGreater, parseSemVer };

export const matchBumpSize = (message: string, sizes: SizePatterns): BumpSize => {
  if (new RegExp(sizes.major.pattern).test(message)) return 'major';
  if (new RegExp(sizes.minor.pattern).test(message)) return 'minor';
  if (new RegExp(sizes.patch.pattern).test(message)) return 'patch';
  return 'skip';
};

export const defaultBumpVersion = (version: string, size: BumpSize): string => {
  if (size === 'skip') return version;
  if (size === 'major' || size === 'minor' || size === 'patch') {
    return bumpStableVersion(version, size);
  }
  return version;
};

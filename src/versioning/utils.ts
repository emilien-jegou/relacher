import type { BumpSize, SizePatterns } from "./types";

export const matchBumpSize = (message: string, sizes: SizePatterns): BumpSize => {
  if (new RegExp(sizes.major.pattern).test(message)) return 'major';
  if (new RegExp(sizes.minor.pattern).test(message)) return 'minor';
  if (new RegExp(sizes.patch.pattern).test(message)) return 'patch';
  return 'skip';
};

export const defaultBumpVersion = (version: string, size: BumpSize): string => {
  if (size === 'skip') return version;

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);
  if (!match) return version;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  // Notice we ignore any `pre` match completely here
  // In upgradeReady mode 0.0.4-rc.1 + [patch] simply becomes 0.0.5
  if (size === 'major') return `${major + 1}.0.0`;
  if (size === 'minor') return `${major}.${minor + 1}.0`;
  if (size === 'patch') return `${major}.${minor}.${patch + 1}`;
  
  return version;
};

import { Effect, Layer } from 'effect';

import { VcsProviderService, type VcsProvider } from '../vcs';

import type { BumpSize, CascadeRules, SizePatterns } from './types';

import { makeVcsVersionManager, VersionManagerService } from '.';

const getRcIdentifier = (size: BumpSize, defaultId: string): string => {
  if (typeof size === 'object' && size !== null && size.kind === 'pre') {
    if (size.size) {
      return size.size;
    }
  }
  return defaultId;
};

const inferLastStableVersion = (version: string): string => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);
  if (!match) return version;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const pre = match[4];

  if (!pre) {
    return `${major}.${minor}.${patch}`;
  }

  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.0`;
  }
  if (major > 0) {
    return `${major - 1}.0.0`;
  }
  return '0.0.0';
};

const bumpStableVersion = (stableVersion: string, size: BumpSize): string => {
  const match = stableVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return stableVersion;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (size === 'major') return `${major + 1}.0.0`;
  if (size === 'minor') return `${major}.${minor + 1}.0`;
  if (size === 'patch') return `${major}.${minor}.${patch + 1}`;
  return stableVersion;
};

const isVersionGreater = (v1: string, v2: string): boolean => {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return true;
    if (p1 < p2) return false;
  }
  return false;
};

const makeRCBumpVersion =
  (rcIdentifier: string, isRCMode: boolean) =>
    (version: string, size: BumpSize): string => {
      if (size === 'skip') return version;

      const currentRcIdentifier = getRcIdentifier(size, rcIdentifier);

      const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);
      if (!match) return version;

      const major = Number(match[1]);
      const minor = Number(match[2]);
      const patch = Number(match[3]);
      const pre = match[4];

      const lastStable = inferLastStableVersion(version);
      const targetStable = bumpStableVersion(lastStable, size);
      const currentBase = `${major}.${minor}.${patch}`;
      const isGreater = isVersionGreater(targetStable, currentBase);

      if (isRCMode) {
        if (isGreater) {
          return `${targetStable}-${currentRcIdentifier}.0`;
        } else {
          if (pre && pre.startsWith(`${currentRcIdentifier}.`)) {
            const parts = pre.split('.');
            const preNum = Number(parts[parts.length - 1]);
            if (!isNaN(preNum)) {
              return `${major}.${minor}.${patch}-${currentRcIdentifier}.${preNum + 1}`;
            }
          }
          return `${major}.${minor}.${patch}-${currentRcIdentifier}.0`;
        }
      } else {
        return isGreater ? targetStable : currentBase;
      }
    };

type RcVersionManagerOptions = {
  sizes?: SizePatterns;
  cascade?: CascadeRules;
  rcIdentifier?: string;
  upgradeReady?: boolean;
  tagPrereleases?: boolean;
};

export const makeRCVersionManager = (vcs: VcsProvider, options?: RcVersionManagerOptions) => {
  const isRCMode = options?.upgradeReady === false || options?.upgradeReady === undefined;

  return makeVcsVersionManager(vcs, {
    ...options,
    isRCMode,
    bumpVersionImpl: makeRCBumpVersion(options?.rcIdentifier ?? 'rc', isRCMode),
  });
};

export const RCVersionManagerLive = (options?: {
  sizes?: SizePatterns;
  cascade?: CascadeRules;
  rcIdentifier?: string;
  upgradeReady?: boolean;
  tagPrereleases?: boolean;
}) =>
  Layer.effect(
    VersionManagerService,
    Effect.gen(function*() {
      const vcs = yield* VcsProviderService;
      return makeRCVersionManager(vcs, options);
    }),
  );

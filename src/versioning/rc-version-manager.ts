import { Effect, Layer } from 'effect';

import { VcsProviderService, type VcsProvider } from '../vcs';

import { bumpStableVersion, inferLastStableVersion, isVersionGreater, parseSemVer } from './semver';
import type { BumpSize, CascadeRules, SizePatterns } from './types';
import { makeVcsVersionManager, VersionManagerService } from './vcs-version-manager';

const getRcIdentifier = (size: BumpSize, defaultId: string): string => {
  if (typeof size === 'object' && size !== null && size.kind === 'pre') {
    if (size.size) return size.size;
  }
  return defaultId;
};

// Replace lines 18-27 in src/versioning/rc-version-manager.ts
const makeRCBumpVersion =
  (rcIdentifier: string, isRCMode: boolean) =>
  (version: string, size: BumpSize): string => {
    if (size === 'skip') return version;

    const currentRcIdentifier = getRcIdentifier(size, rcIdentifier);
    const parsed = parseSemVer(version);
    if (!parsed) return version;

    const bumpType = typeof size === 'string' ? size : 'patch';
    const lastStable = inferLastStableVersion(version);
    const targetStable = bumpStableVersion(lastStable, bumpType);
    const currentBase = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    const isGreater = isVersionGreater(targetStable, currentBase);

    if (isRCMode) {
      if (isGreater) {
        return `${targetStable}-${currentRcIdentifier}.0`;
      }
      if (parsed.prerelease && parsed.prerelease.startsWith(`${currentRcIdentifier}.`)) {
        const nextNum = (parsed.prereleaseNum ?? -1) + 1;
        return `${currentBase}-${currentRcIdentifier}.${nextNum}`;
      }
      return `${currentBase}-${currentRcIdentifier}.0`;
    }

    return isGreater ? targetStable : currentBase;
  };

export interface RcVersionManagerOptions {
  sizes?: SizePatterns;
  cascade?: CascadeRules;
  rcIdentifier?: string;
  upgradeReady?: boolean;
  tagPrereleases?: boolean;
}

export const makeRCVersionManager = (vcs: VcsProvider, options?: RcVersionManagerOptions) => {
  const isRCMode = options?.upgradeReady === false || options?.upgradeReady === undefined;

  return makeVcsVersionManager(vcs, {
    ...options,
    isRCMode,
    bumpVersionImpl: makeRCBumpVersion(options?.rcIdentifier ?? 'rc', isRCMode),
  });
};

export const RCVersionManagerLive = (options?: RcVersionManagerOptions) =>
  Layer.effect(
    VersionManagerService,
    Effect.gen(function* () {
      const vcs = yield* VcsProviderService;
      return makeRCVersionManager(vcs, options);
    }),
  );

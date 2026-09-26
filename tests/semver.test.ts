import { describe, expect, it } from 'bun:test';

import {
  bumpStableVersion,
  formatSemVer,
  inferLastStableVersion,
  isVersionGreater,
  parseSemVer,
} from '../src/versioning/semver';

describe('Centralized SemVer Engine', () => {
  describe('parseSemVer', () => {
    it('should parse standard SemVer strings', () => {
      const parsed = parseSemVer('1.2.3');
      expect(parsed).toEqual({
        major: 1,
        minor: 2,
        patch: 3,
        prerelease: undefined,
        prereleaseId: undefined,
        prereleaseNum: undefined,
      });
    });

    it('should strip leading "v"', () => {
      const parsed = parseSemVer('v2.0.1');
      expect(parsed?.major).toBe(2);
      expect(parsed?.minor).toBe(0);
      expect(parsed?.patch).toBe(1);
    });

    it('should parse prerelease strings', () => {
      const parsed = parseSemVer('1.0.0-rc.3');
      expect(parsed).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
        prerelease: 'rc.3',
        prereleaseId: 'rc',
        prereleaseNum: 3,
      });
    });

    it('should return null on invalid version strings', () => {
      expect(parseSemVer('not-a-version')).toBeNull();
      expect(parseSemVer('')).toBeNull();
      expect(parseSemVer('1.2')).toBeNull();
    });
  });

  describe('formatSemVer', () => {
    it('should format standard version', () => {
      expect(formatSemVer({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
    });

    it('should format prerelease version', () => {
      expect(formatSemVer({ major: 1, minor: 2, patch: 3, prerelease: 'beta.1' })).toBe('1.2.3-beta.1');
    });
  });

  describe('isVersionGreater', () => {
    it('should compare major bumps', () => {
      expect(isVersionGreater('2.0.0', '1.9.9')).toBeTrue();
      expect(isVersionGreater('1.0.0', '2.0.0')).toBeFalse();
    });

    it('should compare minor bumps', () => {
      expect(isVersionGreater('1.2.0', '1.1.9')).toBeTrue();
      expect(isVersionGreater('1.1.0', '1.2.0')).toBeFalse();
    });

    it('should compare patch bumps', () => {
      expect(isVersionGreater('1.0.5', '1.0.4')).toBeTrue();
      expect(isVersionGreater('1.0.4', '1.0.5')).toBeFalse();
    });

    it('should return false for equal versions', () => {
      expect(isVersionGreater('1.0.0', '1.0.0')).toBeFalse();
    });
  });

  describe('bumpStableVersion', () => {
    it('should bump major versions', () => {
      expect(bumpStableVersion('1.2.3', 'major')).toBe('2.0.0');
    });

    it('should bump minor versions', () => {
      expect(bumpStableVersion('1.2.3', 'minor')).toBe('1.3.0');
    });

    it('should bump patch versions', () => {
      expect(bumpStableVersion('1.2.3', 'patch')).toBe('1.2.4');
    });
  });

  describe('inferLastStableVersion', () => {
    it('should return unchanged version if stable', () => {
      expect(inferLastStableVersion('1.2.3')).toBe('1.2.3');
    });

    it('should step back patch for pre-release', () => {
      expect(inferLastStableVersion('1.2.3-rc.0')).toBe('1.2.2');
    });

    it('should step back minor if patch is 0', () => {
      expect(inferLastStableVersion('1.2.0-beta.1')).toBe('1.1.0');
    });

    it('should step back major if minor and patch are 0', () => {
      expect(inferLastStableVersion('2.0.0-alpha.0')).toBe('1.0.0');
    });
  });
});

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  prereleaseId?: string;
  prereleaseNum?: number;
}

export function parseSemVer(version: string): ParsedSemVer | null {
  const clean = version.trim().replace(/^v/, '');
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prerelease = match[4];

  let prereleaseId: string | undefined;
  let prereleaseNum: number | undefined;

  if (prerelease) {
    const parts = prerelease.split('.');
    const lastNum = Number(parts[parts.length - 1]);
    if (!isNaN(lastNum)) {
      prereleaseNum = lastNum;
      prereleaseId = parts.slice(0, -1).join('.');
    } else {
      prereleaseId = prerelease;
    }
  }

  return { major, minor, patch, prerelease, prereleaseId, prereleaseNum };
}

export function formatSemVer(semver: ParsedSemVer): string {
  const base = `${semver.major}.${semver.minor}.${semver.patch}`;
  return semver.prerelease ? `${base}-${semver.prerelease}` : base;
}

export function isVersionGreater(v1: string, v2: string): boolean {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);
  if (!p1 || !p2) return false;

  if (p1.major !== p2.major) return p1.major > p2.major;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch;

  return false;
}

export function bumpStableVersion(
  version: string,
  size: 'major' | 'minor' | 'patch',
): string {
  const parsed = parseSemVer(version);
  if (!parsed) return version;

  if (size === 'major') return `${parsed.major + 1}.0.0`;
  if (size === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (size === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  return version;
}

export function inferLastStableVersion(version: string): string {
  const parsed = parseSemVer(version);
  if (!parsed || !parsed.prerelease) return version;

  if (parsed.patch > 0) return `${parsed.major}.${parsed.minor}.${parsed.patch - 1}`;
  if (parsed.minor > 0) return `${parsed.major}.${parsed.minor - 1}.0`;
  if (parsed.major > 0) return `${parsed.major - 1}.0.0`;
  return '0.0.0';
}

import type { BumpSize, PreRelease } from './types';

/**
 * Type guard for pre-release bump objects.
 */
export function isPreRelease(val: unknown): val is PreRelease {
  return typeof val === 'object' && val !== null && 'kind' in val && (val as PreRelease).kind === 'pre';
}

/**
 * Numeric priority for bump sizes: major (4) > minor (3) > patch (2) > pre (1) > skip (0).
 */
export function getBumpPriority(bump: BumpSize): number {
  if (bump === 'major') return 4;
  if (bump === 'minor') return 3;
  if (bump === 'patch') return 2;
  if (isPreRelease(bump)) return 1;
  return 0;
}

export function isBumpGreater(a: BumpSize, b: BumpSize): boolean {
  return getBumpPriority(a) > getBumpPriority(b);
}

export function maxBump(a: BumpSize, b: BumpSize): BumpSize {
  return getBumpPriority(a) >= getBumpPriority(b) ? a : b;
}

export function isBumpEqual(a: BumpSize, b: BumpSize): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (isPreRelease(a) && isPreRelease(b)) return a.size === b.size;
  return false;
}

export function getBumpByPriority(priority: number, fallbackPre?: PreRelease): BumpSize {
  if (priority === 4) return 'major';
  if (priority === 3) return 'minor';
  if (priority === 2) return 'patch';
  if (priority === 1) return fallbackPre ?? { kind: 'pre' };
  return 'skip';
}

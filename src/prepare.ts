import fs from 'node:fs';
import path from 'node:path';

import { defaultCascadeRules, defaultSizes } from './default-data';
import type {
  BumpSize,
  Commit,
  VcsProvider,
  DependencyConfig,
  DependencyUpdateReport,
  IntermediateReport,
  PrepareOptions,
  SizePatterns,
  CascadeRules,
} from './types';
import type { UpdateAction, UpdateActionResolved } from './updater';

export function bumpVersion(version: string, size: BumpSize): string {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return version;
  const major = parts[0];
  const minor = parts[1];
  const patch = parts[2];
  if (major === undefined || minor === undefined || patch === undefined) return version;
  if (size === 'major') return `${major + 1}.0.0`;
  if (size === 'minor') return `${major}.${minor + 1}.0`;
  if (size === 'patch') return `${major}.${minor}.${patch + 1}`;
  return version;
}

export async function getCurrentVersion(
  dep: DependencyConfig,
  vcs: VcsProvider,
  cwd: string,
): Promise<{ version: string | null; isFallback: boolean }> {
  // 1. Look for releases in git history first
  const latestTag = await vcs.getLatestTag(dep.name);
  if (latestTag) {
    let version = latestTag;

    // Strip package-specific prefixes (e.g., "api-v1.0.0" or "api/v1.0.0" -> "v1.0.0")
    if (version.startsWith(`${dep.name}-`)) {
      version = version.slice(dep.name.length + 1);
    } else if (version.startsWith(`${dep.name}/`)) {
      version = version.slice(dep.name.length + 1);
    }

    return { version: version.replace(/^v/, ''), isFallback: false };
  }

  // 2. Resolve via user-defined fallback
  if (dep.versionFallback) {
    return { version: dep.versionFallback.readFallback(cwd), isFallback: true };
  }

  return { version: null, isFallback: false };
}

export function matchBumpSize(message: string, sizes: SizePatterns): BumpSize {
  if (new RegExp(sizes.major.pattern).test(message)) return 'major';
  if (new RegExp(sizes.minor.pattern).test(message)) return 'minor';
  if (new RegExp(sizes.patch.pattern).test(message)) return 'patch';
  return 'skip';
}

export function evaluateCommitsBump(commits: Commit[], sizes: SizePatterns): BumpSize {
  const priority: Record<BumpSize, number> = { skip: 0, patch: 1, minor: 2, major: 3 };
  let maxBump: BumpSize = 'skip';
  for (const commit of commits) {
    const commitBump = matchBumpSize(commit.message, sizes);
    if (priority[commitBump] > priority[maxBump]) {
      maxBump = commitBump;
    }
  }
  return maxBump;
}

export function topologicalSort(items: IntermediateReport[]): IntermediateReport[] {
  const processed = new Set<string>();
  const processing = new Set<string>();
  const sorted: IntermediateReport[] = [];
  function visit(item: IntermediateReport) {
    if (processing.has(item.name) || processed.has(item.name)) return;
    processing.add(item.name);
    for (const depName of item.depends) {
      const depItem = items.find((r) => r.name === depName);
      if (depItem) visit(depItem);
    }
    processing.delete(item.name);
    processed.add(item.name);
    sorted.push(item);
  }
  items.forEach((item) => visit(item));
  return sorted;
}

export function propagateBumps(sorted: IntermediateReport[], rules?: CascadeRules): void {
  const activeRules: Record<BumpSize, Record<BumpSize, BumpSize>> = {
    skip: { ...defaultCascadeRules.skip, ...rules?.skip },
    patch: { ...defaultCascadeRules.patch, ...rules?.patch },
    minor: { ...defaultCascadeRules.minor, ...rules?.minor },
    major: { ...defaultCascadeRules.major, ...rules?.major },
  };

  for (const item of sorted) {
    let maxDepBump: BumpSize = 'skip';
    for (const depName of item.depends) {
      const depItem = sorted.find((r) => r.name === depName);
      if (depItem) {
        if (depItem.bump === 'major') {
          maxDepBump = 'major';
        } else if (depItem.bump === 'minor' && maxDepBump !== 'major') {
          maxDepBump = 'minor';
        } else if (depItem.bump === 'patch' && maxDepBump === 'skip') {
          maxDepBump = 'patch';
        }
      }
    }

    if (maxDepBump !== 'skip') {
      const original = item.bump;
      const targetBump = activeRules[original][maxDepBump] ?? original;
      item.bump = targetBump;
    }

    item.newVersion =
      item.bump !== 'skip' ? bumpVersion(item.currentVersion, item.bump) : item.currentVersion;
  }
}

export async function initReportItems(
  cargoDeps: DependencyConfig[],
  vcs: VcsProvider,
  sizes: SizePatterns,
  cwd: string,
): Promise<IntermediateReport[]> {
  const reports: IntermediateReport[] = [];
  for (const dep of cargoDeps) {
    const { version: currentVersion, isFallback } = await getCurrentVersion(dep, vcs, cwd);
    const isMissingVersion = currentVersion === null;
    const actualVersion = currentVersion || '0.0.0';

    const commits = await vcs.getCommits(dep.name, dep.watch || []);
    const selfBump = evaluateCommitsBump(commits, sizes);

    let isErroneous = isMissingVersion;
    for (const u of dep.updates || []) {
      if (u.required) {
        const filePath = path.resolve(cwd, u.path);
        if (!fs.existsSync(filePath)) {
          isErroneous = true;
          break;
        }
      }
    }

    reports.push({
      name: dep.name,
      currentVersion: actualVersion,
      newVersion: actualVersion,
      bump: selfBump,
      originalBump: selfBump,
      commits,
      updates: dep.updates || [],
      depends: dep.depends || [],
      isErroneous,
      isFirstRelease: isFallback,
    });
  }
  return reports;
}

export async function prepare(
  cargoDeps: DependencyConfig[],
  vcs: VcsProvider,
  options: PrepareOptions = {},
): Promise<DependencyUpdateReport[]> {
  const cwd = options.cwd || process.cwd();
  const sizes = options.sizes || defaultSizes;
  const items = await initReportItems(cargoDeps, vcs, sizes, cwd);
  const sorted = topologicalSort(items);
  propagateBumps(sorted, options.cascade);
  return finalizeReports(sorted);
}

export function finalizeReports(sorted: IntermediateReport[]): DependencyUpdateReport[] {
  const allCommitsMap = new Map<string, Commit>();
  for (const item of sorted) {
    for (const c of item.commits) {
      allCommitsMap.set(c.hash, c);
    }
  }
  const globalCommits = Array.from(allCommitsMap.values());

  return sorted.map((item) => ({
    name: item.name,
    currentVersion: item.currentVersion,
    newVersion: item.newVersion,
    bump: item.bump,
    originalBump: item.originalBump,
    commits: item.commits,
    updates: mapResolvedUpdates(item.updates, item.newVersion, item.commits, globalCommits),
    depends: item.depends,
    isErroneous: item.isErroneous,
    isFirstRelease: item.isFirstRelease,
  }));
}

export function mapResolvedUpdates(
  updates: UpdateAction[],
  newVersion: string,
  crateCommits: Commit[],
  globalCommits: Commit[],
): UpdateActionResolved[] {
  return updates.map((act) =>
    act.prepare({
      newVersion,
      crateCommits,
      globalCommits,
    }),
  );
}

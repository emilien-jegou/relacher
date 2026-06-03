import fs from 'node:fs';
import path from 'node:path';

import {
  defaultSizes,
  defaultCascadeRules,
  type BumpSize,
  type Commit,
  type VcsProvider,
  type DependencyConfig,
  type DependencyUpdateReport,
  type IntermediateReport,
  type PrepareOptions,
  type SizePatterns,
  type CascadeRules,
  type UpdateAction,
  type ChangelogContext,
} from './types';

export function getTomlValue(content: string): string | null {
  const packageMatch = content.match(/\[package\][^]*?(?=^\[|z)/);
  const targetText = packageMatch ? packageMatch[0] : content;
  const versionMatch = targetText.match(/^version\s*=\s*"([^"]+)"/m);
  return versionMatch && versionMatch[1] ? versionMatch[1] : null;
}

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

export function getCurrentVersion(dep: DependencyConfig, cwd: string): string {
  const tomlUpdate = dep.updates?.find((u) => u.kind === 'toml');
  if (!tomlUpdate) return '0.0.0';
  const filePath = path.resolve(cwd, tomlUpdate.path);
  if (!fs.existsSync(filePath)) return '0.0.0';
  return getTomlValue(fs.readFileSync(filePath, 'utf8')) || '0.0.0';
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
    const currentVersion = getCurrentVersion(dep, cwd);
    const commits = await vcs.getCommits(dep.name, dep.watch || []);
    const selfBump = evaluateCommitsBump(commits, sizes);
    reports.push({
      name: dep.name,
      currentVersion,
      newVersion: currentVersion,
      bump: selfBump,
      originalBump: selfBump,
      commits,
      updates: dep.updates || [],
      depends: dep.depends || [],
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

export function buildChangelogBlock(version: string, commits: Commit[]): string {
  const date = new Date().toISOString().split('T')[0] ?? '';
  let block = `## [${version}] - ${date}\n\n`;

  if (commits.length === 0) {
    return block + `*No notable changes.*\n`;
  }

  const breaking: string[] = [];
  const features: string[] = [];
  const fixes: string[] = [];
  const others: string[] = [];

  for (const c of commits) {
    if (c.message.includes('!:') || c.message.includes('BREAKING CHANGE')) {
      breaking.push(`- ${c.hash} ${c.message}`);
    } else if (c.message.startsWith('feat')) {
      features.push(`- ${c.hash} ${c.message}`);
    } else if (c.message.startsWith('fix')) {
      fixes.push(`- ${c.hash} ${c.message}`);
    } else {
      others.push(`- ${c.hash} ${c.message}`);
    }
  }

  if (breaking.length) block += `### ⚠️ BREAKING CHANGES\n${breaking.join('\n')}\n\n`;
  if (features.length) block += `### ✨ Features\n${features.join('\n')}\n\n`;
  if (fixes.length) block += `### 🐛 Bug Fixes\n${fixes.join('\n')}\n\n`;
  if (others.length) block += `### 🛠 Other Changes\n${others.join('\n')}\n\n`;

  return block.trim() + '\n';
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
  }));
}

export function defaultChangelogTemplate({ version, date, commits }: ChangelogContext): string {
  let block = `## [${version}] - ${date}\n\n`;
  if (commits.length === 0) return block + `*No notable changes.*\n`;

  const groups: { breaking: string[]; feat: string[]; fix: string[]; other: string[] } = {
    breaking: [],
    feat: [],
    fix: [],
    other: [],
  };

  for (const c of commits) {
    const item = `- ${c.shortHash} ${c.message}`;
    if (c.isBreaking) groups.breaking.push(item);
    else if (c.type === 'feat') groups.feat.push(item);
    else if (c.type === 'fix') groups.fix.push(item);
    else groups.other.push(item);
  }

  if (groups.breaking.length) block += `### ⚠️ BREAKING CHANGES\n${groups.breaking.join('\n')}\n\n`;
  if (groups.feat.length) block += `### ✨ Features\n${groups.feat.join('\n')}\n\n`;
  if (groups.fix.length) block += `### 🐛 Bug Fixes\n${groups.fix.join('\n')}\n\n`;
  if (groups.other.length) block += `### 🛠 Other Changes\n${groups.other.join('\n')}\n\n`;

  return block.trim() + '\n';
}

export function mapResolvedUpdates(
  updates: UpdateAction[],
  newVersion: string,
  crateCommits: Commit[],
  globalCommits: Commit[],
): UpdateAction[] {
  return updates.map((u) => {
    if (u.kind === 'regex') {
      return { ...u, resolvedReplace: u.replace.replace('{{version}}', newVersion) };
    }
    if (u.kind === 'changelog') {
      const targetCommits = u.global ? globalCommits : crateCommits;
      const context: ChangelogContext = {
        version: newVersion,
        date: new Date().toISOString().split('T')[0] ?? '',
        commits: targetCommits,
      };

      const content = u.template ? u.template(context) : defaultChangelogTemplate(context);
      return { ...u, resolvedBlock: content };
    }
    return u;
  });
}

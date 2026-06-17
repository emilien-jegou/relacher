import { pipe } from 'effect';

import type { PreparedUpdate } from '../types';
import { defaultSizes } from '../versioning/default-data';
import { matchBumpSize } from '../versioning/utils';

import { getIconForFile } from './devicons';
import { c, log } from './utils';

function inferLastStableVersion(version: string): string {
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
}

/**
 * Highlights only the changed segments of a version string.
 * Example: "1.2.3" -> "1.3.0" prints "1.2.3 → 1.[3.0]" where [3.0] is bright green.
 */
function highlightVersion(oldV: string, newV: string): string {
  if (oldV === newV) return c.gray(`${oldV} (no change)`);

  const oParts = oldV.split('.');
  const nParts = newV.split('.');

  let matchIdx = 0;
  while (matchIdx < 3 && oParts[matchIdx] === nParts[matchIdx]) {
    matchIdx++;
  }

  const common = nParts.slice(0, matchIdx).join('.') + (matchIdx > 0 ? '.' : '');
  const changed = nParts.slice(matchIdx).join('.');

  return [c.gray(oldV), c.magenta('→'), c.gray(common) + pipe(changed, c.green, c.bold)].join(' ');
}

/**
 * Customizes version segment formatting to hide/represent pre-release details gracefully.
 */
function getVersionDisplay(oldV: string, newV: string, lastStableVersion?: string | null): string {
  if (!oldV.includes('-')) {
    return highlightVersion(oldV, newV);
  }

  const lastStable = lastStableVersion || inferLastStableVersion(oldV);
  const highlightedTransition = highlightVersion(lastStable, newV);

  const parts = highlightedTransition.split(c.magenta('→'));
  if (parts.length === 2) {
    const part0 = parts[0];
    const part1 = parts[1];
    if (part0 !== undefined && part1 !== undefined) {
      return [part0.trim(), c.gray(`<${oldV}>`), c.magenta('→'), part1.trim()].join(' ');
    }
  }

  return `${lastStable} <${oldV}> → ${newV}`;
}

export function prettyPrint(prepared: PreparedUpdate): void {
  if (prepared.isDirty) {
    log.warn('The repository has unstaged or uncommitted changes (dirty status).');
  }

  if (prepared.isInvalid) {
    console.log(c.red('\nErrors detected during preparation:'));
    for (const err of prepared.errors) {
      console.log(`  - ${c.bold(err.name)}: ${err.message}`);
    }
    console.log('');
  }

  if (prepared.isEmpty) {
    log.ok('No package modifications detected. Everything is up to date.');
    return;
  }

  for (const report of prepared.deps) {
    if (report.bump === 'skip') continue;

    const bumpColor =
      report.bump === 'major' ? c.red : report.bump === 'minor' ? c.yellow : c.green;

    // Check if it's a first release (fallback was used instead of finding tags)
    const firstReleaseBadge = report.isFirstRelease ? c.cyan(` 🌱 (first release)`) : '';

    process.stdout.write(
      [
        c.bold(`📦 ${report.name.padEnd(12)}`),
        getVersionDisplay(report.currentVersion, report.newVersion, report.lastStableVersion),
        pipe(`[${report.bump}]`, bumpColor, c.bold),
        firstReleaseBadge,
      ].join(' ') + '\n',
    );

    const files = report.updates.map((u) =>
      [
        getIconForFile(u.targetPath.split('/').pop() || ''),
        c.dim(u.targetPath.split('/').pop() ?? ''),
      ].join(' '),
    );
    console.log(`   ${files.join('  ')}`);

    // 1. Show all commits since the last release with a bump marker if applicable
    for (const commit of report.commits) {
      const commitBump = matchBumpSize(commit.message, defaultSizes);
      const affectsBump = commitBump !== 'skip';

      const marker = affectsBump ? `${c.green('✦')}` : `${c.gray('○')}`;

      // User string is now wrapped with <>
      console.log(
        `     ${marker} ${c.yellow(commit.shortHash)} ${commit.message}  ${c.gray(`<${commit.author}> ${commit.date}`)}`,
      );
    }

    // 2. Show Cascades with their update kind
    const changedDeps = prepared.deps.filter(
      (r) => report.depends?.includes(r.name) && r.currentVersion !== r.newVersion,
    );

    if (changedDeps.length > 0) {
      const depsStr = changedDeps
        .map((d) => {
          const depBumpColor = d.bump === 'major' ? c.red : d.bump === 'minor' ? c.yellow : c.green;
          return `${c.blue(d.name)} ${depBumpColor(`[${d.bump}]`)}`;
        })
        .join(', ');

      console.log(
        `     ${c.green('✦')} Cascaded as ${bumpColor(`[${report.bump}]`)} from deps: ${depsStr}`,
      );
    }

    console.log('');
  }
}

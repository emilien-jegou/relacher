import { pipe } from 'effect';

import type { PreparedUpdate } from '../types';
import { defaultSizes } from '../versioning/default-data';
import { inferLastStableVersion, matchBumpSize } from '../versioning/utils';

import { getIconForFile } from './devicons';
import { c, log } from './utils';

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

function getVersionDisplay(oldV: string, newV: string, lastStableVersion?: string | null): string {
  if (!oldV.includes('-')) {
    return highlightVersion(oldV, newV);
  }

  const lastStable = lastStableVersion || inferLastStableVersion(oldV);
  const highlightedTransition = highlightVersion(lastStable, newV);
  const parts = highlightedTransition.split(c.magenta('→'));

  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    return [parts[0].trim(), c.gray(`<${oldV}>`), c.magenta('→'), parts[1].trim()].join(' ');
  }

  return `${lastStable} <${oldV}> → ${newV}`;
}

export function prettyPrint(prepared: PreparedUpdate): void {
  if (prepared.isDirty) {
    log.warn('The repository has unstaged or uncommitted changes (dirty status).');
  }

  if (prepared.isInvalid) {
    console.log(c.red('\nErrors detected during preparation:'));
    for (const err of prepared.errors || []) {
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

    // 1. Show commits
    for (const commit of report.commits) {
      const commitBump = matchBumpSize(commit.message, defaultSizes);
      const marker = commitBump !== 'skip' ? `${c.green('✦')}` : `${c.gray('○')}`;
      console.log(
        `     ${marker} ${c.yellow(commit.shortHash)} ${commit.message}  ${c.gray(`<${commit.author}> ${commit.date}`)}`,
      );
    }

    // 2. Show Cascades
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

    // 3. Fallback for forced releases with no commits and no cascades
    if (report.commits.length === 0 && changedDeps.length === 0) {
      console.log(`     ${c.gray('○ (forced release - no new commits)')}`);
    }

    console.log('');
  }
}

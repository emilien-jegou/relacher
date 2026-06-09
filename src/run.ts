import fs from 'node:fs';
import path from 'node:path';

import type { DependencyUpdateReport, VcsProvider } from './types';

/**
 * Builds the multi-line commit message showcasing version bumps, included commits,
 * cascade triggers, and first-release indicators.
 */
export function generateCommitMessage(reports: DependencyUpdateReport[]): string | null {
  const activeReports = reports.filter((r) => r.bump !== 'skip');
  if (activeReports.length === 0) {
    return null;
  }

  const tagList = activeReports.map((r) => `${r.name}-v${r.newVersion}`).join(', ');
  let commitMessage = `chore: release ${tagList}\n\n`;

  for (const report of activeReports) {
    const firstReleaseBadge = report.isFirstRelease ? ' (first release)' : '';

    commitMessage += `${report.name} (${report.currentVersion} -> ${report.newVersion}) [${report.bump}]${firstReleaseBadge}\n`;

    // Add commits
    for (const commit of report.commits) {
      commitMessage += `  - ${commit.shortHash} ${commit.message} (<${commit.author}> ${commit.date})\n`;
    }

    // Add cascades
    const changedDeps = reports.filter(
      (r) => report.depends?.includes(r.name) && r.currentVersion !== r.newVersion,
    );

    if (changedDeps.length > 0) {
      const depsStr = changedDeps.map((d) => `${d.name} [${d.bump}]`).join(', ');
      commitMessage += `  - Cascaded from deps: ${depsStr}\n`;
    }

    commitMessage += '\n';
  }

  return commitMessage.trim();
}

/**
 * Applies calculated updates to files on disk, stages, commits, and tags using the provided VcsProvider.
 */
export async function run(
  reports: DependencyUpdateReport[],
  vcs: VcsProvider,
  options: { cwd: string },
): Promise<void> {
  const erroneous = reports.filter((r) => r.isErroneous);
  if (erroneous.length > 0) {
    const names = erroneous.map((r) => r.name).join(', ');
    throw new Error(
      `Cannot run because the following packages are missing versions or required updates: ${names}`,
    );
  }

  const cwd = options.cwd;

  // 1. Apply file updates
  for (const report of reports) {
    for (const u of report.updates) {
      const filePath = path.resolve(cwd, u.targetPath);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      u.apply(report, reports, cwd);
    }
  }

  // 2. Build multi-line commit message
  const commitMessage = generateCommitMessage(reports);
  if (!commitMessage) {
    return;
  }

  // 3. Stage and execute commit
  await vcs.commit(commitMessage);

  // 4. Create tags
  const activeReports = reports.filter((r) => r.bump !== 'skip');
  for (const report of activeReports) {
    const tagName = `${report.name}-v${report.newVersion}`;
    await vcs.tag(tagName);
  }
}

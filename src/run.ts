import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import { updateLockfile } from './lockfile';
import type { DependencyUpdateReport, PreparedUpdate } from './types';
import { VcsProviderService, type VcsProvider } from './vcs';

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
 * Applies calculated updates to files on disk, stages, commits, and tags using the VcsProvider from context.
 */
export function run(
  prepared: PreparedUpdate,
  options: { cwd: string },
): Effect.Effect<void, Error, VcsProvider> {
  return Effect.gen(function*() {
    const vcs = yield* VcsProviderService;

    // Check for dirty repository status
    const isDirty = yield* vcs.isDirty();
    if (isDirty) {
      return yield* Effect.fail(new Error('Cannot run release: repository has dirty status.'));
    }

    // Reject run early if preparation is flagged as invalid
    if (prepared.isInvalid) {
      const messages = prepared.errors
        .map((e) => (e.name ? `[${e.name}] ${e.message}` : e.message))
        .join('; ');

      return yield* Effect.fail(
        new Error(`Cannot run due to preparation or configuration errors: ${messages}`),
      );
    }

    if (prepared.isEmpty) {
      return;
    }

    const reports = prepared.deps;
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

    // 2. Update .relacher.lock with the calculated metadata (commit argument is removed)
    updateLockfile(cwd, reports);

    // 3. Build multi-line commit message
    const commitMessage = generateCommitMessage(reports);
    if (!commitMessage) {
      return;
    }

    // 4. Stage and execute commit
    yield* vcs.commit(commitMessage);
  }) as Effect.Effect<void, Error, VcsProvider>;
}

import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import { updateLockfile } from './lockfile';
import type { DependencyUpdateReport, PreparedUpdate } from './types';
import { VcsProviderService, type VcsProvider } from './vcs';

export function generateCommitMessage(
  reports: DependencyUpdateReport[],
  options?: {
    commitTitle?: (defaultTitle: string, bumps: Record<string, string>) => string;
  },
): string | null {
  const activeReports = reports.filter((r) => r.bump !== 'skip');
  if (activeReports.length === 0) return null;

  const bumps: Record<string, string> = {};
  for (const r of activeReports) {
    bumps[r.name] = r.newVersion;
  }

  const tagList = activeReports.map((r) => `${r.name}-v${r.newVersion}`).join(', ');
  const defaultTitle = `release: ${tagList}`;
  const commitTitle = options?.commitTitle
    ? options.commitTitle(defaultTitle, bumps)
    : defaultTitle;

  let commitMessage = `${commitTitle}\n\n`;

  for (const report of activeReports) {
    const firstReleaseBadge = report.isFirstRelease ? ' (first release)' : '';
    commitMessage += `${report.name} (${report.currentVersion} -> ${report.newVersion}) [${report.bump}]${firstReleaseBadge}\n`;

    // 1. Commits list
    for (const commit of report.commits) {
      commitMessage += `  - ${commit.shortHash} ${commit.message} (<${commit.author}> ${commit.date})\n`;
    }

    // 2. Cascades from local dependencies
    const changedDeps = reports.filter(
      (r) => report.depends?.includes(r.name) && r.currentVersion !== r.newVersion,
    );

    if (changedDeps.length > 0) {
      const depsStr = changedDeps.map((d) => `${d.name} [${d.bump}]`).join(', ');
      commitMessage += `  - Cascaded from deps: ${depsStr}\n`;
    }

    // 3. Fallback note for forced releases with no commits and no cascades
    if (report.commits.length === 0 && changedDeps.length === 0) {
      commitMessage += `  - forced release bump (no new commits)\n`;
    }

    commitMessage += '\n';
  }

  return commitMessage.trim();
}

export function run(
  prepared: PreparedUpdate,
  options: {
    cwd: string;
    commitTitle?: (defaultTitle: string, bumps: Record<string, string>) => string;
  },
): Effect.Effect<void, Error, VcsProvider> {
  return Effect.gen(function* () {
    const vcs = yield* VcsProviderService;

    const isDirty = yield* vcs.isDirty();
    if (isDirty) {
      return yield* Effect.fail(new Error('Cannot run release: repository has dirty status.'));
    }

    if (prepared.isInvalid) {
      const messages = (prepared.errors || [])
        .map((e) => (e.name ? `[${e.name}] ${e.message}` : e.message))
        .join('; ');
      return yield* Effect.fail(
        new Error(`Cannot run due to preparation or configuration errors: ${messages}`),
      );
    }

    if (prepared.isEmpty) return;

    const reports = prepared.deps;
    const cwd = options.cwd;

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

    updateLockfile(cwd, reports);

    const commitMessage = generateCommitMessage(reports, {
      commitTitle: options.commitTitle,
    });
    if (!commitMessage) return;

    yield* vcs.commit(commitMessage);
  }) as Effect.Effect<void, Error, VcsProvider>;
}

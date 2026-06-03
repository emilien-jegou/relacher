import fs from 'node:fs';
import path from 'node:path';

import type { DependencyUpdateReport, VcsProvider } from './types';

/**
 * Applies calculated updates to files on disk, stages, commits, and tags using the provided VcsProvider.
 */
export async function run(
  reports: DependencyUpdateReport[],
  vcs: VcsProvider,
  options: { cwd: string },
): Promise<void> {
  const cwd = options.cwd;

  // 1. Apply file updates
  for (const report of reports) {
    for (const u of report.updates) {
      const filePath = path.resolve(cwd, u.path);
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      if (u.kind === 'toml') {
        if (fs.existsSync(filePath)) {
          let content = fs.readFileSync(filePath, 'utf8');
          // Update package version inside the target Cargo.toml package block
          content = content.replace(
            /(\[package\][^]*?^version\s*=\s*")[^"]+(")/m,
            `$1${report.newVersion}$2`,
          );
          // Sync workspace dependency entries if internal dependencies changed
          for (const depReport of reports) {
            if (depReport.name === report.name) continue;
            const depRegex = new RegExp(
              `(${depReport.name}\\s*=\\s*\\{[^}]*version\\s*=\\s*")[^"]+(")`,
              'g',
            );
            content = content.replace(depRegex, `$1${depReport.newVersion}$2`);
          }
          fs.writeFileSync(filePath, content);
        }
      } else if (u.kind === 'regex') {
        if (fs.existsSync(filePath)) {
          let content = fs.readFileSync(filePath, 'utf8');
          const searchRegex = new RegExp(u.search, 'g');
          content = content.replace(searchRegex, u.resolvedReplace ?? '');
          fs.writeFileSync(filePath, content);
        }
      } else if (u.kind === 'changelog') {
        const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const newContent = (u.resolvedBlock ?? '') + '\n' + oldContent;
        fs.writeFileSync(filePath, newContent.trim() + '\n');
      }
    }
  }

  // 2. Build multi-line commit message
  const activeReports = reports.filter((r) => r.bump !== 'skip');
  if (activeReports.length === 0) {
    return;
  }

  const tagList = activeReports.map((r) => `${r.name}-v${r.newVersion}`).join(', ');
  let commitMessage = `chore: release ${tagList}\n\n`;

  for (const report of activeReports) {
    commitMessage += `${report.name} (${report.currentVersion} -> ${report.newVersion}) [${report.bump}]\n`;

    // Add commits
    for (const commit of report.commits) {
      commitMessage += `  - ${commit.shortHash} ${commit.message} (${commit.author} ${commit.date})\n`;
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

  // 3. Stage and execute commit
  await vcs.commit(commitMessage.trim());

  // 4. Create tags
  for (const report of activeReports) {
    const tagName = `${report.name}-v${report.newVersion}`;
    await vcs.tag(tagName);
  }
}

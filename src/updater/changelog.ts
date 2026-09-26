import fs from 'node:fs';
import path from 'node:path';

import type { ChangelogContext, Commit } from '../types';

import { type ApplyActionFnArgs, type PrepareActionFnArgs, updateBuilder } from './builder';

export type ChangelogUpdateParams = {
  global?: boolean;
  template?: (ctx: ChangelogContext) => string;
};

type ChangelogPreparedData = {
  resolvedBlock: string;
};

export const changelogUpdate = updateBuilder<ChangelogUpdateParams, ChangelogPreparedData>({
  kind: 'changelog',
  prepare: ({ params, options }: PrepareActionFnArgs<ChangelogUpdateParams>) => {
    const targetCommits = params.global ? options.globalCommits : options.crateCommits;
    const context: ChangelogContext = {
      version: options.newVersion,
      date: new Date().toISOString().split('T')[0] ?? '',
      commits: targetCommits || [],
      commitsSincePreRelease: options.commitsSincePreRelease,
    };

    const resolvedBlock = params.template
      ? params.template(context)
      : defaultChangelogTemplate(context);

    return { resolvedBlock };
  },
  apply: ({
    targetPath,
    preparedData,
    cwd,
  }: ApplyActionFnArgs<ChangelogUpdateParams, ChangelogPreparedData>) => {
    const filePath = path.resolve(cwd, targetPath);
    const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const newContent = (preparedData.resolvedBlock ?? '') + '\n' + oldContent;
    fs.writeFileSync(filePath, newContent.trim() + '\n');
  },
});

export function defaultChangelogTemplate({ version, date, commits }: ChangelogContext): string {
  let block = `## [${version}] - ${date}\n\n`;
  if (commits.length === 0) return block + `*No notable changes.*\n`;

  const groups: { breaking: Commit[]; feat: Commit[]; fix: Commit[]; other: Commit[] } = {
    breaking: [],
    feat: [],
    fix: [],
    other: [],
  };

  for (const c of commits) {
    if (c.isBreaking) groups.breaking.push(c);
    else if (c.type === 'feat') groups.feat.push(c);
    else if (c.type === 'fix') groups.fix.push(c);
    else groups.other.push(c);
  }

  const formatGroup = (arr: Commit[]) => arr.map((c) => `- ${c.shortHash} ${c.message}`).join('\n');

  if (groups.breaking.length)
    block += `### ⚠️ BREAKING CHANGES\n${formatGroup(groups.breaking)}\n\n`;
  if (groups.feat.length) block += `### Features\n${formatGroup(groups.feat)}\n\n`;
  if (groups.fix.length) block += `### Bug Fixes\n${formatGroup(groups.fix)}\n\n`;
  if (groups.other.length) block += `### Other Changes\n${formatGroup(groups.other)}\n\n`;

  return block.trim() + '\n';
}

/**
 * Built-in Conventional Commits template with GitHub links and scoped categorization.
 */
export function githubChangelogTemplate(repo: string) {
  return ({ version, date, commits }: ChangelogContext): string => {
    const cleanVersion = version ? version.replace(/^v/, '') : 'Unreleased';
    let block = `## [${cleanVersion}] - ${date}\n\n`;

    if (commits.length === 0) return block + '*No notable changes.*\n';

    const categories: Record<string, Commit[]> = {
      'Breaking Changes': [],
      Features: [],
      'Bug Fixes': [],
      Performance: [],
      Refactoring: [],
      Documentation: [],
      Miscellaneous: [],
    };

    for (const c of commits) {
      if (c.isBreaking) categories['Breaking Changes']!.push(c);
      else if (c.type === 'feat') categories.Features!.push(c);
      else if (c.type === 'fix') categories['Bug Fixes']!.push(c);
      else if (c.type === 'perf') categories.Performance!.push(c);
      else if (c.type === 'refactor') categories.Refactoring!.push(c);
      else if (c.type === 'docs') categories.Documentation!.push(c);
      else categories.Miscellaneous!.push(c);
    }

    for (const [title, list] of Object.entries(categories)) {
      if (!list || list.length === 0) continue;

      block += `### ${title}\n`;
      for (const c of list) {
        const breakingBadge = c.isBreaking && title !== 'Breaking Changes' ? '[**breaking**] ' : '';
        const scope = c.scope ? `**${c.scope}:** ` : '';
        const desc = c.description || c.message;
        const formattedDesc = desc.charAt(0).toUpperCase() + desc.slice(1);
        const commitLink = `[\`${c.shortHash}\`](https://github.com/${repo}/commit/${c.hash})`;

        block += `- ${breakingBadge}${scope}${formattedDesc} — ${commitLink} by ${c.author}\n`;
      }
      block += '\n';
    }

    return block.trim() + '\n';
  };
}

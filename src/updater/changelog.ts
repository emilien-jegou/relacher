import fs from 'node:fs';
import path from 'node:path';

import { type ChangelogContext, type Commit } from '../types'; // Assuming these types are defined here

import { updateBuilder, type PrepareActionFnArgs, type ApplyActionFnArgs } from './builder';

export type ChangelogUpdateParams = {
  global?: boolean;
  template?: (ctx: ChangelogContext) => string;
  required?: boolean;
};

// Define the type for data prepared by the 'prepare' function
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

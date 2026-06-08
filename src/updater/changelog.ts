import fs from 'node:fs';
import path from 'node:path';

import type { ChangelogContext } from '../types';

import type { UpdateAction, UpdateActionResolved, UpdateActionOptions } from '.';

export type ChangelogUpdateParams = {
  path: string;
  global?: boolean;
  template?: (ctx: ChangelogContext) => string;
  required?: boolean;
};

export const changelogUpdate = (params: ChangelogUpdateParams): UpdateAction => ({
  kind: 'changelog',
  path: params.path,
  required: params.required,
  params,
  prepare(data: UpdateActionOptions): UpdateActionResolved {
    const targetCommits = params.global ? data.globalCommits : data.crateCommits;
    const context: ChangelogContext = {
      version: data.newVersion,
      date: new Date().toISOString().split('T')[0] ?? '',
      commits: targetCommits,
    };

    const resolvedBlock = params.template
      ? params.template(context)
      : defaultChangelogTemplate(context);

    const t = {
      kind: 'changelog',
      path: params.path,
      params: {
        ...params,
        resolvedBlock,
      },
      apply(_report, _reports, cwd) {
        const filePath = path.resolve(cwd, params.path);
        const oldContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const newContent = (resolvedBlock ?? '') + '\n' + oldContent;
        fs.writeFileSync(filePath, newContent.trim() + '\n');
      },
    } satisfies UpdateActionResolved;

    return t;
  },
});

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

import fs from 'node:fs';
import path from 'node:path';

import type { VersionFallback, UpdateAction, UpdateActionResolved, UpdateActionOptions } from '.';

export type RegexFallbackParams = { path: string; search: string };
export type RegexUpdateParams = {
  path: string;
  search: string;
  replace: string;
  required?: boolean;
};

export const regexFallback = (params: RegexFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const searchRegex = new RegExp(params.search, 'm');
    const match = content.match(searchRegex);
    return match && match[1] ? match[1] : null;
  },
});

export const regexUpdate = (params: RegexUpdateParams): UpdateAction => ({
  kind: 'regex',
  path: params.path,
  required: params.required,
  params,
  prepare(data: UpdateActionOptions): UpdateActionResolved {
    const resolvedReplace = params.replace.replace('{{version}}', data.newVersion);

    return {
      kind: 'regex',
      path: params.path,
      params: { ...params, resolvedReplace },
      apply(_report, _reports, cwd) {
        const filePath = path.resolve(cwd, params.path);
        if (!fs.existsSync(filePath)) return;

        let content = fs.readFileSync(filePath, 'utf8');
        const searchRegex = new RegExp(params.search, 'g');
        content = content.replace(searchRegex, resolvedReplace);
        fs.writeFileSync(filePath, content);
      },
    };
  },
});

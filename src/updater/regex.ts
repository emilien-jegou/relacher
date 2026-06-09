import fs from 'node:fs';
import path from 'node:path';

import { updateBuilder, type PrepareActionFnArgs, type ApplyActionFnArgs } from './builder';

import { type VersionFallback } from '.';

export type RegexFallbackParams = { path: string; search: string };
export type RegexUpdateParams = {
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

// Define the type for data prepared by the 'prepare' function
type RegexPreparedData = {
  resolvedReplace: string;
};

export const regexUpdate = updateBuilder<RegexUpdateParams, RegexPreparedData>({
  kind: 'regex',

  prepare: ({ params, options }: PrepareActionFnArgs<RegexUpdateParams>) => {
    // Pre-calculate the replacement string with the new version
    const resolvedReplace = params.replace.replace('{{version}}', options.newVersion);
    return { resolvedReplace };
  },

  apply: ({
    targetPath,
    params,
    preparedData,
    cwd,
  }: ApplyActionFnArgs<RegexUpdateParams, RegexPreparedData>) => {
    const filePath = path.resolve(cwd, targetPath);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found for regex update (path: ${filePath}). Skipping.`);
      return;
    }

    let content = fs.readFileSync(filePath, 'utf8');
    const searchRegex = new RegExp(params.search, 'g');
    content = content.replace(searchRegex, preparedData.resolvedReplace);
    fs.writeFileSync(filePath, content);
  },
});

import fs from 'node:fs';
import path from 'node:path';

import { patch } from '@decimalturn/toml-patch';
import { parse } from 'smol-toml';

import type { DependencyUpdateReport } from '../types';

import { type VersionFallback, updateBuilder } from '.';

export type TomlFallbackParams = {
  path: string;
  read: (parsed: any) => string | null | undefined;
};

export type TomlUpdateParams = (
  parsed: any,
  report: DependencyUpdateReport,
  reports: DependencyUpdateReport[],
) => void;

export const tomlFallback = (params: TomlFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parse(content);
      return params.read(parsed) ?? null;
    } catch {
      return null;
    }
  },
});

export const tomlUpdate = updateBuilder<TomlUpdateParams>({
  kind: 'toml',
  apply({ targetPath, params, report, reports, cwd }) {
    const filePath = path.resolve(cwd, targetPath);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parse(content);

    // Safely mutate the object using the user provided callback
    params(parsed, report, reports);

    // Patch the original document string using the mutated JS object
    const updatedContent = patch(content, parsed);

    fs.writeFileSync(filePath, updatedContent);
  },
});

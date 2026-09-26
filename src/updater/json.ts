import fs from 'node:fs';
import path from 'node:path';

import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';

import type { DependencyUpdateReport } from '../types';

import { type VersionFallback, updateBuilder } from './builder';
import { createMutationProxy } from './proxy';

export type JsonFallbackParams = {
  path: string;
  read: (parsed: any) => string | null | undefined;
};

export type JsonUpdateParams = (
  parsed: any,
  report: DependencyUpdateReport,
  reports: DependencyUpdateReport[],
) => void;

export const jsonFallback = (params: JsonFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = parseJsonc(content);
      return params.read(parsed) ?? null;
    } catch {
      return null;
    }
  },
});

export const jsonUpdate = updateBuilder<JsonUpdateParams>({
  kind: 'json',
  apply({ targetPath, params, report, reports, cwd }) {
    const filePath = path.resolve(cwd, targetPath);
    if (!fs.existsSync(filePath)) return;

    let content = fs.readFileSync(filePath, 'utf8');
    let parsed: any;
    try {
      parsed = parseJsonc(content);
      if (parsed === undefined) throw new Error('Parsed content is undefined');
    } catch (err) {
      console.error(`Failed to parse JSON file at ${filePath}:`, err);
      return;
    }

    const modifications: Array<{ path: string[]; value: any }> = [];
    const proxy = createMutationProxy(parsed, [], (p, v) => {
      modifications.push({ path: p, value: v });
    });

    params(proxy, report, reports);

    if (modifications.length === 0) return;

    for (const mod of modifications) {
      const edits = modify(content, mod.path, mod.value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      content = applyEdits(content, edits);
    }

    fs.writeFileSync(filePath, content);
  },
});

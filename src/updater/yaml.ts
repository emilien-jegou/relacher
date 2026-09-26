import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import type { DependencyUpdateReport } from '../types';

import { type VersionFallback, updateBuilder } from './builder';
import { createMutationProxy } from './proxy';

export type YamlFallbackParams = {
  path: string;
  read: (parsed: any) => string | null | undefined;
};

export type YamlUpdateParams = (
  parsed: any,
  report: DependencyUpdateReport,
  reports: DependencyUpdateReport[],
) => void;

export const yamlFallback = (params: YamlFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = parseDocument(content);
      return params.read(doc.toJS()) ?? null;
    } catch {
      return null;
    }
  },
});

export const yamlUpdate = updateBuilder<YamlUpdateParams>({
  kind: 'yaml',
  apply({ targetPath, params, report, reports, cwd }) {
    const filePath = path.resolve(cwd, targetPath);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const doc = parseDocument(content);
    const parsed = doc.toJS();

    const modifications: Array<{ path: string[]; value: any }> = [];
    const proxy = createMutationProxy(parsed, [], (p, v) => {
      modifications.push({ path: p, value: v });
    });

    params(proxy, report, reports);

    if (modifications.length === 0) return;

    for (const mod of modifications) {
      doc.setIn(mod.path, mod.value);
    }

    fs.writeFileSync(filePath, doc.toString());
  },
});

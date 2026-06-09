import fs from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import type { DependencyUpdateReport } from '../types';

import { type VersionFallback, updateBuilder } from '.';

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
      const parsed = doc.toJS();
      return params.read(parsed) ?? null;
    } catch {
      return null;
    }
  },
});

function createMutationProxy(
  obj: any,
  path: string[] = [],
  onSet: (path: string[], value: any) => void,
): any {
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (prop === 'toJSON') return () => target;

      const value = target[prop];
      if (value !== null && typeof value === 'object') {
        return createMutationProxy(value, [...path, prop], onSet);
      }
      return value;
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') {
        target[prop] = value;
        return true;
      }
      target[prop] = value;
      onSet([...path, prop], value);
      return true;
    },
  });
}

export const yamlUpdate = updateBuilder<YamlUpdateParams>({
  kind: 'yaml',
  apply({ targetPath, params, report, reports, cwd }) {
    const filePath = path.resolve(cwd, targetPath);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const doc = parseDocument(content);
    const parsed = doc.toJS();

    const modifications: Array<{ path: string[]; value: any }> = [];
    const proxy = createMutationProxy(parsed, [], (path, value) => {
      modifications.push({ path, value });
    });

    // Mutate the object proxy using the user provided callback
    params(proxy, report, reports);

    if (modifications.length === 0) return;

    for (const mod of modifications) {
      doc.setIn(mod.path, mod.value);
    }

    fs.writeFileSync(filePath, doc.toString());
  },
});

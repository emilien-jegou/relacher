import fs from 'node:fs';
import path from 'node:path';

import type { VersionFallback, UpdateAction, UpdateActionResolved, UpdateActionOptions } from '.';

export type JsonFallbackParams = { path: string; json: string };
export type JsonUpdateParams = { path: string; json: string; required?: boolean };

export const jsonFallback = (params: JsonFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const keys = params.json.split('.');
      let val: any = data;
      for (const k of keys) {
        if (val == null) return null;
        val = val[k];
      }
      return typeof val === 'string' ? val : null;
    } catch {
      return null;
    }
  },
});

export const jsonUpdate = (params: JsonUpdateParams): UpdateAction => ({
  kind: 'json',
  path: params.path,
  required: params.required,
  params,
  prepare(_data: UpdateActionOptions): UpdateActionResolved {
    return {
      kind: 'json',
      path: params.path,
      params,
      apply(report, reports, cwd) {
        const filePath = path.resolve(cwd, params.path);
        if (!fs.existsSync(filePath)) return;

        const content = fs.readFileSync(filePath, 'utf8');

        // Detect indent size
        const indentMatch = content.match(/^[ \t]+/m);
        const indent = indentMatch ? indentMatch[0] : 2;

        let data: Record<string, any>;
        try {
          data = JSON.parse(content);
        } catch (err) {
          console.error(`Failed to parse JSON file at ${filePath}`);
          return;
        }

        // Update specific JSON path
        const keys = params.json.split('.');
        const lastKey = keys.pop();
        if (lastKey) {
          let target = data;
          for (const k of keys) {
            if (target[k] == null || typeof target[k] !== 'object') {
              target[k] = {};
            }
            target = target[k];
          }
          target[lastKey] = report.newVersion;
        }

        // Sync internal workspace dependency entries
        const depSections = [
          'dependencies',
          'devDependencies',
          'peerDependencies',
          'optionalDependencies',
        ];

        for (const depReport of reports) {
          if (depReport.name === report.name) continue;

          for (const section of depSections) {
            if (data[section] && data[section][depReport.name]) {
              const currentVal = data[section][depReport.name] as string;
              const prefixMatch = currentVal.match(/^([~^]?)(.*)$/);
              const prefix = prefixMatch ? prefixMatch[1] : '';
              data[section][depReport.name] = `${prefix}${depReport.newVersion}`;
            }
          }
        }

        fs.writeFileSync(filePath, JSON.stringify(data, null, indent) + '\n');
      },
    };
  },
});

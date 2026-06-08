import fs from 'node:fs';
import path from 'node:path';

import type { VersionFallback, UpdateAction, UpdateActionResolved, UpdateActionOptions } from '.';

export type TomlFallbackParams = { path: string; toml: string };
export type TomlUpdateParams = { path: string; toml: string; required?: boolean };

export const tomlFallback = (params: TomlFallbackParams): VersionFallback => ({
  readFallback(cwd: string): string | null {
    const filePath = path.resolve(cwd, params.path);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const packageMatch = content.match(/\[package\][^]*?(?=^\[|z)/);
    const targetText = packageMatch ? packageMatch[0] : content;
    const versionMatch = targetText.match(/^version\s*=\s*"([^"]+)"/m);
    return versionMatch && versionMatch[1] ? versionMatch[1] : null;
  },
});

export const tomlUpdate = (params: TomlUpdateParams): UpdateAction => ({
  kind: 'toml',
  path: params.path,
  params,
  required: params.required,
  prepare(_data: UpdateActionOptions): UpdateActionResolved {
    return {
      kind: 'toml',
      path: params.path,
      params,
      apply(report, reports, cwd) {
        const filePath = path.resolve(cwd, params.path);
        if (!fs.existsSync(filePath)) return;

        let content = fs.readFileSync(filePath, 'utf8');

        // Update package version inside the target Cargo.toml package block
        content = content.replace(
          /(\[package\][^]*?^version\s*=\s*")[^"]+(")/m,
          `$1${report.newVersion}$2`,
        );

        // Sync workspace dependency entries if internal dependencies changed
        for (const depReport of reports) {
          if (depReport.name === report.name) continue;
          const depRegex = new RegExp(
            `(${depReport.name}\\s*=\\s*\\{[^}]*version\\s*=\\s*")[^"]+(")`,
            'g',
          );
          content = content.replace(depRegex, `$1${depReport.newVersion}$2`);
        }

        fs.writeFileSync(filePath, content);
      },
    };
  },
});

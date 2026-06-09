import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { jsonUpdate } from '../src/updater/json';
import { yamlUpdate } from '../src/updater/yaml';

import { mktemp } from './utils/repo';

describe('Formatting preservation tests for JSON and YAML', () => {
  it('should preserve JSON formatting and comments when performing updates', () => {
    using temp = mktemp();
    const filePath = path.join(temp.path, 'package.json');
    const originalJson = `{
  // This is a comment at the top
  "name": "my-package",
  "version": "1.0.0", /* Inline comment */
  "dependencies": {
    "foo": "1.0.0"
  }
}`;

    fs.writeFileSync(filePath, originalJson, 'utf8');

    const update = jsonUpdate('package.json', (parsed) => {
      parsed.version = '2.0.0';
      parsed.dependencies.foo = '1.2.0';
    });

    const report = {
      name: 'my-package',
      bump: 'minor',
      newVersion: '2.0.0',
    } as any;

    const resolved = update.prepare({
      newVersion: '2.0.0',
      globalCommits: [],
      crateCommits: [],
    });

    resolved.apply(report, [report], temp.path);

    const updatedJson = fs.readFileSync(filePath, 'utf8');

    // Confirm target values updated
    expect(updatedJson).toContain('"version": "2.0.0"');
    expect(updatedJson).toContain('"foo": "1.2.0"');

    // Confirm comments and structure are preserved
    expect(updatedJson).toContain('// This is a comment at the top');
    expect(updatedJson).toContain('/* Inline comment */');
  });

  it('should preserve YAML formatting and comments when performing updates', () => {
    using temp = mktemp();
    const filePath = path.join(temp.path, 'config.yaml');
    const originalYaml = `
# This is a root comment
app:
  name: "my-app"
  version: "1.0.0" # Inline version comment
  features:
    - name: "auth"
      enabled: true
`.trim();

    fs.writeFileSync(filePath, originalYaml, 'utf8');

    const update = yamlUpdate('config.yaml', (parsed) => {
      parsed.app.version = '2.0.0';
    });

    const report = {
      name: 'my-app',
      bump: 'minor',
      newVersion: '2.0.0',
    } as any;

    const resolved = update.prepare({
      newVersion: '2.0.0',
      globalCommits: [],
      crateCommits: [],
    });

    resolved.apply(report, [report], temp.path);

    const updatedYaml = fs.readFileSync(filePath, 'utf8');

    // Confirm target values updated
    expect(updatedYaml).toContain('version: "2.0.0"');

    // Confirm comments and indentation structure are preserved
    expect(updatedYaml).toContain('# This is a root comment');
    expect(updatedYaml).toContain('# Inline version comment');
    expect(updatedYaml).toContain('name: "auth"');
  });
});

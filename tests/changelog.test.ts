import { describe, it, expect } from 'bun:test';

import { mapResolvedUpdates } from '../src/prepare';
import type { Commit } from '../src/types';
import { changelogUpdate, defaultChangelogTemplate } from '../src/updater';

describe('Changelog templating', () => {
  const dummyCommit: Commit = {
    hash: 'a1b2c3d4e5f6',
    shortHash: 'a1b2c3d',
    author: 'Alice',
    date: '2023-01-01',
    message: 'feat(api)!: add new endpoints',
    type: 'feat',
    scope: 'api',
    isBreaking: true,
    description: 'add new endpoints',
  };

  it('should format default blocks', () => {
    const block = defaultChangelogTemplate({
      version: '1.0.0',
      date: '2023-01-01',
      commits: [dummyCommit],
    });
    expect(block).toInclude('### ⚠️ BREAKING CHANGES');
    expect(block).toInclude('a1b2c3d feat(api)!: add new endpoints');
  });

  it('should execute user provided template logic safely', () => {
    const customTemplate = ({ version, commits }: any) => {
      return (
        `# v${version}\n` +
        commits.map((c: any) => `* Scope: ${c.scope} | Desc: ${c.description}`).join('\n')
      );
    };

    const updates = mapResolvedUpdates(
      [changelogUpdate('CHANGELOG.md', { template: customTemplate })],
      '2.0.0',
      [dummyCommit],
      [dummyCommit],
    );

    const update = updates[0];
    expect(update).toBeDefined();
    expect(update!.preparedData.resolvedBlock).toBe('# v2.0.0\n* Scope: api | Desc: add new endpoints');
  });
});

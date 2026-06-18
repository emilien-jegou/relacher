import { describe, it, expect } from 'bun:test';

import { generateCommitMessage } from '../src/run';
import type { Commit, DependencyUpdateReport } from '../src/types';

describe('generateCommitMessage', () => {
  const mockReports: DependencyUpdateReport[] = [
    {
      name: 'oyui',
      currentVersion: '1.4.4',
      newVersion: '1.4.5',
      bump: 'patch',
      isFirstRelease: false,
      commits: [
        {
          shortHash: 'a1b2c3d',
          message: 'fix: align button',
          author: 'Jane Doe',
          date: '2023-10-27',
        } satisfies Partial<Commit> as Commit,
      ],
      depends: [],
      updates: [],
    },
    {
      name: 'oyui-lib',
      currentVersion: '1.3.1',
      newVersion: '1.3.2',
      bump: 'patch',
      isFirstRelease: true,
      commits: [
        {
          shortHash: 'e5f6g7h',
          message: 'feat: spacing tokens',
          author: 'John Smith',
          date: '2023-10-27',
        } satisfies Partial<Commit> as Commit,
      ],
      depends: ['oyui'],
      updates: [],
    },
    {
      name: 'ignored-pkg',
      currentVersion: '2.0.0',
      newVersion: '2.0.0',
      bump: 'skip',
      isFirstRelease: false,
      commits: [],
      depends: [],
      updates: [],
    },
  ];

  it('should generate a default commit message with "release:" prefix and detail the changes', () => {
    const message = generateCommitMessage(mockReports);

    expect(message).not.toBeNull();
    // Verify default title structure
    expect(message).toContain('release: oyui-v1.4.5, oyui-lib-v1.3.2\n\n');
    // Verify body content
    expect(message).toContain('oyui (1.4.4 -> 1.4.5) [patch]');
    expect(message).toContain('  - a1b2c3d fix: align button (<Jane Doe> 2023-10-27)');
    expect(message).toContain('oyui-lib (1.3.1 -> 1.3.2) [patch] (first release)');
    // Skipped packages should not appear in the title or body
    expect(message).not.toContain('ignored-pkg');
  });

  it('should return null when there are no active updates to report', () => {
    const onlySkippedReports: DependencyUpdateReport[] = [
      {
        name: 'ignored-pkg',
        currentVersion: '2.0.0',
        newVersion: '2.0.0',
        bump: 'skip',
        isFirstRelease: false,
        commits: [],
        depends: [],
        updates: [],
      },
    ];

    const message = generateCommitMessage(onlySkippedReports);
    expect(message).toBeNull();
  });

  it('should pass the default title and list of bumps to the callback and use the returned title', () => {
    let receivedDefaultTitle = '';
    let receivedBumps: Record<string, string> = {};

    const customTitleCallback = (defaultTitle: string, bumps: Record<string, string>) => {
      receivedDefaultTitle = defaultTitle;
      receivedBumps = bumps;
      return `ci(release): upgraded ${Object.keys(bumps).length} library items`;
    };

    const message = generateCommitMessage(mockReports, { commitTitle: customTitleCallback });

    // Verify context passed to callback
    expect(receivedDefaultTitle).toBe('release: oyui-v1.4.5, oyui-lib-v1.3.2');
    expect(receivedBumps).toEqual({
      oyui: '1.4.5',
      'oyui-lib': '1.3.2',
    });

    // Verify output message uses modified title
    expect(message).not.toBeNull();
    expect(message!.startsWith('ci(release): upgraded 2 library items')).toBe(true);
  });
});

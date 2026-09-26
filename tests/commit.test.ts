import { describe, expect, it } from 'bun:test';

import { parseCommit, parseCommitLine } from '../src/vcs/commit';

describe('Conventional Commit Parser', () => {
  it('should parse standard features and bug fixes', () => {
    const c1 = parseCommit('abc1234', 'Dev', '2026-09-26', 'feat: add user authentication');
    expect(c1.type).toBe('feat');
    expect(c1.scope).toBeNull();
    expect(c1.isBreaking).toBeFalse();
    expect(c1.description).toBe('add user authentication');

    const c2 = parseCommit('def5678', 'Dev', '2026-09-26', 'fix: resolve race condition');
    expect(c2.type).toBe('fix');
    expect(c2.scope).toBeNull();
    expect(c2.isBreaking).toBeFalse();
    expect(c2.description).toBe('resolve race condition');
  });

  it('should extract commit scope', () => {
    const c = parseCommit('abc1234', 'Dev', '2026-09-26', 'feat(auth): add OAuth2 provider');
    expect(c.type).toBe('feat');
    expect(c.scope).toBe('auth');
    expect(c.description).toBe('add OAuth2 provider');
  });

  it('should identify breaking changes via exclamation mark', () => {
    const c = parseCommit('abc1234', 'Dev', '2026-09-26', 'refactor(api)!: remove legacy v1 endpoint');
    expect(c.isBreaking).toBeTrue();
    expect(c.type).toBe('refactor');
    expect(c.scope).toBe('api');
  });

  it('should identify breaking changes via BREAKING CHANGE footer keyword', () => {
    const c = parseCommit('abc1234', 'Dev', '2026-09-26', 'fix: upgrade db schema BREAKING CHANGE: requires migration');
    expect(c.isBreaking).toBeTrue();
  });

  it('should parse delimited log lines', () => {
    const line = '6543210|Alice|2026-09-26|chore(deps): bump smol-toml';
    const c = parseCommitLine(line);

    expect(c).not.toBeNull();
    expect(c?.shortHash).toBe('6543210');
    expect(c?.author).toBe('Alice');
    expect(c?.date).toBe('2026-09-26');
    expect(c?.type).toBe('chore');
    expect(c?.scope).toBe('deps');
    expect(c?.description).toBe('bump smol-toml');
  });

  it('should return null for empty lines', () => {
    expect(parseCommitLine('')).toBeNull();
    expect(parseCommitLine('   ')).toBeNull();
  });
});

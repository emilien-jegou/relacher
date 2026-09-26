import type { Commit } from '../types';

export function parseCommit(
  hash: string,
  author: string,
  date: string,
  message: string,
): Commit {
  const trimmed = message.trim();
  const ccMatch = trimmed.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);

  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: author.trim(),
    date: date.trim(),
    message: trimmed,
    type: ccMatch ? (ccMatch[1] ?? 'other') : 'other',
    scope: ccMatch ? (ccMatch[2] ?? null) : null,
    isBreaking: (ccMatch && !!ccMatch[3]) || trimmed.includes('BREAKING CHANGE'),
    description: ccMatch ? (ccMatch[4] ?? trimmed) : trimmed,
  };
}

export function parseCommitLine(line: string): Commit | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('|');
  const hash = parts[0]?.trim();
  if (!hash) return null;

  const author = parts[1]?.trim() ?? '';
  const date = parts[2]?.trim() ?? '';
  const message = parts.slice(3).join('|').trim();

  return parseCommit(hash, author, date, message);
}

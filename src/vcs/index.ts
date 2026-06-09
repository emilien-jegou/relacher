import type { Commit } from '../types';

export interface VcsProvider {
  getCommits(name: string, watch: string[], exclude?: string[]): Promise<Commit[]>;
  getLatestTag(name?: string): Promise<string | null>;
  commit(message: string): Promise<void>;
  tag(tagName: string): Promise<void>;
}

export * from './git';
export * from './jj';

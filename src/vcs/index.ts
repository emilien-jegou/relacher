import type { Commit } from '../types';

export interface VcsProvider {
  getCommits(name: string, watch: string[]): Promise<Commit[]>;
  commit(message: string): Promise<void>;
  tag(tagName: string): Promise<void>;
}

export * from './git';
export * from './jj';

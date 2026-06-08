import type { Commit, DependencyUpdateReport } from '../types';

export * from './changelog';
export * from './json';
export * from './regex';
export * from './toml';

export type UpdateActionOptions = {
  newVersion: string;
  globalCommits: Commit[];
  crateCommits: Commit[];
};

export interface UpdateActionResolved {
  kind: string;
  path: string;
  apply(report: DependencyUpdateReport, reports: DependencyUpdateReport[], cwd: string): void;
  params: any;
}

export interface UpdateAction {
  kind: string;
  path: string;
  required?: boolean;
  params: any;
  prepare(data: UpdateActionOptions): UpdateActionResolved;
}

export interface VersionFallback {
  readFallback(cwd: string): string | null;
}

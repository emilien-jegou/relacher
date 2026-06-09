import type { Commit, DependencyUpdateReport } from '../types';

export type UpdateActionOptions = {
  newVersion: string;
  globalCommits: Commit[];
  crateCommits: Commit[];
};

export interface UpdateActionResolved {
  kind: string;
  targetPath: string;
  apply(report: DependencyUpdateReport, reports: DependencyUpdateReport[], cwd: string): void;
  params: any;
  preparedData: any;
}

export interface UpdateAction {
  kind: string;
  path: string;
  required?: boolean;
  params: any;
  prepare(data: UpdateActionOptions): UpdateActionResolved;
  skipIf(fn: (cwd: string) => boolean): this;
  _skipIf(cwd: string): boolean;
}

export interface VersionFallback {
  readFallback(cwd: string): string | null;
}

export type ApplyActionFnArgs<T, K = undefined> = {
  params: T;
  targetPath: string;
  options: UpdateActionOptions;
  report: DependencyUpdateReport;
  reports: DependencyUpdateReport[];
  cwd: string;
  preparedData: K;
};

type ApplyActionFn<T, K = undefined> = (args: ApplyActionFnArgs<T, K>) => void;

export type PrepareActionFnArgs<T> = {
  params: T;
  targetPath: string;
  options: UpdateActionOptions;
};

type PrepareActionFn<T, K> = (args: PrepareActionFnArgs<T>) => K;

type UpdateBuilderParams<T, K = undefined> = {
  kind: string;
  apply: ApplyActionFn<T, K>;
  prepare?: PrepareActionFn<T, K>;
};

export const updateBuilder =
  <T, K = undefined>({ kind, apply, prepare }: UpdateBuilderParams<T, K>) =>
    (targetPath: string, params: T & { required?: boolean }) => {
      let skipIfCallback: ((cwd: string) => boolean) | undefined;

      const action: UpdateAction = {
        kind,
        path: targetPath,
        params,
        required: params.required,
        skipIf(fn: (cwd: string) => boolean) {
          skipIfCallback = fn;
          return this;
        },
        _skipIf(cwd: string) {
          return skipIfCallback ? skipIfCallback(cwd) : false;
        },
        prepare(options: UpdateActionOptions): UpdateActionResolved {
          const preparedData = prepare?.({ params, targetPath, options }) as K;

          return {
            kind,
            targetPath,
            params,
            preparedData,
            apply(report: DependencyUpdateReport, reports: DependencyUpdateReport[], cwd: string) {
              if (skipIfCallback?.(cwd)) {
                return;
              }
              apply({
                preparedData,
                targetPath,
                params,
                options,
                report,
                reports,
                cwd,
              });
            },
          };
        },
      };

      return action;
    };

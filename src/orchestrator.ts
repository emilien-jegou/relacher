import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';

import { Effect } from 'effect';

import { type PackageList } from './builder';
import { log, prettyPrint, printDependencyList } from './display';
import { init } from './init';
import { prepare } from './prepare';
import { run } from './run';
import type { PreparedUpdate } from './types';
import { makeGitVcsProvider, makeJjVcsProvider, VcsProviderService, type VcsProvider } from './vcs';
import { isInsideJjWorkTree } from './vcs/common';
import {
  makeRCVersionManager,
  VersionManagerService,
  type CascadeRules,
  type SizePatterns,
  type BumpSize,
} from './versioning';

// Replace lines 20-35 in src/orchestrator.ts:
export interface RelacherConfig {
  cwd?: string;
  packages: PackageList;
  vcs?: 'git' | 'jj' | VcsProvider;
  rcIdentifier?: string;
  sizes?: SizePatterns;
  cascade?: CascadeRules;
  excludeNestedWatches?: boolean;
  /** Force a bump size across all packages (e.g. true for patch, or 'minor' / 'major') */
  force?: boolean | BumpSize;
  /** Selectively force bump sizes for specific packages */
  forcePackages?: Record<string, BumpSize>;
  commitTitle?: (bumps: Record<string, string>, defaultTitle: string) => string;
}

export function createRelacher(config: RelacherConfig) {
  const cwd = config.cwd || process.cwd();

  let vcs: VcsProvider;
  if (config.vcs && typeof config.vcs === 'object') {
    vcs = config.vcs;
  } else if (config.vcs === 'git') {
    vcs = makeGitVcsProvider(cwd);
  } else if (config.vcs === 'jj') {
    vcs = makeJjVcsProvider(cwd);
  } else {
    vcs = isInsideJjWorkTree(cwd) ? makeJjVcsProvider(cwd) : makeGitVcsProvider(cwd);
  }

  const createVM = (mode: 'release' | 'pre-release') => {
    return makeRCVersionManager(vcs, {
      upgradeReady: mode === 'release',
      rcIdentifier: config.rcIdentifier ?? 'rc',
      sizes: config.sizes,
      cascade: config.cascade,
    });
  };

  return {
    vcs,

    async init(): Promise<void> {
      const program = init(config.packages, { cwd }).pipe(
        Effect.provideService(VcsProviderService, vcs),
      );
      return Effect.runPromise(program);
    },


    async prepare(
      options: {
        mode?: 'release' | 'pre-release';
        force?: boolean | BumpSize;
        forcePackages?: Record<string, BumpSize>;
      } = {},
    ): Promise<PreparedUpdate> {
      const mode = options.mode || 'release';
      const vm = createVM(mode);

      const program = prepare(config.packages, {
        cwd,
        excludeNestedWatches: config.excludeNestedWatches ?? true,
        force: options.force ?? config.force,
        forcePackages: options.forcePackages ?? config.forcePackages,
      }).pipe(
        Effect.provideService(VersionManagerService, vm),
        Effect.provideService(VcsProviderService, vcs),
      );

      return Effect.runPromise(program);
    },
    async run(prepared: PreparedUpdate): Promise<void> {
      const program = run(prepared, {
        cwd,
        commitTitle: (defaultTitle, bumps) =>
          config.commitTitle ? config.commitTitle(bumps, defaultTitle) : defaultTitle,
      }).pipe(Effect.provideService(VcsProviderService, vcs));

      return Effect.runPromise(program);
    },

    async cli(argv: string[] = process.argv.slice(2)): Promise<void> {
      const dryRun = argv.includes('--dry-run');
      const yes = argv.includes('-y') || argv.includes('--yes');

      // Parse force / empty flags
      const forceFlagIdx = argv.findIndex((a) => a === '--force');
      const hasEmptyFlag = argv.includes('--empty');
      let forceOption: boolean | BumpSize | undefined = undefined;

      if (forceFlagIdx !== -1 && argv[forceFlagIdx + 1] && !argv[forceFlagIdx + 1]?.startsWith('-')) {
        forceOption = argv[forceFlagIdx + 1] as BumpSize;
      } else if (forceFlagIdx !== -1 || hasEmptyFlag) {
        forceOption = true;
      }

      const positional = argv.filter((a) => !a.startsWith('-') && a !== forceOption);
      const command = positional[0] as 'init' | 'pre-release' | 'release' | undefined;

      if (!command || !['init', 'pre-release', 'release'].includes(command)) {
        log.error(
          [
            'Invalid or missing release command.',
            '',
            'Usage:',
            '  relacher pre-release [--force] [--dry-run] [-y]',
            '  relacher release     [--force [patch|minor|major]] [--dry-run] [-y]',
            '  relacher init',
          ].join('\n'),
        );
        process.exit(1);
      }

      try {
        log.step(`Preflight checks & Workspace Discovery (${log.c.bold(command.toUpperCase())} mode)`);
        log.step(`Scanned ${config.packages.length} package(s)`);
        printDependencyList(config.packages, true);

        if (command === 'init') {
          await this.init();
          log.ok('.relacher.lock initialized successfully.');
          return;
        }

        const updates = await this.prepare({ mode: command, force: forceOption });
        log.step('Proposed Updates');
        prettyPrint(updates);

        if (updates.isEmpty) {
          log.ok('Everything is up to date.');
          return;
        }

        if (dryRun) {
          log.step('Dry run active');
          log.warn('No modifications written to disk.');
          return;
        }

        if (!yes) {
          const rl = readline.createInterface({ input, output });
          const answer = await rl.question(`\nProceed with staging and committing ${command} updates? [y/N] `);
          rl.close();

          if (answer.trim().toLowerCase() !== 'y') {
            log.warn('Aborting execution flow.');
            return;
          }
        }

        log.step('Applying updates and writing changes');
        await this.run(updates);
        log.ok(`Release completed successfully under ${command} mode.`);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  };
}

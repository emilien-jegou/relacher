import fs from 'node:fs';
import path from 'node:path';

import { Effect } from 'effect';

import {
  prepare,
  prettyPrint,
  run,
  runGit,
  VcsProviderService,
  VersionManagerService,
} from '../src';
import type { ChangelogContext } from '../src';
import { loadPnpmDeps } from '../src/builder/pnpm';
import { changelogUpdate, regexUpdate } from '../src/updater';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeRCVersionManager } from '../src/versioning/rc-version-manager';
import { mktemp, repo } from '../tests/utils';

// Utility helper to group an array of objects by a string property
function groupBy<T, K extends keyof T>(arr: T[], key: K): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const group = String(item[key]);
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    },
    {} as Record<string, T[]>,
  );
}

// 1-to-1 Translation of the git-cliff Jinja/Tera template using pure TypeScript
function cliffTemplate({ version, date, commits }: ChangelogContext): string {
  let lines = [version ? `## [${version.replace(/^v/, '')}] - ${date}` : `## [Unreleased]`];

  const grouped = groupBy(commits, 'type');

  for (const [group, groupList] of Object.entries(grouped)) {
    lines.push(`### ${group.charAt(0).toUpperCase() + group.slice(1)}`);
    for (const commit of groupList) {
      const breaking = commit.isBreaking ? `[**breaking**] ` : ``;
      const scope = commit.scope ? `**${commit.scope}:** ` : ``;
      const msg = commit.description.charAt(0).toUpperCase() + commit.description.slice(1);
      lines.push(
        `- ${breaking}${scope}${msg} — [\`${commit.shortHash}\`](https://github.com/commit/${commit.hash}) by ${commit.author}`,
      );
    }
  }

  return lines.join('\n');
}

const runRcExample = Effect.gen(function*() {
  const temp = mktemp();
  const tempDir = temp.path;

  // ==========================================================
  // INITIAL STAGE & STAGE 1 COMMITS
  // ==========================================================
  repo(tempDir)
    .commit('chore: base workspace setup', (c) =>
      c
        .update('pnpm-workspace.yaml', () => "packages:\n  - 'packages/*'\n")
        .update('package.json', () =>
          JSON.stringify({ name: 'workspace-root', private: true }, null, 2),
        )
        .update('packages/core_lib/package.json', () =>
          JSON.stringify({ name: 'core_lib', version: '1.0.0' }, null, 2),
        )
        .update('packages/plugin_api/package.json', () =>
          JSON.stringify(
            {
              name: 'plugin_api',
              version: '0.2.0',
              dependencies: {
                core_lib: 'workspace:^1.0.0',
              },
            },
            null,
            2,
          ),
        )
        .update('packages/cli_tool/package.json', () =>
          JSON.stringify(
            {
              name: 'cli_tool',
              version: '3.1.2',
              dependencies: {
                plugin_api: 'workspace:^0.2.0',
              },
            },
            null,
            2,
          ),
        )
        .update('flake.nix', () => `{\n  version = "3.1.2";\n}\n`)
        .update('README.md', () => `# CLI Tool v3.1.2\n`),
    )
    // Mark stable release tag checkpoints
    .write_lock('core_lib-v1.0.0')
    .write_lock('cli_tool-v3.1.2')

    // Simulate development leading up to Cycle 1 Release
    .commit('fix(engine)!: critical resource leak addressed', (c) =>
      c.update('packages/core_lib/src/lib.rs', () => '// breaking change ' + c.getRandomText(8)),
    )
    .commit('feat: support structured configuration formats', (c) =>
      c.update(
        'packages/plugin_api/src/lib.rs',
        (x) => x + '\n// minor addition ' + c.getRandomText(8),
      ),
    )
    .commit('fix(cli): resolve CLI argument parsing issue', (c) =>
      c.update('packages/cli_tool/src/main.rs', () => '// fix CLI argument parsing'),
    );

  console.log('\n\x1b[1m=== RELEASE CYCLE 1: RC MODE (rc.0) ===\x1b[0m');

  const PnpmDeps1 = loadPnpmDeps(tempDir).onPackageBump(
    'cli_tool',
    regexUpdate('./flake.nix', {
      search: 'version = "[^"]+"',
      replace: 'version = "{{version}}"',
    }),
    regexUpdate('./README.md', {
      onlyOn: ['major', 'minor', 'patch'],
      search: 'CLI Tool v[^\\s]+',
      replace: 'CLI Tool v{{version}}',
    }),
    changelogUpdate('./packages/cli_tool/CHANGELOG.md', {
      onlyOn: ['major', 'minor', 'patch'],
    }),
    changelogUpdate('./CHANGELOG.md', {
      onlyOn: ['major', 'minor', 'patch'],
      global: true,
      template: cliffTemplate,
    }),
  );

  const vcs1 = makeJjVcsProvider(tempDir);

  const vm1 = makeRCVersionManager(vcs1, {
    upgradeReady: false, // Activating RC mode
    sizes: {
      major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
      minor: { pattern: '^feat|^revert' },
      patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
      skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
    },
  });

  const updates1 = yield* prepare(PnpmDeps1, {
    cwd: tempDir,
  }).pipe(Effect.provideService(VersionManagerService, vm1));

  prettyPrint(updates1);

  // Apply Cycle 1 Updates (Modifies packages, creates package versions such as v2.0.0-rc.0, etc.)
  yield* run(updates1, { cwd: tempDir }).pipe(Effect.provideService(VcsProviderService, vcs1));
  console.log(`\n\x1b[1m✅ Cycle 1 Release applied successfully under RC mode.\x1b[0m`);

  // ==========================================================
  // CYCLE 2: OUT OF RC MODE -> PROMOTE TO STABLE
  // ==========================================================
  console.log('\n\x1b[1m=== DEVELOPMENT RESUMES: CYCLE 2 (PROMOTING TO STABLE) ===\x1b[0m');

  repo(tempDir).commit('fix(core): resolve core engine thread contention', (c) =>
    c.update(
      'packages/core_lib/src/lib.rs',
      (x) => x + '\n// resolve thread contention ' + c.getRandomText(8),
    ),
  );

  const PnpmDeps2 = loadPnpmDeps(tempDir).onPackageBump(
    'cli_tool',
    regexUpdate('./flake.nix', {
      search: 'version = "[^"]+"',
      replace: 'version = "{{version}}"',
    }),
    regexUpdate('./README.md', {
      onlyOn: ['major', 'minor', 'patch'],
      search: 'CLI Tool v[^\\s]+',
      replace: 'CLI Tool v{{version}}',
    }),
    changelogUpdate('./packages/cli_tool/CHANGELOG.md', {
      onlyOn: ['major', 'minor', 'patch'],
    }),
    changelogUpdate('./CHANGELOG.md', {
      onlyOn: ['major', 'minor', 'patch'],
      global: true,
      template: cliffTemplate,
    }),
  );

  const vcs2 = makeJjVcsProvider(tempDir);

  const vm2 = makeRCVersionManager(vcs2, {
    upgradeReady: true, // Exit RC mode and promote target version to stable
    sizes: {
      major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
      minor: { pattern: '^feat|^revert' },
      patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
      skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
    },
  });

  const updates2 = yield* prepare(PnpmDeps2, {
    cwd: tempDir,
  }).pipe(Effect.provideService(VersionManagerService, vm2));

  prettyPrint(updates2);

  // Apply Cycle 2 Updates (Cleans RC suffix, resolving to final stable versions like v2.0.0, etc.)
  yield* run(updates2, { cwd: tempDir }).pipe(Effect.provideService(VcsProviderService, vcs2));
  console.log(`\n\x1b[1m✅ Cycle 2 Release applied successfully and promoted to stable.\x1b[0m`);

  // ==========================================================
  // FINAL HISTORY VERIFICATION
  // ==========================================================
  console.log(`\n\x1b[1m📊 Final Git History (Last 4 Commits):\x1b[0m`);
  console.log(yield* runGit('git log --oneline -n 4', tempDir));
  console.log(`\n\x1b[1m🏷 Final lockfile:\x1b[0m`);
  const doc = fs.readFileSync(path.join(tempDir, '.relacher.lock'), 'utf8');
  console.log(JSON.stringify(JSON.parse(doc)));

  console.log('Repo path:', tempDir);
});

await Effect.runPromise(runRcExample).catch(console.error);

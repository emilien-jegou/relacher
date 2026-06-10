import { Effect } from 'effect';

import { prepare, cargoDeps, prettyPrint, run, runGit, VcsProviderService } from '../src';
import type { ChangelogContext } from '../src';
import { changelogUpdate, regexUpdate } from '../src/updater';
import { makeJjVcsProvider } from '../src/vcs/jj';
import { makeVcsVersionManager, VersionManagerService } from '../src/versioning';
import { mktemp, repo, toml } from '../tests/utils';

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

const runComplexExample = Effect.gen(function*() {
  const temp = mktemp();
  const tempDir = temp.path;

  // ==========================================================
  // CYCLE 1: INITIAL STAGE & CYCLE 1 COMMITS
  // ==========================================================
  repo(tempDir)
    .commit('chore: base workspace setup', (c) =>
      c
        .update('Cargo.toml', () =>
          toml().section('workspace').kv('members', ['crates/*']).kv('resolver', '2').build(),
        )
        .update('crates/core_lib/Cargo.toml', () =>
          toml().section('package').kv('name', 'core_lib').kv('version', '1.0.0').build(),
        )
        .update('crates/plugin_api/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'plugin_api')
            .kv('version', '0.2.0')
            .section('dependencies')
            .kv('core_lib', { path: '../core_lib', version: '1.0.0' })
            .build(),
        )
        .update('crates/cli_tool/Cargo.toml', () =>
          toml()
            .section('package')
            .kv('name', 'cli_tool')
            .kv('version', '3.1.2')
            .section('dependencies')
            .kv('plugin_api', { path: '../plugin_api', version: '0.2.0' })
            .build(),
        )
        .update('flake.nix', () => `{\n  version = "3.1.2";\n}\n`)
        .update('README.md', () => `# CLI Tool v3.1.2\n`),
    )
    // Mark release checkpoint for two out of three deps
    .tag('core_lib-v1.0.0')
    .tag('cli_tool-v3.1.2')

    // Simulate development leading up to Cycle 1 Release
    .commit('fix(engine)!: critical resource leak addressed', (c) =>
      c.update('crates/core_lib/src/lib.rs', () => '// breaking change ' + c.getRandomText(8)),
    )
    .commit('feat: support structured configuration formats', (c) =>
      c.update(
        'crates/plugin_api/src/lib.rs',
        (x) => x + '\n// minor addition ' + c.getRandomText(8),
      ),
    )
    .commit('fix(cli): resolve CLI argument parsing issue', (c) =>
      c.update('crates/cli_tool/src/main.rs', () => '// fix CLI argument parsing'),
    )
    .commit('docs(cli): improve developer help interface', (c) =>
      c.update('crates/cli_tool/src/main.rs', (x) => x + '\n// trivial doc fix'),
    );

  console.log('\n\x1b[1m=== RELEASE CYCLE 1: INITIAL STAGE ===\x1b[0m');

  const CargoDeps1 = cargoDeps(tempDir).on('cli_tool', (c) =>
    c
      .update(
        regexUpdate('./flake.nix', {
          search: 'version = "[^"]+"',
          replace: 'version = "{{version}}"',
        }),
      )
      .update(
        regexUpdate('./README.md', {
          onlyOn: ['major', 'minor', 'patch'],
          search: 'CLI Tool v[^\\s]+',
          replace: 'CLI Tool v{{version}}',
        }),
      )
      .update(
        changelogUpdate('./crates/cli_tool/CHANGELOG.md', {
          onlyOn: ['major', 'minor', 'patch'],
        }),
      )
      .update(
        changelogUpdate('./CHANGELOG.md', {
          onlyOn: ['major', 'minor', 'patch'],
          global: true,
          template: cliffTemplate,
        }),
      ),
  );

  const vcs1 = makeJjVcsProvider(tempDir);

  const vm1 = makeVcsVersionManager(vcs1, {
    sizes: {
      major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
      minor: { pattern: '^feat|^revert' },
      patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
      skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
    },
    cascade: {
      patch: {
        skip: 'patch',
        patch: 'patch',
        minor: 'minor',
        major: 'minor',
      },
    },
  });

  const updates1 = yield* prepare(CargoDeps1, {
    cwd: tempDir,
  }).pipe(Effect.provideService(VersionManagerService, vm1));

  prettyPrint(updates1);

  // Apply Cycle 1 Updates (Modifies workspace files, commits, and creates core_lib-v2.0.0, etc.)
  yield* run(updates1, { cwd: tempDir }).pipe(Effect.provideService(VcsProviderService, vcs1));
  console.log(`\n\x1b[1m✅ Cycle 1 Release applied successfully.\x1b[0m`);

  // ==========================================================
  // CYCLE 2: RESUME WORK & CYCLE 2 COMMITS
  // ==========================================================
  console.log('\n\x1b[1m=== DEVELOPMENT RESUMES: CYCLE 2 ===\x1b[0m');

  repo(tempDir)
    .commit('fix(core): resolve core engine thread contention', (c) =>
      c.update(
        'crates/core_lib/src/lib.rs',
        (x) => x + '\n// resolve thread contention ' + c.getRandomText(8),
      ),
    )
    .commit('feat(ui): add progress indicator to execution flow', (c) =>
      c.update(
        'crates/cli_tool/src/main.rs',
        (x) => x + '\n// progress bar indicators ' + c.getRandomText(8),
      ),
    );

  // Re-discover dependencies (reads the fresh version configurations written by the first cycle)
  const CargoDeps2 = cargoDeps(tempDir).on('cli_tool', (c) =>
    c
      .update(
        regexUpdate('./flake.nix', {
          search: 'version = "[^"]+"',
          replace: 'version = "{{version}}"',
        }),
      )
      .update(
        regexUpdate('./README.md', {
          search: 'CLI Tool v[^\\s]+',
          replace: 'CLI Tool v{{version}}',
        }),
      )
      .update(changelogUpdate('./crates/cli_tool/CHANGELOG.md', {}))
      .update(
        changelogUpdate('./CHANGELOG.md', {
          global: true,
          template: cliffTemplate,
        }),
      ),
  );

  // Re-instantiate the VCS Provider to pick up newly added commits and release tags
  const vcs2 = makeJjVcsProvider(tempDir);

  const vm2 = makeVcsVersionManager(vcs2, {
    sizes: {
      major: { pattern: '^[a-z]+(?:\\([^)]+\\))?!:|BREAKING CHANGE' },
      minor: { pattern: '^feat|^revert' },
      patch: { pattern: '^fix|^build|^refactor|^nit|^style' },
      skip: { pattern: '^release|^chore|^infra|^docs|^test|^ci|^build' },
    },
    cascade: {
      patch: {
        skip: 'patch',
        patch: 'patch',
        minor: 'minor',
        major: 'minor',
      },
    },
  });

  const updates2 = yield* prepare(CargoDeps2, {
    cwd: tempDir,
  }).pipe(Effect.provideService(VersionManagerService, vm2));

  prettyPrint(updates2);

  // Apply Cycle 2 Updates (Creates core_lib-v2.0.1, cli_tool-v3.3.0, etc.)
  yield* run(updates2, { cwd: tempDir }).pipe(Effect.provideService(VcsProviderService, vcs2));
  console.log(`\n\x1b[1m✅ Cycle 2 Release applied successfully.\x1b[0m`);

  // ==========================================================
  // FINAL HISTORY VERIFICATION
  // ==========================================================
  console.log(`\n\x1b[1m📊 Final Git History (Last 4 Commits):\x1b[0m`);
  console.log(yield* runGit('git log --oneline -n 4', tempDir));
  console.log(`\n\x1b[1m🏷 Final Tags Created:\x1b[0m`);
  console.log(yield* runGit('git tag -l "*-v*"', tempDir));

  console.log('Repo:', tempDir);
});

await Effect.runPromise(runComplexExample).catch(console.error);

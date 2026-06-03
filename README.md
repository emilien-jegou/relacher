# Relacher

![NPM Version](https://img.shields.io/npm/v/relacher?color=green)
![NPM Downloads](https://img.shields.io/npm/dw/relacher?label=npm)
[![License](https://img.shields.io/github/license/emilien-jegou/oyui)](./LICENSE)

**Relacher** is a scriptable, workspace-aware release orchestration library designed for monorepos.

```
📦 cli_tool     3.1.2 → 3.3.0 [minor]
   flake.nix  README.md  CHANGELOG.md  CHANGELOG.md
     ✦ 4a0ce62 feat(ui): add progress indicator to execution flow  Author 2025-01-30
     ✦ Cascaded as [minor] from deps: plugin_api [minor]
```

## Features

* 🤖 **Conventional Commits Engine:** Analyzes commit patterns to determine if modifications warrant a `patch`, `minor`, or `major` bump.
* 🔗 **Topological Cascading Rules:** Automatically tracks internal crate dependencies, propagating downstream version updates throughout your workspace.
* 🛠️ **TypeScript-First Configuration:** Declare, modify, and customize your release steps in code (via Bun, Deno, or Node) rather than static YAML or TOML configs.
* 📝 **Custom Changelog Rendering:** Flexible templating interfaces to format changelog files with precise controls.

---

### Why another Versionning tool?

Most releases tools are configuration based, they often run as "all-or-nothing" CI black boxes. You execute the command, and it commits, tags, and publishes automatically. Think of them as large functions that take your whole toml config and repo state as arguments.

Since relacher is exposed as a typescript library you have full control of each step of the release lifecycle, you can replace or extends blocks as-needed without needing an extensive plugin system.

```typescript
  // cargoDeps will analyzer your workspace and form a graph of every crates
  const CargoDeps = cargoDeps(tempDir).on('cli_tool', (c) => c
      .update(
        regexUpdate({
          path: './flake.nix',
          search: 'version = "[^"]+"',
          replace: 'version = "{{version}}"',
        }),
      )
      .update(
        regexUpdate({
          path: './README.md',
          search: 'CLI Tool v[^\\s]+',
          replace: 'CLI Tool v{{version}}',
        }),
      )
      .update(
        changelogUpdate({
          path: './crates/cli_tool/CHANGELOG.md',
        }),
      )
      .update(
        changelogUpdate({
          path: './CHANGELOG.md',
          global: true,
          template: cliffTemplate,
        }),
      ),
  );

  // this is how a crate is stored internally (simplified), notice how it's
  // just a toml parser under the hood, no mention of rust, you can copy the
  // source code of the cargo parser and pretty much adapt it to any setup of your
  // liking:
  //
  // {
  //  "name": "cli_tool",
  //  "watch": ["crates/cli_tool"],
  //  "depends": ["plugin_api"],
  //  "updates": [
  //     {
  //      "kind": "toml",
  //      "path": "crates/cli_tool/Cargo.toml",
  //      "toml": "package.version"
  //     },
  //     // flake.nix, regex, changelog...
  //  ]
  // }

  // ... You could prepare more actions here, like adding npm deps.

  const vcs = new JjVcsProvider(tempDir);

  const updates = await prepare(CargoDeps, vcs, {
    cwd: tempDir,
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

  prettyPrint(updates);

  const ans = prompt("Proceed with staging and committing release? [y/N]");
  if (ans?.trim().toLowerCase() === "y") {
    await run(updates, vcs, { cwd: root });
    console.log("Release tags and files written successfully.");
  }
```

## 📦 Installation

Add `relacher` to your JavaScript or TypeScript workspace:

```sh
bun add relacher --dev
# or
pnpm install relacher --save-dev
```

---

## 🛠️ Configuration & Customization

### Designing Custom Changelogs
You can supply your own renderer directly through the `template` option in `changelogUpdate`:

```typescript
import type { ChangelogContext } from "relacher";

function customTemplate({ version, date, commits }: ChangelogContext): string {
  let lines = [`## [${version}] - ${date}\n`];

  for (const commit of commits) {
    const icon = commit.isBreaking ? "⚠️" : commit.type === "feat" ? "✨" : "🐛";
    lines.push(`- ${icon} **${commit.scope || "general"}:** ${commit.description}`);
  }

  return lines.join("\n");
}
```

---

## 🙏 Credits

* [git-cliff](https://github.com/orhun/git-cliff)
* [versio](https://github.com/chaaz/versio)

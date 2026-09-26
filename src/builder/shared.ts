import path from 'node:path';

import type { ChangelogContext, PackageConfig } from '../types';
import {
  changelogUpdate,
  githubChangelogTemplate,
  regexUpdate,
  type UpdateAction,
  type VersionFallback,
} from '../updater';
import type { BumpSize } from '../versioning/types';

export interface PackageListError {
  name: string;
  message: string;
}

export class PackageList extends Array<PackageConfig> {
  public errors: PackageListError[] = [];

  public static create(configs: PackageConfig[] = []): PackageList {
    const list = new PackageList(...configs);
    if ('errors' in configs && Array.isArray((configs as { errors: PackageListError[] }).errors)) {
      list.errors.push(...(configs as { errors: PackageListError[] }).errors);
    }
    return list;
  }

  public append(newConfigs: PackageConfig[] | PackageList): this {
    this.push(...newConfigs);
    if ('errors' in newConfigs && Array.isArray((newConfigs as PackageList).errors)) {
      this.errors.push(...(newConfigs as PackageList).errors);
    }
    return this;
  }

  public onPackageBump(name: string, ...actions: UpdateAction[]): this {
    const dep = this.find((d) => d.name === name);
    if (dep) {
      if (!dep.updates) dep.updates = [];
      dep.updates.push(...actions);
    } else {
      this.errors.push({
        name,
        message: `Cannot attach updates to unknown package '${name}'.`,
      });
    }
    return this;
  }

  public onAllPackages(...actions: UpdateAction[]): this {
    for (const pkg of this) {
      if (!pkg.updates) pkg.updates = [];
      pkg.updates.push(...actions);
    }
    return this;
  }

  public group(groupName: string, ...packageNames: string[]): this {
    for (const name of packageNames) {
      const pkg = this.find((p) => p.name === name);
      if (pkg) {
        pkg.group = groupName;
        pkg.coupled = pkg.coupled || [];
        for (const other of packageNames) {
          if (other !== name && !pkg.coupled.includes(other)) {
            pkg.coupled.push(other);
          }
        }
      } else {
        this.errors.push({
          name,
          message: `Cannot add unknown package '${name}' to group '${groupName}'.`,
        });
      }
    }
    return this;
  }

  public couple(...args: [string, string] | [string[]]): this {
    if (Array.isArray(args[0])) {
      for (const groupMembers of args as string[][]) {
        this.group(`coupled__${groupMembers.join('__')}`, ...groupMembers);
      }
      return this;
    }
    const [a, b] = args as [string, string];
    return this.group(`coupled__${a}__${b}`, a, b);
  }

  /**
   * Automatically adds a CHANGELOG.md update action to each package's directory.
   * Defaults to onlyOn: ['major', 'minor', 'patch'] so pre-releases are skipped.
   */
  public withChangelogs(options?: {
    only?: string[];
    exclude?: string[];
    onlyOn?: BumpSize[];
    template?: (ctx: ChangelogContext) => string;
  }): this {
    const onlyOn = options?.onlyOn ?? ['major', 'minor', 'patch'];

    for (const pkg of this) {
      if (options?.only && !options.only.includes(pkg.name)) continue;
      if (options?.exclude && options.exclude.includes(pkg.name)) continue;

      const pkgDir = pkg.watch?.[0] || '.';
      const changelogPath = path.posix.join(pkgDir.replace(/\\/g, '/'), 'CHANGELOG.md');

      this.onPackageBump(
        pkg.name,
        changelogUpdate(changelogPath, {
          onlyOn,
          template: options?.template,
        }),
      );
    }
    return this;
  }

  /**
   * Attaches a workspace-wide root CHANGELOG.md that captures all changes across packages.
   * Defaults to onlyOn: ['major', 'minor', 'patch'] so pre-releases are skipped.
   */
  public withRootChangelog(options?: {
    github?: string;
    path?: string;
    onlyOn?: BumpSize[];
    template?: (ctx: ChangelogContext) => string;
  }): this {
    const changelogPath = options?.path || 'CHANGELOG.md';
    const template = options?.template ?? (options?.github ? githubChangelogTemplate(options.github) : undefined);
    const onlyOn = options?.onlyOn ?? ['major', 'minor', 'patch'];

    this.onAllPackages(
      changelogUpdate(changelogPath, {
        global: true,
        onlyOn,
        template,
      }),
    );
    return this;
  }

  /**
   * Declaratively syncs a package version to any file on disk (e.g. `flake.nix`, `README.md`).
   * Supports `options.onlyOn` to restrict updates to specific bump types.
   */
  public syncVersion(
    packageName: string,
    filePath: string,
    pattern: string | RegExp = 'version = "[^"]+"',
    replaceTemplate = 'version = "{{version}}"',
    options?: { onlyOn?: BumpSize[] },
  ): this {
    const search = typeof pattern === 'string' ? pattern : pattern.source;
    return this.onPackageBump(
      packageName,
      regexUpdate(filePath, {
        search,
        replace: replaceTemplate,
        onlyOn: options?.onlyOn,
      }),
    );
  }

  public assertFound(...names: string[]): this {
    for (const name of names) {
      if (!this.some((p) => p.name === name)) {
        this.errors.push({
          name,
          message: `Package '${name}' was not found in the list.`,
        });
      }
    }
    return this;
  }

  public addDepsOn(pkgName: string, dependsOn: string | string[]): this {
    const pkg = this.find((p) => p.name === pkgName);
    if (!pkg) {
      this.errors.push({
        name: pkgName,
        message: `Cannot add dependencies to unknown package '${pkgName}'.`,
      });
      return this;
    }

    const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
    for (const dep of deps) {
      const target = this.find((p) => p.name === dep);
      if (!target) {
        this.errors.push({
          name: pkgName,
          message: `Cannot depend on '${dep}' because it is not in scope. Make sure it is appended to the builder before calling addDepsOn.`,
        });
      } else {
        if (!pkg.depends) pkg.depends = [];
        if (!pkg.depends.includes(dep)) pkg.depends.push(dep);
      }
    }
    return this;
  }

  public ignore(...names: string[]): this {
    const filtered = this.filter((p) => !names.includes(p.name));
    this.length = 0;
    this.push(...filtered);
    return this;
  }

  public only(...names: string[]): this {
    const filtered = this.filter((p) => names.includes(p.name));
    this.length = 0;
    this.push(...filtered);
    return this;
  }

  public addWatchFiles(pkgName: string, paths: string | string[]): this {
    const pkg = this.find((p) => p.name === pkgName);
    if (!pkg) {
      this.errors.push({
        name: pkgName,
        message: `Cannot add watch files to unknown package '${pkgName}'.`,
      });
      return this;
    }

    if (!pkg.watch) pkg.watch = [];
    const pathsArray = Array.isArray(paths) ? paths : [paths];
    pkg.watch.push(...pathsArray);
    return this;
  }

  public setVersionFallback(pkgName: string, fallback: VersionFallback): this {
    const pkg = this.find((p) => p.name === pkgName);
    if (!pkg) {
      this.errors.push({
        name: pkgName,
        message: `Cannot set version fallback for unknown package '${pkgName}'.`,
      });
      return this;
    }
    pkg.versionFallback = fallback;
    return this;
  }
}

export function createPackageList(configs: PackageConfig[] = []): PackageList {
  return PackageList.create(configs);
}

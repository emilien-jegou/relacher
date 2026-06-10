import type { PackageConfig } from '../types';
import type { UpdateAction, VersionFallback } from '../updater';

export interface PackageListError {
  name: string;
  message: string;
}

export interface PackageList extends Array<PackageConfig> {
  /** Internal array storing any validation/scoping errors */
  errors: PackageListError[];

  /** Merges another list or array of configs into this one, inheriting any errors */
  append(configs: PackageConfig[]): this;

  /** Attaches update actions (e.g. file replacements, changelogs) to a specific package */
  onPackageBump(name: string, ...actions: UpdateAction[]): this;

  /** Attaches update actions to ALL packages currently in the list */
  onAllPackages(...actions: UpdateAction[]): this;

  /**
   * Couples two packages together so that if one bumps, the other bumps to the exact same version.
   * Useful for tightly integrated monorepo packages (e.g. core & cli).
   */
  couple(a: string, b: string): this;

  /** Validates that the provided packages exist in the current scope */
  assertFound(...names: string[]): this;

  /** Adds dependency linkages, enforcing that the target dependency is already in scope */
  addDepsOn(pkgName: string, dependsOn: string | string[]): this;

  /** Removes the specified packages from the list entirely */
  ignore(...names: string[]): this;

  /** Removes ALL packages from the list EXCEPT the specified ones */
  only(...names: string[]): this;

  /** Adds custom file paths to watch for changes that should trigger a bump for this package */
  addWatchFiles(pkgName: string, paths: string | string[]): this;

  /** Overrides the fallback strategy used if the package has no previously published tags */
  setVersionFallback(pkgName: string, fallback: VersionFallback): this;
}

export function createPackageList(configs: PackageConfig[] = []): PackageList {
  const list = [...configs] as PackageList;

  // Inherit errors if initialized with an existing PackageList
  list.errors =
    'errors' in configs && Array.isArray((configs as any).errors)
      ? [...(configs as any).errors]
      : [];

  list.append = function(newConfigs: PackageConfig[]) {
    this.push(...newConfigs);

    // Bubble up errors from nested/appended PackageLists
    if ('errors' in newConfigs && Array.isArray((newConfigs as any).errors)) {
      this.errors.push(...(newConfigs as any).errors);
    }

    return this;
  };

  list.onPackageBump = function(name: string, ...actions: UpdateAction[]) {
    const dep = this.find((d) => d.name === name);
    if (dep) {
      if (!dep.updates) {
        dep.updates = [];
      }
      dep.updates.push(...actions);
    } else {
      this.errors.push({
        name,
        message: `Cannot attach updates to unknown package '${name}'.`,
      });
    }
    return this;
  };

  list.onAllPackages = function(...actions: UpdateAction[]) {
    for (const pkg of this) {
      if (!pkg.updates) {
        pkg.updates = [];
      }
      pkg.updates.push(...actions);
    }
    return this;
  };

  list.couple = function(a: string, b: string) {
    const itemA = this.find((d) => d.name === a) as any;
    const itemB = this.find((d) => d.name === b) as any;

    if (!itemA) this.errors.push({ name: a, message: `Cannot couple unknown package '${a}'.` });
    if (!itemB) this.errors.push({ name: b, message: `Cannot couple unknown package '${b}'.` });

    if (itemA && itemB) {
      itemA.coupled = itemA.coupled || [];
      itemB.coupled = itemB.coupled || [];
      if (!itemA.coupled.includes(b)) itemA.coupled.push(b);
      if (!itemB.coupled.includes(a)) itemB.coupled.push(a);
    }
    return this;
  };

  list.assertFound = function(...names: string[]) {
    for (const name of names) {
      if (!this.some((p) => p.name === name)) {
        this.errors.push({
          name,
          message: `Package '${name}' was not found in the list.`,
        });
      }
    }
    return this;
  };

  list.addDepsOn = function(pkgName: string, dependsOn: string | string[]) {
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
  };

  list.ignore = function(...names: string[]) {
    const filtered = this.filter((p) => !names.includes(p.name));
    this.length = 0; // clear current contents
    this.push(...filtered);
    return this;
  };

  list.only = function(...names: string[]) {
    const filtered = this.filter((p) => names.includes(p.name));
    this.length = 0; // clear current contents
    this.push(...filtered);
    return this;
  };

  list.addWatchFiles = function(pkgName: string, paths: string | string[]) {
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
  };

  list.setVersionFallback = function(pkgName: string, fallback: VersionFallback) {
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
  };

  return list;
}

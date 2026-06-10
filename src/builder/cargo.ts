import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'smol-toml';

import type { PackageConfig } from '../types';
import { tomlUpdate, tomlFallback } from '../updater';

import { createPackageList, type PackageList } from './shared';

export interface CargoBuilderOptions { }

interface PathDep {
  name: string;
  path: string;
}

function isWorkspace(cargoPath: string): boolean {
  try {
    const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as any;
    return !!doc?.workspace;
  } catch {
    return false;
  }
}

function checkDir(dir: string): { isRoot: boolean; hasCargo: boolean } {
  const cargoPath = path.join(dir, 'Cargo.toml');
  const hasCargo = fs.existsSync(cargoPath);
  return { isRoot: hasCargo && isWorkspace(cargoPath), hasCargo };
}

function findCargoWorkspaceRoot(cwd: string): string {
  let current = path.resolve(cwd);
  let bestRoot = current;
  while (true) {
    const { isRoot, hasCargo } = checkDir(current);
    if (isRoot) return current;
    if (hasCargo) bestRoot = current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return bestRoot;
}

function getPathFromVal(name: string, val: any, wsDeps: Record<string, any>): string | undefined {
  if (val && typeof val === 'object') {
    if (val.path) return val.path;
    if (val.workspace === true && wsDeps[name]?.path) {
      return wsDeps[name].path;
    }
  }
  return undefined;
}

function collectDepsFromBlock(block: any, wsDeps: Record<string, any>): PathDep[] {
  if (!block || typeof block !== 'object') return [];
  const list: PathDep[] = [];
  for (const [name, val] of Object.entries(block)) {
    const p = getPathFromVal(name, val, wsDeps);
    if (p) list.push({ name, path: p });
  }
  return list;
}

function collectTargetDeps(doc: any, wsDeps: Record<string, any>): PathDep[] {
  if (!doc.target || typeof doc.target !== 'object') return [];
  const list: PathDep[] = [];
  for (const targetValue of Object.values(doc.target)) {
    if (targetValue && typeof targetValue === 'object') {
      list.push(...collectDepsFromBlock((targetValue as any).dependencies, wsDeps));
      list.push(...collectDepsFromBlock((targetValue as any)['dev-dependencies'], wsDeps));
      list.push(...collectDepsFromBlock((targetValue as any)['build-dependencies'], wsDeps));
    }
  }
  return list;
}

function extractPathDependencies(doc: any, wsDeps: Record<string, any> = {}): PathDep[] {
  return [
    ...collectDepsFromBlock(doc.dependencies, wsDeps),
    ...collectDepsFromBlock(doc['dev-dependencies'], wsDeps),
    ...collectDepsFromBlock(doc['build-dependencies'], wsDeps),
    ...collectTargetDeps(doc, wsDeps),
  ];
}

class CrateScanner {
  workspaceRoot: string;
  workspaceDeps: Record<string, any>;
  discoveredPaths = new Set<string>();
  crateInfos: { name: string; memberPath: string; doc: any }[] = [];

  constructor(workspaceRoot: string, workspaceDeps: Record<string, any>) {
    this.workspaceRoot = workspaceRoot;
    this.workspaceDeps = workspaceDeps;
  }

  registerCrate(p: string) {
    const absPath = path.resolve(this.workspaceRoot, p);
    if (this.discoveredPaths.has(absPath)) return;
    this.discoveredPaths.add(absPath);
    const cargoPath = path.join(absPath, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return;
    try {
      const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as any;
      if (doc.package?.name) {
        this.crateInfos.push({ name: doc.package.name, memberPath: absPath, doc });
      }
    } catch { }
  }
}

function expandGlob(workspaceRoot: string, member: string): string[] {
  const globPath = path.join(workspaceRoot, member);
  if (!globPath.endsWith('*')) return [path.join(globPath, 'Cargo.toml')];
  const dir = path.dirname(globPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((d) => path.join(dir, d, 'Cargo.toml'));
}

function registerWorkspaceMembers(scanner: CrateScanner, rootDoc: any) {
  if (rootDoc.package?.name) {
    scanner.registerCrate(scanner.workspaceRoot);
  }
  const members = rootDoc.workspace?.members;
  if (!Array.isArray(members)) return;
  for (const member of members) {
    const paths = expandGlob(scanner.workspaceRoot, member).filter(fs.existsSync);
    paths.forEach((p) => scanner.registerCrate(path.dirname(p)));
  }
}

function runRecursiveDiscovery(scanner: CrateScanner) {
  let i = 0;
  while (i < scanner.crateInfos.length) {
    const info = scanner.crateInfos[i]!;
    const foundDeps = extractPathDependencies(info.doc, scanner.workspaceDeps);
    for (const dep of foundDeps) {
      const fullDepPath = path.resolve(info.memberPath, dep.path);
      scanner.registerCrate(fullDepPath);
    }
    i++;
  }
}

function updateBlockEntry(block: any, depName: string, newVersion: string) {
  const dep = block[depName];
  if (dep && typeof dep === 'object' && dep.version) {
    dep.version = newVersion;
  } else if (typeof dep === 'string') {
    block[depName] = newVersion;
  }
}

function syncDeps(block: any, reports: any[], selfName: string) {
  if (!block || typeof block !== 'object') return;
  for (const r of reports) {
    if (r.name !== selfName && block[r.name]) {
      updateBlockEntry(block, r.name, r.newVersion);
    }
  }
}

function syncAllBlocks(doc: any, reports: any[], selfName: string) {
  syncDeps(doc.dependencies, reports, selfName);
  syncDeps(doc['dev-dependencies'], reports, selfName);
  syncDeps(doc['build-dependencies'], reports, selfName);
  if (doc.target && typeof doc.target === 'object') {
    for (const targetVal of Object.values(doc.target)) {
      if (targetVal && typeof targetVal === 'object') {
        syncDeps((targetVal as any).dependencies, reports, selfName);
        syncDeps((targetVal as any)['dev-dependencies'], reports, selfName);
        syncDeps((targetVal as any)['build-dependencies'], reports, selfName);
      }
    }
  }
}

function createSelfUpdate(relativeCargo: string, selfName: string) {
  return tomlUpdate(relativeCargo, (doc, report, reports) => {
    if (doc.package) {
      doc.package.version = report.newVersion;
    }
    syncAllBlocks(doc, reports, selfName);
  });
}

function createLockUpdate(selfName: string, hasLock: boolean) {
  return tomlUpdate('Cargo.lock', (doc, report) => {
    if (Array.isArray(doc.package)) {
      const pkg = doc.package.find((p: any) => p.name === selfName && !p.source && !p.checksum);
      if (pkg) pkg.version = report.newVersion;
    }
  }).skipIf(() => !hasLock);
}

function createWorkspaceDepUpdate(rootCargoPath: string, selfName: string) {
  return tomlUpdate(rootCargoPath, (doc, report) => {
    const dep = doc.workspace?.dependencies?.[selfName];
    if (typeof dep === 'object' && dep.version) {
      dep.version = report.newVersion;
    } else if (typeof dep === 'string') {
      doc.workspace.dependencies[selfName] = report.newVersion;
    }
  }).skipIf((cwd) => {
    // Only apply if the workspace dependencies definition contains the dependency
    try {
      const cargoPath = path.resolve(cwd, rootCargoPath);
      if (fs.existsSync(cargoPath)) {
        const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as any;
        return !doc.workspace?.dependencies?.[selfName];
      }
    } catch { }
    return true;
  });
}

function buildCrateConfig(
  info: any,
  workspaceRoot: string,
  rootCargoPath: string,
  localNames: Set<string>,
  hasLock: boolean,
  wsDeps: Record<string, any>,
): PackageConfig {
  const relPath = path.relative(workspaceRoot, info.memberPath);
  const posixPath = relPath.split(path.sep).join(path.posix.sep);
  const relCargo = posixPath ? path.posix.join(posixPath, 'Cargo.toml') : 'Cargo.toml';
  const depends = extractPathDependencies(info.doc, wsDeps)
    .map((fd) => fd.name)
    .filter((name) => localNames.has(name) && name !== info.name);

  return {
    name: info.name,
    watch: [posixPath || '.'],
    depends,
    versionFallback: tomlFallback({ path: relCargo, read: (doc) => doc.package?.version }),
    updates: [
      createSelfUpdate(relCargo, info.name),
      createLockUpdate(info.name, hasLock),
      createWorkspaceDepUpdate(rootCargoPath, info.name),
    ],
  };
}

function scanWorkspace(workspaceRoot: string, rootDoc: any): CrateScanner {
  const scanner = new CrateScanner(workspaceRoot, rootDoc.workspace?.dependencies || {});
  if (rootDoc.workspace) registerWorkspaceMembers(scanner, rootDoc);
  else if (rootDoc.package?.name) scanner.registerCrate(workspaceRoot);
  runRecursiveDiscovery(scanner);
  return scanner;
}

function isPathTracked(absolutePath: string, workspaceRoot: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: workspaceRoot, stdio: 'ignore' });
    try {
      execSync(`git ls-files --error-unmatch "${absolutePath}"`, {
        cwd: workspaceRoot,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  } catch {
    try {
      execSync('jj root', { cwd: workspaceRoot, stdio: 'ignore' });
      try {
        execSync(`jj files "${absolutePath}"`, { cwd: workspaceRoot, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    } catch {
      return true;
    }
  }
}

export function loadCargoDeps(cwd: string, options?: CargoBuilderOptions): PackageList {
  const workspaceRoot = findCargoWorkspaceRoot(cwd);
  const rootCargo = path.join(workspaceRoot, 'Cargo.toml');
  if (!fs.existsSync(rootCargo)) return createPackageList([]);
  try {
    const rootDoc = parse(fs.readFileSync(rootCargo, 'utf8')) as any;
    const scanner = scanWorkspace(workspaceRoot, rootDoc);
    const hasLock = fs.existsSync(path.join(workspaceRoot, 'Cargo.lock'));

    const filteredCrates = scanner.crateInfos.filter((info) => {
      // Skip if package is not meant to be published
      const publishVal = info.doc?.package?.publish;
      if (publishVal === false) return false;
      if (Array.isArray(publishVal) && publishVal.length === 0) return false;

      // Skip if package is not tracked by the VCS
      const cargoPath = path.join(info.memberPath, 'Cargo.toml');
      return isPathTracked(cargoPath, workspaceRoot);
    });

    const localNames = new Set(filteredCrates.map((c) => c.name));

    // Calculate relative path from executing cwd to the workspace root Cargo.toml
    const relWorkspaceRoot = path.relative(cwd, workspaceRoot);
    const rootCargoPath = relWorkspaceRoot
      ? path.join(relWorkspaceRoot, 'Cargo.toml')
      : 'Cargo.toml';

    const configs = filteredCrates.map((info) =>
      buildCrateConfig(
        info,
        workspaceRoot,
        rootCargoPath,
        localNames,
        hasLock,
        scanner.workspaceDeps,
      ),
    );

    return createPackageList(configs);
  } catch (e) {
    console.warn(e);
    return createPackageList([]);
  }
}

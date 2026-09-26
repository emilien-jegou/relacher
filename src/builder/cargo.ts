import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'smol-toml';

import type { PackageConfig } from '../types';
import { tomlFallback, tomlUpdate } from '../updater';
import { isPathTrackedSync } from '../vcs/common';

import { createPackageList, type PackageList } from './shared';

export interface CargoBuilderOptions {
  includePrivate?: boolean;
}

interface PathDep {
  name: string;
  path: string;
}

interface CrateInfo {
  name: string;
  memberPath: string;
  doc: Record<string, any>;
}

function isWorkspace(cargoPath: string): boolean {
  try {
    const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as Record<string, any>;
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

function getPathFromVal(name: string, val: unknown, wsDeps: Record<string, any>): string | undefined {
  if (val && typeof val === 'object') {
    const obj = val as Record<string, any>;
    if (typeof obj.path === 'string') return obj.path;
    if (obj.workspace === true && wsDeps[name]?.path) {
      return wsDeps[name].path;
    }
  }
  return undefined;
}

function collectDepsFromBlock(block: unknown, wsDeps: Record<string, any>): PathDep[] {
  if (!block || typeof block !== 'object') return [];
  const list: PathDep[] = [];
  for (const [name, val] of Object.entries(block as Record<string, any>)) {
    const p = getPathFromVal(name, val, wsDeps);
    if (p) list.push({ name, path: p });
  }
  return list;
}

function collectTargetDeps(doc: Record<string, any>, wsDeps: Record<string, any>): PathDep[] {
  if (!doc.target || typeof doc.target !== 'object') return [];
  const list: PathDep[] = [];
  for (const targetValue of Object.values(doc.target)) {
    if (targetValue && typeof targetValue === 'object') {
      const tv = targetValue as Record<string, any>;
      list.push(...collectDepsFromBlock(tv.dependencies, wsDeps));
      list.push(...collectDepsFromBlock(tv['dev-dependencies'], wsDeps));
      list.push(...collectDepsFromBlock(tv['build-dependencies'], wsDeps));
    }
  }
  return list;
}

function extractPathDependencies(doc: Record<string, any>, wsDeps: Record<string, any> = {}): PathDep[] {
  return [
    ...collectDepsFromBlock(doc.dependencies, wsDeps),
    ...collectDepsFromBlock(doc['dev-dependencies'], wsDeps),
    ...collectDepsFromBlock(doc['build-dependencies'], wsDeps),
    ...collectTargetDeps(doc, wsDeps),
  ];
}

class CrateScanner {
  public discoveredPaths = new Set<string>();
  public crateInfos: CrateInfo[] = [];

  constructor(
    public readonly workspaceRoot: string,
    public readonly workspaceDeps: Record<string, any>,
  ) {}

  public registerCrate(p: string): void {
    const absPath = path.resolve(this.workspaceRoot, p);
    if (this.discoveredPaths.has(absPath)) return;
    this.discoveredPaths.add(absPath);
    const cargoPath = path.join(absPath, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return;
    try {
      const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as Record<string, any>;
      if (doc.package?.name) {
        this.crateInfos.push({ name: doc.package.name, memberPath: absPath, doc });
      }
    } catch {}
  }
}

function expandGlob(workspaceRoot: string, memberPattern: string): string[] {
  const normalized = memberPattern.replace(/\\/g, '/');
  if (normalized.endsWith('/*')) {
    const baseDir = path.join(workspaceRoot, normalized.slice(0, -2));
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return [];
    return fs
      .readdirSync(baseDir)
      .map((d) => path.join(baseDir, d, 'Cargo.toml'))
      .filter(fs.existsSync);
  }

  const directPath = path.join(workspaceRoot, normalized, 'Cargo.toml');
  return fs.existsSync(directPath) ? [directPath] : [];
}

function registerWorkspaceMembers(scanner: CrateScanner, rootDoc: Record<string, any>): void {
  if (rootDoc.package?.name) {
    scanner.registerCrate(scanner.workspaceRoot);
  }
  const members = rootDoc.workspace?.members;
  if (!Array.isArray(members)) return;
  for (const member of members) {
    const paths = expandGlob(scanner.workspaceRoot, member);
    for (const p of paths) {
      scanner.registerCrate(path.dirname(p));
    }
  }
}

function runRecursiveDiscovery(scanner: CrateScanner): void {
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

function updateBlockEntry(block: Record<string, any>, depName: string, newVersion: string): void {
  const dep = block[depName];
  if (dep && typeof dep === 'object' && dep.version) {
    dep.version = newVersion;
  } else if (typeof dep === 'string') {
    block[depName] = newVersion;
  }
}

function syncDeps(block: Record<string, any> | undefined, reports: any[], selfName: string): void {
  if (!block || typeof block !== 'object') return;
  for (const r of reports) {
    if (r.name !== selfName && block[r.name]) {
      updateBlockEntry(block, r.name, r.newVersion);
    }
  }
}

function syncAllBlocks(doc: Record<string, any>, reports: any[], selfName: string): void {
  syncDeps(doc.dependencies, reports, selfName);
  syncDeps(doc['dev-dependencies'], reports, selfName);
  syncDeps(doc['build-dependencies'], reports, selfName);
  if (doc.target && typeof doc.target === 'object') {
    for (const targetVal of Object.values(doc.target)) {
      if (targetVal && typeof targetVal === 'object') {
        const tv = targetVal as Record<string, any>;
        syncDeps(tv.dependencies, reports, selfName);
        syncDeps(tv['dev-dependencies'], reports, selfName);
        syncDeps(tv['build-dependencies'], reports, selfName);
      }
    }
  }
}

function buildCrateConfig(
  info: CrateInfo,
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
    manifestPath: relCargo,
    watch: [posixPath || '.'],
    depends,
    versionFallback: tomlFallback({ path: relCargo, read: (doc) => doc.package?.version }),
    updates: [
      tomlUpdate(relCargo, (doc, report, reports) => {
        if (doc.package) doc.package.version = report.newVersion;
        syncAllBlocks(doc, reports, info.name);
      }),
      tomlUpdate('Cargo.lock', (doc, report) => {
        if (Array.isArray(doc.package)) {
          const pkg = doc.package.find(
            (p: any) => p.name === info.name && !p.source && !p.checksum,
          );
          if (pkg) pkg.version = report.newVersion;
        }
      }).skipIf(() => !hasLock),
      tomlUpdate(rootCargoPath, (doc, report) => {
        const dep = doc.workspace?.dependencies?.[info.name];
        if (typeof dep === 'object' && dep.version) {
          dep.version = report.newVersion;
        } else if (typeof dep === 'string') {
          doc.workspace.dependencies[info.name] = report.newVersion;
        }
      }).skipIf((cwd) => {
        try {
          const cargoPath = path.resolve(cwd, rootCargoPath);
          if (fs.existsSync(cargoPath)) {
            const doc = parse(fs.readFileSync(cargoPath, 'utf8')) as Record<string, any>;
            return !doc.workspace?.dependencies?.[info.name];
          }
        } catch {}
        return true;
      }),
    ],
  };
}

export function loadCargoDeps(cwd: string, options?: CargoBuilderOptions): PackageList {
  const workspaceRoot = findCargoWorkspaceRoot(cwd);
  const rootCargo = path.join(workspaceRoot, 'Cargo.toml');
  if (!fs.existsSync(rootCargo)) return createPackageList([]);

  try {
    const rootDoc = parse(fs.readFileSync(rootCargo, 'utf8')) as Record<string, any>;
    const scanner = new CrateScanner(workspaceRoot, rootDoc.workspace?.dependencies || {});
    if (rootDoc.workspace) registerWorkspaceMembers(scanner, rootDoc);
    else if (rootDoc.package?.name) scanner.registerCrate(workspaceRoot);
    runRecursiveDiscovery(scanner);

    const hasLock = fs.existsSync(path.join(workspaceRoot, 'Cargo.lock'));

    const publishableTracked = scanner.crateInfos.filter((info) => {
      // Respect includePrivate flag (defaults to false)
      if (!options?.includePrivate) {
        const publishVal = info.doc?.package?.publish;
        if (publishVal === false) return false;
        if (Array.isArray(publishVal) && publishVal.length === 0) return false;
      }

      const cargoPath = path.join(info.memberPath, 'Cargo.toml');
      return isPathTrackedSync(cargoPath, workspaceRoot);
    });

    const localNames = new Set(publishableTracked.map((c) => c.name));
    const relWorkspaceRoot = path.relative(cwd, workspaceRoot);
    const rootCargoPath = relWorkspaceRoot
      ? path.join(relWorkspaceRoot, 'Cargo.toml')
      : 'Cargo.toml';

    const configs = publishableTracked.map((info) =>
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

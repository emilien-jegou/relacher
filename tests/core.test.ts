import { describe, it, expect } from 'bun:test';

import { Effect } from 'effect';

import { topologicalSort } from '../src/prepare';
import type { IntermediateReport } from '../src/types';
import { makeVcsVersionManager } from '../src/versioning';

describe('Core Logic', () => {
  describe('Graph Resolution & Cascading', () => {
    it('should sort topological dependencies correctly', () => {
      const items = [
        { name: 'app', depends: ['lib'] },
        { name: 'lib', depends: ['core'] },
        { name: 'core', depends: [] },
      ] as IntermediateReport[];

      const sorted = topologicalSort(items);
      expect(sorted.map((s) => s.name)).toEqual(['core', 'lib', 'app']);
    });

    it('should propagate patch bumps to dependents', () => {
      const sorted = [
        { name: 'core', currentVersion: '1.0.0', bump: 'major', depends: [] },
        { name: 'lib', currentVersion: '1.0.0', bump: 'skip', depends: ['core'] },
        { name: 'app', currentVersion: '1.0.0', bump: 'skip', depends: ['lib'] },
      ] as IntermediateReport[];

      const dummyVcs = {
        getLatestTag: () => Effect.succeed(null),
        getCommits: () => Effect.succeed([]),
        commit: () => Effect.void,
        tag: () => Effect.void,
      } as any;
      const vm = makeVcsVersionManager(dummyVcs);

      vm.propagateBumps(sorted);

      expect(sorted.find((s) => s.name === 'core')?.newVersion).toBe('2.0.0');
      expect(sorted.find((s) => s.name === 'lib')?.bump).toBe('patch');
      expect(sorted.find((s) => s.name === 'lib')?.newVersion).toBe('1.0.1');
      expect(sorted.find((s) => s.name === 'app')?.bump).toBe('patch');
      expect(sorted.find((s) => s.name === 'app')?.newVersion).toBe('1.0.1');
    });
  });

  describe('Advanced Graph Resolution & Cascading', () => {
    it('should handle diamond dependencies correctly without duplication', () => {
      const items = [
        { name: 'api', depends: ['logger', 'db'] },
        { name: 'logger', depends: ['core'] },
        { name: 'db', depends: ['core'] },
        { name: 'core', depends: [] },
      ] as IntermediateReport[];

      const sorted = topologicalSort(items);
      const sortedNames = sorted.map((s) => s.name);

      // core must come first, api must come last. logger/db order doesn't matter.
      expect(sortedNames[0]).toBe('core');
      expect(sortedNames[3]).toBe('api');
      expect(sortedNames).toContain('logger');
      expect(sortedNames).toContain('db');
    });

    it('should gracefully handle circular dependencies without looping infinitely', () => {
      const items = [
        { name: 'a', depends: ['b'], currentVersion: '1.0.0', bump: 'skip' },
        { name: 'b', depends: ['c'], currentVersion: '1.0.0', bump: 'skip' },
        { name: 'c', depends: ['a'], currentVersion: '1.0.0', bump: 'major' },
      ] as IntermediateReport[];

      const sorted = topologicalSort(items);
      expect(sorted.length).toBe(3); // Prove it successfully completed sorting

      const dummyVcs = {
        getLatestTag: () => Effect.succeed(null),
        getCommits: () => Effect.succeed([]),
        commit: () => Effect.void,
        tag: () => Effect.void,
      } as any;
      const vm = makeVcsVersionManager(dummyVcs);

      vm.propagateBumps(sorted);

      // 'c' had a major bump. It propagates to 'b' which propagates to 'a'.
      expect(sorted.find((s) => s.name === 'c')?.bump).toBe('major');
      expect(sorted.find((s) => s.name === 'b')?.bump).toBe('patch');
      expect(sorted.find((s) => s.name === 'a')?.bump).toBe('patch');
    });
  });
});

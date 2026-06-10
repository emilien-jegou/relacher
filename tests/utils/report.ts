import { expect } from 'bun:test';

import type { DependencyUpdateReport, IntermediateReport } from '../../src/types';
import type { BumpSize } from '../../src/versioning/types';

export class ReportTester {
  constructor(private reports: (DependencyUpdateReport | IntermediateReport)[]) { }

  /**
   * Manually print the reports to the console for debugging
   */
  debug(): this {
    console.log(`\n\x1b[36m=== DEBUG REPORTS ===\x1b[0m`);
    console.dir(this.reports, { depth: null, colors: true });
    return this;
  }

  length(expected: number): this {
    try {
      expect(this.reports).toHaveLength(expected);
    } catch (err) {
      this.dumpState(`length to be ${expected}`);
      throw err;
    }
    return this;
  }

  expectBump(name: string, bump: BumpSize): this {
    const report = this.reports.find((r) => r.name === name);
    try {
      expect(report).toBeDefined();
      if (report) {
        expect(report.bump).toBe(bump);
      }
    } catch (err) {
      this.dumpState(`module '${name}' to have bump '${bump}'`);
      throw err;
    }
    return this;
  }

  expectNewVersion(name: string, version: string): this {
    const report = this.reports.find((r) => r.name === name);
    try {
      expect(report).toBeDefined();
      if (report) {
        expect(report.newVersion).toBe(version);
      }
    } catch (err) {
      this.dumpState(`module '${name}' to have newVersion '${version}'`);
      throw err;
    }
    return this;
  }

  private dumpState(context: string) {
    console.error(`\x1b[33mCurrent state of Reports:\x1b[0m`);
    console.dir(this.reports, { depth: null, colors: true });
    console.error(`\n\x1b[31m[DEBUG] Validation failed: Expected ${context}.\x1b[0m`);
  }
}

export const reportTest = (reports: (DependencyUpdateReport | IntermediateReport)[]) =>
  new ReportTester(reports);

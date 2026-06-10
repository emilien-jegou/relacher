import type { PackageList } from '../builder/shared';

import { getIconForFile } from './devicons';
import { c } from './utils';

export function printDependencyList(list: PackageList, short = false): void {
  // 1. Display Configuration Errors if they exist
  if (list.errors && list.errors.length > 0) {
    // Falls back to safe styling if c.red is not defined in the utility helper
    const redText = typeof c.red === 'function' ? c.red : (str: string) => str;

    console.log(`⚠️  ${c.bold(redText('Configuration Errors:'))}`);
    for (const error of list.errors) {
      console.log(`   - ${redText(error.message)}`);
    }
    console.log(''); // Spacing after errors
  }

  // 2. Display Empty State
  if (list.length === 0) {
    console.log(`  ${c.gray('No matching packages discovered')}`);
    return;
  }

  // 3. Display Packages
  for (const dep of list) {
    if (short) {
      const depsFormatted = dep.depends && dep.depends.length ? ' ' + dep.depends.join(', ') : '';
      const nameFormatted = `📦 ${dep.name}`;
      console.log(`${c.bold(nameFormatted)}  ${c.cyan(depsFormatted)}`);
    } else {
      console.log(c.bold(`📦 ${dep.name}`));

      // Watch Paths
      if (dep.watch && dep.watch.length > 0) {
        console.log(`   ${c.dim(`📁 Watch:`)} ${dep.watch.join(', ')}`);
      }

      // Dependencies
      if (dep.depends && dep.depends.length > 0) {
        const depsFormatted = c.cyan(dep.depends.join(', '));
        console.log(`   ${c.dim(` Links:`)} ${depsFormatted}`);
      }

      // Planned Updates
      if (dep.updates && dep.updates.length > 0) {
        console.log(`   ${c.dim(`⚙ Updates:`)}`);
        for (const update of dep.updates) {
          const fileName = update.path || 'unknown';
          const fileIcon = getIconForFile(fileName.split('/').pop() || '');
          const targetPathStr = typeof update.path === 'string' ? update.path : '[Dynamic Path]';

          console.log(`       ${fileIcon} ${c.gray(targetPathStr)}`);
        }
      }

      console.log('');
    }
  }
}

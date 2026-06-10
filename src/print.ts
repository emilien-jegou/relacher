import type { DependencyUpdateReport } from './types';

// ANSI Escape Codes for Terminal Colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function inferLastStableVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);
  if (!match) return version;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const pre = match[4];

  if (!pre) {
    return `${major}.${minor}.${patch}`;
  }

  if (patch > 0) {
    return `${major}.${minor}.${patch - 1}`;
  }
  if (minor > 0) {
    return `${major}.${minor - 1}.0`;
  }
  if (major > 0) {
    return `${major - 1}.0.0`;
  }
  return '0.0.0';
}

/**
 * Highlights only the changed segments of a version string.
 * Example: "1.2.3" -> "1.3.0" prints "1.2.3 → 1.[3.0]" where [3.0] is bright green.
 */
function highlightVersion(oldV: string, newV: string): string {
  if (oldV === newV) return `${c.gray}${oldV} (no change)${c.reset}`;

  const oParts = oldV.split('.');
  const nParts = newV.split('.');

  let matchIdx = 0;
  while (matchIdx < 3 && oParts[matchIdx] === nParts[matchIdx]) {
    matchIdx++;
  }

  const common = nParts.slice(0, matchIdx).join('.') + (matchIdx > 0 ? '.' : '');
  const changed = nParts.slice(matchIdx).join('.');

  return `${c.gray}${oldV}${c.reset} ${c.magenta}→${c.reset} ${c.gray}${common}${c.reset}${c.green}${c.bold}${changed}${c.reset}`;
}

/**
 * Customizes version segment formatting to hide/represent pre-release details gracefully.
 */
function getVersionDisplay(oldV: string, newV: string, lastStableVersion?: string | null): string {
  if (!oldV.includes('-')) {
    return highlightVersion(oldV, newV);
  }

  const lastStable = lastStableVersion || inferLastStableVersion(oldV);
  const highlightedTransition = highlightVersion(lastStable, newV);

  const parts = highlightedTransition.split(`${c.magenta}→${c.reset}`);
  if (parts.length === 2) {
    const part0 = parts[0];
    const part1 = parts[1];
    if (part0 !== undefined && part1 !== undefined) {
      return `${part0.trim()} ${c.gray}<${oldV}>${c.reset} ${c.magenta}→${c.reset} ${part1.trim()}`;
    }
  }

  return `${lastStable} <${oldV}> → ${newV}`;
}

function getIconForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const icons: Record<string, string> = {
    toml: '',
    nix: '',
    md: '',
    mdx: '',
    rs: '',
    js: '',
    ts: '',
    json: '',
    yaml: '',
    yml: '',
    lock: '',
    log: '󰌱',
  };

  return icons[ext] || '󰈚'; // Default file icon
}

export function prettyPrint(reports: DependencyUpdateReport[]): void {
  for (const report of reports) {
    if (report.bump === 'skip') continue;

    const bumpColor =
      report.bump === 'major' ? c.red : report.bump === 'minor' ? c.yellow : c.green;

    // Check if it's a first release (fallback was used instead of finding tags)
    const firstReleaseBadge = report.isFirstRelease ? ` ${c.cyan}🌱 (first release)${c.reset}` : '';

    process.stdout.write(
      `${c.bold}📦 ${report.name.padEnd(12)}${c.reset} ${getVersionDisplay(report.currentVersion, report.newVersion, report.lastStableVersion)} ${bumpColor}${c.bold}[${report.bump}]${c.reset}${firstReleaseBadge}\n`,
    );

    const files = report.updates.map(
      (u) =>
        `${getIconForFile(u.targetPath.split('/').pop() || '')} ${c.dim}${u.targetPath.split('/').pop()}${c.reset}`,
    );
    console.log(`   ${files.join('  ')}`);

    // 1. Show all commits since the last release with a bump marker if applicable
    for (const commit of report.commits) {
      const commitBump = 'skip'; //matchBumpSize(commit.message, defaultSizes);
      const affectsBump = commitBump !== 'skip';

      const marker = affectsBump ? `${c.green}✦${c.reset}` : `${c.gray}○${c.reset}`;

      // User string is now wrapped with <>
      console.log(
        `     ${marker} ${c.yellow}${commit.shortHash}${c.reset} ${commit.message}  ${c.gray}<${commit.author}> ${commit.date}${c.reset}`,
      );
    }

    // 2. Show Cascades with their update kind
    const changedDeps = reports.filter(
      (r) => report.depends?.includes(r.name) && r.currentVersion !== r.newVersion,
    );

    if (changedDeps.length > 0) {
      const depsStr = changedDeps
        .map((d) => {
          const depBumpColor = d.bump === 'major' ? c.red : d.bump === 'minor' ? c.yellow : c.green;
          return `${c.blue}${d.name}${c.reset} ${depBumpColor}[${d.bump}]${c.reset}`;
        })
        .join(', ');

      console.log(
        `     ${c.green}✦${c.reset} Cascaded as ${bumpColor}[${report.bump}]${c.reset} from deps: ${depsStr}`,
      );
    }

    console.log('');
  }
}

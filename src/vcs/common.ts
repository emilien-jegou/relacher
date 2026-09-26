import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function isInsideGitWorkTree(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function isGitTracked(filePath: string, cwd: string): boolean {
  try {
    const relPath = path.isAbsolute(filePath)
      ? path.relative(cwd, filePath).replace(/\\/g, '/')
      : filePath.replace(/\\/g, '/');

    execFileSync('git', ['ls-files', '--error-unmatch', relPath || '.'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function isInsideJjWorkTree(cwd: string): boolean {
  try {
    execFileSync('jj', ['--color=never', 'root'], {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function isJjTracked(filePath: string, cwd: string): boolean {
  try {
    // Jujutsu requires relative paths from cwd:
    const relPath = path.isAbsolute(filePath)
      ? path.relative(cwd, filePath).replace(/\\/g, '/')
      : filePath.replace(/\\/g, '/');

    const out = execFileSync('jj', ['--color=never', 'files', relPath || '.'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Centrally verifies if a given path is tracked by VCS without shell interpolation.
 * If the workspace is not inside any VCS repository, defaults to true.
 */
export function isPathTrackedSync(absolutePath: string, workspaceRoot: string): boolean {
  if (isInsideGitWorkTree(workspaceRoot)) {
    return isGitTracked(absolutePath, workspaceRoot);
  }

  if (isInsideJjWorkTree(workspaceRoot)) {
    return isJjTracked(absolutePath, workspaceRoot);
  }

  // Not in any VCS repository, so all files are considered tracked
  return true;
}

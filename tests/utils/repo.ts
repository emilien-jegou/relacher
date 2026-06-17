import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class TempDir implements Disposable {
  public readonly path: string;

  constructor() {
    this.path = path.resolve(`/tmp/relache__${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(this.path, { recursive: true });
  }

  [Symbol.dispose]() {
    fs.rmSync(this.path, { recursive: true, force: true });
  }
}

export const mktemp = (): TempDir => new TempDir();

export class CommitContext {
  constructor(private dir: string) {}

  update(filePath: string, updater: (oldContent: string) => string): this {
    const fullPath = path.join(this.dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    const oldContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
    const newContent = updater(oldContent);

    fs.writeFileSync(fullPath, newContent);
    return this;
  }

  getRandomText(bytes: number = 16): string {
    return crypto.randomBytes(bytes).toString('hex');
  }
}

export class RepoBuilder {
  constructor(public dir: string) {
    if (!fs.existsSync(path.join(this.dir, '.jj'))) {
      this.runJj('git init');
    }
    this.exec("git config user.name 'Example User'");
    this.exec("git config user.email 'example@example.com'");
    this.exec('git config commit.gpgSign false');
  }

  private exec(cmd: string): string {
    return execSync(cmd, {
      cwd: this.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  }

  private runJj(cmd: string): string {
    return execSync(`jj --color=never ${cmd}`, {
      cwd: this.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  }

  commit(msg: string, cb?: (c: CommitContext) => void): this {
    if (cb) {
      cb(new CommitContext(this.dir));
    }
    this.runJj(`commit -m "${msg}"`);
    return this;
  }

  write_lock(tagLikeName: string): this {
    const lastDash = tagLikeName.lastIndexOf('-v');
    if (lastDash === -1) return this;
    const name = tagLikeName.slice(0, lastDash);
    const version = tagLikeName.slice(lastDash + 2);

    const lockPath = path.join(this.dir, '.relacher.lock');
    let lockData: any = { packages: {} };
    if (fs.existsSync(lockPath)) {
      try {
        lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      } catch {}
    }
    if (!lockData.packages) {
      lockData.packages = {};
    }
    lockData.packages[name] = {
      version,
      commit: '',
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2) + '\n', 'utf8');

    return this;
  }

  readFile(filePath: string): string {
    const fullPath = path.join(this.dir, filePath);
    if (!fs.existsSync(fullPath)) return '';
    return fs.readFileSync(fullPath, 'utf8');
  }

  getLogs(): string[] {
    const out = this.runJj(`log --no-graph -r '::@' -T "description.first_line() ++ '\n'"`);
    return out.split('\n').filter(Boolean);
  }
}

export const repo = (dir: string) => new RepoBuilder(dir);

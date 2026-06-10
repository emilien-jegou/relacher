import { pipe } from 'effect';

// ── CLI Polish Formatting Helpers ──────────────────────────────────────────
export const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  reset: '\x1b[0m',
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

export const log = {
  c,
  step: (msg: string) => console.info(`\n${pipe(msg, c.bold, c.blue)}`),
  ok: (msg: string) => console.log(`  ${c.green('✓')} ${msg}`),
  warn: (msg: string) => console.warn(`  ${c.yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`\n${c.red(`✗ ${msg}`)}`),
};

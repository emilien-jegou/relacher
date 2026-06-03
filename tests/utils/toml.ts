type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };

export class TomlBuilder {
  private lines: string[] = [];

  section(name: string): this {
    if (this.lines.length > 0) {
      this.lines.push('');
    }
    this.lines.push(`[${name}]`);
    return this;
  }

  kv(key: string, value: TomlValue): this {
    this.lines.push(`${key} = ${this.formatValue(value)}`);
    return this;
  }

  private formatValue(val: TomlValue): string {
    if (typeof val === 'string') return `"${val}"`;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
      return `[${val.map((v) => this.formatValue(v)).join(', ')}]`;
    }
    if (typeof val === 'object' && val !== null) {
      // Formats objects as TOML inline tables: { key = "value" }
      const entries = Object.entries(val).map(([k, v]) => `${k} = ${this.formatValue(v)}`);
      return `{ ${entries.join(', ')} }`;
    }
    return '""';
  }

  build(): string {
    return this.lines.join('\n') + '\n';
  }
}

export const toml = () => new TomlBuilder();

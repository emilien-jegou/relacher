import { stringify } from 'smol-toml';

export class TomlBuilder {
  protected data: Record<string, any> = {};
  protected currentPath: string[] = [];

  /**
   * Set the current section context. Supports dotted paths (e.g., 'workspace.dependencies').
   */
  section(name: string) {
    this.currentPath = name ? name.split('.') : [];
    return this;
  }

  /**
   * Set a key-value pair under the current active section (or root if no section is active).
   */
  kv(key: string, value: any) {
    let current = this.data;

    for (const part of this.currentPath) {
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part];
    }

    current[key] = value;
    return this;
  }

  /**
   * Serialize the accumulated object structure to a TOML string.
   */
  build(): string {
    return stringify(this.data);
  }
}

export function toml() {
  return new TomlBuilder();
}

import { TomlBuilder } from './toml';

export class CargoBuilder extends TomlBuilder {
  /**
   * Helper to quickly set up the [package] section.
   */
  package(name: string, version: string, extra: Record<string, any> = {}) {
    this.section('package').kv('name', name).kv('version', version);

    for (const [key, val] of Object.entries(extra)) {
      this.kv(key, val);
    }
    return this;
  }

  /**
   * Helper to define a dependency.
   */
  dependency(name: string, details: string | Record<string, any>) {
    this.section('dependencies').kv(name, details);
    return this;
  }

  /**
   * Helper to define workspace dependencies.
   */
  workspaceDependency(name: string, details: string | Record<string, any>) {
    this.section('workspace.dependencies').kv(name, details);
    return this;
  }
}

export function cargo() {
  return new CargoBuilder();
}

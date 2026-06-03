import type { ChangelogUpdate, RegexUpdate, DependencyConfig, UpdateAction } from '../types';

export function changelogUpdate(options: Omit<ChangelogUpdate, 'kind'>): ChangelogUpdate {
  return { kind: 'changelog', ...options };
}

export function regexUpdate(options: Omit<RegexUpdate, 'kind'>): RegexUpdate {
  return { kind: 'regex', ...options };
}

export class SingleDependencyBuilder {
  constructor(private config: DependencyConfig) { }

  update(action: UpdateAction): this {
    if (!this.config.updates) {
      this.config.updates = [];
    }
    this.config.updates.push(action);
    return this;
  }
}

export interface DependencyList extends Array<DependencyConfig> {
  on(name: string, cb: (builder: SingleDependencyBuilder) => void): this;
}

export function decorateList(configs: DependencyConfig[]): DependencyList {
  const list = configs as DependencyList;
  list.on = function(name: string, cb: (builder: SingleDependencyBuilder) => void) {
    const dep = this.find((d) => d.name === name);
    if (dep) {
      cb(new SingleDependencyBuilder(dep));
    }
    return this;
  };
  return list;
}

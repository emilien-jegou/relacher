/**
 * Shared recursive Proxy generator tracking modified property paths on target objects.
 */
export function createMutationProxy(
  obj: any,
  currentPath: string[] = [],
  onSet: (path: string[], value: any) => void,
): any {
  return new Proxy(obj, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      if (prop === 'toJSON') return () => target;

      const value = target[prop];
      if (value !== null && typeof value === 'object') {
        return createMutationProxy(value, [...currentPath, prop], onSet);
      }
      return value;
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol') {
        target[prop] = value;
        return true;
      }
      target[prop] = value;
      onSet([...currentPath, prop], value);
      return true;
    },
  });
}

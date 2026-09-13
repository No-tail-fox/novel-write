/** Small request gate for UI actions that must not be submitted twice. */
export interface DirectorRequestGate {
  begin(key: string): boolean;
  end(key: string): void;
  has(key: string): boolean;
  clear(): void;
}

export function createDirectorRequestGate(): DirectorRequestGate {
  const active = new Set<string>();
  return {
    begin(key) {
      if (!key || active.has(key)) return false;
      active.add(key);
      return true;
    },
    end(key) {
      active.delete(key);
    },
    has(key) {
      return active.has(key);
    },
    clear() {
      active.clear();
    },
  };
}

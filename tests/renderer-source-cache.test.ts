import { describe, expect, it } from 'vitest';
import { collectReachableSources } from './helpers/renderer-source';

describe('renderer dependency cache', () => {
  it('shares parsed imports across route traversals without sharing ownership sets', () => {
    const sources = new Map([
      ['src/a.ts', "import './common'; import type { OnlyType } from './missing';"],
      ['src/b.ts', "export * from './common'; void import('./lazy');"],
      ['src/common.ts', "export * from './leaf';"],
      ['src/leaf.ts', 'export const leaf = true;'],
      ['src/lazy.ts', 'export const lazy = true;'],
    ]);
    const cache = new Map<string, readonly string[]>();
    const first = collectReachableSources(sources, 'src/a.ts', cache);
    const common = cache.get('src/common.ts');
    const second = collectReachableSources(sources, 'src/b.ts', cache);
    expect(cache.get('src/common.ts')).toBe(common);
    expect(cache.size).toBe(5);
    expect([...first.keys()].sort()).toEqual(['src/a.ts', 'src/common.ts', 'src/leaf.ts']);
    expect([...second.keys()].sort()).toEqual(['src/b.ts', 'src/common.ts', 'src/lazy.ts', 'src/leaf.ts']);
    expect(first).not.toBe(second);
  });

  it('does not reuse stale imports between independent source snapshots', () => {
    const original = new Map([['src/a.ts', 'export const value = 1;']]);
    expect(collectReachableSources(original, 'src/a.ts').size).toBe(1);
    const changed = new Map([['src/a.ts', "import './missing';"]]);
    expect(() => collectReachableSources(changed, 'src/a.ts')).toThrow('Cannot resolve local renderer import');
  });
});
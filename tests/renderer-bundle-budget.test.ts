import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface TestChunk {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  modules: Record<string, unknown>;
}

const corpusId = 'C:/repo/src/shared/storybound-system-templates.ts';

describe('renderer bundle budget', () => {
  it('enforces strict entry bytes and dynamic-only prompt corpus reachability', async () => {
    const source = await readFile(new URL('../scripts/renderer-bundle-budget.ts', import.meta.url), 'utf8').catch(() => '');
    expect(source.length).toBeGreaterThan(0);
    if (!source) return;
    const { assertRendererBundleBudget } = compileBudget(source);

    expect(() => assertRendererBundleBudget(bundle([entry(499_999), corpus('corpus.js')]))).not.toThrow();
    expect(() => assertRendererBundleBudget(bundle([entry(500_000), corpus('corpus.js')]))).toThrow(/500000|budget/iu);
    expect(() => assertRendererBundleBudget(bundle([
      chunk('entry.js', 100, [], [], { [corpusId]: {} }, true),
    ]))).toThrow(/static|corpus/iu);
    expect(() => assertRendererBundleBudget(bundle([
      entry(100, ['shared.js']),
      chunk('shared.js', 100, [], [], { [corpusId]: {} }),
    ]))).toThrow(/static|corpus/iu);
    expect(() => assertRendererBundleBudget(bundle([entry(100)]))).toThrow(/missing|corpus/iu);
    expect(() => assertRendererBundleBudget(bundle([
      entry(100, [], ['route.js']),
      chunk('route.js', 100, ['corpus.js']),
      corpus('corpus.js'),
    ]))).not.toThrow();
  });

  it('checks every entry independently', async () => {
    const source = await readFile(new URL('../scripts/renderer-bundle-budget.ts', import.meta.url), 'utf8').catch(() => '');
    expect(source.length).toBeGreaterThan(0);
    if (!source) return;
    const { assertRendererBundleBudget } = compileBudget(source);
    expect(() => assertRendererBundleBudget(bundle([
      entry(100, [], ['corpus.js'], 'entry-a.js'),
      entry(499_999, [], ['corpus.js'], 'entry-b.js'),
      corpus('corpus.js'),
    ]))).not.toThrow();
    expect(() => assertRendererBundleBudget(bundle([
      entry(100, [], ['corpus.js'], 'entry-a.js'),
      entry(500_000, [], ['corpus.js'], 'entry-b.js'),
      corpus('corpus.js'),
    ]))).toThrow(/entry-b\.js/iu);
  });

  it('normalizes Windows separators, query strings, and Rollup virtual prefixes', async () => {
    const source = await readFile(new URL('../scripts/renderer-bundle-budget.ts', import.meta.url), 'utf8').catch(() => '');
    expect(source.length).toBeGreaterThan(0);
    if (!source) return;
    const { assertRendererBundleBudget } = compileBudget(source);
    const windowsVirtualCorpus = '\0C:\\repo\\src\\shared\\storybound-system-templates.ts?commonjs-proxy';
    expect(() => assertRendererBundleBudget(bundle([
      entry(100, [], ['route.js']),
      chunk('route.js', 100, ['corpus.js']),
      chunk('corpus.js', 100, [], [], { [windowsVirtualCorpus]: {} }),
    ]))).not.toThrow();
  });
});

function compileBudget(source: string): {
  assertRendererBundleBudget(bundle: Record<string, TestChunk>): void;
} {
  const stripped = source.replace(/^import type .*?;\r?$/gmu, '').replace(/^export /gmu, '');
  const compiled = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(`${compiled}\nreturn { assertRendererBundleBudget };`)() as {
    assertRendererBundleBudget(bundle: Record<string, TestChunk>): void;
  };
}

function bundle(chunks: TestChunk[]): Record<string, TestChunk> {
  return Object.fromEntries(chunks.map((value) => [value.fileName, value]));
}

function entry(bytes: number, imports: string[] = [], dynamicImports: string[] = ['corpus.js'], fileName = 'entry.js'): TestChunk {
  return chunk(fileName, bytes, imports, dynamicImports, {} as Record<string, unknown>, true);
}

function corpus(fileName: string): TestChunk {
  return chunk(fileName, 100, [], [], { [corpusId]: {} });
}

function chunk(
  fileName: string,
  bytes: number,
  imports: string[] = [],
  dynamicImports: string[] = [],
  modules: Record<string, unknown> = {},
  isEntry = false,
): TestChunk {
  return { type: 'chunk', fileName, code: 'x'.repeat(bytes), isEntry, imports, dynamicImports, modules };
}

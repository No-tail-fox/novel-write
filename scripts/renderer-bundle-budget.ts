import type { Plugin } from 'vite';

export const MAX_RENDERER_ENTRY_BYTES = 500_000;
const PROMPT_CORPUS_SUFFIX = '/src/shared/storybound-system-templates.ts';

interface RendererChunk {
  type: 'chunk';
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  modules: Record<string, unknown>;
}

type RendererBundle = Record<string, RendererChunk | { type: 'asset' }>;

export function assertRendererBundleBudget(bundle: RendererBundle): void {
  const chunks = new Map(
    Object.values(bundle)
      .filter((output): output is RendererChunk => output.type === 'chunk')
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const entries = [...chunks.values()].filter((chunk) => chunk.isEntry);
  if (entries.length === 0) throw new Error('Renderer bundle budget: missing JavaScript entry chunk.');

  for (const entry of entries) {
    const bytes = Buffer.byteLength(entry.code, 'utf8');
    if (bytes >= MAX_RENDERER_ENTRY_BYTES) {
      throw new Error(`Renderer bundle budget: ${entry.fileName} is ${bytes} bytes; entries must be below ${MAX_RENDERER_ENTRY_BYTES}.`);
    }
  }

  const corpusChunks = [...chunks.values()].filter((chunk) => (
    Object.keys(chunk.modules).some((moduleId) => normalizeModuleId(moduleId).endsWith(PROMPT_CORPUS_SUFFIX))
  ));
  if (corpusChunks.length === 0) throw new Error('Renderer bundle budget: prompt corpus is missing from the output.');

  for (const entry of entries) {
    const staticClosure = collectChunks(chunks, [entry.fileName], false);
    const staticCorpus = corpusChunks.find((chunk) => staticClosure.has(chunk.fileName));
    if (staticCorpus) {
      throw new Error(`Renderer bundle budget: prompt corpus ${staticCorpus.fileName} is in the static closure of ${entry.fileName}.`);
    }
  }

  const dynamicallyReachable = new Set<string>();
  for (const entry of entries) {
    const staticClosure = collectChunks(chunks, [entry.fileName], false);
    const dynamicRoots = [...staticClosure].flatMap((fileName) => chunks.get(fileName)?.dynamicImports ?? []);
    for (const fileName of collectChunks(chunks, dynamicRoots, true)) dynamicallyReachable.add(fileName);
  }
  if (!corpusChunks.some((chunk) => dynamicallyReachable.has(chunk.fileName))) {
    throw new Error('Renderer bundle budget: prompt corpus is not reachable through a dynamic import subtree.');
  }
}

export function rendererBundleBudgetPlugin(): Plugin {
  return {
    name: 'storydream-renderer-bundle-budget',
    generateBundle(_options, bundle) {
      assertRendererBundleBudget(bundle as unknown as RendererBundle);
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue;
        console.log(`[renderer-budget] ${output.fileName}: ${Buffer.byteLength(output.code, 'utf8')} bytes`);
      }
    },
  };
}

function collectChunks(
  chunks: ReadonlyMap<string, RendererChunk>,
  roots: readonly string[],
  includeDynamic: boolean,
): Set<string> {
  const collected = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (collected.has(fileName)) continue;
    const chunk = chunks.get(fileName);
    if (!chunk) continue;
    collected.add(fileName);
    pending.push(...chunk.imports);
    if (includeDynamic) pending.push(...chunk.dynamicImports);
  }
  return collected;
}

function normalizeModuleId(moduleId: string): string {
  return moduleId.replaceAll('\\', '/').replace(/^\0/u, '').split('?', 1)[0];
}

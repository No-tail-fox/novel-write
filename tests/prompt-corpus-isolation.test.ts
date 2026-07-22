import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('prompt corpus isolation', () => {
  it('keeps the heavy corpus outside lightweight renderer and persistence modules', async () => {
    const [main, promptPage, promptEditor, config, storage, stateDelta, stateReconciliation] = await Promise.all([
      'src/main.tsx',
      'src/features/templates/PromptTemplatesPage.tsx',
      'src/features/templates/PromptTemplateEditor.tsx',
      'src/shared/config.ts',
      'src/shared/storage.ts',
      'src/shared/state-delta.ts',
      'src/shared/state-reconciliation.ts',
    ].map(source));
    const files = [main, promptPage, promptEditor, config, storage, stateDelta, stateReconciliation];

    for (const contents of files) {
      expect(contents).not.toMatch(/from ['"].*storybound-system-templates/);
      expect(contents).not.toMatch(/import\s*\{[^}]*defaultPromptTemplates[^}]*\}\s*from ['"].*config/);
    }
    expect(config).not.toContain('export const defaultPromptTemplates');
  });

  it('loads one canonical corpus through a retryable module-scope dynamic loader', async () => {
    const loader = await source('src/shared/prompt-template-loader.ts');
    const defaults = await source('src/shared/prompt-template-defaults.ts');

    expect(loader).toContain("import('./prompt-template-defaults')");
    expect(loader).toContain('defaultPromptTemplatesPromise');
    expect(loader).toMatch(/catch[\s\S]*defaultPromptTemplatesPromise\s*=\s*null/);
    expect(defaults).toContain("from './storybound-system-templates'");
    expect(defaults).toContain('export const defaultPromptTemplates');
  });

  it('awaits the corpus only at database seeding, reset, and browser fallback boundaries', async () => {
    const [storage, appState, browserFallback] = await Promise.all([
      source('src/shared/storage.ts'),
      source('src/app/app-state.ts'),
      source('src/app/browser-fallback.ts'),
    ]);
    const open = storage.slice(storage.indexOf('static async open'), storage.indexOf('private enqueueCommit'));
    const reset = storage.slice(storage.indexOf('async resetPromptTemplates'), storage.indexOf('async upsertDraftTemplate'));
    const bootstrap = appState.slice(appState.indexOf('export function bootstrapToState'), appState.indexOf('export function mergeDeltaView'));
    const fallback = browserFallback.slice(browserFallback.indexOf('export function makeFallbackApi'));

    expect(open).toContain('Promise.all([loadSql(), loadDefaultPromptTemplates()])');
    expect(open.indexOf('loadDefaultPromptTemplates()')).toBeLessThan(open.indexOf('instance.migrate()'));
    expect(reset.indexOf('await loadDefaultPromptTemplates()')).toBeLessThan(reset.indexOf('enqueueCommit'));
    expect(bootstrap).toContain('bootstrap.promptTemplates.items.map(promptTemplatePlaceholder)');
    expect(bootstrap).not.toContain('loadDefaultPromptTemplates');
    expect(fallback).toContain('const defaults = await loadDefaultPromptTemplates()');
    expect(fallback).toContain('async getPromptTemplateDetail(id)');
    expect(fallback).toContain("promptTemplates.find((template) => template.id === id)");
  });

  it('keeps lightweight catalog metadata identical to the lazily loaded corpus', async () => {
    const [{ promptTemplateCatalog }, { loadDefaultPromptTemplates }] = await Promise.all([
      import('../src/shared/prompt-template-catalog'),
      import('../src/shared/prompt-template-loader'),
    ]);
    const defaults = await loadDefaultPromptTemplates();
    const detailsById = new Map(defaults.map((template) => [template.id, template]));

    expect(promptTemplateCatalog.map((template) => template.id)).toEqual(defaults.map((template) => template.id));
    for (const summary of promptTemplateCatalog) {
      expect(detailsById.get(summary.id)).toMatchObject(summary);
      expect(summary).not.toHaveProperty('content');
      expect(summary).not.toHaveProperty('stepPrompts');
      expect(summary).not.toHaveProperty('imageSeedPoolsJson');
    }
  });

  it('shares in-flight loads and retries after a failed corpus request', async () => {
    const { createRetryablePromptTemplateLoader } = await import('../src/shared/prompt-template-loader');
    let attempts = 0;
    const load = createRetryablePromptTemplateLoader(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary chunk failure');
      return { defaultPromptTemplates: [{ id: 'loaded' }] as never[] };
    });

    await expect(load()).rejects.toThrow('temporary chunk failure');
    const first = load();
    const second = load();
    await expect(first).resolves.toEqual([{ id: 'loaded' }]);
    await expect(second).resolves.toBe(await first);
    expect(attempts).toBe(2);
  });

  it('emits the prompt corpus as a non-entry Vite chunk', async () => {
    const result = await build({
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      build: { write: false, manifest: true },
    }) as Rollup.RollupOutput;
    const chunks = result.output.filter((output): output is Rollup.OutputChunk => output.type === 'chunk');
    const entry = chunks.find((chunk) => chunk.isEntry);
    const corpus = chunks.find((chunk) => Object.keys(chunk.modules).some((id) => id.endsWith('/storybound-system-templates.ts')));

    expect(entry).toBeDefined();
    expect(corpus).toBeDefined();
    expect(corpus?.isEntry).toBe(false);
    expect(Object.keys(entry?.modules ?? {})).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/storybound-system-templates\.ts$/),
    ]));
  }, 30_000);
});

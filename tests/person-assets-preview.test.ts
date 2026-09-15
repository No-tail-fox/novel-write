import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { makeFallbackApi } from '../src/app/browser-fallback';
import type { StoryDreamApi } from '../src/shared/storydream-api';

describe('person asset preview capabilities', () => {
  const operations: [string, (api: StoryDreamApi) => Promise<unknown>][] = [
    ['create', (api) => api.createPersonAsset('Preview person')],
    ['rename', (api) => api.renamePersonAsset('Preview person', 'Renamed person')],
    ['usage', (api) => api.getPersonAssetUsage('Preview person')],
    ['delete', (api) => api.deletePersonAsset('Preview person')],
    ['restore', (api) => api.restorePersonAsset('preview-token')],
    ['import', (api) => api.importPersonAssetImages('Preview person')],
    ['open', (api) => api.openPersonAssetDirectory('Preview person')],
  ];

  it.each(operations)('rejects unsupported %s instead of returning fake success', async (_name, operation) => {
    const setState = vi.fn();
    const api = makeFallbackApi(setState);
    await expect(operation(api)).rejects.toThrow(/浏览器预览.*Electron 桌面端/u);
    expect(setState).not.toHaveBeenCalled();
  });

  it('does not invent local people or images in the preview', async () => {
    const api = makeFallbackApi(() => undefined);
    await expect(api.listPersonAssets()).resolves.toEqual([]);
    await expect(api.listPersonAssetImages('Preview person')).resolves.toEqual([]);
  });

  it('keeps the desktop requirement visible and disables local mutations in preview', async () => {
    const source = await readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const controlsDisabled = isBrowserPreview || personAction.busy;');
    expect(source).toContain('className="person-preview-notice" role="note"');
    expect(source).toContain('本地素材管理仅在桌面端可用');
    expect(source).toContain('disabled={controlsDisabled || !newPersonName.trim()}');
    expect(source).toContain('disabled={!selectedName || controlsDisabled}');
    expect(source).toContain("import { Button, TextField } from '../../ui';");
    expect(source).not.toMatch(/<(button|input)\b/u);
  });

  it('catches failed usage checks before deleting and locks selection while pending', async () => {
    const source = await readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8');
    const deletion = source.slice(source.indexOf('async function deletePerson()'), source.indexOf('async function undoDelete()'));
    expect(deletion.indexOf('await personAction.run')).toBeLessThan(deletion.indexOf('await api.getPersonAssetUsage'));
    expect(deletion).toContain('onError: (error) => setMessage(error.message)');
    expect(source).toContain('aria-pressed={person.name === selectedName} disabled={controlsDisabled}');
  });

  it('places feedback before the gallery so errors do not disappear below the images', async () => {
    const source = await readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8');
    expect(source.indexOf('className="person-asset-feedback"')).toBeLessThan(source.indexOf('className="person-image-grid"'));
    expect(source).toContain('message && !personAction.feedback');
  });
});

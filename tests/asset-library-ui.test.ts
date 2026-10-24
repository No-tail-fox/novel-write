import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
describe('asset library workflow contracts', () => {
  it('keeps the library route and the legacy people collection reachable', async () => {
    const [route, page] = await Promise.all([source('src/app/route-registry.ts'), source('src/features/asset-library/AssetLibraryPage.tsx')]);
    expect(route).toContain("import('../features/asset-library/AssetLibraryPage')");
    expect(page).toContain('<PersonAssetsPage');
    expect(page).toContain('导入图片');
    expect(page).toContain('onDiscard:');
  });
  it('validates fresh chooser content and imports a separate pinned comic reference', async () => {
    const [picker, comic] = await Promise.all([source('src/features/asset-library/LibraryPicker.tsx'), source('src/features/motion-comic/MotionComicPage.tsx')]);
    expect(picker).toContain('await api.getLibraryAsset(selected.id)');
    expect(picker).toContain('asset.deletedAt || asset.kind !== kind');
    expect(comic).toContain('selection?.imagePath || await api.selectLocalImage()');
    expect(comic).toContain('await api.addImageLabRecord(');
    expect(comic).toContain('librarySource: { id: selection.libraryId, revision: selection.revision }');
    expect(comic).toContain('attachMotionComicReference(latest, target, asset)');
  });
});

import { libraryListSchema, librarySaveSchema, libraryUpdateSchema, queryLibraryAssets, type LibraryAsset } from '../shared/asset-library';
import type { StoryDreamApi } from '../shared/storydream-api';

const key = 'storydream.asset-library.v1';
export function browserAssetLibrary(storage: Storage): Pick<StoryDreamApi, 'listLibraryAssets' | 'getLibraryAsset' | 'saveLibraryAsset' | 'updateLibraryAsset' | 'recycleLibraryAsset' | 'restoreLibraryAsset'> {
  const read = (): LibraryAsset[] => JSON.parse(storage.getItem(key) || '[]');
  const write = (assets: LibraryAsset[]) => storage.setItem(key, JSON.stringify(assets));
  const mutate = (id: string, update: (asset: LibraryAsset) => LibraryAsset) => {
    const assets = read();
    const index = assets.findIndex((asset) => asset.id === id);
    if (index < 0) throw new Error('素材不存在，请刷新素材库。');
    assets[index] = { ...update(assets[index]), updatedAt: new Date().toISOString() };
    write(assets);
    return assets[index];
  };
  return {
    async listLibraryAssets(input = {}) { return queryLibraryAssets(read(), libraryListSchema.parse(input)); },
    async getLibraryAsset(id) {
      const asset = read().find((item) => item.id === id);
      if (!asset) throw new Error('素材不存在，请刷新素材库。');
      return asset;
    },
    async saveLibraryAsset(input) {
      const parsed = librarySaveSchema.parse(input);
      if (parsed.kind === 'image') throw new Error('本地图片素材请在桌面端保存。浏览器预览支持文本素材。');
      const now = new Date().toISOString();
      const { kind, title, collection, tags, favorite, source, text } = parsed;
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const revision = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const asset: LibraryAsset = { id: crypto.randomUUID(), kind, title, collection, tags, favorite, source, text, revision, createdAt: now, updatedAt: now, deletedAt: null };
      write([...read(), asset]);
      return asset;
    },
    async updateLibraryAsset(input) {
      const parsed = libraryUpdateSchema.parse(input);
      return mutate(parsed.id, (asset) => {
        if (asset.deletedAt) throw new Error('请先从回收站恢复素材。');
        return { ...asset, ...parsed };
      });
    },
    async recycleLibraryAsset(id) { return mutate(id, (asset) => ({ ...asset, deletedAt: asset.deletedAt || new Date().toISOString() })); },
    async restoreLibraryAsset(id) { return mutate(id, (asset) => ({ ...asset, deletedAt: null })); },
  };
}

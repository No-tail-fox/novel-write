import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { libraryListSchema, librarySaveSchema, libraryUpdateSchema, queryLibraryAssets, type LibraryAsset, type LibraryListInput, type LibrarySaveInput, type LibraryUpdateInput } from '../src/shared/asset-library';
import { importManagedImageLabRecord, type ManagedImageLabImportDependencies } from './image-lab-import';

/** The library owns immutable content; metadata and recycling never mutate adopted copies. */
export class AssetLibraryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  constructor(appDataDirectory: string, private readonly imageDependencies: ManagedImageLabImportDependencies = {}) {
    this.root = join(appDataDirectory, 'asset-library');
  }
  private async read(): Promise<LibraryAsset[]> {
    try {
      const saved = JSON.parse(await readFile(join(this.root, 'index.json'), 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.assets)) throw new Error('素材库索引格式无法识别。');
      return saved.assets.map((asset: LibraryAsset) => {
        z.uuid().parse(asset.id);
        librarySaveSchema.parse(asset.kind === 'image'
          ? { kind: asset.kind, imagePath: asset.imagePath, prompt: asset.prompt, title: asset.title, collection: asset.collection, tags: asset.tags, favorite: asset.favorite, source: asset.source }
          : { kind: asset.kind, text: asset.text, title: asset.title, collection: asset.collection, tags: asset.tags, favorite: asset.favorite, source: asset.source });
        z.string().datetime().parse(asset.createdAt);
        z.string().datetime().parse(asset.updatedAt);
        z.string().datetime().nullable().parse(asset.deletedAt);
        z.string().regex(/^[a-f0-9]{64}$/).parse(asset.revision);
        return asset;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async write(assets: LibraryAsset[]) {
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `index-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx');
      try { await handle.writeFile(JSON.stringify({ version: 1, assets }), 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, join(this.root, 'index.json'));
    } finally { await rm(temporary, { force: true }); }
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  async list(request: LibraryListInput = {}) {
    await this.queue;
    return queryLibraryAssets(await this.read(), libraryListSchema.parse(request));
  }
  async get(id: string): Promise<LibraryAsset> {
    z.uuid().parse(id);
    await this.queue;
    const asset = (await this.read()).find((item) => item.id === id);
    if (!asset) throw new Error('素材不存在，请刷新素材库。');
    return asset;
  }
  save(input: LibrarySaveInput): Promise<LibraryAsset> {
    return this.serialize(async () => {
      const parsed = librarySaveSchema.parse(input);
      const assets = await this.read();
      const now = new Date().toISOString();
      const { kind, title, collection, tags, favorite, source } = parsed;
      const metadata = { id: randomUUID(), kind, title, collection, tags: [...new Set(tags)], favorite, source, createdAt: now, updatedAt: now, deletedAt: null };
      if (parsed.kind === 'text') {
        const asset: LibraryAsset = { ...metadata, text: parsed.text, revision: createHash('sha256').update(parsed.text).digest('hex') };
        await this.write([...assets, asset]);
        return asset;
      }
      let saved: LibraryAsset | undefined;
      await mkdir(join(this.root, 'media'), { recursive: true });
      await importManagedImageLabRecord(join(this.root, 'media'), {
        imagePath: parsed.imagePath, prompt: parsed.prompt || title, ratio: '1:1', style: 'library', provider: 'local-import',
      }, async (record) => {
        if (!record.imagePath) throw new Error('素材图片未能写入本地存储。');
        const imagePath = record.imagePath;
        const bytes = await readFile(imagePath);
        saved = { ...metadata, imagePath, prompt: parsed.prompt, revision: createHash('sha256').update(bytes).digest('hex') };
        await this.write([...assets, saved]);
        return { ...record, imagePath, id: metadata.id, createdAt: now, errorMessage: '', status: 'generated', resolution: record.resolution ?? '1K', smartMode: record.smartMode ?? 'text-to-image', referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, finishedAt: now };
      }, this.imageDependencies);
      return saved!;
    });
  }
  update(input: LibraryUpdateInput) {
    const parsed = libraryUpdateSchema.parse(input);
    return this.mutate(parsed.id, (asset) => {
      if (asset.deletedAt) throw new Error('请先从回收站恢复素材。');
      return { ...asset, ...parsed, tags: [...new Set(parsed.tags)] };
    });
  }
  recycle(id: string) { return this.mutate(id, (asset) => ({ ...asset, deletedAt: asset.deletedAt || new Date().toISOString() })); }
  restore(id: string) { return this.mutate(id, (asset) => ({ ...asset, deletedAt: null })); }
  private mutate(id: string, change: (asset: LibraryAsset) => LibraryAsset): Promise<LibraryAsset> {
    z.uuid().parse(id);
    return this.serialize(async () => {
      const assets = await this.read();
      const index = assets.findIndex((asset) => asset.id === id);
      if (index < 0) throw new Error('素材不存在，请刷新素材库。');
      const next = { ...change(assets[index]), updatedAt: new Date().toISOString() };
      assets[index] = next;
      await this.write(assets);
      return next;
    });
  }
}

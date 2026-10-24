import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AssetLibraryStore } from '../electron/asset-library-store';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNsAAAAASUVORK5CYII=', 'base64');
const textInput = (title: string) => ({ kind: 'text' as const, title, text: `Content for ${title}`, collection: 'Scripts', tags: ['story'], favorite: false, source: { kind: 'local' as const } });
async function temporaryRoot() {
  const root = await createTestTempDirectory(join(tmpdir(), 'storydream-library-'));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => removeTestTempDirectories(root))); });

describe('global asset library', () => {
  it('persists concurrent saves without losing entries and returns bounded summaries', async () => {
    const root = await temporaryRoot();
    const store = new AssetLibraryStore(root);
    const saved = await Promise.all(Array.from({ length: 28 }, (_, index) => store.save(textInput(`Text ${index}`))));
    expect(new Set(saved.map((asset) => asset.id)).size).toBe(28);
    const restarted = new AssetLibraryStore(root);
    const page = await restarted.list({ limit: 24 });
    expect(page.total).toBe(28);
    expect(page.items).toHaveLength(24);
    expect(page.items[0]).not.toHaveProperty('text');
    expect(page.items[0]).not.toHaveProperty('prompt');
    const next = await restarted.list({ offset: 24, limit: 24 });
    expect(next.items).toHaveLength(4);
    expect(new Set([...page.items, ...next.items].map((asset) => asset.id)).size).toBe(28);
    expect((await restarted.get(saved[0].id)).text).toBe(saved[0].text);
  });

  it('keeps content identity stable through metadata, favorites, recycling and restore', async () => {
    const store = new AssetLibraryStore(await temporaryRoot());
    const saved = await store.save(textInput('Original'));
    const updated = await store.update({ id: saved.id, title: 'Renamed', collection: 'Dialogue', tags: ['voice', 'voice'], favorite: true });
    expect(updated.revision).toBe(saved.revision);
    expect(updated.text).toBe(saved.text);
    expect(updated.tags).toEqual(['voice']);
    expect((await store.list({ query: 'CONTENT', kind: 'text', favorite: true, collection: 'Dialogue' })).items.map((asset) => asset.id)).toEqual([saved.id]);
    expect((await store.list({ query: 'voice' })).total).toBe(1);
    await store.recycle(saved.id);
    expect((await store.list()).total).toBe(0);
    expect((await store.list({ deleted: true })).collections).toEqual(['Dialogue']);
    await expect(store.update({ id: saved.id, title: 'Invalid', collection: '', tags: [], favorite: false })).rejects.toThrow();
    const restored = await store.restore(saved.id);
    expect(restored.revision).toBe(saved.revision);
    expect(restored.deletedAt).toBeNull();
    expect((await store.list({ favorite: true })).total).toBe(1);
  });

  it('owns a separate image copy that survives removal of its original and recycling', async () => {
    const root = await temporaryRoot();
    const source = join(root, 'source.png');
    await writeFile(source, png);
    const store = new AssetLibraryStore(root);
    const { text: _text, ...metadata } = textInput('Image');
    const saved = await store.save({ ...metadata, kind: 'image', imagePath: source });
    expect(saved.imagePath).not.toBe(source);
    expect(saved.imagePath).toContain(join(root, 'asset-library', 'media'));
    expect(saved.revision).toBe(createHash('sha256').update(png).digest('hex'));
    await rm(source);
    await store.recycle(saved.id);
    expect(await readFile(saved.imagePath!)).toEqual(png);
    expect((await new AssetLibraryStore(root).get(saved.id)).imagePath).toBe(saved.imagePath);
  });

  it('rolls back a failed image import and allows the next queued save', async () => {
    const root = await temporaryRoot();
    const source = join(root, 'source.png');
    await writeFile(source, png);
    const store = new AssetLibraryStore(root, { copyFile: async () => { throw new Error('copy failed'); } });
    const { text: _text, ...metadata } = textInput('Image');
    await expect(store.save({ ...metadata, kind: 'image', imagePath: source })).rejects.toThrow('copy failed');
    expect((await store.list()).total).toBe(0);
    expect(await readdir(join(root, 'asset-library', 'media', 'image-lab'))).toEqual([]);
    await store.save(textInput('After failure'));
    expect((await store.list()).total).toBe(1);
  });

  it('rejects a damaged index without silently replacing existing data', async () => {
    const root = await temporaryRoot();
    const index = join(root, 'asset-library', 'index.json');
    await mkdir(join(root, 'asset-library'), { recursive: true });
    await writeFile(index, '{damaged', 'utf8');
    const store = new AssetLibraryStore(root);
    await expect(store.save(textInput('New'))).rejects.toThrow();
    expect(await readFile(index, 'utf8')).toBe('{damaged');
  });

  it('keeps identity and owned paths out of metadata mutations at the IPC boundary', () => {
    const saveLibraryAsset = ipcInputSchemas['library:save'];
    const updateLibraryAsset = ipcInputSchemas['library:update'];
    const recycleLibraryAsset = ipcInputSchemas['library:recycle'];
    const restoreLibraryAsset = ipcInputSchemas['library:restore'];
    expect(saveLibraryAsset.safeParse(textInput('Valid')).success).toBe(true);
    expect(saveLibraryAsset.safeParse({ ...textInput('Invalid'), revision: 'renderer-revision' }).success).toBe(false);
    expect(updateLibraryAsset.safeParse({ id: '537e5c24-76d1-490b-95e1-5a3ee5f0397a', title: 'Name', collection: '', tags: [], favorite: false, imagePath: 'replaced.png' }).success).toBe(false);
    expect(recycleLibraryAsset.safeParse('not-a-uuid').success).toBe(false);
    expect(restoreLibraryAsset.safeParse('not-a-uuid').success).toBe(false);
  });
});

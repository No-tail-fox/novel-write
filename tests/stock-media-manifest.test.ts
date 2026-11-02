import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStockMediaManifest } from '../src/shared/stock-media-manifest';
import type { TaskArtifactVideoPreview } from '../src/shared/types';
import { PEXELS_API_DOCUMENTATION_URL, PEXELS_LICENSE_URL, type StockMediaProvenance } from '../src/shared/stock-media';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const source: StockMediaProvenance = { provider: 'pexels', mediaId: '42', variantId: '88', sourceUrl: 'https://www.pexels.com/video/42/', author: '素材作者', authorUrl: 'https://www.pexels.com/@fixture/', licenseName: 'Pexels License', licenseUrl: PEXELS_LICENSE_URL, licenseRecordedAt: '2026-11-02T00:00:00.000Z', downloadedAt: '2026-11-02T00:00:00.000Z', contentHash: 'a'.repeat(64), apiDocumentationUrl: PEXELS_API_DOCUMENTATION_URL };
const video = (stockMedia?: StockMediaProvenance[]): TaskArtifactVideoPreview => ({ sceneId: 1, path: 'D:/private-cache/media.mp4', source: 'local-upload', originalName: '素材', durationMs: 2000, width: 320, height: 180, trimStartMs: 0, fit: 'cover', muted: true, stockMedia });
async function target() { const directory = await mkdtemp(join(tmpdir(), 'stock-manifest-')); directories.push(directory); return { directory, path: join(directory, 'sources.json') }; }
describe('portable stock source manifests', () => {
  it('writes portable source records without local paths or transient URLs', async () => {
    const { directory, path } = await target(); await writeStockMediaManifest(path, [video([source])]);
    const text = await readFile(path, 'utf8'), parsed = JSON.parse(text);
    expect(parsed.scenes).toEqual([{ sceneId: 1, sources: [source] }]);
    expect(text).not.toContain('D:/private-cache'); expect(text).not.toContain('videos.pexels.com');
    expect((await readdir(directory)).filter(name => name.endsWith('.partial'))).toEqual([]);
  });
  it('removes stale attribution when a replacement delivery uses no stock sources', async () => {
    const { path } = await target(); await writeStockMediaManifest(path, [video([source])]); await writeStockMediaManifest(path, [video()]);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects invalid provenance before replacing existing evidence', async () => {
    const { directory, path } = await target(); await writeStockMediaManifest(path, [video([source])]); const before = await readFile(path, 'utf8');
    await expect(writeStockMediaManifest(path, [video([{ ...source, sourceUrl: 'https://unapproved.invalid/42' }])])).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before); expect(await readdir(directory)).toEqual(['sources.json']);
  });
});

import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCustomStylePreviewDraft } from '../electron/custom-style-preview';
import { defaultConfig, defaultCustomStyles } from '../src/shared/config';
import { CUSTOM_STYLE_PREVIEW_SUBJECT, customStylePreviewSignature, validCustomStylePreview, withoutStaleCustomStylePreview } from '../src/shared/custom-style-preview';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { FileDatabase } from '../src/shared/storage';
import type { CustomStyle, ImageLabRecord } from '../src/shared/types';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

const roots: string[] = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNsAAAAASUVORK5CYII=', 'base64');
const style: CustomStyle = { ...defaultCustomStyles[0], id: 'user-illustration', name: '我的画风', prefix: '蓝色版画', suffix: '棉纸纹理', negativePrompt: '照片', allowColor: true };

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => removeTestTempDirectories(root)));
});

describe('custom drawing style previews', () => {
  it('matches only drawing parameters and rejects stale or invalid preview metadata', () => {
    const preview = { imagePath: 'C:/app/custom-style-previews/image.png', generatedAt: '2026-09-17T01:00:00.000Z', styleSignature: customStylePreviewSignature(style) };
    expect(validCustomStylePreview({ ...style, preview })).toEqual(preview);
    expect(validCustomStylePreview({ ...style, name: '改名', tag: '新标签', description: '新说明', preview })).toEqual(preview);
    for (const changed of [
      { prefix: '新前缀' }, { suffix: '新后缀' }, { negativePrompt: '新负面词' }, { allowColor: false },
    ]) {
      expect(validCustomStylePreview({ ...style, ...changed, preview })).toBeUndefined();
      expect(withoutStaleCustomStylePreview({ ...style, ...changed, preview })).not.toHaveProperty('preview');
    }
    expect(validCustomStylePreview({ ...style, preview: { ...preview, generatedAt: 'invalid' } })).toBeUndefined();
    expect(validCustomStylePreview({ ...style, preview: { ...preview, imagePath: ' ' } })).toBeUndefined();
  });

  it('persists a generated sample across reopening and removes it when drawing parameters change', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'app.db');
    const preview = { imagePath: join(root, 'sample.png'), generatedAt: new Date().toISOString(), styleSignature: customStylePreviewSignature(style) };
    const database = await FileDatabase.open(path);
    await database.upsertCustomStyle({ ...style, preview });
    await database.close();
    const reopened = await FileDatabase.open(path);
    try {
      expect((await reopened.getCustomStyleDetail(style.id))?.preview).toEqual(preview);
      expect((await reopened.upsertCustomStyle({ ...style, name: '已改名', preview })).preview).toEqual(preview);
      expect((await reopened.upsertCustomStyle({ ...style, prefix: '全新风格', preview })).preview).toBeUndefined();
      expect((await reopened.getCustomStyleDetail(style.id))?.preview).toBeUndefined();
    } finally { await reopened.close(); }
  });

  it('migrates older custom-style tables without discarding saved user templates', async () => {
    const root = await temporaryRoot();
    const path = join(root, 'legacy.db');
    const database = await FileDatabase.open(path);
    await database.upsertCustomStyle(style);
    (database as unknown as { db: { run: (sql: string) => void } }).db.run('ALTER TABLE custom_styles DROP COLUMN preview_json');
    await database.persist();
    await database.close();
    const reopened = await FileDatabase.open(path);
    try {
      expect(await reopened.getCustomStyleDetail(style.id)).toEqual(style);
      const preview = { imagePath: join(root, 'migrated.png'), generatedAt: new Date().toISOString(), styleSignature: customStylePreviewSignature(style) };
      expect((await reopened.upsertCustomStyle({ ...style, preview })).preview).toEqual(preview);
    } finally { await reopened.close(); }
  });

  it('generates one sample with the real draft style and configured model in an independent local directory', async () => {
    const root = await temporaryRoot();
    const generate = vi.fn(async (config, workDir, input, _signal, customStyle) => {
      expect(config).toBe(defaultConfig);
      expect(input).toMatchObject({ style: style.id, prompt: CUSTOM_STYLE_PREVIEW_SUBJECT, ratio: '16:9', resolution: '1K' });
      expect(customStyle).toEqual(style);
      expect(relative(root, workDir)).toMatch(/^custom-style-previews[\\/][a-f0-9-]{36}$/u);
      const imagePath = join(workDir, 'sample.png');
      await writeFile(imagePath, png);
      return generatedRecord(imagePath);
    });
    const draft = await generateCustomStylePreviewDraft(defaultConfig, root, style, generate);
    expect(generate).toHaveBeenCalledOnce();
    expect(style).not.toHaveProperty('preview');
    expect(draft).toMatchObject(style);
    expect(validCustomStylePreview(draft)).toEqual(draft.preview);
    expect(await readFile(draft.preview!.imagePath)).toEqual(png);
    const second = await generateCustomStylePreviewDraft(defaultConfig, root, style, generate);
    expect(second.preview!.imagePath).not.toBe(draft.preview!.imagePath);
  });

  it('surfaces failed provider calls without retrying or changing the existing draft preview', async () => {
    const root = await temporaryRoot();
    const original = { ...style, preview: { imagePath: join(root, 'old.png'), generatedAt: new Date().toISOString(), styleSignature: customStylePreviewSignature(style) } };
    const generate = vi.fn(async () => ({ ...generatedRecord(''), status: 'failed' as const, errorMessage: 'provider rejected request' }));
    await expect(generateCustomStylePreviewDraft(defaultConfig, root, original, generate)).rejects.toThrow('provider rejected request');
    expect(generate).toHaveBeenCalledOnce();
    expect(original.preview.imagePath).toBe(join(root, 'old.png'));
    const throws = vi.fn(async () => { throw new Error('network timeout'); });
    await expect(generateCustomStylePreviewDraft(defaultConfig, root, original, throws)).rejects.toThrow('network timeout');
    expect(throws).toHaveBeenCalledOnce();
  });

  it('rejects successful records with no valid local sample and validates the new IPC contract', async () => {
    const root = await temporaryRoot();
    await expect(generateCustomStylePreviewDraft(defaultConfig, root, style, async () => generatedRecord(join(root, 'outside.png')))).rejects.toThrow('INVALID_OUTPUT');
    expect(ipcInputSchemas['custom-style:generate-preview'].safeParse(style).success).toBe(true);
    const withPreview = { ...style, preview: { imagePath: join(root, 'preview.png'), styleSignature: customStylePreviewSignature(style), generatedAt: new Date().toISOString() } };
    expect(ipcInputSchemas['custom-style:save'].safeParse(withPreview).success).toBe(true);
    expect(ipcInputSchemas['custom-style:generate-preview'].safeParse({ ...style, preview: { ...withPreview.preview, imagePath: 'bad\0path' } }).success).toBe(false);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await createTestTempDirectory(join(tmpdir(), 'storydream-custom-style-preview-'));
  roots.push(root);
  return root;
}

function generatedRecord(imagePath: string): ImageLabRecord {
  return { id: 'preview-record', prompt: CUSTOM_STYLE_PREVIEW_SUBJECT, style: style.id, ratio: '16:9', provider: 'gpt_image', imagePath, status: 'generated', errorMessage: '', resolution: '1K', smartMode: 'text-to-image', referenceImagePath: '', referenceImagePaths: [], upstreamTaskId: null, createdAt: new Date().toISOString(), finishedAt: new Date().toISOString() };
}

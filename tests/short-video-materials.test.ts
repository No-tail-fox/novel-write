import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, copyFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bindShortVideoMaterials, allocateShortVideoMaterials } from '../src/shared/short-video-material-runtime';
import { appendShortVideoMaterialFiles, resolveShortVideoMaterials } from '../src/shared/short-video-materials';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { formatAppErrorMessage, normalizeAppError } from '../src/shared/app-error';
import { FileDatabase } from '../src/shared/storage';
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'short-video-materials-')); directories.push(dir);
  const file = join(dir, 'source.mp4'); await writeFile(file, 'unit-fixture-video');
  const normalize = vi.fn(async (source: string, target: string) => { await copyFile(source, target); return { width: 320, height: 180, durationMs: 5000 }; });
  return { dir, file, normalize, settings: { files: [file], fit: 'cover' as const } };
}
describe('task-owned material pool (unit contracts, not visual acceptance)', () => {
  it('rejects empty, unsupported and unrelated routes; preserves order while deduplicating', () => {
    expect(() => resolveShortVideoMaterials({ shortVideoMaterials: { files: [], fit: 'cover' } })).toThrow();
    expect(() => resolveShortVideoMaterials({ shortVideoMaterials: { files: ['image.png'], fit: 'cover' } })).toThrow('MP4');
    expect(() => resolveShortVideoMaterials({ taskKind: 'music-mv', shortVideoMaterials: { files: ['a.mp4'], fit: 'cover' } })).toThrow('短片');
    expect(resolveShortVideoMaterials({ shortVideoMaterials: { files: ['b.mp4', 'a.mov', 'b.mp4'], fit: 'contain' } })?.files).toEqual(['b.mp4', 'a.mov']);
  });
  it('imports once, deduplicates content and resumes after the external file is removed', async () => {
    const f = await fixture(), work = join(f.dir, 'task'); const duplicate = join(f.dir, 'duplicate.mp4'); await copyFile(f.file, duplicate);
    const first = await bindShortVideoMaterials({ ...f.settings, files: [f.file, duplicate] }, work, f);
    expect(first.assets).toHaveLength(1); expect(f.normalize).toHaveBeenCalledTimes(1);
    expect(first.assets[0].originalName).toBe('source.mp4'); await rm(f.file); await rm(duplicate);
    const resumed = await bindShortVideoMaterials(first.settings, work, f);
    expect(resumed).toEqual(first); expect(f.normalize).toHaveBeenCalledTimes(1);
  });
  it('refuses a corrupted managed file instead of trusting a stale receipt', async () => {
    const f = await fixture(), work = join(f.dir, 'task');
    const first = await bindShortVideoMaterials(f.settings, work, f);
    await writeFile(first.settings.files[0], 'corrupted');
    await expect(bindShortVideoMaterials(first.settings, work, f)).rejects.toThrow('回执');
    expect(f.normalize).toHaveBeenCalledTimes(1);
  });
  it('cancels import without committing a partial asset or receipt', async () => {
    const f = await fixture(), work = join(f.dir, 'task'), controller = new AbortController();
    await expect(bindShortVideoMaterials(f.settings, work, { signal: controller.signal, normalize: async (source, target) => {
      const probe = await f.normalize(source, target); controller.abort(); return probe;
    } })).rejects.toThrow();
    expect(await readdir(join(work, 'sources', 'short-video'))).toEqual([]);
    expect(await readFile(f.file, 'utf8')).toBe('unit-fixture-video');
  });
  it('rejects an invalid probe and removes only its own temporary files', async () => {
    const f = await fixture(), work = join(f.dir, 'task');
    await expect(bindShortVideoMaterials(f.settings, work, { normalize: async (source, target) => {
      await f.normalize(source, target); return { width: 0, height: 10, durationMs: 100 };
    } })).rejects.toThrow('尺寸');
    expect(await readdir(join(work, 'sources', 'short-video'))).toEqual([]);
  });
  it('rejects changing source files without committing stale content hashes', async () => {
    const f = await fixture(), work = join(f.dir, 'task');
    await expect(bindShortVideoMaterials(f.settings, work, { normalize: async (source, target) => {
      const probe = await f.normalize(source, target); await writeFile(source, 'changed-source-and-length'); return probe;
    } })).rejects.toThrow('发生变化');
    expect(await readdir(join(work, 'sources', 'short-video'))).toEqual([]);
  });
  it('rejects empty normalized files even when the host returns a valid probe', async () => {
    const f = await fixture(), work = join(f.dir, 'task');
    await expect(bindShortVideoMaterials(f.settings, work, { normalize: async (_source, target) => {
      await writeFile(target, ''); return { width: 320, height: 180, durationMs: 5000 };
    } })).rejects.toThrow('结果为空');
    expect(await readdir(join(work, 'sources', 'short-video'))).toEqual([]);
  });
  it('allocates ordered scene segments and keeps original audio muted', async () => {
    const f = await fixture(), pool = await bindShortVideoMaterials(f.settings, join(f.dir, 'task'), f);
    const scenes = [1, 2, 3].map(id => ({ id, cap: '测试', descPrompt: '', durationMs: 2000 }));
    const videos = allocateShortVideoMaterials(scenes, pool.assets, 'contain');
    expect(videos.map(v => v.trimStartMs)).toEqual([0, 2000, 0]);
    expect(videos.every(v => v.muted && v.fit === 'contain' && v.license)).toBe(true);
  });
  it('persists pool settings through strict IPC, database update and reopen; old tasks stay unchanged', async () => {
    const f = await fixture(), file = join(f.dir, 'db.sqlite'); let db = await FileDatabase.open(file);
    try {
      const parsed = ipcInputSchemas['task:create-and-run'].parse({ inputText: '素材混剪', shortVideoMaterials: f.settings });
      const task = await db.createTask(parsed), pool = await bindShortVideoMaterials(f.settings, join(f.dir, 'task'), f);
      expect(task.outputTargets).toEqual(['jianying-draft']);
      await db.updateTask(task.id, { shortVideoMaterials: pool.settings }); await db.close(); db = await FileDatabase.open(file);
      expect((await db.getState()).tasks.find(t => t.id === task.id)?.shortVideoMaterials).toEqual(pool.settings);
      expect((await db.createTask({ inputText: 'legacy' })).shortVideoMaterials).toBeUndefined();
    } finally { await db.close(); }
  });
});

describe('short-video material selection boundary', () => {
  it('adds a batch in order, supports WebM and cancels without mutating the pool', () => {
    const current = { files: ['first.mp4'], fit: 'contain' as const };
    expect(appendShortVideoMaterialFiles(current, [])).toBe(current);
    expect(appendShortVideoMaterialFiles(current, ['first.mp4', 'second.webm', 'third.mov', 'second.webm']).files).toEqual(['first.mp4', 'second.webm', 'third.mov']);
    expect(current.files).toEqual(['first.mp4']);
  });
  it('rejects an overflowing batch atomically rather than silently dropping files', () => {
    const current = { files: Array.from({ length: 99 }, (_, i) => `${i}.mp4`), fit: 'cover' as const };
    expect(() => appendShortVideoMaterialFiles(current, ['new1.mp4', 'new2.webm'])).toThrow('100');
    expect(current.files).toHaveLength(99);
    expect(appendShortVideoMaterialFiles(current, ['0.mp4', 'new1.webm']).files).toHaveLength(100);
    expect(() => appendShortVideoMaterialFiles(current, ['photo.png'])).toThrow('MP4');
  });
  it('keeps local validation readable through the safe UI error contract', () => {
    try {
      appendShortVideoMaterialFiles({ files: ['first.mp4'], fit: 'cover' }, Array.from({ length: 100 }, (_, i) => `${i}.mp4`));
      expect.fail('expected an over-limit selection error');
    } catch (error) {
      const normalized = normalizeAppError(error);
      expect(normalized.code).toBe('SHORT_VIDEO_MATERIAL_LIMIT');
      expect(formatAppErrorMessage(normalized)).toContain('最多添加 100');
    }
  });
  it('decodes bridge errors in both pickers and catalog loading', async () => {
    for (const file of ['ShortVideoMaterialFields.tsx', 'PixelleTemplateFields.tsx', 'NewTaskPage.tsx']) {
      const source = await readFile(new URL(`../src/features/tasks/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('formatAppErrorMessage(normalizeAppError(error))');
    }
  });
  it('wires selectShortVideoMaterials to a separate trusted multi-file picker, not the reference picker', async () => {
    const read = (name: string) => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
    const main = await read('electron/main.ts');
    const start = main.indexOf("trustedHandle('short-video-materials:select'");
    expect(start).toBeGreaterThan(0);
    const picker = main.slice(start, main.indexOf('\ntrustedHandle(', start + 1));
    expect(picker).toContain("properties: ['openFile', 'multiSelections']");
    expect(picker).toContain("extensions: ['mp4', 'mov', 'webm']");
    expect(picker).toContain('result.canceled ? [] : result.filePaths');
    expect(await read('electron/preload.ts')).toContain("selectShortVideoMaterials: (): Promise<string[]> => invokeTrusted('short-video-materials:select')");
    expect(await read('src/features/tasks/NewTaskPage.tsx')).toContain('api.selectShortVideoMaterials()');
    expect(await read('src/features/tasks/ShortVideoMaterialFields.tsx')).toContain('disabled={picking || value.files.length >= 100}');
    expect(ipcInputSchemas['short-video-materials:select'].safeParse(undefined).success).toBe(true);
    expect(ipcInputSchemas['short-video-materials:select'].safeParse({ path: 'untrusted.mp4' }).success).toBe(false);
  });
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, stat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { FileDatabase } from '../src/shared/storage';
import { bindPixelleTaskVideo, preflightPixelleTask, loadPixelleCatalog, preparePixelleTaskOutputs } from '../src/shared/pixelle-render';
import { resolvePixelleTask, pixelleRatio } from '../src/shared/pixelle-task';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { getTemplate } from '../src/shared/templates';
import type { PixelleCatalog } from '../src/shared/pixelle';
import type { WriteJianyingDraftInput } from '../src/shared/draft';
let dir: string, catalog: PixelleCatalog;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pixelle-task-')); catalog = await loadPixelleCatalog({ appRoot: resolve('.'), cacheDir: dir }); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
const find = (name: string) => catalog.templates.find(t => t.ref.path === '1080x1920/' + name)!;
describe('Pixelle task contract and shared delivery', () => {
  it('accepts all 31 original template identities and required media types', () => {
    for (const t of catalog.templates) expect(resolvePixelleTask({ visualTemplateRef: t.ref, ratio: pixelleRatio(t), pixelleOptions: { subtitleMode: 'template', ...(t.type === 'video' ? { videoPath: 'explicit-local.mp4' } : {}) } }, catalog)).toEqual(t);
  });
  it('rejects incompatible ratio, missing real video, stale identity and unrelated task routes', () => {
    const visualTemplateRef = find('video_default.html').ref;
    expect(() => resolvePixelleTask({ visualTemplateRef }, catalog)).toThrow('真实视频');
    expect(() => resolvePixelleTask({ visualTemplateRef: find('image_default.html').ref, ratio: '16:9' }, catalog)).toThrow('画幅');
    expect(() => resolvePixelleTask({ visualTemplateRef: { ...visualTemplateRef, sha256: '0'.repeat(64) } }, catalog)).toThrow('校验');
    expect(() => resolvePixelleTask({ visualTemplateRef, taskType: 'html-video' }, catalog)).toThrow('短片生成');
    expect(() => resolvePixelleTask({ visualTemplateRef, taskKind: 'music-mv' }, catalog)).toThrow('短片生成');
  });
  it('shares a material pool only with video-capable template modes', () => {
    const shortVideoMaterials = { files: ['owned.mp4'], fit: 'contain' as const };
    const video = find('video_default.html'), asset = find('asset_default.html');
    expect(resolvePixelleTask({ visualTemplateRef: video.ref, shortVideoMaterials }, catalog)).toEqual(video);
    expect(resolvePixelleTask({ visualTemplateRef: asset.ref, shortVideoMaterials, pixelleOptions: { subtitleMode: 'template', mediaKind: 'video' } }, catalog)).toEqual(asset);
    for (const filename of ['image_default.html', 'static_default.html', 'asset_default.html']) {
      expect(() => resolvePixelleTask({ visualTemplateRef: find(filename).ref, shortVideoMaterials }, catalog)).toThrow('视频模式');
    }
  });
  it('retains separate draft/visual IDs through actual SQL persistence and strict IPC validation', async () => {
    const path = join(dir, 'db.sqlite'); let db = await FileDatabase.open(path);
    const input = { inputText: '原模板持久化测试', visualTemplateRef: find('image_default.html').ref, pixelleOptions: { subtitleMode: 'timed-overlay' as const }, templateId: 'default-portrait-9-16', outputTargets: ['mp4', 'jianying-draft'] as const };
    const parsed = ipcInputSchemas['task:create-and-run'].parse(input);
    const task = await db.createTask(parsed); await db.close(); db = await FileDatabase.open(path);
    try {
      const restored = (await db.getState()).tasks.find(t => t.id === task.id)!;
      expect(restored.visualTemplateRef).toEqual(input.visualTemplateRef); expect(restored.pixelleOptions).toEqual(input.pixelleOptions);
      expect(restored.templateId).toBe(input.templateId); expect(restored.outputTargets).toEqual(input.outputTargets);
      const legacy = await db.createTask({ inputText: 'legacy' }); expect(legacy.visualTemplateRef).toBeUndefined(); expect(legacy.outputTargets).toBeUndefined();
    } finally { await db.close(); }
  });
  it('renders original frame once, reuses cache and suppresses duplicate title/subtitle/motion', async () => {
    const db = await FileDatabase.open(join(dir, 'render.sqlite'));
    try {
      const image = join(dir, 'tiny.png'); await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=', 'base64'));
      const task = await db.createTask({ inputText: '一次渲染两种输出', visualTemplateRef: find('image_default.html').ref, pixelleOptions: { subtitleMode: 'timed-overlay' } });
      const template = structuredClone(getTemplate('default-portrait-9-16'));
      const input: WriteJianyingDraftInput = { workDir: join(dir, 'delivery'), draftRootDir: '', title: '测试', ratio: '9:16', template, cover: { title: '原版', subtitle: [], tags: [], comments: [], summary: '' }, scenes: [{ id: 1, cap: '时轴字幕', descPrompt: '', durationMs: 1000 }], imagePrompts: [], reviewedText: '', rewrittenCopy: '', generatedImages: [{ sceneId: 1, path: image }], narrationAudio: [], bgm: null };
      const host = { appRoot: resolve('.'), cacheDir: join(dir, 'cache') };
      const first = await preparePixelleTaskOutputs(input, task, find('image_default.html'), host);
      const modified = (await stat(first.generatedImages[0].path)).mtimeMs;
      const second = await preparePixelleTaskOutputs(input, task, find('image_default.html'), host);
      expect(second.generatedImages).toEqual(first.generatedImages); expect((await stat(first.generatedImages[0].path)).mtimeMs).toBe(modified);
      expect(first.template!.title.visible).toBe(false); expect(first.template!.subtitle.visible).toBe(false); expect(first.template!.frame.enabled).toBe(false);
      expect(first.template!.caption.visible).toBe(true); expect(first.template!.image.motion).toBe(''); expect(template.title.visible).toBe(true);
      expect(input.generatedImages[0].path).toBe(image);
    } finally { await db.close(); }
  }, 30000);
});

it('copies real local video into task storage and keeps retries independent of the source file', async () => {
  const host = { appRoot: resolve('.'), cacheDir: join(dir, 'managed-cache') };
  const exec = promisify(execFile), python = resolve('vendor/python/python.exe');
  const ffmpeg = (await exec(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
  const source = join(dir, 'external-video.mp4');
  await exec(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24', '-t', '0.2', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
  let db = await FileDatabase.open(join(dir, 'managed.sqlite'));
  try {
    const template = find('video_default.html');
    const task = await db.createTask({ inputText: 'managed source', visualTemplateRef: template.ref, pixelleOptions: { subtitleMode: 'template', videoPath: source } });
    await preflightPixelleTask(task, host);
    const work = join(dir, 'task-owned');
    const bound = await bindPixelleTaskVideo(task, template, work, host);
    expect(bound.pixelleOptions!.videoPath!.startsWith(work)).toBe(true);
    await db.updateTask(task.id, { pixelleOptions: bound.pixelleOptions });
    await rm(source);
    await db.close(); db = await FileDatabase.open(join(dir, 'managed.sqlite'));
    const restored = (await db.getState()).tasks.find(t => t.id === task.id)!;
    expect(restored.pixelleOptions).toEqual(bound.pixelleOptions);
    await expect(preflightPixelleTask(restored, host)).resolves.toEqual(template);
    expect(await bindPixelleTaskVideo(restored, template, work, host)).toBe(restored);
    const broken = join(dir, 'invalid.mp4'); await writeFile(broken, 'not a video');
    await expect(preflightPixelleTask({ ...restored, pixelleOptions: { ...restored.pixelleOptions!, videoPath: broken } }, host)).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);

it('binds the Pixelle selectLocalVideo command to recoverable file-selection controls', async () => {
  const page = await readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8');
  const fields = await readFile(new URL('../src/features/tasks/PixelleTemplateFields.tsx', import.meta.url), 'utf8');
  expect(page).toContain('onSelectVideo={selectPixelleVideo}');
  expect(page).toContain('api.selectLocalVideo()');
  expect(fields).toContain('onClick={handleSelectVideo} disabled={pickingVideo}');
  expect(fields).toContain('finally { setPickingVideo(false); }');
  expect(fields).toContain('videoSelectionError');
});

import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type { WriteJianyingDraftInput } from './draft';
import type { Task, CreateTaskInput } from './types';
import type { PixelleCatalog, PixelleTemplateDescriptor } from './pixelle';
import { runPixelleWorker } from './pixelle-worker';
import { renderPixelleFrameWithResources } from './pixelle-resources';
import { pixelleUsesVideo, resolvePixelleTask } from './pixelle-task';
import { getTemplate, resolveDraftTemplateForRatio } from './templates';
import { outputFingerprint } from './task-output-runner';

export interface PixelleHostOptions {
  appRoot: string; resourcesPath?: string; cacheDir: string; signal?: AbortSignal;
  onProgress?: (detail: string) => Promise<void>;
}
export function loadPixelleCatalog(options: PixelleHostOptions): Promise<PixelleCatalog> {
  return runPixelleWorker({ mode: 'catalog', workDir: join(options.cacheDir, 'catalog') }, options);
}
export async function preflightPixelleTask(input: CreateTaskInput, options: PixelleHostOptions): Promise<PixelleTemplateDescriptor | undefined> {
  if (!input.visualTemplateRef && !input.pixelleOptions) return undefined;
  const template = resolvePixelleTask(input, await loadPixelleCatalog(options));
  if (template && pixelleUsesVideo(template, input.pixelleOptions) && !input.shortVideoMaterials) {
    const path = input.pixelleOptions!.videoPath!;
    if (!/\.(mp4|mov)$/i.test(path) || !(await stat(path)).isFile()) throw new Error('Pixelle 本地视频不可读取');
    await runPixelleWorker({ mode: 'probe-video', workDir: join(options.cacheDir, 'probe'), videoPath: path }, options);
  }
  return template;
}
/** Freeze selected external media into the task before any paid generation. */
export async function bindPixelleTaskVideo(task: Task, template: PixelleTemplateDescriptor, workDir: string, options: PixelleHostOptions): Promise<Task> {
  if (!pixelleUsesVideo(template, task.pixelleOptions) || task.shortVideoMaterials) return task;
  const source = resolve(task.pixelleOptions!.videoPath!);
  const extension = extname(source).toLowerCase();
  if (!['.mp4', '.mov'].includes(extension)) throw new Error('Pixelle 本地视频格式不支持');
  const directory = resolve(workDir, 'sources', 'pixelle');
  const target = join(directory, 'source' + extension);
  if (source === target) return task;
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `source-${randomUUID()}.partial${extension}`);
  try {
    options.signal?.throwIfAborted();
    const before = await stat(source);
    await copyFile(source, temporary);
    const after = await stat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || (await stat(temporary)).size !== before.size) throw new Error('Pixelle 视频导入期间发生变化，请重试');
    await runPixelleWorker({ mode: 'probe-video', workDir: directory, videoPath: temporary }, options);
    options.signal?.throwIfAborted();
    await rename(temporary, target);
    return { ...task, pixelleOptions: { ...task.pixelleOptions!, videoPath: target } };
  } finally { await rm(temporary, { force: true }); }
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Apply the original visual template once; both deliverables reuse these outputs. */
export async function preparePixelleTaskOutputs(input: WriteJianyingDraftInput, task: Task, template: PixelleTemplateDescriptor, options: PixelleHostOptions): Promise<WriteJianyingDraftInput> {
  resolvePixelleTask(task, { revision: template.ref.revision, templates: [template], paidRequests: 0 });
  const settings = task.pixelleOptions ?? { subtitleMode: 'template' as const };
  const video = pixelleUsesVideo(template, settings);
  const root = resolve(input.workDir, 'pixelle');
  await mkdir(root, { recursive: true });
  const images: WriteJianyingDraftInput['generatedImages'] = [];
  const videos: NonNullable<WriteJianyingDraftInput['generatedVideos']> = [];
  for (const [index, scene] of input.scenes.entries()) {
    options.signal?.throwIfAborted();
    const image = template.type !== 'static' && !video ? input.generatedImages.find(item => item.sceneId === scene.id)?.path : undefined;
    if (template.type !== 'static' && !video && !image) throw new Error(`Pixelle 镜头 ${scene.id} 缺少原始图片`);
    const videoPath = input.generatedVideos?.find(item => item.sceneId === scene.id)?.path ?? settings.videoPath;
    const voices = input.narrationAudio.filter(item => item.sceneId === scene.id).sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
    if (video && !voices.length) throw new Error(`Pixelle 镜头 ${scene.id} 缺少可复用配音`);
    const base = { workDir: root, templateRef: template.ref, title: input.cover.title || input.title, text: settings.subtitleMode === 'template' ? scene.cap : '', index: index + 1, parameters: settings.parameters, imagePath: image, mediaKind: video ? 'video' as const : 'image' as const };
    const fingerprint = await outputFingerprint({ version: 1, base, durationMs: scene.durationMs, video, videoPath, settings }, [image ?? '', ...(video ? [videoPath!, ...voices.map(item => item.path)] : [])]);
    const output = `scene-${index + 1}-${fingerprint.slice(0, 20)}.${video ? 'mp4' : 'png'}`;
    const path = join(root, output), receipt = path + '.json';
    let cached = false;
    try {
      const saved = JSON.parse(await readFile(receipt, 'utf8'));
      cached = saved.fingerprint === fingerprint && saved.sha256 === hash(await readFile(path));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (!cached) {
      await options.onProgress?.(`Pixelle 原模板渲染 ${index + 1}/${input.scenes.length}：${template.name}`);
      const common = { cacheDir: join(options.cacheDir, 'resources'), template, signal: options.signal };
      if (video) {
        const result = await renderPixelleFrameWithResources({ ...base, mode: 'render-clip' as const, output, videoPath, audioPaths: voices.map(item => item.path), durationMs: scene.durationMs, padStrategy: settings.padStrategy ?? 'freeze' }, { ...common, render: request => runPixelleWorker(request, options) });
        for (const warning of result.warnings) await options.onProgress?.(`镜头 ${scene.id} 视频不足，${warning.strategy === 'black' ? '黑屏' : '末帧冻结'}补齐 ${(warning.durationMs / 1000).toFixed(1)} 秒`);
      } else {
        const result = await renderPixelleFrameWithResources({ ...base, mode: 'render-frame' as const, output }, { ...common, render: request => runPixelleWorker(request, options) });
        if (result.requiresVideoComposition) throw new Error('不能把视频透明叠层当作成片画面');
      }
      const partial = receipt + '.' + randomUUID() + '.tmp';
      await writeFile(partial, JSON.stringify({ fingerprint, sha256: hash(await readFile(path)), templateRef: template.ref }), 'utf8');
      await rename(partial, receipt);
    }
    if (video) videos.push({ sceneId: scene.id, path, source: 'local-upload', originalName: template.name, durationMs: scene.durationMs, width: template.width, height: template.height, trimStartMs: 0, fit: 'contain', muted: true });
    else images.push({ sceneId: scene.id, path });
  }
  // The visual frame is already complete. Keep only the user's audio and timed-caption styling.
  const deliveryTemplate = structuredClone(resolveDraftTemplateForRatio(input.template ?? getTemplate(input.templateId), input.ratio));
  Object.assign(deliveryTemplate.canvas, { width: template.width, height: template.height, backgroundImage: '' });
  Object.assign(deliveryTemplate.image, { visible: true, left: 0, top: 0, width: 1, height: 1, fit: 'contain', ratio: input.ratio, mediaScale: 1, animation: '', motion: '', motionStrength: 0 });
  deliveryTemplate.frame.enabled = false;
  deliveryTemplate.title.visible = false;
  deliveryTemplate.subtitle.visible = false;
  deliveryTemplate.disclaimer.visible = false;
  deliveryTemplate.caption.visible = settings.subtitleMode === 'timed-overlay';
  return { ...input, generatedImages: images, generatedVideos: videos, template: deliveryTemplate };
}

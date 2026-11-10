// Editorial QA / task-operations fixture seeding, split out of main.ts (O-5). Only runs under the QA capture scopes.
import { nativeImage, shell } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHtmlVideoTaskInput, parseHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { FileDatabase } from '../src/shared/storage';
import type { CreateTaskInput } from '../src/shared/types';
import { ensureHtmlVideoTaskWorkDir } from './html-video-runtime';
import { importSceneVideoToLibrary } from './scene-video-library';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { resolveEditorialQaConfig } from './editorial-qa';

const execFileAsync = promisify(execFile);

export interface EditorialQaSeedDependencies {
  editorialQaConfig: ReturnType<typeof resolveEditorialQaConfig>;
  artifactDataDir: () => string;
  sceneVideoLibraryRoot: () => string;
  normalizeSceneVideo: Parameters<typeof importSceneVideoToLibrary>[0]["normalize"];
}

export function createEditorialQaSeeds(deps: EditorialQaSeedDependencies) {
  const { editorialQaConfig, artifactDataDir, sceneVideoLibraryRoot, normalizeSceneVideo } = deps;

async function seedTaskOperationsEditorialQa(database: FileDatabase, dataDir: string): Promise<void> {
  const taskOperationsScope = editorialQaConfig?.scope === 'task-operations'
    || editorialQaConfig?.scope === 'workflow'
    || editorialQaConfig?.scope === 'all';
  const projectFixtureScope = taskOperationsScope || editorialQaConfig?.scope === 'shell';
  const sceneVideoScope = editorialQaConfig?.scope === 'task-operations'
    || editorialQaConfig?.scope === 'workflow'
    || editorialQaConfig?.scope === 'all';
  const draftTemplateGalleryScope = editorialQaConfig?.scope === 'system';
  if (!projectFixtureScope && !draftTemplateGalleryScope) return;
  const selectedTemplateId = 'qa-selected-draft-template';
  const selectedTemplateBase = await database.getDraftTemplateDetail('builtin-portrait-4-3');
  if (!selectedTemplateBase) throw new Error('Editorial QA draft template fixture base is missing.');
  await database.upsertDraftTemplate({
    ...selectedTemplateBase,
    id: selectedTemplateId,
    name: 'QA 已选草稿模板',
    isDefault: false,
    canvas: { ...selectedTemplateBase.canvas, backgroundColor: '#071d24' },
    image: { ...selectedTemplateBase.image, top: 0.22, height: 0.44 },
    frame: {
      ...selectedTemplateBase.frame,
      enabled: true,
      headerColor: '#12303a',
      headerColorEnd: '#174b50',
      footerColor: '#0b1720',
      footerColorEnd: '#122b35',
      imageBorderColor: '#38f2b0',
      imageBorderWidth: 5,
    },
    title: {
      ...selectedTemplateBase.title,
      x: 0.08,
      y: 0.76,
      width: 0.76,
      fontSize: 31,
      color: '#38f2b0',
      underline: draftTemplateGalleryScope,
    },
    subtitle: {
      ...selectedTemplateBase.subtitle,
      x: -0.08,
      y: 0.56,
      width: 0.68,
      fontSize: 15,
      color: '#fff6c9',
      bold: true,
      underline: draftTemplateGalleryScope,
    },
    caption: { ...selectedTemplateBase.caption, y: -0.65, fontSize: 14, color: '#f8fafc', underline: draftTemplateGalleryScope },
    disclaimer: { ...selectedTemplateBase.disclaimer, fontSize: 9, color: '#9ad7cc', alpha: 0.82, underline: draftTemplateGalleryScope },
  });
  if (!projectFixtureScope) return;
  if (sceneVideoScope) await seedTaskOperationsSceneVideo(dataDir);
  const createFixture = async (title: string, overrides: Partial<CreateTaskInput> = {}) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
    return database.createTask({
      title,
      inputText: `${title}的本地确定性 QA 素材`,
      mode: 'ai',
      track: 'character-story',
      ratio: '9:16',
      templateId: selectedTemplateId,
      storyboardSceneCount: 12,
      targetScenes: 12,
      coverImageMode: 'off',
      ...overrides,
    });
  };

  const archived = await createFixture('QA 永久删除验证记录');
  await database.updateTask(archived.id, { status: 'completed', currentStep: 7, completedAt: new Date().toISOString() });
  await database.archiveTask(archived.id);

  const completed = await createFixture('丝绸之路文化科普', {
    coverImageMode: 'auto',
    coverTemplateId: 'cinematic-poster',
    coverPageEnabled: true,
    coverPageText: '丝路文明，从长安启程',
  });
  const completedOutput = join(dataDir, 'qa-task-operations', 'completed-output');
  const completedPipelineDir = join(completedOutput, 'pipeline');
  const completedDraftDir = join(completedOutput, 'draft');
  const completedCoverDir = join(completedOutput, 'covers');
  const completedStatePath = join(completedPipelineDir, 'state.json');
  const completedDraftContentPath = join(completedDraftDir, 'draft_content.json');
  const completedDraftMetaPath = join(completedDraftDir, 'draft_meta_info.json');
  const completedCoverPath = join(completedCoverDir, 'cover-auto-r1.png');
  await Promise.all([
    mkdir(completedPipelineDir, { recursive: true }),
    mkdir(completedDraftDir, { recursive: true }),
    mkdir(completedCoverDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(completedDraftContentPath, '{}\n', 'utf8'),
    writeFile(completedDraftMetaPath, '{}\n', 'utf8'),
    writeFile(completedCoverPath, editorialQaHtmlVideoPreviewPng(3)),
    writeFile(completedStatePath, `${JSON.stringify({
      version: 1,
      taskId: completed.id,
      updatedAt: new Date().toISOString(),
      steps: Object.fromEntries(Array.from({ length: 7 }, (_, step) => [step, { status: 'completed' }])),
      artifact: {
        reviewedText: '丝绸之路文化科普预审文案。',
        rewrittenCopy: '从长安出发，商旅与文化沿丝绸之路跨越山河。',
        cover: { title: '丝绸之路', subtitle: ['跨越山河的文明交流'], summary: '丝绸之路文化科普。', tags: ['#历史科普'], comments: [] },
        scenes: [],
        imagePrompts: [],
      },
      assets: {
        cover: [{ sceneId: 0, path: completedCoverPath }],
        images: [],
        imageErrors: [],
        narration: [],
      },
      draft: {
        draftDir: completedDraftDir,
        draftContentPath: completedDraftContentPath,
        draftMetaPath: completedDraftMetaPath,
      },
    }, null, 2)}\n`, 'utf8'),
  ]);
  await database.updateTask(completed.id, {
    status: 'completed',
    currentStep: 7,
    outputDir: completedOutput,
    artifactStatePath: completedStatePath,
    completedAt: new Date().toISOString(),
  });

  const paused = await createFixture('夏日轻食产品短片');
  await database.updateTask(paused.id, { status: 'paused', currentStep: 4, errorMessage: '等待用户继续任务' });

  const draft = await createFixture('QA 草稿项目');
  await database.updateTask(draft.id, { status: 'draft', currentStep: 0 });

  const pending = await createFixture('QA 待开始项目');
  await database.updateTask(pending.id, { status: 'pending', currentStep: 4 });

  const cancelled = await createFixture('QA 已取消项目');
  await database.updateTask(cancelled.id, { status: 'cancelled', currentStep: 4 });

  const failed = await createFixture('QA 浅色错误提示');
  await database.updateTask(failed.id, {
    status: 'failed',
    currentStep: 1,
    failedStep: 1,
    retryFromStep: 1,
    errorMessage: 'HTML video planning step failed',
  });
  await database.addTaskEvent(failed.id, {
    type: 'step_error',
    step: 1,
    agent: 'Planner',
    detail: 'HTML video planning step failed',
  });

  const running = await createFixture('武则天：从深宫才人到一代女皇');
  const fixtureRoot = join(dataDir, 'qa-task-operations', 'running-task');
  const pipelineDir = join(fixtureRoot, 'pipeline');
  const imageDir = join(fixtureRoot, 'images');
  const statePath = join(pipelineDir, 'state.json');
  await Promise.all([mkdir(pipelineDir, { recursive: true }), mkdir(imageDir, { recursive: true })]);
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    cap: ['十四岁入宫', '重返长安', '权力中心', '登临帝位'][index] ?? `历史场景 ${index + 1}`,
    descPrompt: `武则天人物故事场景 ${index + 1}`,
    durationMs: 4200,
  }));
  const imageAssets = await Promise.all(scenes.slice(0, 8).map(async (scene) => {
    const path = join(imageDir, `scene-${scene.id}.png`);
    const borrowedFrom = scene.id === 2 ? 1 : undefined;
    await writeFile(path, editorialQaHtmlVideoPreviewPng(borrowedFrom ?? scene.id));
    return { sceneId: scene.id, path, borrowedFrom };
  }));
  await writeFile(statePath, `${JSON.stringify({
    version: 1,
    taskId: running.id,
    updatedAt: new Date().toISOString(),
    steps: {
      0: { status: 'completed' },
      1: { status: 'completed' },
      2: { status: 'completed' },
      3: { status: 'completed' },
      4: { status: 'running' },
      5: { status: 'pending' },
      6: { status: 'pending' },
    },
    artifact: {
      reviewedText: '武则天人物生平预审文案。',
      rewrittenCopy: '武则天在深宫沉默十二年。后来武则天走出低谷，最终成为中国历史上唯一的女皇。',
      cover: {
        title: '武则天',
        subtitle: ['深宫沉默十二年', '最后走成唯一女皇'],
        summary: '从深宫才人到一代女皇的故事。',
        tags: ['#人物故事', '#武则天'],
        comments: [],
      },
      scenes,
      imagePrompts: scenes.map((scene) => ({
        sceneId: scene.id,
        cap: scene.cap,
        prompt: scene.descPrompt,
        negativePrompt: '',
        style: 'photo-real',
        ratio: '9:16',
        characterProfile: '武则天人物一致性档案',
      })),
    },
    assets: {
      images: imageAssets,
      imageErrors: [{ sceneId: 2, message: 'QA Provider 拒绝了第 2 张图片，已借用相邻镜头。' }],
      narration: [],
    },
  }, null, 2)}\n`, 'utf8');
  const startedAt = new Date().toISOString();
  await database.updateTask(running.id, {
    status: 'running',
    currentStep: 4,
    outputDir: fixtureRoot,
    artifactStatePath: statePath,
    startedAt,
    lastHeartbeatAt: startedAt,
  });
  const eventFixtures = [
    { step: 2, agent: 'Storyboard', detail: 'Step 2 分镜 · 共 12 个场景' },
    { step: 3, agent: 'Prompt', detail: 'Step 3 角色与提示词已完成' },
    { step: 4, agent: 'Producer', detail: 'Step 4 批量生图 · 已完成 8 / 12' },
  ];
  for (const [index, event] of eventFixtures.entries()) {
    await database.addTaskEvent(running.id, {
      type: index === eventFixtures.length - 1 ? 'step_progress' : 'step_complete',
      step: event.step,
      agent: event.agent,
      detail: event.detail,
      ts: Date.now() + index,
    });
  }
}

async function seedTaskOperationsSceneVideo(dataDir: string): Promise<void> {
  const sourceDir = join(dataDir, 'qa-task-operations', 'scene-video-source');
  const sourcePath = join(sourceDir, 'qa-scene-source.mp4');
  await mkdir(sourceDir, { recursive: true });
  const runtime = resolvePythonRuntimeInfo();
  const script = [
    'import imageio_ffmpeg',
    'import subprocess',
    'import sys',
    'command = [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24:duration=6", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", sys.argv[1]]',
    'subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)',
  ].join('\n');
  await execFileAsync(runtime.command, ['-c', script, sourcePath], {
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  await importSceneVideoToLibrary({
    libraryRoot: sceneVideoLibraryRoot(),
    sourcePath,
    normalize: normalizeSceneVideo,
  });
}

async function seedHtmlVideoEditorialQa(database: FileDatabase): Promise<void> {
  if (editorialQaConfig?.scope !== 'html-video' && editorialQaConfig?.scope !== 'task-operations' && editorialQaConfig?.scope !== 'workflow' && editorialQaConfig?.scope !== 'all') return;
  const copy = [
    '武则天十四岁入宫，十二年间几乎没有被命运看见。',
    '直到唐高宗时代，她重新站回权力中心。',
    '一次次选择，最终改写了她在历史中的位置。',
  ].join('\n\n');
  const input = createHtmlVideoTaskInput({
    copy,
    style: 'modern-cinematic',
    voiceId: 'qa-editorial-voice',
    ttsProvider: 'mock',
    ttsSpeed: 1,
    bgmId: '',
    captionPreset: 'editorial',
    captionAnim: 'fade-up',
    bgmVolume: 'soft',
    transitionType: 'fade',
    coverImageMode: 'auto',
    coverTemplate: 'cinematic-poster',
    coverRatio: '9:16',
    draftTemplate: '',
    foreground: true,
    maxScenes: 3,
    ratio: '9:16',
  });
  const task = await database.createTask({ ...input, title: '武则天：权力之路 HTML 动画' });
  if (!task.managedStorageKey) throw new Error('Editorial QA HTML video fixture has no managed storage key.');
  const taskDirectory = await ensureHtmlVideoTaskWorkDir(artifactDataDir(), task.managedStorageKey);
  const workDir = taskDirectory.workDir.canonicalPath;
  const pipeline = parseHtmlVideoPipelineData(task.pipelineData);
  const sceneMedia = pipeline.scenes.map((scene) => ({
    scene,
    backgroundPath: join(workDir, `scene-${scene.index}-background.png`),
    foregroundPath: join(workDir, `scene-${scene.index}-foreground.png`),
    thumbnailPath: join(workDir, `scene-${scene.index}-thumbnail.png`),
    voicePath: join(workDir, `scene-${scene.index}.wav`),
    htmlPath: join(workDir, `scene-${scene.index}.html`),
  }));
  await Promise.all(sceneMedia.flatMap(({ scene, backgroundPath, foregroundPath, thumbnailPath, voicePath, htmlPath }) => {
    const previewPng = editorialQaHtmlVideoPreviewPng(scene.index);
    return [
      writeFile(backgroundPath, previewPng),
      writeFile(foregroundPath, previewPng),
      writeFile(thumbnailPath, previewPng),
      writeFile(voicePath, editorialQaWavTone(900 + scene.index * 120, 220 + scene.index * 45)),
      writeFile(htmlPath, `<!doctype html><html lang="zh-CN"><body><main><h1>${scene.title}</h1><p>${scene.narration}</p></main></body></html>`, 'utf8'),
    ];
  }));
  pipeline.revision = 4;
  pipeline.current = 'preview';
  pipeline.steps = {
    rewrite: { status: 'completed' },
    planning: { status: 'completed' },
    assets: { status: 'completed' },
    voice: { status: 'completed' },
    preview: { status: 'running' },
    render: { status: 'pending' },
  };
  pipeline.assets = sceneMedia.flatMap(({ scene, backgroundPath, foregroundPath }) => [
    {
      sceneIndex: scene.index,
      kind: 'bg' as const,
      slot: 0,
      src: backgroundPath,
      prompt: scene.background.prompt,
    },
    {
      sceneIndex: scene.index,
      kind: 'fg' as const,
      slot: scene.elements[0]?.slot ?? 0,
      src: foregroundPath,
      prompt: scene.elements[0]?.prompt,
    },
  ]);
  pipeline.voices = sceneMedia.map(({ scene, voicePath }) => ({
    sceneIndex: scene.index,
    src: voicePath,
    durationSec: 1.02,
    text: scene.narration,
  }));
  pipeline.compositions = sceneMedia.map(({ scene, backgroundPath, thumbnailPath, voicePath, htmlPath }) => ({
    index: scene.index,
    durationSec: 4 + scene.index,
    canvas: { w: 720, h: 1280 },
    audio: { src: voicePath, durationSec: 1.02 },
    background: { src: backgroundPath },
    captions: scene.captions.map((text, index) => ({
      id: `${scene.index}-${index + 1}`,
      text,
      startSec: index * 1.2,
      durationSec: 1.2,
    })),
    htmlPath,
    thumbnailPath,
    rev: 1,
  }));
  const startedAt = new Date().toISOString();
  await database.updateTask(task.id, {
    status: 'running',
    currentStep: 4,
    pipelineStep: 'preview',
    pipelineData: JSON.stringify(pipeline),
    outputDir: workDir,
    startedAt,
    lastHeartbeatAt: startedAt,
  });
}

function editorialQaHtmlVideoPreviewPng(sceneIndex: number): Buffer {
  const width = 360;
  const height = 640;
  const bitmap = Buffer.alloc(width * height * 4);
  const accents = [[43, 63, 143], [115, 58, 91], [44, 103, 72]] as const;
  const accent = accents[(sceneIndex - 1) % accents.length];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isAccent = (y > 238 && y < 250) || (y > 510 && x > 38 && x < width - 38);
      const shade = isAccent ? accent : y < 120 ? [24, 29, 34] : [16, 19, 22];
      bitmap[offset] = shade[2];
      bitmap[offset + 1] = shade[1];
      bitmap[offset + 2] = shade[0];
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 }).toPNG();
}

function editorialQaWavTone(durationMs: number, frequency: number): Buffer {
  const sampleRate = 8_000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1_000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * frequency) * 8_000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

  return { seedTaskOperationsEditorialQa, seedHtmlVideoEditorialQa };
}

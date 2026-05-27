import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiSourceContext, BgmItem, CoverMetadata, ImagePrompt, PipelineArtifact, StoryboardScene, Task } from './types';
import { buildSubtitleTrack } from './story';
import { writeJianyingDraft, type SceneAsset, type WriteJianyingDraftOptions } from './draft';
import type { FileDatabase } from './storage';
import type { JsonLlm } from './llm-provider';
import { formatAiSourceContext } from './research';

export interface RunTaskOptions {
  appDataDir: string;
  onEvent?: (detail: string) => void;
  llm?: JsonLlm;
  resolveAiSourceContext?: (task: Task) => Promise<AiSourceContext>;
  generatePipelineArtifact?: (task: Task, sourceContext?: AiSourceContext) => Promise<PipelineArtifact>;
  generateImages?: (scenes: StoryboardScene[], prompts: ImagePrompt[], task: Task) => Promise<SceneAsset[]>;
  synthesizeNarration?: (scenes: StoryboardScene[], task: Task) => Promise<SceneAsset[]>;
  draftWriterOptions?: WriteJianyingDraftOptions;
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

interface PipelineState {
  version: 1;
  taskId: string;
  updatedAt: string;
  steps: Record<string, { status: StepStatus; outputPath?: string; error?: string; completedAt?: string }>;
  artifact: Partial<PipelineArtifact>;
  assets: {
    images: SceneAsset[];
    narration: SceneAsset[];
  };
  draft?: {
    draftDir: string;
    draftContentPath: string;
    draftMetaPath: string;
  };
}

const stepAgents: Record<number, string> = {
  0: 'Reviewer',
  1: 'Writer',
  2: 'Storyboard',
  3: 'Prompt',
  4: 'Producer',
  5: 'TTS',
  6: 'Draft',
};

function todayTitle(input: string): string {
  const title = /武则天|武曌|武后/.test(input) ? '武则天' : input.slice(0, 10).replace(/\s+/g, '');
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${stamp} - ${title || '故事任务'}`;
}

export async function runTask(db: FileDatabase, task: Task, options: RunTaskOptions): Promise<Task> {
  const workDir = join(options.appDataDir, 'tasks', task.id);
  const pipelineDir = join(workDir, 'pipeline');
  const statePath = join(pipelineDir, 'state.json');
  await mkdir(pipelineDir, { recursive: true });

  let pipeline = await loadPipelineState(statePath, task.id);
  let activeStep: number | null = task.retryFromStep ?? firstRunnableStep(pipeline);
  await db.updateTask(task.id, {
    status: 'running',
    currentStep: activeStep,
    outputDir: workDir,
    errorMessage: '',
    failedStep: null,
    retryFromStep: activeStep,
    artifactStatePath: statePath,
  });

  const emit = async (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => {
    options.onEvent?.(detail);
    await db.addTaskEvent(task.id, {
      type,
      step,
      agent,
      detail,
      dataJson: data === undefined ? null : JSON.stringify(data),
    });
  };

  const save = async () => {
    pipeline.updatedAt = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(pipeline, null, 2), 'utf8');
  };

  const markStep = async (step: number, status: StepStatus, patch: Partial<PipelineState['steps'][string]> = {}) => {
    pipeline.steps[String(step)] = {
      ...(pipeline.steps[String(step)] ?? { status: 'pending' }),
      ...patch,
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : pipeline.steps[String(step)]?.completedAt,
    };
    await save();
  };

  try {
    await ensureContentArtifact({ db, task, options, workDir, emit, markStep, pipeline });
    const artifact = hydrateArtifact(pipeline.artifact);
    activeStep = 4;
    await ensureImages({ db, task, artifact, options, emit, markStep, pipeline });
    activeStep = 5;
    await ensureNarration({ db, task, artifact, options, emit, markStep, pipeline });

    activeStep = 6;
    await db.updateTask(task.id, { currentStep: 6, retryFromStep: 6 });
    if (pipeline.steps['6']?.status !== 'completed') {
      await markStep(6, 'running');
      await emit('step_start', 6, 'Draft', '写入剪映草稿目录');
      const state = await db.getState();
      const bgm = resolveBgm(state.config.jianying.bgmLibrary, task.bgmId);
      const draft = await writeJianyingDraft(
        {
          workDir,
          draftRootDir: state.config.jianying.draftPath,
          title: task.title || todayTitle(task.inputText),
          cover: artifact.cover,
          ratio: task.ratio,
          templateId: task.templateId,
          scenes: artifact.scenes,
          imagePrompts: artifact.imagePrompts,
          reviewedText: artifact.reviewedText,
          rewrittenCopy: artifact.rewrittenCopy,
          generatedImages: pipeline.assets.images,
          narrationAudio: pipeline.assets.narration,
          bgm,
        },
        options.draftWriterOptions,
      );
      pipeline.draft = {
        draftDir: draft.draftDir,
        draftContentPath: draft.draftContentPath,
        draftMetaPath: draft.draftMetaPath,
      };
      await markStep(6, 'completed', { outputPath: draft.draftDir });
      await emit('step_complete', 6, 'Draft', 'Jianying draft folder generated', draft);
    }

    const draftDir = pipeline.draft?.draftDir ?? pipeline.steps['6']?.outputPath ?? workDir;
    const completedAt = new Date().toISOString();
    await db.updateTask(task.id, {
      status: 'completed',
      currentStep: 7,
      completedAt,
      outputDir: draftDir,
      errorMessage: '',
      failedStep: null,
      retryFromStep: null,
      artifactStatePath: statePath,
    });
    options.onEvent?.('Task completed');
    return { ...task, status: 'completed', currentStep: 7, completedAt, outputDir: draftDir, errorMessage: '', failedStep: null, retryFromStep: null, artifactStatePath: statePath };
  } catch (error) {
    const step = activeStep ?? firstRunnableStep(pipeline);
    const message = error instanceof Error ? error.message : String(error);
    await markStep(step, 'failed', { error: message });
    await emit('step_error', step, stepAgents[step] ?? null, message);
    await db.updateTask(task.id, {
      status: 'paused',
      currentStep: step,
      errorMessage: message,
      outputDir: workDir,
      failedStep: step,
      retryFromStep: step,
      artifactStatePath: statePath,
    });
    options.onEvent?.('Task paused after failure');
    throw error;
  }
}

async function ensureContentArtifact(input: {
  db: FileDatabase;
  task: Task;
  options: RunTaskOptions;
  workDir: string;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  markStep: (step: number, status: StepStatus, patch?: Partial<PipelineState['steps'][string]>) => Promise<void>;
  pipeline: PipelineState;
}): Promise<void> {
  const { db, task, options, workDir, emit, markStep, pipeline } = input;
  if (pipeline.steps['3']?.status === 'completed' && pipeline.artifact.reviewedText && pipeline.artifact.imagePrompts) {
    return;
  }
  const sourceContext = await prepareAiSourceContext({ task, options, workDir, emit, pipeline });
  if (options.generatePipelineArtifact) {
    const artifact = await options.generatePipelineArtifact(task, sourceContext ?? undefined);
    pipeline.artifact = { ...artifact, subtitles: buildSubtitleTrack(artifact.scenes), sourceContext: sourceContext ?? artifact.sourceContext };
    await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact), task);
    for (const step of [0, 1, 2, 3]) {
      await db.updateTask(task.id, { currentStep: step, retryFromStep: step });
      await markStep(step, 'completed', { outputPath: contentOutputPath(workDir, step) });
    }
    return;
  }
  if (!options.llm) {
    throw new Error('LLM provider is not configured; cannot run real content generation.');
  }

  await db.updateTask(task.id, { currentStep: 0, retryFromStep: 0 });
  await markStep(0, 'running');
  await emit('step_start', 0, 'Reviewer', 'LLM 文案预审');
  const sourceText = buildReviewSourceText(task, sourceContext);
  const review = await options.llm<{ reviewedText: string }>({
    step: 0,
    name: 'review',
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"reviewedText": string}.' },
      { role: 'user', content: sourceText },
    ],
  });
  pipeline.artifact.reviewedText = requireString(review.json.reviewedText, 'reviewedText');
  await writeFile(join(workDir, '00-reviewed.txt'), pipeline.artifact.reviewedText, 'utf8');
  await markStep(0, 'completed', { outputPath: join(workDir, '00-reviewed.txt') });
  await emit('step_complete', 0, 'Reviewer', `已保存 ${pipeline.artifact.reviewedText.length} 字`, { requestId: review.requestId });

  await db.updateTask(task.id, { currentStep: 1, retryFromStep: 1 });
  await markStep(1, 'running');
  await emit('step_start', 1, 'Writer', 'LLM 改写与封面信息');
  const rewrite = await options.llm<{ rewrittenCopy: string; cover: CoverMetadata }>({
    step: 1,
    name: 'rewrite',
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"rewrittenCopy": string, "cover": {"title": string, "subtitle": string[], "summary": string, "tags": string[], "comments": string[]}}.' },
      { role: 'user', content: pipeline.artifact.reviewedText },
    ],
  });
  pipeline.artifact.rewrittenCopy = requireString(rewrite.json.rewrittenCopy, 'rewrittenCopy');
  pipeline.artifact.cover = normalizeCover(rewrite.json.cover);
  await writeFile(join(workDir, '01-rewritten-copy.md'), pipeline.artifact.rewrittenCopy, 'utf8');
  await writeFile(join(workDir, '00-cover-title.json'), JSON.stringify(pipeline.artifact.cover, null, 2), 'utf8');
  await markStep(1, 'completed', { outputPath: join(workDir, '01-rewritten-copy.md') });
  await emit('step_complete', 1, 'Writer', `改写完成：${pipeline.artifact.rewrittenCopy.length} 字`, { requestId: rewrite.requestId });

  await db.updateTask(task.id, { currentStep: 2, retryFromStep: 2 });
  await markStep(2, 'running');
  await emit('step_start', 2, 'Storyboard', 'LLM 影视分镜分句');
  const storyboard = await options.llm<{ scenes: StoryboardScene[] }>({
    step: 2,
    name: 'storyboard',
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"scenes":[{"id":number,"cap":string,"descPrompt":string,"durationMs":number}]}.' },
      { role: 'user', content: pipeline.artifact.rewrittenCopy },
    ],
  });
  pipeline.artifact.scenes = normalizeScenes(storyboard.json.scenes);
  await writeFile(join(workDir, '02-sentences.json'), JSON.stringify(pipeline.artifact.scenes, null, 2), 'utf8');
  await markStep(2, 'completed', { outputPath: join(workDir, '02-sentences.json') });
  await emit('step_complete', 2, 'Storyboard', `分镜 ${pipeline.artifact.scenes.length} 个`, { requestId: storyboard.requestId });

  await db.updateTask(task.id, { currentStep: 3, retryFromStep: 3 });
  await markStep(3, 'running');
  await emit('step_start', 3, 'Prompt', 'LLM 生成绘图提示词');
  const prompts = await options.llm<{ imagePrompts: ImagePrompt[] }>({
    step: 3,
    name: 'image-prompts',
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"imagePrompts":[{"sceneId":number,"cap":string,"prompt":string,"negativePrompt":string,"style":string,"ratio":string,"characterProfile":string}]}.' },
      { role: 'user', content: JSON.stringify({ scenes: pipeline.artifact.scenes, style: task.style, ratio: task.ratio }) },
    ],
  });
  const scenes = pipeline.artifact.scenes;
  if (!scenes) {
    throw new Error('Pipeline storyboard scenes are missing; retry from storyboard step.');
  }
  pipeline.artifact.imagePrompts = normalizePrompts(prompts.json.imagePrompts, scenes, task);
  pipeline.artifact.subtitles = buildSubtitleTrack(scenes);
  await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact), task);
  await markStep(3, 'completed', { outputPath: join(workDir, '03-image-prompts.json') });
  await emit('step_complete', 3, 'Prompt', `已生成 ${pipeline.artifact.imagePrompts.length} 条图片提示词`, { requestId: prompts.requestId });
}

async function prepareAiSourceContext(input: {
  task: Task;
  options: RunTaskOptions;
  workDir: string;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  pipeline: PipelineState;
}): Promise<AiSourceContext | null> {
  const { task, options, workDir, emit, pipeline } = input;
  if (task.mode !== 'ai' || task.aiSources.length === 0) {
    return null;
  }

  let context: AiSourceContext;
  try {
    context = options.resolveAiSourceContext
      ? await options.resolveAiSourceContext(task)
      : { query: task.aiKeyword || task.inputText, sections: [], warnings: ['AI source resolver is not configured; continuing with keyword only.'] };
  } catch (error) {
    context = {
      query: task.aiKeyword || task.inputText,
      sections: [],
      warnings: [`AI source research failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  pipeline.artifact.sourceContext = context;
  await writeFile(join(workDir, '00-source-context.json'), JSON.stringify(context, null, 2), 'utf8');
  await writeFile(join(workDir, '00-source-context.md'), formatAiSourceContext(task, context), 'utf8');
  await emit('step_complete', 0, 'Research', `AI source research completed: ${context.sections.length} sections`, context);
  return context;
}

async function ensureImages(input: {
  db: FileDatabase;
  task: Task;
  artifact: PipelineArtifact;
  options: RunTaskOptions;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  markStep: (step: number, status: StepStatus, patch?: Partial<PipelineState['steps'][string]>) => Promise<void>;
  pipeline: PipelineState;
}): Promise<void> {
  const { db, task, artifact, options, emit, markStep, pipeline } = input;
  const missing = missingScenes(artifact.scenes, pipeline.assets.images);
  if (missing.length === 0 && pipeline.assets.images.length >= artifact.scenes.length) {
    await markStep(4, 'completed');
    return;
  }
  await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
  await markStep(4, 'running');
  await emit('step_start', 4, 'Producer', '批量生成真实图片素材', { missingSceneIds: missing.map((scene) => scene.id) });
  if (!options.generateImages) {
    throw new Error('Image provider is not configured; cannot create real image assets.');
  }
  for (const scene of missing) {
    const generatedImages = await options.generateImages([scene], artifact.imagePrompts, task);
    pipeline.assets.images = mergeAssets(pipeline.assets.images, generatedImages);
    await markStep(4, 'running', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n') });
  }
  await markStep(4, 'completed');
  await emit('step_complete', 4, 'Producer', '真实图片素材已生成', { count: pipeline.assets.images.length });
}

async function ensureNarration(input: {
  db: FileDatabase;
  task: Task;
  artifact: PipelineArtifact;
  options: RunTaskOptions;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  markStep: (step: number, status: StepStatus, patch?: Partial<PipelineState['steps'][string]>) => Promise<void>;
  pipeline: PipelineState;
}): Promise<void> {
  const { db, task, artifact, options, emit, markStep, pipeline } = input;
  const missing = missingScenes(artifact.scenes, pipeline.assets.narration);
  if (missing.length === 0 && pipeline.assets.narration.length >= artifact.scenes.length) {
    await markStep(5, 'completed');
    return;
  }
  await db.updateTask(task.id, { currentStep: 5, retryFromStep: 5 });
  await markStep(5, 'running');
  await emit('step_start', 5, 'TTS', '生成真实旁白音频', { missingSceneIds: missing.map((scene) => scene.id) });
  if (!options.synthesizeNarration) {
    throw new Error('TTS provider is not configured; cannot create real narration audio.');
  }
  for (const scene of missing) {
    const narrationAudio = await options.synthesizeNarration([scene], task);
    pipeline.assets.narration = mergeAssets(pipeline.assets.narration, narrationAudio);
    await markStep(5, 'running', { outputPath: pipeline.assets.narration.map((asset) => asset.path).join('\n') });
  }
  await markStep(5, 'completed');
  await emit('step_complete', 5, 'TTS', '真实配音与字幕时间轴已生成', { subtitles: artifact.subtitles.cues.length, audio: pipeline.assets.narration.length });
}

async function loadPipelineState(path: string, taskId: string): Promise<PipelineState> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PipelineState;
  } catch {
    return {
      version: 1,
      taskId,
      updatedAt: new Date().toISOString(),
      steps: {},
      artifact: {},
      assets: { images: [], narration: [] },
    };
  }
}

async function writeContentArtifacts(workDir: string, artifact: PipelineArtifact, task: Pick<Task, 'aiKeyword' | 'aiSources' | 'extraRequirements'>): Promise<void> {
  await mkdir(workDir, { recursive: true });
  if (artifact.sourceContext) {
    await writeFile(join(workDir, '00-source-context.json'), JSON.stringify(artifact.sourceContext, null, 2), 'utf8');
    await writeFile(join(workDir, '00-source-context.md'), formatAiSourceContext(task, artifact.sourceContext), 'utf8');
  }
  await writeFile(join(workDir, '00-reviewed.txt'), artifact.reviewedText, 'utf8');
  await writeFile(join(workDir, '01-rewritten-copy.md'), artifact.rewrittenCopy, 'utf8');
  await writeFile(join(workDir, '00-cover-title.json'), JSON.stringify(artifact.cover, null, 2), 'utf8');
  await writeFile(join(workDir, '02-sentences.json'), JSON.stringify(artifact.scenes, null, 2), 'utf8');
  await writeFile(join(workDir, '03-image-prompts.json'), JSON.stringify(artifact.imagePrompts, null, 2), 'utf8');
  await writeFile(join(workDir, 'subtitles.srt'), artifact.subtitles.srt, 'utf8');
}

function hydrateArtifact(input: Partial<PipelineArtifact>): PipelineArtifact {
  if (!input.reviewedText || !input.rewrittenCopy || !input.cover || !input.scenes || !input.imagePrompts) {
    throw new Error('Pipeline content artifact is incomplete; retry from LLM steps.');
  }
  return {
    reviewedText: input.reviewedText,
    rewrittenCopy: input.rewrittenCopy,
    cover: input.cover,
    scenes: input.scenes,
    imagePrompts: input.imagePrompts,
    subtitles: input.subtitles ?? buildSubtitleTrack(input.scenes),
    sourceContext: input.sourceContext,
  };
}

function buildReviewSourceText(task: Task, sourceContext: AiSourceContext | null): string {
  if (task.mode !== 'ai') {
    return task.inputText;
  }
  return [
    `AI keyword: ${task.aiKeyword}`,
    task.extraRequirements ? `Extra requirements: ${task.extraRequirements}` : '',
    sourceContext ? formatAiSourceContext(task, sourceContext) : '',
    task.inputText ? `Seed material:\n${task.inputText}` : '',
  ].filter(Boolean).join('\n\n');
}

function normalizeCover(input: unknown): CoverMetadata {
  const cover = input && typeof input === 'object' ? (input as Partial<CoverMetadata>) : {};
  return {
    title: requireString(cover.title, 'cover.title'),
    subtitle: Array.isArray(cover.subtitle) ? cover.subtitle.map(String) : [],
    summary: String(cover.summary ?? ''),
    tags: Array.isArray(cover.tags) ? cover.tags.map(String) : [],
    comments: Array.isArray(cover.comments) ? cover.comments.map(String) : [],
  };
}

function normalizeScenes(input: unknown): StoryboardScene[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('LLM storyboard response did not include scenes.');
  }
  return input.map((scene, index) => {
    const item = scene as Partial<StoryboardScene>;
    return {
      id: Number(item.id ?? index + 1),
      cap: requireString(item.cap, `scenes[${index}].cap`),
      descPrompt: String(item.descPrompt ?? item.cap ?? ''),
      durationMs: Math.max(800, Number(item.durationMs ?? 2400)),
    };
  });
}

function normalizePrompts(input: unknown, scenes: StoryboardScene[], task: Task): ImagePrompt[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('LLM image prompt response did not include imagePrompts.');
  }
  return scenes.map((scene) => {
    const prompt = input.find((item) => Number((item as Partial<ImagePrompt>).sceneId) === scene.id) as Partial<ImagePrompt> | undefined;
    if (!prompt) {
      throw new Error(`Missing image prompt for scene ${scene.id}.`);
    }
    return {
      sceneId: scene.id,
      cap: String(prompt.cap ?? scene.cap),
      prompt: requireString(prompt.prompt, `imagePrompts[${scene.id}].prompt`),
      negativePrompt: String(prompt.negativePrompt ?? ''),
      style: String(prompt.style ?? task.style),
      ratio: String(prompt.ratio ?? task.ratio),
      characterProfile: String(prompt.characterProfile ?? ''),
    };
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`LLM JSON field ${label} is required.`);
  }
  return value;
}

function missingScenes(scenes: StoryboardScene[], assets: SceneAsset[]): StoryboardScene[] {
  const done = new Set(assets.map((asset) => asset.sceneId));
  return scenes.filter((scene) => !done.has(scene.id));
}

function mergeAssets(existing: SceneAsset[], incoming: SceneAsset[]): SceneAsset[] {
  const map = new Map<number, SceneAsset>();
  for (const asset of existing) map.set(asset.sceneId, asset);
  for (const asset of incoming) map.set(asset.sceneId, asset);
  return [...map.values()].sort((a, b) => a.sceneId - b.sceneId);
}

function firstRunnableStep(pipeline: PipelineState): number {
  for (let step = 0; step <= 6; step += 1) {
    if (pipeline.steps[String(step)]?.status !== 'completed') return step;
  }
  return 6;
}

function contentOutputPath(workDir: string, step: number): string {
  return [
    join(workDir, '00-reviewed.txt'),
    join(workDir, '01-rewritten-copy.md'),
    join(workDir, '02-sentences.json'),
    join(workDir, '03-image-prompts.json'),
  ][step];
}

function resolveBgm(library: BgmItem[], bgmId: string): BgmItem | null {
  const bgm = library.find((item) => item.id === bgmId);
  if (!bgm || !bgm.path) return null;
  return bgm;
}

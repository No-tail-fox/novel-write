import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AiSourceContext, BgmItem, CharacterCard, CoverMetadata, CustomCoverTemplate, DraftTemplate, ImagePrompt, MusicPlan, PipelineArtifact, PromptStepTemplateType, PromptTemplate, RewriteEvaluationResult, StoryboardScene, Task, TaskArtifactImageErrorPreview, TaskStepRerunMode } from './types';
import { buildSubtitleTrack } from './story';
import { writeJianyingDraft, type SceneAsset, type WriteJianyingDraftOptions } from './draft';
import { runStoryboundMediaSidecar, type StoryboundSidecarInput, type StoryboundSidecarResult } from './storybound-sidecar';
import { buildHtmlVideoExportInput, type HtmlVideoExportInput, type HtmlVideoExportResult } from './html-video';
import type { FileDatabase } from './storage';
import type { AnthropicMessagesJsonRequest, ConfiguredJsonLlm, LlmJsonResult, LlmMessage, OpenAiCompatibleJsonRequest } from './llm-provider';
import { formatAiSourceContext } from './research';
import { normalizeDraftTemplate } from './templates';
import { buildPromptRenderContext, renderPromptTemplate, selectStepPromptTemplate, selectTaskPromptTemplate, type PromptRenderContext } from './prompt-templates';
import { defaultCustomStyles } from './config';

export interface RunTaskOptions {
  appDataDir: string;
  onEvent?: (detail: string) => void;
  signal?: AbortSignal;
  onHeartbeat?: (taskId: string, step: number, detail: string) => Promise<void>;
  llm?: ConfiguredJsonLlm;
  resolveAiSourceContext?: (task: Task) => Promise<AiSourceContext>;
  generatePipelineArtifact?: (task: Task, sourceContext?: AiSourceContext) => Promise<PipelineArtifact>;
  generateImages?: (scenes: StoryboardScene[], prompts: ImagePrompt[], task: Task, signal?: AbortSignal) => Promise<SceneAsset[]>;
  imageConcurrency?: number;
  synthesizeNarration?: (scenes: StoryboardScene[], task: Task, signal?: AbortSignal) => Promise<SceneAsset[]>;
  draftWriterOptions?: WriteJianyingDraftOptions;
  mediaSidecar?: (input: StoryboundSidecarInput) => Promise<StoryboundSidecarResult>;
  htmlVideoRenderer?: (input: HtmlVideoExportInput) => Promise<HtmlVideoExportResult>;
  customCoverTemplates?: CustomCoverTemplate[];
}

type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

interface PipelineState {
  version: 1;
  taskId: string;
  updatedAt: string;
  steps: Record<string, { status: StepStatus; outputPath?: string; error?: string; completedAt?: string }>;
  artifact: Partial<PipelineArtifact>;
  assets: {
    cover: SceneAsset[];
    images: SceneAsset[];
    imageErrors: TaskArtifactImageErrorPreview[];
    narration: SceneAsset[];
  };
  draft?: {
    draftDir: string;
    draftContentPath: string;
    draftMetaPath: string;
  };
  rerun?: {
    step: number;
    mode: TaskStepRerunMode;
    requestedAt: string;
    context?: Partial<PipelineArtifact>;
  };
}

interface LlmJsonStepRequest {
  step: number;
  name: string;
  messages: LlmMessage[];
  signal?: AbortSignal;
  anthropicToolInputSchema?: Record<string, unknown>;
}

interface RenderedStepPrompt {
  template: PromptTemplate | null;
  content: string;
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

const imagePromptBatchSize = 8;
const defaultStoryboardSceneCount = 12;
const rewriteTargetLengthRepairAttempts = 2;
const rewriteTargetLengthRepairBuffer = 120;
const stringJsonSchema = { type: 'string' };
const stringArrayJsonSchema = { type: 'array', items: stringJsonSchema };
const coverOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: stringJsonSchema,
    subtitle: stringArrayJsonSchema,
    summary: stringJsonSchema,
    tags: stringArrayJsonSchema,
    comments: stringArrayJsonSchema,
  },
};
const reviewOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['reviewedText'],
  additionalProperties: false,
  properties: {
    reviewedText: stringJsonSchema,
  },
};
const rewriteOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['rewrittenCopy', 'cover'],
  additionalProperties: false,
  properties: {
    rewrittenCopy: stringJsonSchema,
    cover: coverOutputJsonSchema,
  },
};
const characterCardOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['characterCard'],
  additionalProperties: false,
  properties: {
    characterCard: {
      type: 'object',
      required: ['summary', 'characters', 'consistencyRules'],
      additionalProperties: false,
      properties: {
        summary: stringJsonSchema,
        characters: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'appearance'],
            additionalProperties: false,
            properties: {
              name: stringJsonSchema,
              appearance: stringJsonSchema,
              wardrobe: stringJsonSchema,
              role: stringJsonSchema,
            },
          },
        },
        consistencyRules: stringArrayJsonSchema,
      },
    },
  },
};
const imagePromptsOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['imagePrompts'],
  additionalProperties: false,
  properties: {
    imagePrompts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['sceneId', 'cap', 'prompt', 'negativePrompt', 'style', 'ratio'],
        additionalProperties: false,
        properties: {
          sceneId: { type: 'number' },
          cap: stringJsonSchema,
          prompt: stringJsonSchema,
          negativePrompt: stringJsonSchema,
          style: stringJsonSchema,
          ratio: stringJsonSchema,
          characterProfile: stringJsonSchema,
          referenceImagePaths: stringArrayJsonSchema,
        },
      },
    },
  },
};

class CheckpointPause extends Error {
  constructor(
    public readonly step: number,
    detail: string,
  ) {
    super(detail);
    this.name = 'CheckpointPause';
  }
}

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
  const initialStep = activeStep ?? 0;
  const startedAt = new Date().toISOString();
  await db.updateTask(task.id, {
    status: 'running',
    currentStep: activeStep,
    outputDir: workDir,
    errorMessage: '',
    failedStep: null,
    retryFromStep: activeStep,
    artifactStatePath: statePath,
    startedAt,
    lastHeartbeatAt: startedAt,
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

  const heartbeat = async (step: number, detail: string) => {
    throwIfAborted(options.signal);
    await db.updateTask(task.id, { lastHeartbeatAt: new Date().toISOString(), currentStep: step, retryFromStep: step });
    await options.onHeartbeat?.(task.id, step, detail);
  };

  const markStep = async (step: number, status: StepStatus, patch: Partial<PipelineState['steps'][string]> = {}) => {
    pipeline.steps[String(step)] = {
      ...(pipeline.steps[String(step)] ?? { status: 'pending' }),
      ...patch,
      status,
      completedAt: status === 'completed' ? new Date().toISOString() : pipeline.steps[String(step)]?.completedAt,
    };
    await save();
    if (status === 'completed' && shouldPauseEveryStep(task, initialStep, step)) {
      throw new CheckpointPause(step + 1, `Task paused for confirmation after step ${step}.`);
    }
  };

  try {
    throwIfAborted(options.signal);
    await heartbeat(activeStep ?? 0, 'task started');
    await ensureContentArtifact({ db, task, options, workDir, emit, markStep, pipeline });
    const artifact = hydrateArtifact(pipeline.artifact);
    if (task.processingMode === 'clip-only') {
      const completedAt = new Date().toISOString();
      await db.updateTask(task.id, {
        status: 'completed',
        currentStep: 4,
        completedAt,
        outputDir: workDir,
        errorMessage: '',
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: statePath,
        lastHeartbeatAt: new Date().toISOString(),
      });
      await emit('step_complete', 3, 'Prompt', 'Clip-only task completed after content artifacts');
      options.onEvent?.('Task completed');
      return { ...task, status: 'completed', currentStep: 4, completedAt, outputDir: workDir, errorMessage: '', failedStep: null, retryFromStep: null, artifactStatePath: statePath, startedAt, lastHeartbeatAt: new Date().toISOString() };
    }
    pauseAtCheckpoint(task, initialStep, 4, 'Task paused for confirmation before image generation.');
    activeStep = 4;
    await heartbeat(4, 'image step');
    await ensureImages({ db, task, artifact, options, workDir, emit, markStep, pipeline });
    pauseAtCheckpoint(task, initialStep, 5, 'Task paused for confirmation after image generation.');
    activeStep = 5;
    await heartbeat(5, 'narration step');
    if (task.taskKind === 'music-mv') {
      if (!isStepCompleted(pipeline, 5)) {
        await markStep(5, 'completed');
        await emit('step_complete', 5, 'TTS', 'Music MV uses the supplied song audio; narration generation was skipped.');
      }
    } else {
      await ensureNarration({ db, task, artifact, options, emit, markStep, pipeline });
    }

    activeStep = 6;
    pauseAtCheckpoint(task, initialStep, 6, 'Task paused for confirmation before draft generation.');
    await heartbeat(6, 'draft step');
    await db.updateTask(task.id, { currentStep: 6, retryFromStep: 6 });
    if (pipeline.steps['6']?.status !== 'completed') {
      await markStep(6, 'running');
      await heartbeat(6, 'draft running');
      await emit('step_start', 6, 'Draft', '写入剪映草稿目录');
      const state = await db.getState();
      const bgm = resolveBgm(state.config.jianying.bgmLibrary, task.bgmId);
      const template = state.draftTemplates.find((item) => item.id === task.templateId);
      const normalizedTemplate = template ? normalizeDraftTemplate(template) : undefined;
      if (task.taskKind === 'html-video') {
        if (!options.htmlVideoRenderer) {
          throw new Error('HTML video renderer is not configured; cannot export html-video tasks.');
        }
        const htmlVideoInput = buildHtmlVideoExportInput({
          workDir,
          outputPath: join(workDir, `${task.title || todayTitle(task.inputText)}.mp4`),
          title: task.title || todayTitle(task.inputText),
          artifact,
          generatedImages: pipeline.assets.images,
          narrationAudio: pipeline.assets.narration,
          coverPath: pipeline.assets.cover[0]?.path,
          bgmPath: bgm?.path || undefined,
          bgmTargetDb: bgm ? -26 : undefined,
          fps: 30,
          canvas_w: task.ratio === '16:9' ? 1920 : 1080,
          canvas_h: task.ratio === '16:9' ? 1080 : 1920,
          transition: { type: 'fade', duration: 0.3 },
        });
        const htmlVideoExport = await options.htmlVideoRenderer(htmlVideoInput);
        pipeline.draft = {
          draftDir: htmlVideoExport.taskDir,
          draftContentPath: htmlVideoExport.outputPath,
          draftMetaPath: htmlVideoExport.sourceVideoPath,
        };
        await db.updateTask(task.id, {
          outputDir: htmlVideoExport.outputPath,
        });
        await markStep(6, 'completed', { outputPath: htmlVideoExport.outputPath });
        await heartbeat(6, 'html video export completed');
        await emit('step_complete', 6, 'Draft', 'HTML video export completed', htmlVideoExport);
      } else {
        const draft =
          task.taskKind === 'music-mv'
            ? await writeMusicMvSidecarDraft({
              task,
              artifact,
              workDir,
              draftRootDir: state.config.jianying.draftPath,
              template: normalizedTemplate,
              generatedImages: pipeline.assets.images,
              coverImagePath: pipeline.assets.cover[0]?.path,
              runSidecar: options.mediaSidecar ?? runStoryboundMediaSidecar,
            })
            : await writeJianyingDraft(
              {
                workDir,
                draftRootDir: state.config.jianying.draftPath,
                title: task.title || todayTitle(task.inputText),
                cover: artifact.cover,
                ratio: task.ratio,
                templateId: task.templateId,
                template: normalizedTemplate,
                scenes: artifact.scenes,
                imagePrompts: artifact.imagePrompts,
                reviewedText: artifact.reviewedText,
                rewrittenCopy: artifact.rewrittenCopy,
                generatedImages: pipeline.assets.images,
                coverImagePath: pipeline.assets.cover[0]?.path,
                narrationAudio: pipeline.assets.narration,
                bgm,
              },
              {
                ...(options.draftWriterOptions ?? {}),
                runSidecar: options.mediaSidecar ?? options.draftWriterOptions?.runSidecar,
              },
            );
        pipeline.draft = {
          draftDir: draft.draftDir,
          draftContentPath: draft.draftContentPath,
          draftMetaPath: draft.draftMetaPath,
        };
        await markStep(6, 'completed', { outputPath: draft.draftDir });
        await heartbeat(6, 'draft completed');
        await emit('step_complete', 6, 'Draft', 'Jianying draft folder generated', draft);
      }
    }

    const draftDir =
      task.taskKind === 'html-video'
        ? pipeline.steps['6']?.outputPath ?? pipeline.draft?.draftContentPath ?? workDir
        : pipeline.draft?.draftDir ?? pipeline.steps['6']?.outputPath ?? workDir;
    if (pipeline.rerun) {
      delete pipeline.rerun;
      await save();
    }
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
      lastHeartbeatAt: new Date().toISOString(),
      ...(task.taskKind === 'html-video' ? { pipelineStep: 'done' } : {}),
    });
    options.onEvent?.('Task completed');
    return { ...task, status: 'completed', currentStep: 7, completedAt, outputDir: draftDir, errorMessage: '', failedStep: null, retryFromStep: null, artifactStatePath: statePath, startedAt, lastHeartbeatAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof CheckpointPause) {
      await emit('checkpoint_pause', error.step, stepAgents[error.step] ?? null, error.message, { retryFromStep: error.step });
      await db.updateTask(task.id, {
        status: 'paused',
        currentStep: error.step,
        errorMessage: error.message,
        outputDir: workDir,
        failedStep: null,
        retryFromStep: error.step,
        artifactStatePath: statePath,
        lastHeartbeatAt: new Date().toISOString(),
      });
      options.onEvent?.('Task paused for confirmation');
      throw error;
    }
    const latestTask = (await db.getState()).tasks.find((item) => item.id === task.id);
    const step = latestTask?.currentStep ?? activeStep ?? firstRunnableStep(pipeline);
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = /cancel|取消/i.test(message);
    await markStep(step, 'failed', { error: message });
    await emit('step_error', step, stepAgents[step] ?? null, message);
    await db.updateTask(task.id, {
      status: cancelled ? 'cancelled' : 'paused',
      currentStep: step,
      errorMessage: message,
      outputDir: workDir,
      failedStep: cancelled ? null : step,
      retryFromStep: cancelled ? null : step,
      artifactStatePath: statePath,
      lastHeartbeatAt: new Date().toISOString(),
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
  throwIfAborted(options.signal);
  if (hasCompleteContentArtifact(pipeline)) {
    const artifact = hydrateArtifact(pipeline.artifact);
    pipeline.artifact.subtitles = artifact.subtitles;
    await writeContentArtifacts(workDir, artifact, task);
    return;
  }
  if (hasCompleteContentData(pipeline)) {
    const artifact = hydrateArtifact(pipeline.artifact);
    pipeline.artifact.subtitles = artifact.subtitles;
    await writeContentArtifacts(workDir, artifact, task);
    for (const step of [0, 1, 2, 3]) {
      if (!isStepCompleted(pipeline, step)) {
        await db.updateTask(task.id, { currentStep: step, retryFromStep: step });
        await markStep(step, 'completed', { outputPath: contentOutputPath(workDir, step) });
        await heartbeatTask(db, task.id, options, step, `content step ${step} completed`);
      }
    }
    return;
  }
  const sourceContext = await prepareAiSourceContext({ task, options, workDir, emit, pipeline });
  throwIfAborted(options.signal);
  if (options.generatePipelineArtifact) {
    const artifact = await options.generatePipelineArtifact(task, sourceContext ?? undefined);
    throwIfAborted(options.signal);
    pipeline.artifact = {
      ...artifact,
      imagePrompts: applyTaskReferenceImagesToPrompts(artifact.imagePrompts, task),
      subtitles: buildSubtitleTrack(artifact.scenes),
      sourceContext: sourceContext ?? artifact.sourceContext,
    };
    await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact), task);
    for (const step of [0, 1, 2, 3]) {
      await db.updateTask(task.id, { currentStep: step, retryFromStep: step });
      await markStep(step, 'completed', { outputPath: contentOutputPath(workDir, step) });
      await heartbeatTask(db, task.id, options, step, `content step ${step} completed`);
    }
    return;
  }
  if (task.taskKind === 'music-mv') {
    pipeline.artifact = buildMusicMvArtifact(task, sourceContext ?? undefined);
    await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact), task);
    for (const step of [0, 1, 2, 3]) {
      await db.updateTask(task.id, { currentStep: step, retryFromStep: step });
      await markStep(step, 'completed', { outputPath: contentOutputPath(workDir, step) });
      await heartbeatTask(db, task.id, options, step, `music mv content step ${step} completed`);
    }
    return;
  }
  if (!options.llm) {
    throw new Error('LLM provider is not configured; cannot run real content generation.');
  }
  const appState = await db.getState();
  const promptTemplates = appState.promptTemplates;
  const taskTemplate = selectTaskPromptTemplate(promptTemplates, { track: task.track, promptTemplateId: task.promptTemplateId });
  const promptContext = (): PromptRenderContext => buildPromptRenderContext({ task, taskTemplate, customStyles: appState.customStyles, sourceContext, artifact: pipeline.artifact });
  const directCopyPublish = task.publishMode === 'direct-copy';

  if (directCopyPublish) {
    pipeline.artifact.reviewedText = pipeline.artifact.reviewedText ?? task.inputText;
    pipeline.artifact.rewrittenCopy = pipeline.artifact.rewrittenCopy ?? task.inputText;
    pipeline.artifact.cover = pipeline.artifact.cover ?? {
      title: task.title || task.inputText.slice(0, 18) || 'Cover',
      subtitle: [],
      summary: task.inputText.slice(0, 120),
      tags: [],
      comments: [],
    };
    pipeline.artifact.rewriteEvaluation = pipeline.artifact.rewriteEvaluation ?? {
      bestRound: 1,
      evaluations: [{ round: 1, score: 100, reason: 'Direct-copy publish mode skips rewrite rounds and keeps the original copy.' }],
    };
  }

  if (!directCopyPublish && (!isStepCompleted(pipeline, 0) || !pipeline.artifact.reviewedText)) {
    await db.updateTask(task.id, { currentStep: 0, retryFromStep: 0 });
    await heartbeatTask(db, task.id, options, 0, 'LLM review');
    await markStep(0, 'running');
    await emit('step_start', 0, 'Reviewer', 'LLM 文案预审');
    const sourceText = buildReviewSourceText(task, sourceContext);
    const reviewPromptResult = renderStepPromptDetails(promptTemplates, 'review', promptContext(), sourceText);
    const reviewPrompt = reviewPromptResult.content;
    const includeReviewSourceBlock = shouldAppendReviewSourceMaterial(reviewPromptResult.template);
    const review = await runLlmJson<{ reviewedText: string }>(options.llm, {
      step: 0,
      name: 'review',
      signal: options.signal,
      anthropicToolInputSchema: reviewOutputJsonSchema,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: {"reviewedText": string}.' },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Template instructions:',
            reviewPrompt,
            targetLengthReviewInstruction(task, sourceText),
            taskModeInstructions(task),
            includeReviewSourceBlock ? 'Source material:' : '',
            includeReviewSourceBlock ? sourceText : '',
            rewriteContextForStep(pipeline, 0),
          ]),
        },
      ],
    });
    pipeline.artifact.reviewedText = requireString(review.json.reviewedText, 'reviewedText');
    await writeFile(join(workDir, '00-reviewed.txt'), pipeline.artifact.reviewedText, 'utf8');
    await markStep(0, 'completed', { outputPath: join(workDir, '00-reviewed.txt') });
    await heartbeatTask(db, task.id, options, 0, 'LLM review completed');
    await emit('step_complete', 0, 'Reviewer', `已保存 ${pipeline.artifact.reviewedText.length} 字`, { requestId: review.requestId });
  }

  if (!directCopyPublish && (!isStepCompleted(pipeline, 1) || !pipeline.artifact.rewrittenCopy || !pipeline.artifact.cover)) {
    await db.updateTask(task.id, { currentStep: 1, retryFromStep: 1 });
    await heartbeatTask(db, task.id, options, 1, 'LLM rewrite');
    await markStep(1, 'running');
    await emit('step_start', 1, 'Writer', 'LLM 改写与封面信息');
    const rewritePrompt = renderStepPrompt(promptTemplates, 'rewrite', promptContext(), requireString(pipeline.artifact.reviewedText, 'reviewedText'));
    const coverPrompt = renderStepPrompt(promptTemplates, 'cover', promptContext(), '');
    const rewrite = await runRewriteRounds(options.llm, {
      task,
      rewritePrompt,
      coverPrompt,
      reviewedText: requireString(pipeline.artifact.reviewedText, 'reviewedText'),
      signal: options.signal,
      rerunContext: rewriteContextForStep(pipeline, 1),
    });
    pipeline.artifact.rewrittenCopy = rewrite.rewrittenCopy;
    pipeline.artifact.cover = rewrite.cover;
    pipeline.artifact.rewriteEvaluation = rewrite.evaluation;
    await writeFile(join(workDir, '01-rewritten-copy.md'), pipeline.artifact.rewrittenCopy, 'utf8');
    await writeFile(join(workDir, '00-cover-title.json'), JSON.stringify(pipeline.artifact.cover, null, 2), 'utf8');
    await writeFile(join(workDir, '01-rewrite-evaluations.json'), JSON.stringify(pipeline.artifact.rewriteEvaluation, null, 2), 'utf8');
    if (pipeline.artifact.rewriteEvaluation.wordCountWarning) {
      await emit('step_warning', 1, 'Writer', pipeline.artifact.rewriteEvaluation.wordCountWarning, pipeline.artifact.rewriteEvaluation);
    }
    await markStep(1, 'completed', { outputPath: join(workDir, '01-rewritten-copy.md') });
    await heartbeatTask(db, task.id, options, 1, 'LLM rewrite completed');
    await emit('step_complete', 1, 'Writer', `改写完成：${pipeline.artifact.rewrittenCopy.length} 字`, { evaluation: pipeline.artifact.rewriteEvaluation });
  }

  if (directCopyPublish && !isStepCompleted(pipeline, 0)) {
    await writeFile(join(workDir, '00-reviewed.txt'), requireString(pipeline.artifact.reviewedText, 'reviewedText'), 'utf8');
    await markStep(0, 'completed', { outputPath: join(workDir, '00-reviewed.txt') });
    await emit('step_complete', 0, 'Reviewer', 'Direct-copy publish mode kept the original source text');
  }

  if (directCopyPublish && !isStepCompleted(pipeline, 1)) {
    await writeFile(join(workDir, '01-rewritten-copy.md'), requireString(pipeline.artifact.rewrittenCopy, 'rewrittenCopy'), 'utf8');
    await writeFile(join(workDir, '00-cover-title.json'), JSON.stringify(normalizeCover(pipeline.artifact.cover), null, 2), 'utf8');
    await writeFile(
      join(workDir, '01-rewrite-evaluations.json'),
      JSON.stringify(pipeline.artifact.rewriteEvaluation ?? { bestRound: 1, evaluations: [] }, null, 2),
      'utf8',
    );
    await markStep(1, 'completed', { outputPath: join(workDir, '01-rewritten-copy.md') });
    await emit('step_complete', 1, 'Writer', 'Direct-copy publish mode skipped rewrite rounds');
  }

  if (!isStepCompleted(pipeline, 2) || !pipeline.artifact.scenes) {
    await db.updateTask(task.id, { currentStep: 2, retryFromStep: 2 });
    await heartbeatTask(db, task.id, options, 2, 'LLM storyboard');
    await markStep(2, 'running');
    await emit('step_start', 2, 'Storyboard', 'LLM 影视分镜分句');
    const rewrittenCopy = requireString(pipeline.artifact.rewrittenCopy, 'rewrittenCopy');
    const storyboardSceneCount = normalizeStoryboardSceneCount(task.targetScenes ?? task.storyboardSceneCount);
    const storyboardPrompt = renderStepPrompt(promptTemplates, 'storyboard', promptContext(), rewrittenCopy);
    const storyboard = await runLlmJson<unknown>(options.llm, {
      step: 2,
      name: 'storyboard',
      signal: options.signal,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: ["tail anchor", "..."].' },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Storyboard instructions:',
            storyboardPrompt,
            taskModeInstructions(task),
            targetScenesInstruction(task),
            'Rewritten copy:',
            rewrittenCopy,
            rewriteContextForStep(pipeline, 2),
          ]),
        },
      ],
    });
    let storyboardScenes = normalizeStoryboardResponse(storyboard.json, storyboard.raw, rewrittenCopy);
    if (!isStoryboardSceneCountAcceptable(storyboardScenes, storyboardSceneCount, rewrittenCopy)) {
      storyboardScenes = await repairStoryboardToTargetSceneCount(options.llm, {
        task,
        storyboardPrompt,
        rewrittenCopy,
        current: storyboardScenes,
        targetSceneCount: storyboardSceneCount,
        signal: options.signal,
        rerunContext: rewriteContextForStep(pipeline, 2),
      });
    }
    pipeline.artifact.scenes = storyboardScenes;
    await writeFile(join(workDir, '02-sentences.json'), JSON.stringify(pipeline.artifact.scenes, null, 2), 'utf8');
    await markStep(2, 'completed', { outputPath: join(workDir, '02-sentences.json') });
    await heartbeatTask(db, task.id, options, 2, 'LLM storyboard completed');
    await emit('step_complete', 2, 'Storyboard', `分镜 ${pipeline.artifact.scenes.length} 个`, { requestId: storyboard.requestId });
  }

  if (!pipeline.artifact.characterCard) {
    pipeline.artifact.characterCard = await ensureCharacterCard({
      llm: options.llm,
      task,
      reviewedText: requireString(pipeline.artifact.reviewedText, 'reviewedText'),
      rewrittenCopy: requireString(pipeline.artifact.rewrittenCopy, 'rewrittenCopy'),
      scenes: pipeline.artifact.scenes ?? [],
      signal: options.signal,
    });
    await writeFile(join(workDir, '02-character-card.json'), JSON.stringify(pipeline.artifact.characterCard, null, 2), 'utf8');
  }

  if (!isStepCompleted(pipeline, 3) || !pipeline.artifact.imagePrompts) {
    await db.updateTask(task.id, { currentStep: 3, retryFromStep: 3 });
    await heartbeatTask(db, task.id, options, 3, 'LLM prompts');
    await markStep(3, 'running');
    await emit('step_start', 3, 'Prompt', 'LLM 生成绘图提示词');
    if (!pipeline.artifact.scenes) {
      throw new Error('Pipeline scenes are missing; retry from storyboard step.');
    }
    const sceneBatches = chunkArray(pipeline.artifact.scenes, imagePromptBatchSize);
    const batchSnapshots = sceneBatches.map((scenes, index) => {
      const batchContext = buildPromptRenderContext({ task, taskTemplate, customStyles: appState.customStyles, sourceContext, artifact: { ...pipeline.artifact, scenes } });
      const instruction = renderStepPrompt(promptTemplates, 'image-prompt', batchContext, JSON.stringify({ scenes, style: task.style, ratio: task.ratio }));
      return buildImagePromptSnapshot(instruction, scenes, task, taskTemplate, index + 1, sceneBatches.length, pipeline.artifact.characterCard, rewriteContextForStep(pipeline, 3));
    });
    await db.updateTask(task.id, { step3PromptSnapshot: batchSnapshots.join('\n\n--- image prompt batch ---\n\n') });
    const imagePrompts: ImagePrompt[] = [];
    const requestIds: Array<string | null> = [];
    for (const [index, scenes] of sceneBatches.entries()) {
      await heartbeatTask(db, task.id, options, 3, `LLM prompts batch ${index + 1}/${sceneBatches.length}`);
      const prompts = await runLlmJson<{ imagePrompts: ImagePrompt[] }>(options.llm, {
        step: 3,
        name: 'image-prompts',
        signal: options.signal,
        anthropicToolInputSchema: imagePromptsOutputJsonSchema,
        messages: [
          { role: 'system', content: 'Return strict JSON only. Schema: {"imagePrompts":[{"sceneId":number,"cap":string,"prompt":string,"negativePrompt":string,"style":string,"ratio":string,"characterProfile":string}]}.' },
          { role: 'user', content: batchSnapshots[index] },
        ],
      });
      requestIds.push(prompts.requestId);
      imagePrompts.push(...normalizePrompts(prompts.json.imagePrompts, scenes, task));
    }
    pipeline.artifact.imagePrompts = normalizePrompts(imagePrompts, pipeline.artifact.scenes, task);
    await markStep(3, 'completed', { outputPath: join(workDir, '03-image-prompts.json') });
    await heartbeatTask(db, task.id, options, 3, 'LLM prompts completed');
    await emit('step_complete', 3, 'Prompt', `已生成 ${pipeline.artifact.imagePrompts.length} 条图片提示词`, { requestIds });
  }
  if (!pipeline.artifact.scenes) {
    throw new Error('Pipeline scenes are missing; retry from storyboard step.');
  }
  pipeline.artifact.subtitles = buildSubtitleTrack(pipeline.artifact.scenes);
  await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact), task);
}

function renderStepPrompt(templates: PromptTemplate[], type: PromptStepTemplateType, context: PromptRenderContext, fallback: string): string {
  return renderStepPromptDetails(templates, type, context, fallback).content;
}

function renderStepPromptDetails(templates: PromptTemplate[], type: PromptStepTemplateType, context: PromptRenderContext, fallback: string): RenderedStepPrompt {
  const template = selectStepPromptTemplate(templates, type, context.taskTemplate ?? null);
  return {
    template,
    content: template ? renderPromptTemplate(template, context) : fallback,
  };
}

function joinPromptBlocks(blocks: string[]): string {
  return blocks.map((block) => block.trim()).filter(Boolean).join('\n\n');
}

function shouldAppendReviewSourceMaterial(template: PromptTemplate | null): boolean {
  if (!template) return false;
  return !/\{\{\s*(?:inputText|sourceContext|\u539f\u6587\u7d20\u6750|\u8054\u7f51\u8d44\u6599|\u8d44\u6599\u6765\u6e90|\u7d20\u6750)\s*\}\}/iu.test(template.content);
}

function rewriteContextForStep(pipeline: PipelineState, step: number): string {
  if (pipeline.rerun?.mode !== 'rewrite' || pipeline.rerun.step !== step || !pipeline.rerun.context) return '';
  return joinPromptBlocks([
    'Existing artifact context:',
    JSON.stringify(pipeline.rerun.context, null, 2),
    'Rewrite the selected step using this existing output as reference. Return fresh JSON for the requested schema.',
  ]);
}

function taskModeInstructions(task: Task): string {
  if (task.videoForm !== 'two-host-podcast') return '';
  return [
    'Two-host podcast mode.',
    `Speaker pair: ${task.podcastSpeakers ?? 'kazai-dayi'}.`,
    'Write as a dialogue script with two hosts taking turns asking and answering.',
    'Use exactly "Host A:" and "Host B:" labels for every dialogue turn.',
    'Do not put host display names inside spoken lines; names are metadata, not narration.',
    'Keep the Host A/Host B label at the beginning of each storyboard cap so TTS can split voices.',
    'Keep each storyboard cap suitable for podcast-style narration and avoid ordinary single-narrator phrasing.',
  ].join('\n');
}

function buildImagePromptSnapshot(instruction: string, scenes: StoryboardScene[], task: Task, taskTemplate: PromptTemplate | null, batchIndex: number, batchCount: number, characterCard?: CharacterCard, rerunContext = ''): string {
  const style = resolveImageStyle(task.style);
  return joinPromptBlocks([
    'Image prompt instructions:',
    instruction,
    buildStoryboundImageRuntimeContext({ task, taskTemplate, style, characterCard }),
    taskModeInstructions(task),
    characterCard ? `Character card:\n${JSON.stringify(characterCard)}` : '',
    `Batch: ${batchIndex}/${batchCount}`,
    'Only return imagePrompts for the sceneIds in this batch.',
    'Scene context:',
    JSON.stringify({ scenes, style: task.style, ratio: task.ratio }),
    rerunContext,
  ]);
}

function buildStoryboundImageRuntimeContext(input: { task: Task; taskTemplate: PromptTemplate | null; style: typeof defaultCustomStyles[number] | null; characterCard?: CharacterCard }): string {
  const { task, taskTemplate, style, characterCard } = input;
  return joinPromptBlocks([
    'StoryDream 本地运行上下文',
    `当前画面风格：${task.style}`,
    `风格前缀：${style?.prefix ?? ''}`,
    `风格后缀：${style?.suffix ?? ''}`,
    `允许使用色彩词：${style ? String(style.allowColor) : ''}`,
    `负面提示词：${style?.negativePrompt ?? ''}`,
    `画面比例：${task.ratio}`,
    `参考图类型：${taskTemplate?.referenceKind ?? 'none'}`,
    `参考图路径：${task.referenceImagePath || '无'}`,
    `Step 3 骨架：${(taskTemplate?.step3SkeletonModules ?? []).join('、') || '无'}`,
    `图片种子池：${taskTemplate?.imageSeedPoolsJson || '{}'}`,
    task.imagePromptReference ? `生图参考：${task.imagePromptReference}` : '',
    characterCard ? `角色档案：${JSON.stringify(characterCard)}` : '',
  ]);
}

function resolveImageStyle(styleId: string): typeof defaultCustomStyles[number] | null {
  const normalized = storyboundStyleAliases.get(styleId) ?? styleId;
  return defaultCustomStyles.find((style) => style.id === normalized) ?? null;
}

const storyboundStyleAliases = new Map([
  ['realistic', 'photo-real'],
  ['oil-painting', 'oil-paint'],
  ['vintage-film', 'retro-film'],
  ['folk-tale-gongbi', 'folk'],
]);

function chunkArray<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function normalizeStoryboardSceneCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultStoryboardSceneCount;
  return Math.min(60, Math.max(1, Math.round(parsed)));
}

function normalizeTargetLength(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(5000, Math.max(100, Math.round(parsed)));
}

interface TargetWordCountRange {
  target: number;
  min: number;
  max: number;
}

function targetWordCountRange(task: Task, sourceText = ''): TargetWordCountRange | null {
  const target = normalizeTargetLength(task.targetLength);
  if (target) {
    return {
      target,
      min: Math.floor(target * 0.8),
      max: Math.ceil(target * 1.2),
    };
  }
  const sourceLength = countVisibleCharacters(sourceText);
  if (sourceLength <= 0) return null;
  return {
    target: sourceLength,
    min: Math.max(1, Math.floor(sourceLength * 0.8)),
    max: Math.max(1, Math.ceil(sourceLength * 1.2)),
  };
}

function targetWordCountRangeLabel(range: TargetWordCountRange): string {
  return `${range.min}-${range.max}`;
}

function isTargetWordCountInRange(length: number, range: TargetWordCountRange): boolean {
  return length >= range.min && length <= range.max;
}

function targetWordCountFailureReason(length: number, range: TargetWordCountRange): string {
  const label = targetWordCountRangeLabel(range);
  if (length < range.min) {
    return `Word count is too low: current ${length} Chinese characters, target ${label}.`;
  }
  if (length > range.max) {
    return `Word count is too high: current ${length} Chinese characters, target ${label}.`;
  }
  return '';
}

function targetLengthInstruction(task: Task, existingPrompt = '', sourceText = ''): string {
  const range = targetWordCountRange(task, sourceText);
  if (!range) return '';
  const rangeLabel = targetWordCountRangeLabel(range);
  const rangeLine = `Target word count range: ${rangeLabel} Chinese characters.`;
  if (existingPrompt.includes(rangeLine)) return '';
  return [
    rangeLine,
    `If a candidate would be outside ${rangeLabel} Chinese characters, reject it and regenerate from the original source material.`,
    'Do not return rewrittenCopy outside the target word count range; expand concrete details if too short, compress redundant phrasing if too long.',
  ].join('\n');
}

function targetLengthReviewInstruction(task: Task, sourceText = ''): string {
  const range = targetWordCountRange(task, sourceText);
  if (!range) return '';
  const rangeLabel = targetWordCountRangeLabel(range);
  return [
    `Target word count range: ${rangeLabel} Chinese characters.`,
    'Preserve enough source detail in reviewedText to support that target range in the rewrite step.',
    'Do not expand or pad the review output; keep reviewedText as a cleaned source brief for the later rewrite step.',
  ].join('\n');
}

function countVisibleCharacters(value: string): number {
  return value.replace(/\s+/g, '').length;
}

function storyboardSceneCountRange(rewrittenCopy: string, targetSceneCount?: number): { min: number; max: number } {
  if (targetSceneCount !== undefined && targetSceneCount !== null && targetSceneCount > 0) {
    const target = normalizeStoryboardSceneCount(targetSceneCount);
    return {
      min: Math.max(1, Math.floor(target * 0.9)),
      max: Math.max(1, Math.ceil(target * 1.1)),
    };
  }
  const length = rewrittenCopy.trim().length;
  const min = Math.max(10, Math.min(30, Math.floor(length / 40)));
  const max = Math.min(60, Math.max(min + 10, Math.floor(length / 30)));
  return { min, max };
}

function isStoryboardSceneCountAcceptable(scenes: StoryboardScene[], targetSceneCount: number, rewrittenCopy = ''): boolean {
  const range = storyboardSceneCountRange(rewrittenCopy, targetSceneCount);
  return scenes.length >= range.min && scenes.length <= range.max;
}

function targetScenesInstruction(task: Task): string {
  const targetScenes = normalizeStoryboardSceneCount(task.targetScenes ?? task.storyboardSceneCount);
  if (!targetScenes) return '';
  const range = storyboardSceneCountRange('', targetScenes);
  return [
    `Storyboard scene count target: ${targetScenes}.`,
    `目标分镜数：约 ${targetScenes} 个（允许 ±10%，建议范围 ${range.min}-${range.max}）。请按这个粒度切分，数量优先于默认切分习惯，必要时拆细或合并。`,
    '只决定切分点，不要改写、扩写、删除或重排最终口播稿。',
  ].join('\n');
}

function pauseAtCheckpoint(task: Task, initialStep: number, step: number, detail: string): void {
  if (step <= initialStep) return;
  if (task.processingMode === 'semi-auto' && step === 4) {
    throw new CheckpointPause(step, detail);
  }
  if ((task.pausePoints.includes('critical') || task.pausePoints.includes('custom')) && (step === 4 || step === 5 || step === 6)) {
    throw new CheckpointPause(step, detail);
  }
}

function shouldPauseEveryStep(task: Task, initialStep: number, nextStep: number): boolean {
  if (!task.pausePoints.includes('every-step')) return false;
  return nextStep > initialStep && nextStep <= 6;
}

function runLlmJson<T = unknown>(llm: ConfiguredJsonLlm, request: LlmJsonStepRequest): Promise<LlmJsonResult<T>> {
  const baseRequest = {
    step: request.step,
    name: request.name,
    messages: request.messages,
    signal: request.signal,
  };
  if (llm.protocol === 'anthropic') {
    const anthropicRequest: AnthropicMessagesJsonRequest = request.anthropicToolInputSchema
      ? { ...baseRequest, anthropic: { toolInputSchema: request.anthropicToolInputSchema } }
      : baseRequest;
    return llm.run<T>(anthropicRequest);
  }
  const openAiRequest: OpenAiCompatibleJsonRequest = baseRequest;
  return llm.run<T>(openAiRequest);
}

async function runRewriteRounds(
  llm: ConfiguredJsonLlm,
  input: { task: Task; rewritePrompt: string; coverPrompt: string; reviewedText: string; signal?: AbortSignal; rerunContext?: string },
): Promise<{ rewrittenCopy: string; cover: CoverMetadata; evaluation: RewriteEvaluationResult }> {
  const round = 1;
  const rewrite = await runLlmJson<{ rewrittenCopy: string; cover: CoverMetadata }>(llm, {
    step: 1,
    name: `rewrite-round-${round}`,
    signal: input.signal,
    anthropicToolInputSchema: rewriteOutputJsonSchema,
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"rewrittenCopy": string, "cover": {"title": string, "subtitle": string[], "summary": string, "tags": string[], "comments": string[]}}.' },
      {
        role: 'user',
        content: joinPromptBlocks([
          'Rewrite round: 1/1',
          'Rewrite instructions:',
          input.rewritePrompt,
          targetLengthInstruction(input.task, input.rewritePrompt, input.reviewedText),
          targetScenesInstruction(input.task),
          taskModeInstructions(input.task),
          'Cover instructions:',
          input.coverPrompt,
          'Reviewed text:',
          input.reviewedText,
          input.rerunContext ?? '',
        ]),
      },
    ],
  });
  const selected = {
    round,
    rewrittenCopy: requireString(rewrite.json.rewrittenCopy, `rewrite round ${round}.rewrittenCopy`),
    cover: normalizeCover(rewrite.json.cover),
    requestId: rewrite.requestId,
  };
  const targetRange = targetWordCountRange(input.task, input.reviewedText);
  const selectedLength = countVisibleCharacters(selected.rewrittenCopy);
  const selectedFailureReason = targetRange ? targetWordCountFailureReason(selectedLength, targetRange) : '';
  const rangeLabel = targetRange ? targetWordCountRangeLabel(targetRange) : '';
  const evaluation: RewriteEvaluationResult = {
    bestRound: selected.round,
    evaluations: [{
      round: selected.round,
      score: selectedFailureReason ? 70 : 100,
      reason: selectedFailureReason
        ? `Single rewrite round outside target word count range: ${selectedLength}/${rangeLabel} Chinese characters. ${selectedFailureReason}`
        : 'Single rewrite round accepted.',
    }],
  };
  if (targetRange && !isTargetWordCountInRange(selectedLength, targetRange)) {
    return repairRewriteToTargetLength(llm, {
      task: input.task,
      rewritePrompt: input.rewritePrompt,
      coverPrompt: input.coverPrompt,
      reviewedText: input.reviewedText,
      current: selected,
      targetRange,
      signal: input.signal,
      rerunContext: input.rerunContext,
      evaluation,
    });
  }
  return {
    rewrittenCopy: selected.rewrittenCopy,
    cover: selected.cover,
    evaluation,
  };
}

async function repairRewriteToTargetLength(
  llm: ConfiguredJsonLlm,
  input: {
    task: Task;
    rewritePrompt: string;
    coverPrompt: string;
    reviewedText: string;
    current: { round: number; rewrittenCopy: string; cover: CoverMetadata; requestId: string | null };
    targetRange: TargetWordCountRange;
    signal?: AbortSignal;
    rerunContext?: string;
    evaluation: RewriteEvaluationResult;
  },
): Promise<{ rewrittenCopy: string; cover: CoverMetadata; evaluation: RewriteEvaluationResult }> {
  let current = input.current;
  let currentLength = countVisibleCharacters(current.rewrittenCopy);
  const rangeLabel = targetWordCountRangeLabel(input.targetRange);
  for (let attempt = 1; attempt <= rewriteTargetLengthRepairAttempts && !isTargetWordCountInRange(currentLength, input.targetRange); attempt += 1) {
    const isTooShort = currentLength < input.targetRange.min;
    const deficit = Math.max(0, input.targetRange.min - currentLength);
    const surplus = Math.max(0, currentLength - input.targetRange.max);
    const minimumAddition = deficit + rewriteTargetLengthRepairBuffer;
    const repairReason = targetWordCountFailureReason(currentLength, input.targetRange);
    const repairTargetInstruction = targetLengthInstruction(input.task, input.rewritePrompt, input.reviewedText);
    const draftLabel = isTooShort ? 'Current short draft:' : 'Current long draft:';
    const repairGuidance = isTooShort
      ? [
          `Minimum additional visible Chinese characters needed: ${deficit}.`,
          `Add at least ${minimumAddition} visible Chinese characters before returning JSON, using concrete details from the original source material instead of filler.`,
          'Expand scene detail, emotional setup, causality, and concrete source facts until the rewrittenCopy is inside the target word count range.',
          'The current draft is rejected because it is below the target word count range.',
        ]
      : [
          `Maximum visible Chinese characters to remove: ${surplus}.`,
          'Compress redundant phrasing without dropping key plot points or source facts.',
          'Shorten repeated setup, filler transitions, and duplicated descriptions until the rewrittenCopy is inside the target word count range.',
          'The current draft is rejected because it is above the target word count range.',
        ];
    const repair = await runLlmJson<{ rewrittenCopy: string; cover: CoverMetadata }>(llm, {
      step: 1,
      name: `rewrite-target-length-repair-${attempt}`,
      signal: input.signal,
      anthropicToolInputSchema: rewriteOutputJsonSchema,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: {"rewrittenCopy": string, "cover": {"title": string, "subtitle": string[], "summary": string, "tags": string[], "comments": string[]}}.' },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Target-length repair rewrite.',
            repairTargetInstruction,
            `Current draft length: ${currentLength} Chinese characters.`,
            repairReason,
            ...repairGuidance,
            'Rewrite instructions:',
            input.rewritePrompt,
            targetScenesInstruction(input.task),
            taskModeInstructions(input.task),
            'Cover instructions:',
            input.coverPrompt,
            'Original source material:',
            input.reviewedText,
            draftLabel,
            current.rewrittenCopy,
            input.rerunContext ?? '',
          ]),
        },
      ],
    });
    current = {
      round: current.round,
      rewrittenCopy: requireString(repair.json.rewrittenCopy, `rewrite target-length repair ${attempt}.rewrittenCopy`),
      cover: normalizeCover(repair.json.cover),
      requestId: repair.requestId,
    };
    currentLength = countVisibleCharacters(current.rewrittenCopy);
  }
  const wordCountWarning = isTargetWordCountInRange(currentLength, input.targetRange)
    ? undefined
    : `Rewrite target word count accepted after ${rewriteTargetLengthRepairAttempts} target-length repairs: ${currentLength}/${rangeLabel} Chinese characters.`;
  const finalReason = wordCountWarning
    ? `Accepted after ${rewriteTargetLengthRepairAttempts} target-length repairs at ${currentLength}/${rangeLabel} Chinese characters.`
    : `Auto-repaired to ${currentLength}/${rangeLabel} Chinese characters.`;
  return {
    rewrittenCopy: current.rewrittenCopy,
    cover: current.cover,
    evaluation: {
      ...input.evaluation,
      bestRound: current.round,
      evaluations: [
        ...input.evaluation.evaluations,
        {
          round: current.round,
          score: wordCountWarning ? 70 : 100,
          reason: finalReason,
        },
      ],
      wordCountWarning,
    },
  };
}

async function repairStoryboardToTargetSceneCount(
  llm: ConfiguredJsonLlm,
  input: {
    task: Task;
    storyboardPrompt: string;
    rewrittenCopy: string;
    current: StoryboardScene[];
    targetSceneCount: number;
    signal?: AbortSignal;
    rerunContext?: string;
  },
): Promise<StoryboardScene[]> {
  let current = input.current;
  let currentCount = current.length;
  for (let attempt = 1; attempt <= 2 && !isStoryboardSceneCountAcceptable(current, input.targetSceneCount, input.rewrittenCopy); attempt += 1) {
    const repair = await runLlmJson<unknown>(llm, {
      step: 2,
      name: `storyboard-target-scenes-repair-${attempt}`,
      signal: input.signal,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: ["tail anchor", "..."].' },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Target-scene repair storyboard.',
            `Hard target storyboard scene count: ${input.targetSceneCount}.`,
            `Current storyboard scene count: ${currentCount}.`,
            `Acceptable range: ${storyboardSceneCountRange(input.rewrittenCopy, input.targetSceneCount).min}-${storyboardSceneCountRange(input.rewrittenCopy, input.targetSceneCount).max} scenes.`,
            'Storyboard instructions:',
            input.storyboardPrompt,
            targetScenesInstruction(input.task),
            taskModeInstructions(input.task),
            'Rewritten copy:',
            input.rewrittenCopy,
            'Current short storyboard:',
            JSON.stringify(current, null, 2),
            'Please return only the tail-anchor JSON string array; do not return {id, cap} objects.',
            input.rerunContext ?? '',
          ]),
        },
      ],
    });
    current = normalizeStoryboardResponse(repair.json, repair.raw, input.rewrittenCopy);
    currentCount = current.length;
  }
  if (!isStoryboardSceneCountAcceptable(current, input.targetSceneCount, input.rewrittenCopy)) {
    const range = storyboardSceneCountRange(input.rewrittenCopy, input.targetSceneCount);
    throw new Error(`Storyboard target scene count not met after automatic repair: ${currentCount}/${range.min}-${range.max} scenes.`);
  }
  return current;
}

async function ensureCharacterCard(input: {
  llm?: ConfiguredJsonLlm;
  task: Task;
  reviewedText: string;
  rewrittenCopy: string;
  scenes: StoryboardScene[];
  signal?: AbortSignal;
}): Promise<CharacterCard> {
  if (input.llm) {
    try {
      const response = await runLlmJson<{ characterCard: CharacterCard }>(input.llm, {
        step: 3.1,
        name: 'character-card',
        signal: input.signal,
        anthropicToolInputSchema: characterCardOutputJsonSchema,
        messages: [
          { role: 'system', content: 'Return strict JSON only. Schema: {"characterCard":{"summary":string,"characters":[{"name":string,"appearance":string,"wardrobe":string,"role":string}],"consistencyRules":string[]}}.' },
          {
            role: 'user',
            content: joinPromptBlocks([
              'Extract the protagonist and recurring character consistency card before image prompt generation.',
              `Task kind: ${input.task.taskKind}`,
              taskModeInstructions(input.task),
              'Reviewed text:',
              input.reviewedText,
              'Rewritten copy:',
              input.rewrittenCopy,
              'Scenes:',
              JSON.stringify(input.scenes),
            ]),
          },
        ],
      });
      return normalizeCharacterCard(response.json.characterCard, input.task);
    } catch {
      return fallbackCharacterCard(input.task);
    }
  }
  return fallbackCharacterCard(input.task);
}

function normalizeCharacterCard(input: unknown, task: Task): CharacterCard {
  const card = input && typeof input === 'object' ? (input as Partial<CharacterCard>) : {};
  const characters = Array.isArray(card.characters) && card.characters.length
    ? card.characters.map((character) => ({
      name: String(character.name ?? '主角'),
      appearance: String(character.appearance ?? card.summary ?? '主体形象保持一致'),
      wardrobe: character.wardrobe === undefined ? undefined : String(character.wardrobe),
      role: character.role === undefined ? undefined : String(character.role),
    }))
    : [{ name: task.taskKind === 'music-mv' ? 'MV 主角' : '主角', appearance: '主体形象保持一致', role: 'protagonist' }];
  return {
    summary: String(card.summary ?? `${characters[0]?.name ?? '主角'}在所有镜头中保持外貌、年龄、服饰和情绪连续。`),
    characters,
    consistencyRules: Array.isArray(card.consistencyRules) && card.consistencyRules.length ? card.consistencyRules.map(String) : ['保持同一主体身份、外貌、服饰和时代感。'],
  };
}

function fallbackCharacterCard(task: Task): CharacterCard {
  const name = task.taskKind === 'music-mv' ? 'MV 主角/歌者' : '主角';
  return {
    summary: `${name}在所有镜头中保持外貌、服饰、年龄和情绪连续。`,
    characters: [{ name, appearance: '主体形象稳定，镜头间保持一致。', role: 'protagonist' }],
    consistencyRules: ['不要改变主角脸型、年龄、发型、服装主色和时代风格。'],
  };
}

function buildMusicMvArtifact(task: Task, sourceContext?: AiSourceContext): PipelineArtifact {
  const musicPlan = buildMusicPlan(task);
  const scenes: StoryboardScene[] = musicPlan.segments.map((segment) => ({
    id: segment.id,
    cap: segment.lyric,
    descPrompt: `音乐MV，${task.style}，${musicPlan.visualMotif || '情绪化画面'}，${segment.section}，${segment.visualHint}，歌词字幕：${segment.lyric}`,
    durationMs: segment.durationMs,
  }));
  const characterCard = fallbackCharacterCard(task);
  const imagePrompts: ImagePrompt[] = scenes.map((scene, index) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: `音乐MV，${task.style}，${musicPlan.visualMotif || '情绪化画面'}，${musicPlan.captionStyle} 字幕，${musicPlan.rhythmMode} 节奏，第 ${index + 1} 镜：${scene.descPrompt}`,
    negativePrompt: '低质量，模糊，水印，乱码文字，多余字幕，变形人物',
    style: task.style,
    ratio: task.ratio,
    characterProfile: characterCard.summary,
  }));
  return {
    reviewedText: task.inputText,
    rewrittenCopy: musicPlan.segments.map((segment) => segment.lyric).join('\n'),
    cover: {
      title: task.title || '音乐MV',
      subtitle: [musicPlan.rhythmMode, musicPlan.captionStyle],
      summary: musicPlan.visualMotif || '根据歌词生成音乐 MV 分镜。',
      tags: ['#音乐MV', '#歌词成片', '#AI视频'],
      comments: ['这版 MV 的画面感很强', '歌词和镜头节奏很搭'],
    },
    scenes,
    imagePrompts,
    subtitles: buildSubtitleTrack(scenes),
    sourceContext,
    musicPlan,
    characterCard,
  };
}

async function writeMusicMvSidecarDraft(input: {
  task: Task;
  artifact: PipelineArtifact;
  workDir: string;
  draftRootDir: string;
  template?: DraftTemplate;
  generatedImages: SceneAsset[];
  coverImagePath?: string;
  runSidecar: (input: StoryboundSidecarInput) => Promise<StoryboundSidecarResult>;
}): Promise<{
  draftDir: string;
  draftContentPath: string;
  draftMetaPath: string;
  draftId?: string;
  sourceVideoPath?: string;
  workDir: string;
  assets: {
    images: string[];
    narration: string[];
    bgm: string | null;
    subtitles: string;
  };
}> {
  const sceneTimings = input.artifact.scenes.map((scene, index) => {
    const image = input.generatedImages.find((asset) => asset.sceneId === scene.id);
    if (!image?.path) {
      throw new Error(`Missing music MV image asset for scene ${scene.id}.`);
    }
    const startUs = input.artifact.scenes.slice(0, index).reduce((sum, item) => sum + Math.max(800, item.durationMs), 0) * 1000;
    const durationUs = Math.max(800, scene.durationMs) * 1000;
    return {
      sceneId: scene.id,
      scene,
      imagePath: image.path,
      startUs,
      durationUs,
    };
  });
  const runSidecar = input.runSidecar ?? runStoryboundMediaSidecar;
  const result = await runSidecar({
    mode: 'music_mv',
    work_dir: input.workDir,
    audio_path: input.task.musicMv.audioPath,
    audio_duration: Math.max(0.001, input.artifact.scenes.reduce((sum, scene) => sum + Math.max(800, scene.durationMs), 0) / 1000),
    material_source: input.task.materialSource ?? 'ai',
    assignments: sceneTimings.map((item) => ({
      scene_id: item.sceneId,
      image_path: item.imagePath,
      start_us: item.startUs,
      duration_us: item.durationUs,
      lyric: item.scene.cap,
    })),
    lyrics: sceneTimings.map((item) => ({
      scene_id: item.sceneId,
      text: item.scene.cap,
      start_us: item.startUs,
      end_us: item.startUs + item.durationUs,
    })),
    jianying_draft_path: input.draftRootDir,
    task_title: input.task.title || todayTitle(input.task.inputText),
    template: input.template,
    cover_title: input.artifact.cover,
    cover_image_path: input.coverImagePath,
  });
  const draftDir = result.draft_dir ?? join(input.draftRootDir, safeDraftName(input.task.title || todayTitle(input.task.inputText)));
  return {
    draftDir,
    draftContentPath: join(draftDir, 'draft_content.json'),
    draftMetaPath: join(draftDir, 'draft_meta_info.json'),
    draftId: result.draft_id,
    sourceVideoPath: result.source_path,
    workDir: input.workDir,
    assets: {
      images: sceneTimings.map((item) => item.imagePath),
      narration: [],
      bgm: input.task.musicMv.audioPath || null,
      subtitles: join(input.workDir, 'subtitles.srt'),
    },
  };
}

function buildMusicPlan(task: Task): MusicPlan {
  const lines = task.inputText
    .replace(/\r/g, '')
    .split(/\n|(?<=[。！？!?；;])/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const lyrics = lines.length ? lines : [task.title || '音乐MV'];
  const durationByMode = task.musicMv.rhythmMode === 'fast-cut' ? 1600 : task.musicMv.rhythmMode === 'slow-cinematic' ? 3600 : 2400;
  return {
    rhythmMode: task.musicMv.rhythmMode,
    captionStyle: task.musicMv.captionStyle,
    visualMotif: task.musicMv.visualMotif,
    audioPath: task.musicMv.audioPath,
    segments: lyrics.map((lyric, index) => ({
      id: index + 1,
      lyric,
      section: musicSection(index, lyrics.length),
      durationMs: durationByMode,
      visualHint: `${task.musicMv.visualMotif || '围绕歌词情绪'}，镜头跟随歌词 "${lyric}"`,
    })),
  };
}

function musicSection(index: number, total: number): MusicPlan['segments'][number]['section'] {
  if (index === 0) return 'intro';
  if (index === total - 1) return 'outro';
  if (total >= 4 && index >= Math.floor(total / 2)) return 'chorus';
  return 'verse';
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
  workDir: string;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  markStep: (step: number, status: StepStatus, patch?: Partial<PipelineState['steps'][string]>) => Promise<void>;
  pipeline: PipelineState;
}): Promise<void> {
  const { db, task, artifact, options, emit, markStep, pipeline } = input;
  throwIfAborted(options.signal);
  if (!options.generateImages) {
    throw new Error('Image provider is not configured; cannot create real image assets.');
  }
  const generateImages = options.generateImages;
  if (shouldGenerateCoverImage(task) && pipeline.assets.cover.length === 0) {
    await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
    await heartbeatTask(db, task.id, options, 4, 'cover image generation');
    await markStep(4, 'running');
    await emit('step_start', 4, 'Producer', '生成封面图片素材', { coverTemplateId: task.coverTemplateId });
    const coverScene = buildCoverScene(artifact);
    const coverPrompt = buildCoverImagePrompt(task, artifact, options.customCoverTemplates);
    const coverAssets = await generateImages([coverScene], [coverPrompt], task, options.signal);
    const coverPath = await persistCoverImage(input.workDir, coverAssets[0], coverPrompt, input);
    pipeline.assets.cover = [{ sceneId: 0, path: coverPath }];
    await markStep(4, 'running', { outputPath: coverPath });
  }
  if (usesSinglePodcastCover(task)) {
    if (pipeline.assets.cover.length === 0) {
      await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
      await heartbeatTask(db, task.id, options, 4, 'podcast cover generation');
      await markStep(4, 'running');
      const coverScene = buildCoverScene(artifact);
      const coverPrompt = buildCoverImagePrompt(task, artifact, options.customCoverTemplates);
      const coverAssets = await generateImages([coverScene], [coverPrompt], task, options.signal);
      const coverPath = await persistCoverImage(input.workDir, coverAssets[0], coverPrompt, input);
      pipeline.assets.cover = [{ sceneId: 0, path: coverPath }];
    }
    pipeline.assets.images = artifact.scenes.map((scene) => ({ sceneId: scene.id, path: pipeline.assets.cover[0].path }));
    await markStep(4, 'completed', { outputPath: pipeline.assets.cover[0].path });
    await emit('step_complete', 4, 'Producer', '播客单图封面已映射到全部分镜', { count: pipeline.assets.images.length });
    return;
  }
  const missing = missingScenes(artifact.scenes, pipeline.assets.images);
  if (missing.length === 0 && pipeline.assets.images.length >= artifact.scenes.length) {
    await markStep(4, 'completed');
    return;
  }
  await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
  await heartbeatTask(db, task.id, options, 4, 'image generation');
  await markStep(4, 'running');
  await emit('step_start', 4, 'Producer', '批量生成真实图片素材', { missingSceneIds: missing.map((scene) => scene.id) });
  let persistImageQueue = Promise.resolve();
  await runWithConcurrency(missing, options.imageConcurrency ?? 1, async (scene) => {
    throwIfAborted(options.signal);
    let generatedImages: SceneAsset[];
    try {
      generatedImages = await generateImages([scene], artifact.imagePrompts, task, options.signal);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      persistImageQueue = persistImageQueue.then(async () => {
        pipeline.assets.imageErrors = upsertImageError(pipeline.assets.imageErrors, scene.id, message);
        await markStep(4, 'running', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n'), error: message });
        await heartbeatTask(db, task.id, options, 4, `image scene ${scene.id} failed`);
      });
      await persistImageQueue;
      throw error;
    }
    persistImageQueue = persistImageQueue.then(async () => {
      pipeline.assets.images = mergeAssets(pipeline.assets.images, generatedImages);
      pipeline.assets.imageErrors = removeImageErrors(pipeline.assets.imageErrors, generatedImages.map((asset) => asset.sceneId));
      await markStep(4, 'running', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n') });
      await heartbeatTask(db, task.id, options, 4, `image scene ${scene.id} completed`);
    });
    await persistImageQueue;
    throwIfAborted(options.signal);
  });
  await persistImageQueue;
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
  throwIfAborted(options.signal);
  const missing = missingScenes(artifact.scenes, pipeline.assets.narration);
  if (missing.length === 0) {
    await markStep(5, 'completed');
    return;
  }
  await db.updateTask(task.id, { currentStep: 5, retryFromStep: 5 });
  await heartbeatTask(db, task.id, options, 5, 'narration generation');
  await markStep(5, 'running');
  await emit('step_start', 5, 'TTS', '生成真实旁白音频', { missingSceneIds: missing.map((scene) => scene.id) });
  if (!options.synthesizeNarration) {
    throw new Error('TTS provider is not configured; cannot create real narration audio.');
  }
  for (const scene of missing) {
    throwIfAborted(options.signal);
    const narrationAudio = await options.synthesizeNarration([scene], task, options.signal);
    pipeline.assets.narration = mergeNarrationAssets(pipeline.assets.narration, narrationAudio);
    await markStep(5, 'running', { outputPath: pipeline.assets.narration.map((asset) => asset.path).join('\n') });
    await heartbeatTask(db, task.id, options, 5, `narration scene ${scene.id} completed`);
    throwIfAborted(options.signal);
  }
  await markStep(5, 'completed');
  await emit('step_complete', 5, 'TTS', '真实配音与字幕时间轴已生成', { subtitles: artifact.subtitles.cues.length, audio: pipeline.assets.narration.length });
}

function shouldGenerateCoverImage(task: Task): boolean {
  return task.coverImageMode === 'auto' || task.coverImageMode === 'manual' || usesSinglePodcastCover(task);
}

function usesSinglePodcastCover(task: Task): boolean {
  return task.videoForm === 'two-host-podcast' && task.podcastImageMode === 'single';
}

function buildCoverScene(artifact: PipelineArtifact): StoryboardScene {
  return {
    id: 0,
    cap: artifact.cover.title || 'Cover',
    descPrompt: artifact.cover.summary || artifact.rewrittenCopy.slice(0, 160),
    durationMs: 1200,
  };
}

function buildCoverImagePrompt(task: Task, artifact: PipelineArtifact, customCoverTemplates: CustomCoverTemplate[] = []): ImagePrompt {
  const selectedTemplate = customCoverTemplates.find((template) => template.id === task.coverTemplateId);
  const template = selectedTemplate
    ? [
      selectedTemplate.directions,
      selectedTemplate.compositionRule,
      selectedTemplate.titleLayout,
      selectedTemplate.subtitleLayout,
      selectedTemplate.plainHint.replace(/\{\{TITLE\}\}/g, artifact.cover.title || task.title || 'Cover'),
    ].filter(Boolean).join('\n')
    : task.coverTemplateId === 'podcast-cover' || usesSinglePodcastCover(task)
      ? 'Podcast cover, readable at thumbnail size, calm host/story identity, single topic signal, clean title area.'
      : 'Short-video cover, strong subject, clear title-safe negative space, readable thumbnail composition.';
  const videoForm = task.videoForm === 'two-host-podcast' ? `Two-host podcast, speaker pair ${task.podcastSpeakers ?? 'kazai-dayi'}, dialogue show visual identity.` : 'Narration video cover.';
  return {
    sceneId: 0,
    cap: artifact.cover.title || task.title || 'Cover',
    prompt: [
      template,
      videoForm,
      `Title: ${artifact.cover.title}`,
      artifact.cover.subtitle.length ? `Subtitle: ${artifact.cover.subtitle.join(' / ')}` : '',
      `Summary: ${artifact.cover.summary}`,
      `Style: ${task.style}`,
      `Ratio: ${task.ratio}`,
    ].filter(Boolean).join('\n'),
    negativePrompt: 'low quality, blurry, watermark, random text, crowded layout, malformed hands',
    style: task.style,
    ratio: task.ratio,
    characterProfile: artifact.characterCard?.summary ?? '',
    referenceImagePaths: task.referenceImagePath?.trim() ? [task.referenceImagePath.trim()] : undefined,
  };
}

async function persistCoverImage(
  workDir: string,
  asset: SceneAsset | undefined,
  prompt: ImagePrompt,
  input: {
    emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  },
): Promise<string> {
  if (!asset?.path) {
    throw new Error('Image provider did not return a cover image asset.');
  }
  const coverPath = join(workDir, 'cover-image.png');
  await copyFile(asset.path, coverPath);
  await input.emit('step_complete', 4, 'Producer', '封面图片已生成', { path: coverPath, prompt });
  return coverPath;
}

async function loadPipelineState(path: string, taskId: string): Promise<PipelineState> {
  try {
    const state = JSON.parse(await readFile(path, 'utf8')) as PipelineState;
    const assets = state.assets ?? { cover: [], images: [], imageErrors: [], narration: [] };
    state.assets = {
      cover: assets.cover ?? [],
      images: assets.images ?? [],
      imageErrors: assets.imageErrors ?? [],
      narration: assets.narration ?? [],
    };
    return state;
  } catch {
    return {
      version: 1,
      taskId,
      updatedAt: new Date().toISOString(),
      steps: {},
      artifact: {},
      assets: { cover: [], images: [], imageErrors: [], narration: [] },
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
  if (artifact.musicPlan) {
    await writeFile(join(workDir, '02-music-plan.json'), JSON.stringify(artifact.musicPlan, null, 2), 'utf8');
  }
  if (artifact.characterCard) {
    await writeFile(join(workDir, '02-character-card.json'), JSON.stringify(artifact.characterCard, null, 2), 'utf8');
  }
  if (artifact.rewriteEvaluation) {
    await writeFile(join(workDir, '01-rewrite-evaluations.json'), JSON.stringify(artifact.rewriteEvaluation, null, 2), 'utf8');
  }
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
    musicPlan: input.musicPlan,
    characterCard: input.characterCard,
    rewriteEvaluation: input.rewriteEvaluation,
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
    const item = scene as Partial<StoryboardScene> & { desc_prompt?: unknown };
    const cap = requireString(item.cap, `scenes[${index}].cap`);
    return {
      id: Number(item.id ?? index + 1),
      cap,
      descPrompt: String(item.descPrompt ?? item.desc_prompt ?? cap),
      durationMs: Math.max(800, Number(item.durationMs ?? estimateSceneDurationMs(cap))),
    };
  });
}

function normalizeStoryboardResponse(input: unknown, raw = '', rewrittenCopy = ''): StoryboardScene[] {
  const anchors = extractStoryboardTailAnchors(input);
  if (anchors) {
    return normalizeStoryboardTailAnchors(anchors, rewrittenCopy, input, raw);
  }
  const scenes = extractStoryboardScenes(input);
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error(`LLM storyboard response did not include scenes.${storyboardResponseDebugHint(input, raw)}`);
  }
  return normalizeScenes(scenes);
}

function normalizeStoryboardTailAnchors(anchors: string[], rewrittenCopy: string, input: unknown, raw: string): StoryboardScene[] {
  const validationError = validateStoryboardTailAnchorArray(anchors);
  if (validationError) {
    throw new Error(`${validationError}${storyboardResponseDebugHint(input, raw)}`);
  }
  const copy = requireString(rewrittenCopy, 'rewrittenCopy');
  const extracted = extractScenesFromTailAnchors(copy, anchors);
  if (extracted.missed.length > 0) {
    throw new Error(`LLM storyboard tail anchors did not match rewritten copy: ${extracted.missed.join(' / ')}.${storyboardResponseDebugHint(input, raw)}`);
  }
  const coverageError = storyboardTextCoverageError(extracted.scenes, copy);
  if (coverageError) {
    throw new Error(`${coverageError}${storyboardResponseDebugHint(input, raw)}`);
  }
  if (extracted.scenes.length === 0) {
    throw new Error(`LLM storyboard response did not produce scenes from tail anchors.${storyboardResponseDebugHint(input, raw)}`);
  }
  return extracted.scenes;
}

function extractStoryboardTailAnchors(input: unknown): string[] | undefined {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) {
    return extractStoryboardTailAnchors(parsedInput);
  }
  if (Array.isArray(input)) {
    return input.every((item) => typeof item === 'string') ? input.map((item) => item.trim()) : undefined;
  }
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['anchors', 'tailAnchors', 'tail_anchors', 'cutAnchors', 'scenes', 'storyboard', 'storyboards', 'sceneList', 'sentences', 'shots', 'data', 'result', 'output']) {
    const anchors = extractStoryboardTailAnchors(record[key]);
    if (anchors) return anchors;
  }
  return undefined;
}

function validateStoryboardTailAnchorArray(anchors: string[]): string | null {
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return 'LLM storyboard response did not include tail anchors.';
  }
  for (let index = 0; index < anchors.length; index += 1) {
    if (typeof anchors[index] !== 'string' || anchors[index].trim().length === 0) {
      return `LLM storyboard tail anchor ${index + 1} must be a non-empty string.`;
    }
  }
  return null;
}

function extractScenesFromTailAnchors(text: string, anchors: string[]): { scenes: StoryboardScene[]; matched: number; total: number; missed: string[] } {
  const indexed: Array<{ ch: string; origIdx: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '“' && text[index] !== '”') {
      indexed.push({ ch: text[index], origIdx: index });
    }
  }
  const normalizedText = indexed.map((item) => item.ch).join('');
  const scenes: StoryboardScene[] = [];
  const missed: string[] = [];
  let originalStart = 0;
  let normalizedSearchStart = 0;

  for (const anchor of anchors) {
    const cleanAnchor = anchor.trim().replace(/[“”]/gu, '');
    if (!cleanAnchor) continue;
    let normalizedEnd: number | null = null;

    const exactIndex = normalizedText.indexOf(cleanAnchor, normalizedSearchStart);
    if (exactIndex >= 0) {
      normalizedEnd = exactIndex + cleanAnchor.length;
    }

    if (normalizedEnd === null) {
      const compactAnchor = cleanAnchor.replace(/\s+/gu, '');
      if (compactAnchor.length >= 3) {
        const nonWhitespace = normalizedCharsFrom(normalizedText, normalizedSearchStart);
        const compactIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(compactAnchor);
        if (compactIndex >= 0) {
          normalizedEnd = nonWhitespace[compactIndex + compactAnchor.length - 1].si + 1;
        }
      }
    }

    if (normalizedEnd === null) {
      const looseAnchor = cleanAnchor.replace(/[\s。！？，、；：…—\-.!?,;:]+$/gu, '').replace(/\s+/gu, '');
      if (looseAnchor.length >= 4) {
        const nonWhitespace = normalizedCharsFrom(normalizedText, normalizedSearchStart);
        const looseIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(looseAnchor);
        if (looseIndex >= 0) {
          let end = nonWhitespace[looseIndex + looseAnchor.length - 1].si;
          while (end + 1 < normalizedText.length && /[。！？，、；：…—\-.!?,;: \t]/u.test(normalizedText[end + 1])) {
            end += 1;
          }
          normalizedEnd = end + 1;
        }
      }
    }

    if (normalizedEnd === null) {
      missed.push(cleanAnchor.length > 20 ? `${cleanAnchor.slice(0, 20)}…` : cleanAnchor);
      continue;
    }

    const indexedEnd = Math.min(normalizedEnd - 1, indexed.length - 1);
    const originalEndIndex = indexed[indexedEnd]?.origIdx;
    const originalEnd = originalEndIndex === undefined ? text.length : originalEndIndex + 1;
    const cap = text.slice(originalStart, originalEnd).trim();
    if (cap) scenes.push(sceneFromCap(cap, scenes.length));
    originalStart = originalEnd;
    normalizedSearchStart = normalizedEnd;
  }

  const tail = text.slice(originalStart).trim();
  if (tail) scenes.push(sceneFromCap(tail, scenes.length));
  const total = anchors.filter((anchor) => anchor.trim()).length;
  return { scenes, matched: total - missed.length, total, missed };
}

function normalizedCharsFrom(text: string, start: number): Array<{ ch: string; si: number }> {
  const output: Array<{ ch: string; si: number }> = [];
  for (let index = start; index < text.length; index += 1) {
    if (text[index].trim()) output.push({ ch: text[index], si: index });
  }
  return output;
}

function sceneFromCap(cap: string, index: number): StoryboardScene {
  return {
    id: index + 1,
    cap,
    descPrompt: cap,
    durationMs: estimateSceneDurationMs(cap),
  };
}

function estimateSceneDurationMs(cap: string): number {
  return Math.max(1200, Math.round((countVisibleCharacters(cap) / 5) * 1000));
}

function storyboardTextCoverageError(scenes: StoryboardScene[], rewrittenCopy: string): string | null {
  const joined = normalizeTextForStoryboardCompare(scenes.map((scene) => scene.cap).join(''));
  const original = normalizeTextForStoryboardCompare(rewrittenCopy);
  if (joined === original) return null;
  let mismatchIndex = -1;
  const limit = Math.min(joined.length, original.length);
  for (let index = 0; index < limit; index += 1) {
    if (joined[index] !== original[index]) {
      mismatchIndex = index;
      break;
    }
  }
  if (mismatchIndex < 0) mismatchIndex = limit;
  const start = Math.max(0, mismatchIndex - 10);
  const end = Math.min(Math.max(joined.length, original.length), mismatchIndex + 10);
  return `Storyboard tail-anchor extraction did not preserve rewritten copy (joined ${joined.length} chars / original ${original.length} chars, diff around ${mismatchIndex}). joined="${joined.slice(start, end)}", original="${original.slice(start, end)}".`;
}

function normalizeTextForStoryboardCompare(value: string): string {
  return value.replace(/[“”]/gu, '').replace(/\s+/gu, '');
}

function extractStoryboardScenes(input: unknown): unknown {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) {
    const nested = extractStoryboardScenes(parsedInput);
    if (Array.isArray(nested)) return nested;
    if (nested !== undefined) return nested;
  }
  if (Array.isArray(input)) return input.every((item) => typeof item === 'string') ? undefined : input;
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ['scenes', 'storyboard', 'storyboards', 'sceneList', 'sentences', 'shots', '鍒嗛暅', '鍒嗛暅鍒楄〃', '闀滃ご', '闀滃ご鍒楄〃']) {
    const value = record[key];
    if (Array.isArray(value) && !value.every((item) => typeof item === 'string')) return value;
    const parsedValue = maybeParseStoryboardJson(value);
    if (parsedValue !== value) {
      const nested = extractStoryboardScenes(parsedValue);
      if (Array.isArray(nested)) return nested;
      if (nested !== undefined) return nested;
    }
  }
  for (const key of ['data', 'result', 'output']) {
    const nested = extractStoryboardScenes(record[key]);
    if (Array.isArray(nested)) return nested;
  }
  return undefined;
}

function maybeParseStoryboardJson(input: unknown): unknown {
  if (typeof input !== 'string') return input;
  const trimmed = input.trim();
  if (!trimmed) return input;
  const parsed = parseStoryboardJsonText(trimmed);
  return parsed.parsed ? parsed.value : input;
}

function parseStoryboardJsonText(text: string): { parsed: true; value: unknown } | { parsed: false } {
  const normalized = stripJsonCodeFence(text);
  for (const candidate of [normalized, ...extractStoryboardJsonCandidates(normalized)]) {
    const parsed = tryParseStoryboardJsonCandidate(candidate);
    if (parsed.parsed) return parsed;
  }
  return { parsed: false };
}

function stripJsonCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return fenced ? fenced[1].trim() : text;
}

function extractStoryboardJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const end = findBalancedJsonEnd(text, start);
    if (end >= start) candidates.push(text.slice(start, end + 1));
  }
  return candidates;
}

function findBalancedJsonEnd(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      continue;
    }
    if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function tryParseStoryboardJsonCandidate(candidate: string): { parsed: true; value: unknown } | { parsed: false } {
  const trimmed = candidate.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return { parsed: false };
  try {
    return { parsed: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    const repaired = stripTrailingJsonCommas(trimmed);
    if (repaired !== trimmed) {
      try {
        return { parsed: true, value: JSON.parse(repaired) as unknown };
      } catch {
        return { parsed: false };
      }
    }
    return { parsed: false };
  }
}

function stripTrailingJsonCommas(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  let changed = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ',') {
      const next = input.slice(index + 1).match(/\S/u)?.[0];
      if (next === '}' || next === ']') {
        changed = true;
        continue;
      }
    }
    output += char;
  }
  return changed ? output : input;
}

function storyboardResponseDebugHint(input: unknown, raw: string): string {
  const keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input as Record<string, unknown>).slice(0, 8) : [];
  const keyHint = keys.length ? ` Received keys: ${keys.join(', ')}.` : '';
  const rawPreview = raw.trim().slice(0, 300);
  return `${keyHint}${rawPreview ? ` Raw preview: ${rawPreview}` : ''}`;
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
      referenceImagePaths: referenceImagePathsForPrompt(prompt.referenceImagePaths, task),
    };
  });
}

function applyTaskReferenceImagesToPrompts(prompts: ImagePrompt[], task: Task): ImagePrompt[] {
  return prompts.map((prompt) => ({
    ...prompt,
    referenceImagePaths: referenceImagePathsForPrompt(prompt.referenceImagePaths, task),
  }));
}

function referenceImagePathsForPrompt(current: string[] | undefined, task: Task): string[] | undefined {
  const paths = [...(current ?? []), task.referenceImagePath ?? ''].map((path) => path.trim()).filter(Boolean);
  return paths.length ? Array.from(new Set(paths)) : undefined;
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

function upsertImageError(existing: TaskArtifactImageErrorPreview[], sceneId: number, message: string): TaskArtifactImageErrorPreview[] {
  const map = new Map<number, TaskArtifactImageErrorPreview>();
  for (const item of existing) map.set(item.sceneId, item);
  map.set(sceneId, { sceneId, message });
  return [...map.values()].sort((a, b) => a.sceneId - b.sceneId);
}

function removeImageErrors(existing: TaskArtifactImageErrorPreview[], sceneIds: number[]): TaskArtifactImageErrorPreview[] {
  const removal = new Set(sceneIds);
  return existing.filter((item) => !removal.has(item.sceneId));
}

function mergeNarrationAssets(existing: SceneAsset[], incoming: SceneAsset[]): SceneAsset[] {
  const map = new Map<string, SceneAsset>();
  for (const asset of existing) map.set(narrationAssetKey(asset), asset);
  for (const asset of incoming) map.set(narrationAssetKey(asset), asset);
  return [...map.values()].sort(compareNarrationAssets);
}

function narrationAssetKey(asset: SceneAsset): string {
  return [asset.sceneId, asset.turnIndex ?? '', asset.speaker ?? '', asset.path].join(':');
}

function compareNarrationAssets(a: SceneAsset, b: SceneAsset): number {
  if (a.sceneId !== b.sceneId) return a.sceneId - b.sceneId;
  const aTurn = a.turnIndex ?? Number.MAX_SAFE_INTEGER;
  const bTurn = b.turnIndex ?? Number.MAX_SAFE_INTEGER;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return a.path.localeCompare(b.path);
}

async function heartbeatTask(db: FileDatabase, taskId: string, options: RunTaskOptions, step: number, detail: string): Promise<void> {
  throwIfAborted(options.signal);
  await db.updateTask(taskId, { currentStep: step, retryFromStep: step, lastHeartbeatAt: new Date().toISOString() });
  await options.onHeartbeat?.(taskId, step, detail);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === 'string' ? reason : 'Task aborted.');
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const limit = Math.max(1, Math.min(items.length || 1, Math.floor(Number.isFinite(concurrency) ? concurrency : 1)));
  let cursor = 0;
  let firstError: unknown = null;

  async function runWorker(): Promise<void> {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, runWorker));
  if (firstError) throw firstError;
}

function firstRunnableStep(pipeline: PipelineState): number {
  for (let step = 0; step <= 6; step += 1) {
    if (pipeline.steps[String(step)]?.status !== 'completed') return step;
  }
  return 6;
}

function isStepCompleted(pipeline: PipelineState, step: number): boolean {
  return pipeline.steps[String(step)]?.status === 'completed';
}

function hasCompleteContentArtifact(pipeline: PipelineState): boolean {
  return (
    isStepCompleted(pipeline, 3) &&
    Boolean(pipeline.artifact.reviewedText) &&
    Boolean(pipeline.artifact.rewrittenCopy) &&
    Boolean(pipeline.artifact.cover) &&
    Boolean(pipeline.artifact.scenes) &&
    Boolean(pipeline.artifact.imagePrompts)
  );
}

function hasCompleteContentData(pipeline: PipelineState): boolean {
  return (
    Boolean(pipeline.artifact.reviewedText) &&
    Boolean(pipeline.artifact.rewrittenCopy) &&
    Boolean(pipeline.artifact.cover) &&
    Boolean(pipeline.artifact.scenes) &&
    Boolean(pipeline.artifact.imagePrompts)
  );
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

function safeDraftName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'storydream-draft';
}

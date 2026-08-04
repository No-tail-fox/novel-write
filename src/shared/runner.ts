import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import type { AiSourceContext, BgmItem, CharacterCard, CoverMetadata, CustomCoverTemplate, DraftTemplate, ImagePrompt, MusicPlan, PipelineArtifact, PromptStepTemplateType, PromptTemplate, RewriteEvaluationResult, SequencedTaskEvent, StoryboardScene, Task, TaskArtifactImageErrorPreview, TaskStepRerunMode } from './types';
import { buildCoverMetadata, buildSubtitleTrack, normalizeStoryboardSceneLengths } from './story';
import { characterCoverDisplayRules, isCharacterStoryTrack, resolveCoverDisplayMetadata } from './cover-copy';
import { writeJianyingDraft, type SceneAsset, type WriteJianyingDraftOptions } from './draft';
import { runStoryboundMediaSidecar, type StoryboundSidecarInput, type StoryboundSidecarResult } from './storybound-sidecar';
import type { FileDatabase } from './storage';
import type { AnthropicMessagesJsonRequest, ConfiguredJsonLlm, LlmJsonResult, LlmMessage, OpenAiCompatibleJsonRequest } from './llm-provider';
import { buildStoryboundReviewSystemPrompt, formatAiSourceContext } from './research';
import { countVisibleCharacters, normalizeStoryboardSceneCount, normalizeTargetLength, storyboardSceneCountRange, targetWordCountRange, type TargetWordCountRange } from './content-metrics';
import { normalizeDraftTemplate } from './templates';
import { buildPromptRenderContext, renderPromptTemplate, selectStepPromptTemplate, selectTaskPromptTemplate, type PromptRenderContext } from './prompt-templates';
import { defaultCustomStyles } from './config';
import { copyPersonMaterialsForScenes } from './person-assets';
import { withPipelineStateLock } from './pipeline-cache';
import { isOrdinaryTask, resolveOrdinaryCoverTemplate } from '../features/tasks/task-control-manifest';
import { taskTerminalStep } from './task-progress';
import { ORDINARY_TASK_COVER_PAGE_DURATION_MS, validateOrdinaryTaskCoverAsset } from './ordinary-task-cover';

export interface RunTaskOptions {
  appDataDir: string;
  workDir: string;
  onEvent?: (event: SequencedTaskEvent) => void;
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
  jsonRoot?: 'object' | 'array';
  anthropicToolInputSchema?: Record<string, unknown>;
}

interface RenderedStepPrompt {
  template: PromptTemplate | null;
  content: string;
}

type TaskEventEmitter = (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;

const storyboardSceneSplittingRules = [
  '影视分镜拆分硬规则：',
  '1. 只切分，不改写；所有分镜 cap 顺序拼接后必须完整还原最终成稿。',
  '2. 第一完整句单独作为开场分镜；后续每个分镜承载同一画面的 1-3 个完整句。',
  '3. 每个分镜推荐 25-45 个中文字符，绝对不得超过 55 个字符；少于 15 字的片段通常与相邻画面合并。',
  '4. 保留完整主语、动作、因果和情绪，不按每个逗号机械切镜。',
  '5. 每项仅输出该分镜末尾连续 10-20 个原文字符作为尾部锚点。',
].join('\n');

const storyboardTailAnchorSystemPrompt = [
  '只输出一个 JSON 字符串数组，每项是最终成稿中的分镜尾部锚点。不要输出 JSON 对象、解释或 Markdown。',
  storyboardSceneSplittingRules,
].join('\n');

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
const storyboardFormatAttempts = 3;
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
  required: ['rewrittenCopy'],
  additionalProperties: false,
  properties: {
    rewrittenCopy: stringJsonSchema,
  },
};
const coverMetadataOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['cover'],
  additionalProperties: false,
  properties: {
    cover: coverOutputJsonSchema,
  },
};
const rewriteEvaluationOutputJsonSchema: Record<string, unknown> = {
  type: 'object',
  required: ['bestRound', 'evaluations'],
  additionalProperties: false,
  properties: {
    bestRound: { type: 'number' },
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['round', 'score', 'reason'],
        additionalProperties: false,
        properties: {
          round: { type: 'number' },
          score: { type: 'number' },
          reason: stringJsonSchema,
        },
      },
    },
    wordCountWarning: stringJsonSchema,
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
  const workDir = requireManagedWorkDir(options);
  const statePath = join(workDir, 'pipeline', 'state.json');
  return withPipelineStateLock(statePath, () => runTaskWithPipelineStateLock(db, task, options));
}

async function runTaskWithPipelineStateLock(db: FileDatabase, task: Task, options: RunTaskOptions): Promise<Task> {
  if (task.taskType === 'html-video') {
    const message = 'HTML 动画视频由独立流水线处理，不能进入普通 Storybound 成片 runner。';
    await db.updateTask(task.id, {
      status: 'paused',
      currentStep: task.currentStep,
      errorMessage: message,
      failedStep: null,
      retryFromStep: null,
      lastHeartbeatAt: new Date().toISOString(),
    });
    const event = await db.addTaskEvent(task.id, {
      type: 'step_error',
      step: null,
      agent: 'HTML Video',
      detail: message,
      runGeneration: task.runGeneration,
    });
    options.onEvent?.(event);
    throw new Error(message);
  }

  const workDir = requireManagedWorkDir(options);
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
    const event = await db.addTaskEvent(task.id, {
      type,
      step,
      agent,
      detail,
      dataJson: data === undefined ? null : JSON.stringify(data),
      runGeneration: task.runGeneration,
    });
    options.onEvent?.(event);
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
    const musicMvAudioDurationMs = task.taskKind === 'music-mv'
      ? await probeMusicMvAudio(task, options, workDir)
      : undefined;
    await ensureContentArtifact({ db, task, options, workDir, emit, markStep, pipeline, musicMvAudioDurationMs });
    const artifact = hydrateArtifact(pipeline.artifact, task);
    if (task.processingMode === 'clip-only') {
      const completedAt = new Date().toISOString();
      await db.updateTask(task.id, {
        status: 'completed',
        currentStep: taskTerminalStep(task),
        completedAt,
        outputDir: workDir,
        errorMessage: '',
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: statePath,
        lastHeartbeatAt: new Date().toISOString(),
      });
      await emit('step_complete', 3, 'Prompt', 'Clip-only task completed after content artifacts');
      return { ...task, status: 'completed', currentStep: taskTerminalStep(task), completedAt, outputDir: workDir, errorMessage: '', failedStep: null, retryFromStep: null, artifactStatePath: statePath, startedAt, lastHeartbeatAt: new Date().toISOString() };
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
      const latestTask = state.tasks.find((item) => item.id === task.id);
      const draftTask = latestTask
        ? { ...task, templateId: latestTask.templateId, bgmId: latestTask.bgmId }
        : task;
      const bgm = resolveBgm(state.config.jianying.bgmLibrary, draftTask.bgmId);
      const template = state.draftTemplates.find((item) => item.id === draftTask.templateId);
      const normalizedTemplate = template ? normalizeDraftTemplate(template) : undefined;
      const draft =
        task.taskKind === 'music-mv'
          ? await writeMusicMvSidecarDraft({
            task: draftTask,
            artifact,
            workDir,
            draftRootDir: state.config.jianying.draftPath,
            template: normalizedTemplate,
            generatedImages: pipeline.assets.images,
            coverImagePath: pipeline.assets.cover[0]?.path,
            bgm,
            runSidecar: options.mediaSidecar ?? runStoryboundMediaSidecar,
          })
          : await writeJianyingDraft(
            {
              workDir,
              draftRootDir: state.config.jianying.draftPath,
              title: task.title || todayTitle(task.inputText),
              cover: artifact.cover,
              ratio: task.ratio,
              templateId: draftTask.templateId,
              template: normalizedTemplate,
              scenes: artifact.scenes,
              subtitles: artifact.subtitles,
              imagePrompts: artifact.imagePrompts,
              reviewedText: artifact.reviewedText,
              rewrittenCopy: artifact.rewrittenCopy,
              generatedImages: pipeline.assets.images,
              coverImagePath: pipeline.assets.cover[0]?.path,
              coverPage: task.coverPageEnabled ? {
                imagePath: requireOrdinaryCoverPageImage(task, pipeline.assets.cover[0]?.path),
                text: task.coverPageText ?? '',
                durationMs: ORDINARY_TASK_COVER_PAGE_DURATION_MS,
              } : undefined,
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

    const draftDir = pipeline.draft?.draftDir ?? pipeline.steps['6']?.outputPath ?? workDir;
    if (pipeline.rerun) {
      delete pipeline.rerun;
      await save();
    }
    const completedAt = new Date().toISOString();
    await db.updateTask(task.id, {
      status: 'completed',
      currentStep: taskTerminalStep(task),
      completedAt,
      outputDir: draftDir,
      errorMessage: '',
      failedStep: null,
      retryFromStep: null,
      artifactStatePath: statePath,
      lastHeartbeatAt: new Date().toISOString(),
    });
    return { ...task, status: 'completed', currentStep: taskTerminalStep(task), completedAt, outputDir: draftDir, errorMessage: '', failedStep: null, retryFromStep: null, artifactStatePath: statePath, startedAt, lastHeartbeatAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof CheckpointPause) {
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
      await emit('checkpoint_pause', error.step, stepAgents[error.step] ?? null, error.message, { retryFromStep: error.step });
      throw error;
    }
    const latestTask = (await db.getState()).tasks.find((item) => item.id === task.id);
    const step = latestTask?.currentStep ?? activeStep ?? firstRunnableStep(pipeline);
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = /cancel|取消/i.test(message);
    await markStep(step, 'failed', { error: message });
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
    await emit('step_error', step, stepAgents[step] ?? null, message);
    throw error;
  }
}

function requireManagedWorkDir(options: RunTaskOptions): string {
  const workDir = options.workDir;
  if (!workDir) throw new Error('MANAGED_WORK_DIR_REQUIRED: Task runner requires a canonical managed work directory.');
  return workDir;
}

async function ensureContentArtifact(input: {
  db: FileDatabase;
  task: Task;
  options: RunTaskOptions;
  workDir: string;
  emit: (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => Promise<void>;
  markStep: (step: number, status: StepStatus, patch?: Partial<PipelineState['steps'][string]>) => Promise<void>;
  pipeline: PipelineState;
  musicMvAudioDurationMs?: number;
}): Promise<void> {
  const { db, task, options, workDir, emit, markStep, pipeline } = input;
  throwIfAborted(options.signal);
  const appState = await db.getState();
  const subtitleMaxCharsPerLine = appState.draftTemplates.find((template) => template.id === task.templateId)?.caption.maxCharsPerLine ?? 12;
  if (hasCompleteContentArtifact(pipeline)) {
    const artifact = hydrateArtifact(pipeline.artifact, task, subtitleMaxCharsPerLine);
    pipeline.artifact.subtitles = artifact.subtitles;
    await writeContentArtifacts(workDir, artifact, task);
    return;
  }
  if (hasCompleteContentData(pipeline)) {
    const artifact = hydrateArtifact(pipeline.artifact, task, subtitleMaxCharsPerLine);
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
      subtitles: buildSubtitleTrack(artifact.scenes, { maxCharsPerLine: subtitleMaxCharsPerLine }),
      sourceContext: sourceContext ?? artifact.sourceContext,
    };
    await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact, task, subtitleMaxCharsPerLine), task);
    for (const step of [0, 1, 2, 3]) {
      await db.updateTask(task.id, { currentStep: step, retryFromStep: step });
      await markStep(step, 'completed', { outputPath: contentOutputPath(workDir, step) });
      await heartbeatTask(db, task.id, options, step, `content step ${step} completed`);
    }
    return;
  }
  if (task.taskKind === 'music-mv') {
    const musicArtifact = buildMusicMvArtifact(task, sourceContext ?? undefined, input.musicMvAudioDurationMs);
    pipeline.artifact = {
      ...musicArtifact,
      subtitles: buildSubtitleTrack(musicArtifact.scenes, { maxCharsPerLine: subtitleMaxCharsPerLine }),
    };
    await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact, task, subtitleMaxCharsPerLine), task);
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
    const reviewSystemPrompt = buildStoryboundReviewSystemPrompt(
      task,
      Boolean(sourceContext?.sections.length || task.inputText.trim()),
    );
    const review = await runLlmJson<{ reviewedText: string }>(options.llm, {
      step: 0,
      name: 'review',
      signal: options.signal,
      anthropicToolInputSchema: reviewOutputJsonSchema,
      messages: [
        { role: 'system', content: reviewSystemPrompt },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Template instructions:',
            reviewPrompt,
            extraRequirementsInstruction(task, reviewPrompt),
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
    await emit('step_start', 1, 'Writer', '标准改写 + 自评迭代');
    const reviewedText = requireString(pipeline.artifact.reviewedText, 'reviewedText');
    const controlPlan = prepareRewriteControls(task, reviewedText);
    const rewriteTask = effectiveRewriteTask(task, controlPlan);
    const rewritePromptContext = buildPromptRenderContext({
      task: rewriteTask,
      taskTemplate,
      customStyles: appState.customStyles,
      sourceContext,
      artifact: { ...pipeline.artifact, reviewedText: controlPlan.reviewedTextForRewrite },
    });
    const rewritePrompt = renderStepPrompt(promptTemplates, 'rewrite', rewritePromptContext, controlPlan.reviewedTextForRewrite);
    const rewrite = await runRewriteRounds(options.llm, {
      task: rewriteTask,
      rewritePrompt,
      reviewedText: controlPlan.reviewedTextForRewrite,
      signal: options.signal,
      rerunContext: rewriteContextForStep(pipeline, 1),
      emit,
    });
    pipeline.artifact.rewrittenCopy = applyFinalRewriteControls(rewrite.rewrittenCopy, task, controlPlan);
    pipeline.artifact.rewriteEvaluation = rewrite.evaluation;
    const coverPromptContext = buildPromptRenderContext({
      task,
      taskTemplate,
      customStyles: appState.customStyles,
      sourceContext,
      artifact: pipeline.artifact,
    });
    const coverPrompt = joinPromptBlocks([
      renderStepPrompt(promptTemplates, 'cover', coverPromptContext, ''),
      productInfoRewriteBlock(task),
    ]);
    pipeline.artifact.cover = await generateCoverMetadata(options.llm, {
      coverPrompt,
      rewrittenCopy: pipeline.artifact.rewrittenCopy,
      track: task.track,
      signal: options.signal,
      emit,
    });
    await writeFile(join(workDir, '01-rewritten-copy.md'), pipeline.artifact.rewrittenCopy, 'utf8');
    await writeFile(join(workDir, '00-cover-title.json'), JSON.stringify(pipeline.artifact.cover, null, 2), 'utf8');
    await writeFile(join(workDir, '01-rewrite-evaluations.json'), JSON.stringify(pipeline.artifact.rewriteEvaluation, null, 2), 'utf8');
    if (pipeline.artifact.rewriteEvaluation.wordCountWarning) {
      await emit('step_warning', 1, 'Writer', pipeline.artifact.rewriteEvaluation.wordCountWarning, pipeline.artifact.rewriteEvaluation);
    }
    await markStep(1, 'completed', { outputPath: join(workDir, '01-rewritten-copy.md') });
    await heartbeatTask(db, task.id, options, 1, 'LLM rewrite completed');
    await emit('step_complete', 1, 'Writer', `最终成稿与封面信息已生成（${pipeline.artifact.rewrittenCopy.length} 字 · 3 轮取最优，采用第 ${pipeline.artifact.rewriteEvaluation.bestRound} 轮）`, { evaluation: pipeline.artifact.rewriteEvaluation });
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
    const storyboardSceneCount = normalizeStoryboardSceneCount(task.targetScenes);
    const storyboardPrompt = renderStepPrompt(promptTemplates, 'storyboard', promptContext(), rewrittenCopy);
    let storyboardScenes: StoryboardScene[] | null = null;
    let storyboardRequestId: string | null = null;
    let storyboardFailure = '未知错误';
    for (let attempt = 1; attempt <= storyboardFormatAttempts; attempt += 1) {
      try {
        const storyboard = await runLlmJson<unknown>(options.llm, {
          step: 2,
          name: attempt === 1 ? 'storyboard' : `storyboard-format-retry-${attempt}`,
          signal: options.signal,
          jsonRoot: 'array',
          messages: [
            { role: 'system', content: storyboardTailAnchorSystemPrompt },
            {
              role: 'user',
              content: joinPromptBlocks([
                'Storyboard instructions:',
                storyboardPrompt,
                extraRequirementsInstruction(task, storyboardPrompt),
                taskModeInstructions(task),
                'Rewritten copy:',
                rewrittenCopy,
                storyboardSceneSplittingRules,
                rewriteContextForStep(pipeline, 2),
                attempt > 1
                  ? `上次分镜尝试失败：${storyboardFailure.slice(0, 300)}\n请修复该问题，只输出 JSON 字符串数组。`
                  : '',
              ]),
            },
          ],
        });
        storyboardScenes = normalizeStoryboardResponse(storyboard.json, storyboard.raw, rewrittenCopy);
        storyboardRequestId = storyboard.requestId;
        break;
      } catch (error) {
        if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        storyboardFailure = error instanceof Error ? error.message : String(error);
        if (attempt < storyboardFormatAttempts) {
          await emit('step_progress', 2, 'Storyboard', `第 ${attempt} 次分镜格式校验未通过，正在自动重试`, {
            attempt,
            error: storyboardFailure.slice(0, 300),
          });
        }
      }
    }
    if (!storyboardScenes) {
      throw new Error(`Step 2 分镜失败：${storyboardFailure}`);
    }
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
    await emit('step_complete', 2, 'Storyboard', `分镜 ${pipeline.artifact.scenes.length} 个`, { requestId: storyboardRequestId });
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
  pipeline.artifact.subtitles = buildSubtitleTrack(pipeline.artifact.scenes, { maxCharsPerLine: subtitleMaxCharsPerLine });
  await writeContentArtifacts(workDir, hydrateArtifact(pipeline.artifact, task, subtitleMaxCharsPerLine), task);
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

function extraRequirementsInstruction(task: Task, existingPrompt = ''): string {
  const requirements = task.extraRequirements?.trim() ?? '';
  if (!requirements) return '';
  if (existingPrompt.includes(requirements)) return '';
  if (existingPrompt.includes('用户额外要求：')) return '';
  return [
    '用户额外要求：',
    requirements,
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

function isStoryboardSceneCountAcceptable(scenes: StoryboardScene[], targetSceneCount: number | null | undefined, rewrittenCopy = ''): boolean {
  const range = storyboardSceneCountRange(rewrittenCopy, targetSceneCount);
  return scenes.length >= range.min && scenes.length <= range.max;
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
    jsonRoot: request.jsonRoot,
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

interface RewriteControlPlan {
  reviewedTextForRewrite: string;
  lockedIntro: string;
  applyTaskFixedIntro: boolean;
}

function prepareRewriteControls(task: Task, reviewedText: string): RewriteControlPlan {
  if (isDialogueScript(task)) return { reviewedTextForRewrite: reviewedText, lockedIntro: '', applyTaskFixedIntro: false };
  const lockIntroSentences = clampIntroSentenceCount(task.lockIntroSentences);
  if (lockIntroSentences <= 0) return { reviewedTextForRewrite: reviewedText, lockedIntro: '', applyTaskFixedIntro: true };
  const split = splitLeadingSentences(reviewedText, lockIntroSentences);
  if (!split.remainder.trim()) return { reviewedTextForRewrite: reviewedText, lockedIntro: '', applyTaskFixedIntro: false };
  return {
    reviewedTextForRewrite: split.remainder,
    lockedIntro: task.fixedIntro?.trim() || split.leading,
    applyTaskFixedIntro: true,
  };
}

function effectiveRewriteTask(task: Task, controlPlan: RewriteControlPlan): Task {
  const adjustedTargetLength = adjustedRewriteTargetLength(task, controlPlan);
  if (adjustedTargetLength === task.targetLength) return task;
  return {
    ...task,
    targetLength: adjustedTargetLength,
  };
}

function adjustedRewriteTargetLength(task: Task, controlPlan: RewriteControlPlan): number | undefined {
  if (task.targetLength === undefined || task.targetLength === null) return task.targetLength;
  const targetLength = normalizeTargetLength(task.targetLength);
  if (!targetLength) return task.targetLength;
  const controlLength = finalRewriteControlVisibleLength(task, controlPlan);
  if (controlLength <= 0) return task.targetLength;
  return Math.min(targetLength, Math.max(100, targetLength - controlLength));
}

function finalRewriteControlVisibleLength(task: Task, controlPlan: RewriteControlPlan): number {
  if (isDialogueScript(task)) return 0;
  const intro = controlPlan.lockedIntro.trim() || (controlPlan.applyTaskFixedIntro ? task.fixedIntro?.trim() : '') || '';
  const outroTemplate = task.outroCta?.trim() ?? '';
  const protagonist = task.title.trim() || '主角';
  const outro = outroTemplate ? outroTemplate.replace(/\{主角\}/g, protagonist) : '';
  return countVisibleCharacters(joinPromptBlocks([intro, outro]));
}

function splitLeadingSentences(text: string, count: number): { leading: string; remainder: string } {
  if (count <= 0) return { leading: '', remainder: text };
  const sentenceEnd = /[。！？；!?;]/g;
  let endIndex = 0;
  let sentencesFound = 0;
  for (let match = sentenceEnd.exec(text); match && sentencesFound < count; match = sentenceEnd.exec(text)) {
    sentencesFound += 1;
    endIndex = match.index + match[0].length;
  }
  if (sentencesFound < count) return { leading: text.trim(), remainder: '' };
  return {
    leading: text.slice(0, endIndex).trim(),
    remainder: text.slice(endIndex).trim(),
  };
}

function productInfoRewriteBlock(task: Task): string {
  if (!task.keepPromotion) return '';
  const raw = task.productInfo?.trim();
  if (!raw) return '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const product = parsed as Record<string, unknown>;
  const name = productInfoValue(product.name);
  if (!name) return '';
  const author = productInfoValue(product.author);
  const category = productInfoValue(product.category ?? product.cat);
  const keyword = productInfoValue(product.keyword ?? product.kw);
  const audience = productInfoValue(product.audience);
  const persons = productInfoValue(product.persons);
  const era = productInfoValue(product.era);
  const price = productInfoValue(product.price);
  const url = productInfoValue(product.url);
  const note = productInfoValue(product.note);
  const sellPoint = productInfoValue(product.sellPoint ?? product.sellpt);
  return joinPromptBlocks([
    '本视频带货商品：',
    `商品名称：${name}`,
    category ? `类别：${category}` : '',
    keyword ? `关键词：${keyword}` : '',
    author ? `作者：${author}` : '',
    persons ? `相关人物：${persons}` : '',
    era ? `时代：${era}` : '',
    audience ? `受众：${audience}` : '',
    price ? `价格：${price}` : '',
    url ? `链接：${url}` : '',
    sellPoint ? `卖点：${sellPoint}` : '',
    note ? `备注：${note}` : '',
  ]);
}

function applyFinalRewriteControls(copy: string, task: Task, controlPlan: RewriteControlPlan): string {
  if (isDialogueScript(task)) return copy;
  const intro = controlPlan.lockedIntro.trim() || (controlPlan.applyTaskFixedIntro ? task.fixedIntro?.trim() : '') || '';
  const outroTemplate = task.outroCta?.trim() ?? '';
  const protagonist = task.title.trim() || task.aiKeyword.trim() || '主角';
  const outro = outroTemplate ? outroTemplate.replace(/\{主角\}/g, protagonist) : '';
  if (!intro && !outro) return copy;
  return joinPromptBlocks([intro, copy, outro]);
}

function clampIntroSentenceCount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(20, Math.max(0, Math.round(parsed)));
}

function productInfoValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isDialogueScript(task: Task): boolean {
  return task.scriptFormat === 'dialogue' || task.videoForm === 'two-host-podcast';
}

function buildRewriteRoundPrompt(input: { task: Task; rewritePrompt: string; reviewedText: string; rerunContext?: string }, round: number, previousDraft?: string): string {
  return joinPromptBlocks([
    `Rewrite round: ${round}/3`,
    round === 1 ? 'Reviewed text:' : `Current draft to improve (round ${round - 1} result):`,
    round === 1 ? input.reviewedText : previousDraft ?? '',
    productInfoRewriteBlock(input.task),
    'Rewrite instructions:',
    input.rewritePrompt,
    extraRequirementsInstruction(input.task, input.rewritePrompt),
    taskModeInstructions(input.task),
    input.rerunContext ?? '',
  ]);
}

function buildRewriteEvaluationPrompt(input: { task: Task; rewritePrompt: string; reviewedText: string; rerunContext?: string }, candidates: Array<{ round: number; rewrittenCopy: string }>): string {
  return joinPromptBlocks([
    'Rewrite evaluation.',
    'Select the best rewrite round and return the round number, per-round scores, and short reasons.',
    productInfoRewriteBlock(input.task),
    'Rewrite instructions:',
    input.rewritePrompt,
    extraRequirementsInstruction(input.task, input.rewritePrompt),
    taskModeInstructions(input.task),
    'Reviewed text:',
    input.reviewedText,
    ...candidates.flatMap((candidate) => [
      `Round ${candidate.round} rewritten copy:`,
      candidate.rewrittenCopy,
    ]),
    input.rerunContext ?? '',
  ]);
}

function selectBestRewriteCandidate(
  candidates: Array<{ round: number; rewrittenCopy: string; cover?: CoverMetadata; requestId: string | null }>,
  evaluation: Partial<RewriteEvaluationResult> | null | undefined,
): { candidate: { round: number; rewrittenCopy: string; cover?: CoverMetadata; requestId: string | null }; evaluation: RewriteEvaluationResult } {
  const incomingEvaluations = Array.isArray(evaluation?.evaluations) ? evaluation.evaluations : [];
  const scoresByRound = new Map<number, { score: number; reason: string }>();
  for (const item of incomingEvaluations) {
    scoresByRound.set(item.round, { score: item.score, reason: item.reason });
  }
  const normalizedEvaluations = candidates.map((candidate) => {
    const current = scoresByRound.get(candidate.round);
    return {
      round: candidate.round,
      score: current?.score ?? candidate.round,
      reason: current?.reason ?? `Round ${candidate.round} fallback selected.`,
    };
  });
  let selectedCandidate = typeof evaluation?.bestRound === 'number'
    ? candidates.find((candidate) => candidate.round === evaluation.bestRound)
    : undefined;
  if (!selectedCandidate) {
    if (!candidates.length) {
      throw new Error('No rewrite candidates available.');
    }
    let fallbackCandidate = candidates[0];
    for (const candidate of candidates) {
      const candidateScore = normalizedEvaluations.find((item) => item.round === candidate.round)?.score ?? 0;
      const selectedScore = normalizedEvaluations.find((item) => item.round === fallbackCandidate.round)?.score ?? 0;
      if (candidateScore > selectedScore || (candidateScore === selectedScore && candidate.round > fallbackCandidate.round)) {
        fallbackCandidate = candidate;
      }
    }
    selectedCandidate = fallbackCandidate;
  }
  const normalizedEvaluation: RewriteEvaluationResult = {
    bestRound: selectedCandidate.round,
    evaluations: normalizedEvaluations,
    wordCountWarning: evaluation?.wordCountWarning,
  };
  return { candidate: selectedCandidate, evaluation: normalizedEvaluation };
}

async function runRewriteRounds(
  llm: ConfiguredJsonLlm,
  input: { task: Task; rewritePrompt: string; reviewedText: string; signal?: AbortSignal; rerunContext?: string; emit?: TaskEventEmitter },
): Promise<{ rewrittenCopy: string; evaluation: RewriteEvaluationResult }> {
  const candidates: Array<{ round: number; rewrittenCopy: string; cover?: CoverMetadata; requestId: string | null }> = [];
  for (let round = 1; round <= 3; round += 1) {
    await input.emit?.('step_detail', 1, 'Writer', round === 1 ? '第 1 轮改写中...' : `打磨第 ${round} 轮中...`, { round });
    const rewrite = await runLlmJson<{ rewrittenCopy: string }>(llm, {
      step: 1,
      name: `rewrite-round-${round}`,
      signal: input.signal,
      anthropicToolInputSchema: rewriteOutputJsonSchema,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: {"rewrittenCopy": string}.' },
        {
          role: 'user',
          content: buildRewriteRoundPrompt(input, round, candidates[candidates.length - 1]?.rewrittenCopy),
        },
      ],
    });
    const candidate = {
      round,
      rewrittenCopy: requireString(rewrite.json.rewrittenCopy, `rewrite round ${round}.rewrittenCopy`),
      requestId: rewrite.requestId,
    };
    candidates.push(candidate);
    await input.emit?.('step_detail', 1, 'Writer', `第 ${round} 轮自评完成`, {
      round,
      requestId: candidate.requestId,
      rewrittenCopyLength: countVisibleCharacters(candidate.rewrittenCopy),
    });
  }
  const rewriteEvaluation = await runLlmJson<RewriteEvaluationResult>(llm, {
    step: 1,
    name: 'rewrite-evaluation',
    signal: input.signal,
    anthropicToolInputSchema: rewriteEvaluationOutputJsonSchema,
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"bestRound": number, "evaluations": [{"round": number, "score": number, "reason": string}], "wordCountWarning"?: string}.' },
      {
        role: 'user',
        content: buildRewriteEvaluationPrompt(input, candidates),
      },
    ],
  });
  const { candidate: selected, evaluation } = selectBestRewriteCandidate(candidates, rewriteEvaluation.json);
  await input.emit?.('step_detail', 1, 'Writer', `已迭代 3 轮，采用最优版本（第 ${selected.round} 轮）`, {
    bestRound: selected.round,
    evaluations: evaluation.evaluations,
  });
  const targetRange = targetWordCountRange(input.task.targetLength, input.reviewedText);
  const selectedLength = countVisibleCharacters(selected.rewrittenCopy);
  if (targetRange && !isTargetWordCountInRange(selectedLength, targetRange)) {
    return repairRewriteToTargetLength(llm, {
      task: input.task,
      rewritePrompt: input.rewritePrompt,
      current: selected,
      targetRange,
      signal: input.signal,
      evaluation,
    });
  }
  return {
    rewrittenCopy: selected.rewrittenCopy,
    evaluation,
  };
}

async function generateCoverMetadata(
  llm: ConfiguredJsonLlm,
  input: { coverPrompt: string; rewrittenCopy: string; track: string; signal?: AbortSignal; emit?: TaskEventEmitter },
): Promise<CoverMetadata> {
  await input.emit?.('step_detail', 1, 'Writer', '生成封面标题与种子留言...');
  const cover = await runLlmJson<{ cover: CoverMetadata }>(llm, {
    step: 1,
    name: 'cover-metadata',
    signal: input.signal,
    anthropicToolInputSchema: coverMetadataOutputJsonSchema,
    messages: [
      { role: 'system', content: 'Return strict JSON only. Schema: {"cover": {"title": string, "subtitle": string[], "summary": string, "tags": string[], "comments": string[]}}.' },
      {
        role: 'user',
        content: joinPromptBlocks([
          'Cover metadata generation.',
          'Cover instructions:',
          input.coverPrompt,
          isCharacterStoryTrack(input.track) ? characterCoverDisplayRules : '',
          'Final rewritten copy:',
          input.rewrittenCopy,
        ]),
      },
    ],
  });
  const result = cover.json && typeof cover.json === 'object' ? cover.json as { cover?: unknown } : {};
  try {
    return resolveCoverDisplayMetadata(normalizeCover(result.cover), { track: input.track, sourceText: input.rewrittenCopy });
  } catch {
    return resolveCoverDisplayMetadata(buildCoverMetadata(input.rewrittenCopy), { track: input.track, sourceText: input.rewrittenCopy });
  }
}

async function repairRewriteToTargetLength(
  llm: ConfiguredJsonLlm,
  input: {
    task: Task;
    rewritePrompt: string;
    current: { round: number; rewrittenCopy: string; cover?: CoverMetadata; requestId: string | null };
    targetRange: TargetWordCountRange;
    signal?: AbortSignal;
    evaluation: RewriteEvaluationResult;
  },
): Promise<{ rewrittenCopy: string; evaluation: RewriteEvaluationResult }> {
  let current = input.current;
  let currentLength = countVisibleCharacters(current.rewrittenCopy);
  const rangeLabel = targetWordCountRangeLabel(input.targetRange);
  for (let attempt = 1; attempt <= rewriteTargetLengthRepairAttempts && !isTargetWordCountInRange(currentLength, input.targetRange); attempt += 1) {
    const isTooShort = currentLength < input.targetRange.min;
    const deficit = Math.max(0, input.targetRange.min - currentLength);
    const surplus = Math.max(0, currentLength - input.targetRange.max);
    const minimumAddition = deficit + rewriteTargetLengthRepairBuffer;
    const repairReason = targetWordCountFailureReason(currentLength, input.targetRange);
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
    const repair = await runLlmJson<{ rewrittenCopy: string }>(llm, {
      step: 1,
      name: `rewrite-target-length-repair-${attempt}`,
      signal: input.signal,
      anthropicToolInputSchema: rewriteOutputJsonSchema,
      messages: [
        { role: 'system', content: 'Return strict JSON only. Schema: {"rewrittenCopy": string}.' },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Target-length repair rewrite.',
            `Target word count range: ${rangeLabel} Chinese characters.`,
            `Current draft length: ${currentLength} Chinese characters.`,
            repairReason,
            ...repairGuidance,
            productInfoRewriteBlock(input.task),
            'Rewrite instructions:',
            input.rewritePrompt,
            extraRequirementsInstruction(input.task, input.rewritePrompt),
            taskModeInstructions(input.task),
            draftLabel,
            current.rewrittenCopy,
          ]),
        },
      ],
    });
    current = {
      round: current.round,
      rewrittenCopy: requireString(repair.json.rewrittenCopy, `rewrite target-length repair ${attempt}.rewrittenCopy`),
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
    targetSceneCount: number | null;
    signal?: AbortSignal;
    rerunContext?: string;
  },
): Promise<StoryboardScene[]> {
  let current = input.current;
  let currentCount = current.length;
  for (let attempt = 1; attempt <= 2 && !isStoryboardSceneCountAcceptable(current, input.targetSceneCount, input.rewrittenCopy); attempt += 1) {
    const range = storyboardSceneCountRange(input.rewrittenCopy, input.targetSceneCount);
    const repair = await runLlmJson<unknown>(llm, {
      step: 2,
      name: `storyboard-target-scenes-repair-${attempt}`,
      signal: input.signal,
      jsonRoot: 'array',
      messages: [
        { role: 'system', content: storyboardTailAnchorSystemPrompt },
        {
          role: 'user',
          content: joinPromptBlocks([
            'Target-scene repair storyboard.',
            input.targetSceneCount ? `Hard target storyboard scene count: ${input.targetSceneCount}.` : `Automatic storyboard scene count target: about ${range.target}.`,
            `Current storyboard scene count: ${currentCount}.`,
            `Acceptable range: ${range.min}-${range.max} scenes.`,
            'Storyboard instructions:',
            input.storyboardPrompt,
            taskModeInstructions(input.task),
            'Rewritten copy:',
            input.rewrittenCopy,
            storyboardSceneSplittingRules,
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

function buildMusicMvArtifact(task: Task, sourceContext?: AiSourceContext, audioDurationMs?: number): PipelineArtifact {
  const musicPlan = buildMusicMvPlan(task, audioDurationMs);
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
  bgm?: BgmItem | null;
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
    const planSegment = input.artifact.musicPlan?.segments.find((segment) => segment.id === scene.id);
    const startUs = (planSegment?.startMs ?? input.artifact.scenes.slice(0, index).reduce((sum, item) => sum + Math.max(800, item.durationMs), 0)) * 1000;
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
    audio_duration: Math.max(0.001, (input.artifact.musicPlan?.audioDurationMs ?? input.artifact.scenes.reduce((sum, scene) => sum + Math.max(800, scene.durationMs), 0)) / 1000),
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
    bgm_path: input.bgm?.path,
    ratio: input.task.ratio,
    canvas: input.template?.canvas,
    caption_style: input.task.musicMv.captionStyle,
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

export function buildMusicMvPlan(task: Task, audioDurationMs = 0): MusicPlan {
  const lines = task.inputText
    .replace(/\r/g, '')
    .split(/\n|(?<=[。！？!?；;])/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const requestedScenes = normalizeStoryboardSceneCount(task.targetScenes ?? task.storyboardSceneCount) ?? 60;
  const parsed = (lines.length ? lines : [task.title || '音乐MV']).map((line) => {
    const match = line.match(/^\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]\s*(.+)$/u);
    return { lyric: match?.[3]?.trim() || line, startMs: match ? (Number(match[1]) * 60 + Number(match[2])) * 1000 : null };
  }).slice(0, requestedScenes);
  const lyrics = parsed.map((item) => item.lyric);
  const durationByMode = task.musicMv.rhythmMode === 'fast-cut' ? 1600 : task.musicMv.rhythmMode === 'slow-cinematic' ? 3600 : 2400;
  const effectiveDurationMs = audioDurationMs > 0 ? audioDurationMs : durationByMode * lyrics.length;
  const timed = parsed.every((item) => item.startMs !== null);
  return {
    rhythmMode: task.musicMv.rhythmMode,
    captionStyle: task.musicMv.captionStyle,
    visualMotif: task.musicMv.visualMotif,
    audioPath: task.musicMv.audioPath,
    audioDurationMs: effectiveDurationMs,
    segments: lyrics.map((lyric, index) => {
      const startMs = timed ? Math.min(effectiveDurationMs, parsed[index].startMs ?? 0) : Math.round(effectiveDurationMs * index / lyrics.length);
      const nextStartMs = timed && index + 1 < lyrics.length
        ? Math.min(effectiveDurationMs, parsed[index + 1].startMs ?? effectiveDurationMs)
        : timed ? effectiveDurationMs : Math.round(effectiveDurationMs * (index + 1) / lyrics.length);
      return {
      id: index + 1,
      lyric,
      section: musicSection(index, lyrics.length),
      startMs,
      durationMs: Math.max(1, nextStartMs - startMs),
      visualHint: `${task.musicMv.visualMotif || '围绕歌词情绪'}，镜头跟随歌词 "${lyric}"`,
      };
    }),
  };
}

async function probeMusicMvAudio(task: Task, options: RunTaskOptions, workDir: string): Promise<number> {
  const audioPath = task.musicMv.audioPath.trim();
  if (!audioPath) throw new Error('Music MV audio validation failed: select a local song audio file.');
  try {
    const result = await (options.mediaSidecar ?? runStoryboundMediaSidecar)({ mode: 'probe_media', work_dir: workDir, media_path: audioPath });
    if (!result.success || result.has_audio === false || !Number.isFinite(result.duration) || Number(result.duration) <= 0) {
      throw new Error(result.error || 'audio duration is unavailable');
    }
    return Number(result.duration) * 1000;
  } catch (error) {
    throw new Error(`Music MV audio validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  if (isOrdinaryTask(task) && task.coverImageMode === 'manual' && pipeline.assets.cover.length === 0) {
    const asset = validateOrdinaryTaskCoverAsset(task.ordinaryCoverAsset);
    if (!task.managedStorageKey) {
      throw new Error('ORDINARY_MANUAL_COVER_STORAGE_INVALID: Task has no managed storage key.');
    }
    if (task.ratio !== asset.ratio) {
      throw new Error('ORDINARY_MANUAL_COVER_RATIO_MISMATCH: Task ratio does not match the managed cover.');
    }
    const coverPath = join(input.workDir, ...asset.path.split('/'));
    const coverBytes = await readFile(coverPath);
    const coverHash = createHash('sha256').update(coverBytes).digest('hex');
    if (coverBytes.length !== asset.sizeBytes || coverHash !== asset.sha256) {
      throw new Error('ORDINARY_MANUAL_COVER_TAMPERED: Managed cover asset does not match its metadata.');
    }
    pipeline.assets.cover = [{ sceneId: 0, path: coverPath }];
    await emit('cover_ready', 4, 'Producer', '已使用手动封面图片素材', { path: asset.path, ratio: asset.ratio });
  }
  const ordinaryCoverTemplate = isOrdinaryTask(task)
    ? resolveOrdinaryCoverTemplate(task.coverImageMode ?? 'off', task.coverTemplateId, options.customCoverTemplates ?? [])
    : null;
  if (shouldGenerateCoverImage(task) && pipeline.assets.cover.length === 0) {
    if (!options.generateImages) {
      throw new Error('Image provider is not configured; cannot create a cover image asset.');
    }
    await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
    await heartbeatTask(db, task.id, options, 4, 'cover image generation');
    await markStep(4, 'running');
    await emit('step_start', 4, 'Producer', '生成封面图片素材', { coverTemplateId: task.coverTemplateId });
    const coverScene = buildCoverScene(artifact);
    const coverPrompt = buildCoverImagePrompt(task, artifact, ordinaryCoverTemplate ? [ordinaryCoverTemplate] : options.customCoverTemplates);
    const coverAssets = await options.generateImages([coverScene], [coverPrompt], task, options.signal);
    const coverPath = await persistCoverImage(input.workDir, coverAssets[0], coverPrompt, input);
    pipeline.assets.cover = [{ sceneId: 0, path: coverPath }];
    await markStep(4, 'running', { outputPath: coverPath });
  }
  if (task.materialSource === 'local') {
    const person = task.materialPerson?.trim();
    if (!person) {
      throw new Error('本地人物素材来源需要选择人物。');
    }
    await db.updateTask(task.id, { currentStep: 4, retryFromStep: 4 });
    await heartbeatTask(db, task.id, options, 4, 'local person materials');
    await markStep(4, 'running');
    await emit('step_start', 4, 'Producer', '从人物素材库复制本地图片素材', { person, sceneIds: artifact.scenes.map((scene) => scene.id) });
    const copied = await copyPersonMaterialsForScenes({
      rootDir: join(options.appDataDir, 'person-assets'),
      person,
      scenes: artifact.scenes,
      taskDir: input.workDir,
      ratio: task.ratio,
      signal: options.signal,
    });
    pipeline.assets.images = mergeAssets(pipeline.assets.images, copied.assets);
    pipeline.assets.imageErrors = removeImageErrors(pipeline.assets.imageErrors, copied.assets.map((asset) => asset.sceneId));
    await markStep(4, 'completed', { outputPath: join(input.workDir, '04-local-meta.json') });
    await emit('step_complete', 4, 'Producer', '人物素材库图片已复制', { count: copied.assets.length, origins: copied.origins });
    return;
  }
  if (!options.generateImages) {
    throw new Error('Image provider is not configured; cannot create real image assets.');
  }
  const generateImages = options.generateImages;
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
      generatedImages = validateGeneratedSceneImages(
        scene,
        await generateImages([scene], artifact.imagePrompts, task, options.signal),
      );
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      persistImageQueue = persistImageQueue.then(async () => {
        pipeline.assets.imageErrors = upsertImageError(pipeline.assets.imageErrors, scene.id, message);
        await markStep(4, 'running', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n'), error: message });
        await heartbeatTask(db, task.id, options, 4, `image scene ${scene.id} failed`);
      });
      await persistImageQueue;
      if (!task.autoBorrowImage) throw error;
      return;
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
  if (task.autoBorrowImage) {
    const unresolved = missingScenes(artifact.scenes, pipeline.assets.images);
    if (unresolved.length > 0 && pipeline.assets.images.length === 0) {
      throw new Error('Automatic image borrowing requires at least one successful source image.');
    }
    for (const scene of artifact.scenes) {
      if (pipeline.assets.images.some((asset) => asset.sceneId === scene.id)) continue;
      const source = findBorrowSource(artifact.scenes, pipeline.assets.images, scene.id);
      if (!source) {
        throw new Error(`Automatic image borrowing could not find a usable source for scene ${scene.id}.`);
      }
      const borrowed = await materializeBorrowedImage(input.workDir, scene.id, source);
      pipeline.assets.images = mergeAssets(pipeline.assets.images, [borrowed]);
      await markStep(4, 'running', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n') });
      await emit('image_borrowed', 4, 'Producer', `第 ${scene.id} 张图片借用第 ${borrowed.borrowedFrom} 张`, {
        sceneId: scene.id,
        borrowedFrom: borrowed.borrowedFrom,
        path: borrowed.path,
      });
    }
  }
  const unresolved = missingScenes(artifact.scenes, pipeline.assets.images);
  if (unresolved.length > 0) {
    throw new Error(`Image provider did not return usable assets for scenes: ${unresolved.map((scene) => scene.id).join(', ')}.`);
  }
  await markStep(4, 'completed', { outputPath: pipeline.assets.images.map((asset) => asset.path).join('\n'), error: undefined });
  await emit('step_complete', 4, 'Producer', task.autoBorrowImage ? '真实图片素材与相邻镜头补位已完成' : '真实图片素材已生成', {
    count: pipeline.assets.images.length,
    borrowed: pipeline.assets.images.filter((asset) => asset.borrowedFrom !== undefined).length,
  });
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
  return task.coverImageMode === 'auto' || usesSinglePodcastCover(task);
}

function requireOrdinaryCoverPageImage(task: Task, path: string | undefined): string {
  if (!path) {
    throw new Error(`ORDINARY_COVER_PAGE_IMAGE_MISSING: Task ${task.id} enabled a cover page but has no cover image asset.`);
  }
  return path;
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

function hydrateArtifact(input: Partial<PipelineArtifact>, task?: Pick<Task, 'track'>, subtitleMaxCharsPerLine?: number): PipelineArtifact {
  if (!input.reviewedText || !input.rewrittenCopy || !input.cover || !input.scenes || !input.imagePrompts) {
    throw new Error('Pipeline content artifact is incomplete; retry from LLM steps.');
  }
  return {
    reviewedText: input.reviewedText,
    rewrittenCopy: input.rewrittenCopy,
    cover: resolveCoverDisplayMetadata(input.cover, { track: task?.track, sourceText: input.rewrittenCopy }),
    scenes: input.scenes,
    imagePrompts: input.imagePrompts,
    subtitles: input.subtitles ?? buildSubtitleTrack(input.scenes, subtitleMaxCharsPerLine === undefined
      ? undefined
      : { maxCharsPerLine: subtitleMaxCharsPerLine }),
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
  const scenes = input.map((scene, index) => {
    const item = scene as Partial<StoryboardScene> & { desc_prompt?: unknown };
    const cap = requireString(item.cap, `scenes[${index}].cap`);
    return {
      id: Number(item.id ?? index + 1),
      cap,
      descPrompt: String(item.descPrompt ?? item.desc_prompt ?? cap),
      durationMs: Math.max(800, Number(item.durationMs ?? estimateSceneDurationMs(cap))),
    };
  });
  return normalizeStoryboardSceneLengths(scenes);
}

function normalizeStoryboardResponse(input: unknown, raw = '', rewrittenCopy = ''): StoryboardScene[] {
  const responseError = extractStoryboardResponseError(input);
  if (responseError) {
    throw new Error(`LLM storyboard response reported an error: ${responseError}.${storyboardResponseDebugHint(input, raw)}`);
  }
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

function extractStoryboardResponseError(input: unknown): string | null {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) return extractStoryboardResponseError(parsedInput);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of ['error', 'errors']) {
    if (!(key in record) || record[key] === null || record[key] === undefined) continue;
    const detail = storyboardResponseErrorDetail(record[key]);
    if (detail) return detail;
  }
  if (record.ok === false || record.success === false) {
    return storyboardResponseErrorDetail(record.message ?? record.detail ?? record.reason) || 'provider reported an unsuccessful storyboard response';
  }
  for (const key of ['data', 'result', 'output', 'response']) {
    const nested = record[key];
    if (!nested || typeof nested !== 'object') continue;
    const nestedError = extractStoryboardResponseError(nested);
    if (nestedError) return nestedError;
  }
  return null;
}

function storyboardResponseErrorDetail(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  try {
    const serialized = JSON.stringify(value);
    return (serialized ?? String(value)).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
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
  return normalizeStoryboardSceneLengths(extracted.scenes);
}

const STORYBOARD_TAIL_ANCHOR_KEYS = new Set([
  'anchor',
  'anchors',
  'tailanchor',
  'tailanchors',
  'cutanchor',
  'cutanchors',
  'endinganchor',
  'endinganchors',
  '锚点',
  '尾锚',
  '尾锚点',
  '尾部锚点',
  '分镜锚点',
  '切分锚点',
  '句尾锚点',
]);

const STORYBOARD_TAIL_ANCHOR_CONTAINER_KEYS = new Set([
  'scene',
  'scenes',
  'storyboard',
  'storyboards',
  'scenelist',
  'sentences',
  'shots',
  'items',
  'list',
  'values',
  'data',
  'result',
  'output',
  'content',
  'response',
  '分镜',
  '分镜列表',
  '镜头',
  '镜头列表',
]);

function extractStoryboardTailAnchors(input: unknown, allowPlainText = false): string[] | undefined {
  const parsedInput = maybeParseStoryboardJson(input);
  if (parsedInput !== input) {
    return extractStoryboardTailAnchors(parsedInput, allowPlainText);
  }
  if (typeof input === 'string') {
    return allowPlainText ? parseStoryboardTailAnchorText(input) : undefined;
  }
  if (Array.isArray(input)) {
    return input.every((item) => typeof item === 'string') ? input.map((item) => item.trim()) : undefined;
  }
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  const entries = Object.entries(record);

  for (const [key, value] of entries) {
    if (!STORYBOARD_TAIL_ANCHOR_KEYS.has(normalizeStoryboardResponseKey(key))) continue;
    const anchors = extractStoryboardTailAnchors(value, true);
    if (anchors) return anchors;
  }

  for (const [key, value] of entries) {
    if (!STORYBOARD_TAIL_ANCHOR_CONTAINER_KEYS.has(normalizeStoryboardResponseKey(key))) continue;
    const anchors = extractStoryboardTailAnchors(value);
    if (anchors) return anchors;
  }

  if (entries.length === 1) {
    return extractStoryboardTailAnchors(entries[0][1], true);
  }
  return undefined;
}

function normalizeStoryboardResponseKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

function parseStoryboardTailAnchorText(value: string): string[] | undefined {
  const lines = stripJsonCodeFence(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line
      .replace(/^(?:[-*•]\s*|\d+[.)、:：]\s*)/u, '')
      .replace(/^["'“](.*)["'”][,，]?$/u, '$1')
      .trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
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
    const normalizedEnd = findStoryboardAnchorEnd(normalizedText, normalizedSearchStart, cleanAnchor);
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

function findStoryboardAnchorEnd(text: string, searchStart: number, anchor: string): number | null {
  const exactIndex = text.indexOf(anchor, searchStart);
  if (exactIndex >= 0) {
    return exactIndex + anchor.length;
  }

  const compactAnchor = anchor.replace(/\s+/gu, '');
  if (compactAnchor.length >= 3) {
    const nonWhitespace = normalizedCharsFrom(text, searchStart);
    const compactIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(compactAnchor);
    if (compactIndex >= 0) {
      return nonWhitespace[compactIndex + compactAnchor.length - 1].si + 1;
    }
  }

  const looseAnchor = anchor.replace(/[\s。！？，、；：…—\-.!?,;:]+$/gu, '').replace(/\s+/gu, '');
  if (looseAnchor.length >= 4) {
    const nonWhitespace = normalizedCharsFrom(text, searchStart);
    const looseIndex = nonWhitespace.map((item) => item.ch).join('').indexOf(looseAnchor);
    if (looseIndex >= 0) {
      let end = nonWhitespace[looseIndex + looseAnchor.length - 1].si;
      while (end + 1 < text.length && /[。！？，、；：…—\-.!?,;: \t]/u.test(text[end + 1])) {
        end += 1;
      }
      return end + 1;
    }
  }

  const punctuationlessAnchor = normalizedCharsFrom(anchor, 0, (char) => !isStoryboardIgnoredMatchChar(char))
    .map((item) => item.ch)
    .join('');
  if (punctuationlessAnchor.length >= 4) {
    const punctuationlessText = normalizedCharsFrom(text, searchStart, (char) => !isStoryboardIgnoredMatchChar(char));
    const punctuationlessIndex = punctuationlessText.map((item) => item.ch).join('').indexOf(punctuationlessAnchor);
    if (punctuationlessIndex >= 0) {
      let end = punctuationlessText[punctuationlessIndex + punctuationlessAnchor.length - 1].si;
      while (end + 1 < text.length && /[。！？，、；：…—\-.!?,;: \t]/u.test(text[end + 1])) {
        end += 1;
      }
      return end + 1;
    }
  }

  return null;
}

function normalizedCharsFrom(text: string, start: number, keepChar: (char: string) => boolean = (char) => char.trim().length > 0): Array<{ ch: string; si: number }> {
  const output: Array<{ ch: string; si: number }> = [];
  for (let index = start; index < text.length; index += 1) {
    if (keepChar(text[index])) output.push({ ch: text[index], si: index });
  }
  return output;
}

function isStoryboardIgnoredMatchChar(char: string): boolean {
  return /[\p{P}]/u.test(char);
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

function validateGeneratedSceneImages(scene: StoryboardScene, assets: SceneAsset[]): SceneAsset[] {
  if (!Array.isArray(assets) || assets.length !== 1) {
    throw new Error(`Image provider did not return exactly one image asset for scene ${scene.id}.`);
  }
  const asset = assets[0];
  if (asset.sceneId !== scene.id || typeof asset.path !== 'string' || !asset.path.trim()) {
    throw new Error(`Image provider returned an unusable image asset for scene ${scene.id}.`);
  }
  return [{ ...asset, borrowedFrom: undefined }];
}

function findBorrowSource(scenes: StoryboardScene[], assets: SceneAsset[], targetSceneId: number): SceneAsset | null {
  const targetIndex = scenes.findIndex((scene) => scene.id === targetSceneId);
  if (targetIndex < 0) return null;
  const bySceneId = new Map(assets.map((asset) => [asset.sceneId, asset] as const));
  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const asset = bySceneId.get(scenes[index].id);
    if (asset) return asset;
  }
  for (let index = targetIndex + 1; index < scenes.length; index += 1) {
    const asset = bySceneId.get(scenes[index].id);
    if (asset) return asset;
  }
  return null;
}

async function materializeBorrowedImage(workDir: string, sceneId: number, source: SceneAsset): Promise<SceneAsset> {
  const extension = extname(source.path).toLowerCase() || '.png';
  const outputDir = join(workDir, 'provider-images');
  const path = join(outputDir, `${String(sceneId).padStart(3, '0')}${extension}`);
  await mkdir(outputDir, { recursive: true });
  await copyFile(source.path, path);
  return {
    sceneId,
    path,
    borrowedFrom: source.borrowedFrom ?? source.sceneId,
  };
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

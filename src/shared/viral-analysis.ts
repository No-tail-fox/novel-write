import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CreateTaskInput,
  ViralContentBreakdown,
  ViralFrameAnalysis,
  ViralAnalysisResult,
  ViralAnalysisEvent,
  ViralAnalysisRecord,
  ViralRecreationDraft,
  ViralAnalysisSettings,
  ViralTranscriptSegment,
  ViralVideoSource,
  ViralPlatform,
  ViralProductionTaskOptions,
  ViralCookieSource,
  ViralDownloadProvider,
} from './types';

export interface ViralBreakdownPromptInput {
  title: string;
  author: string;
  transcriptText: string;
  frameSummary: string;
}

export interface ViralRecreationPromptInput {
  track: string;
  extraRequirements: string;
  result: ViralAnalysisResult;
}

export interface ViralMediaDownloadResult {
  source: ViralVideoSource;
  videoPath: string;
  provider: ViralDownloadProvider;
  normalizedUrl: string;
  usedCookieSource: ViralCookieSource;
  raw?: unknown;
}

export interface ViralMediaExtractionResult {
  audioPath: string;
  frames: Array<{ timestamp: number; framePath: string }>;
}

export interface ViralMediaExtractionRequest {
  keyFrameCount: number;
  sourceDurationSeconds: number;
}

export interface RunViralAnalysisOptions {
  workDir: string;
  signal?: AbortSignal;
  emit?: (event: Pick<ViralAnalysisEvent, 'type' | 'stage' | 'detail'> & { progress?: number; data?: unknown }) => Promise<void>;
  download: (record: ViralAnalysisRecord, workDir: string, signal?: AbortSignal) => Promise<ViralMediaDownloadResult>;
  extract: (videoPath: string, workDir: string, signal?: AbortSignal, request?: ViralMediaExtractionRequest) => Promise<ViralMediaExtractionResult>;
  transcribe: (audioPath: string, signal?: AbortSignal) => Promise<ViralTranscriptSegment[]>;
  analyzeFrame: (frame: { timestamp: number; framePath: string }, previousFrame: { timestamp: number; framePath: string } | null, source: ViralVideoSource, signal?: AbortSignal) => Promise<ViralFrameAnalysis>;
  analyzeBreakdown: (input: ViralBreakdownPromptInput, signal?: AbortSignal) => Promise<ViralContentBreakdown>;
  createRecreation: (input: ViralRecreationPromptInput, signal?: AbortSignal) => Promise<ViralRecreationDraft>;
}

export interface CompletedViralAnalysisRun {
  result: ViralAnalysisResult;
  resultPath: string;
  videoPath: string;
}

export function detectViralPlatform(url: string): ViralPlatform {
  const normalized = url.toLowerCase();
  if (/douyin\.com|iesdouyin\.com|amemv\.com/.test(normalized)) return 'douyin';
  if (/kuaishou\.com|gifshow\.com|kwai\.com/.test(normalized)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/.test(normalized)) return 'bilibili';
  return 'unknown';
}

export function normalizeViralSourceUrl(url: string, platform: ViralPlatform): string {
  if (platform !== 'douyin') return url;
  try {
    const parsed = new URL(url);
    const modalId = parsed.searchParams.get('modal_id');
    if (modalId && /^\d+$/.test(modalId)) {
      return `https://www.douyin.com/video/${modalId}`;
    }
  } catch {
    return url;
  }
  return url;
}

export async function runViralAnalysis(record: ViralAnalysisRecord, options: RunViralAnalysisOptions): Promise<CompletedViralAnalysisRun> {
  await mkdir(options.workDir, { recursive: true });

  const emit = async (type: string, stage: ViralAnalysisEvent['stage'], detail: string, progress: number, data?: unknown) => {
    throwIfAborted(options.signal);
    await options.emit?.({ type, stage, detail, progress, data });
  };

  await emit('stage_start', 'downloading', 'Downloading source video', 0.05);
  const downloaded = await options.download(record, options.workDir, options.signal);
  await emit('stage_done', 'downloading', 'Downloaded source video', 0.16, {
    provider: downloaded.provider,
    normalizedUrl: downloaded.normalizedUrl,
    usedCookieSource: downloaded.usedCookieSource,
    metadataTitle: downloaded.source.title,
  });

  await emit('stage_start', 'extracting', 'Extracting audio and frames', 0.18);
  const extractionRequest: ViralMediaExtractionRequest = {
    keyFrameCount: normalizeKeyFrameCount(record.settings.keyFrameCount),
    sourceDurationSeconds: normalizeDurationSeconds(downloaded.source.duration),
  };
  const extracted = await options.extract(downloaded.videoPath, options.workDir, options.signal, extractionRequest);

  await emit('stage_start', 'transcribing', 'Transcribing narration', 0.32);
  const transcript = await options.transcribe(extracted.audioPath, options.signal);

  await emit('stage_start', 'analyzing_frames', 'Analyzing key frames', 0.45);
  const uniqueFrames = await filterUniqueExtractedFrames(extracted.frames);
  const frames: ViralFrameAnalysis[] = [];
  const showFrameProgress = uniqueFrames.length > 1;
  for (const [index, frame] of uniqueFrames.entries()) {
    throwIfAborted(options.signal);
    if (showFrameProgress) {
      const current = index + 1;
      await emit(
        'stage_progress',
        'analyzing_frames',
        `Analyzing key frames (${current}/${uniqueFrames.length})`,
        0.45 + (current / uniqueFrames.length) * 0.24,
        { current, total: uniqueFrames.length, timestamp: frame.timestamp },
      );
    }
    const previous = index > 0 ? uniqueFrames[index - 1] : null;
    frames.push(await options.analyzeFrame(frame, previous, downloaded.source, options.signal));
  }

  await emit('stage_start', 'breaking_down', 'Breaking down opening, structure, ending, and viral points', 0.72);
  const breakdownInput = {
    title: downloaded.source.title,
    author: downloaded.source.author,
    transcriptText: transcript.map((segment) => segment.text).join('\n'),
    frameSummary: frames.map((frame) => `${frame.timestamp}s: ${frame.visualDescription}`).join('\n'),
  };
  const contentBreakdown = await options.analyzeBreakdown(breakdownInput, options.signal);

  await emit('stage_start', 'recreating', 'Creating structure-level recreation draft', 0.88);
  const recreation = await options.createRecreation(
    {
      track: record.settings.track,
      extraRequirements: record.settings.extraRequirements ?? '',
      result: {
        source: downloaded.source,
        transcript,
        frames,
        contentBreakdown,
        recreation: emptyRecreation(record.settings),
        createdAt: new Date().toISOString(),
      },
    },
    options.signal,
  );

  const result: ViralAnalysisResult = {
    source: downloaded.source,
    transcript,
    frames,
    contentBreakdown,
    recreation,
    createdAt: new Date().toISOString(),
  };
  const resultPath = join(options.workDir, 'viral-analysis-result.json');
  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8');
  await emit('done', 'completed', 'Viral analysis completed', 1, { resultPath });
  return { result, resultPath, videoPath: downloaded.videoPath };
}

export function buildViralBreakdownPrompt(input: ViralBreakdownPromptInput): string {
  return [
    '你是一位短视频爆款内容拆解专家。只从视频内容、标题、封面、逐字稿和画面分析中找爆点，不要采集或假设评论区。',
    '请严格返回 JSON，并围绕四个固定维度拆解：开头、结构、结尾、爆点。',
    '开头分类只能从以下类型选择：开门见山、引用金句、亮点前置、抛出观点。',
    '结构分类只能从以下类型选择：总分结构、递进结构、平行结构。',
    '结尾分类只能从以下类型选择：总结型结尾、引导型结尾、预告型结尾。',
    '爆点从内容内部寻找：价值信息、简单有效方案、情绪共鸣、冲突、矛盾、反转、视觉亮点。',
    '同时输出选题方向、标题拆解、封面拆解、可复用模式和证据。',
    'JSON Schema: {"topic":string,"title":{"original":string,"pattern":string,"suggestions":string[]},"cover":{"observed":string,"pattern":string,"suggestions":string[]},"opening":{"type":string,"analysis":string,"reusablePattern":string},"structure":{"type":string,"analysis":string,"outline":string[]},"ending":{"type":string,"analysis":string,"reusablePattern":string},"viralPoint":{"summary":string,"evidence":string[],"reusablePattern":string}}',
    `视频标题：${input.title || '未知'}`,
    `作者：${input.author || '未知'}`,
    `逐字稿：\n${input.transcriptText || '无语音内容'}`,
    `画面摘要：\n${input.frameSummary || '无画面摘要'}`,
  ].join('\n\n');
}

export function buildViralRecreationPrompt(input: ViralRecreationPromptInput): string {
  return [
    '你是一位短视频编导。请基于拆解结果做结构级复刻，保留开头方式、结构节奏、结尾功能和爆点逻辑，但生成全新的选题表达。',
    '不要逐句照搬原文，不要复用原标题，不要复用原视频独特表达，不要逐镜头高仿。',
    '输出可直接转成 CreateTaskInput 的中文素材。',
    'JSON Schema: {"blueprint":string,"openingOptions":string[],"titleOptions":string[],"coverIdeas":string[],"script":string,"storyboardHints":string[],"taskDefaults":{"track":string,"style":string,"ratio":string,"storyboardSceneCount":number}}',
    `目标赛道：${input.track}`,
    input.extraRequirements ? `额外要求：${input.extraRequirements}` : '',
    `拆解结果：\n${JSON.stringify(input.result.contentBreakdown, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function createViralProductionTaskInput(result: ViralAnalysisResult, options: ViralProductionTaskOptions = {}): CreateTaskInput {
  const defaults = result.recreation.taskDefaults;
  const settings = {
    track: options.track ?? defaults.track ?? 'general-story',
    style: options.style ?? defaults.style ?? 'photo-real',
    ratio: options.ratio ?? defaults.ratio ?? '9:16',
    templateId: options.templateId ?? 'default-portrait-9-16',
    storyboardSceneCount: options.storyboardSceneCount ?? defaults.storyboardSceneCount ?? 12,
    extraRequirements: '',
  };
  return {
    title: options.title ?? `爆款复刻 - ${result.source.title || result.contentBreakdown.topic || '短视频'}`,
    inputText: result.recreation.script,
    mode: 'paste',
    track: settings.track,
    style: settings.style,
    ratio: settings.ratio,
    templateId: settings.templateId,
    storyboardSceneCount: settings.storyboardSceneCount,
    imagePromptReference: buildViralImagePromptReference(result.frames),
    extraRequirements: [
      '结构级复刻：只复用原视频的开头方式、结构节奏、结尾功能和爆点逻辑。',
      '不要逐句照搬、不要复用原标题、不要复用原视频独特表达。',
      `复刻蓝图：${result.recreation.blueprint}`,
      result.recreation.storyboardHints.length ? `分镜建议：${result.recreation.storyboardHints.join(' / ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function buildViralImagePromptReference(frames: ViralFrameAnalysis[]): string {
  return frames
    .map((frame, index) => {
      const prompt = frame.imagePrompt?.trim();
      if (!prompt) return '';
      return `${index + 1}. ${formatViralTimestamp(frame.timestamp)} - ${prompt}`;
    })
    .filter(Boolean)
    .join('\n');
}

function emptyRecreation(settings: ViralAnalysisSettings): ViralRecreationDraft {
  return {
    blueprint: '',
    openingOptions: [],
    titleOptions: [],
    coverIdeas: [],
    script: '',
    storyboardHints: [],
    taskDefaults: {
      track: settings.track,
      style: settings.style,
      ratio: settings.ratio,
      storyboardSceneCount: settings.storyboardSceneCount ?? 12,
    },
  };
}

async function filterUniqueExtractedFrames(
  frames: ViralMediaExtractionResult['frames'],
): Promise<ViralMediaExtractionResult['frames']> {
  const seen = new Set<string>();
  const unique: ViralMediaExtractionResult['frames'] = [];
  for (const frame of frames) {
    const hash = createHash('sha256').update(await readFile(frame.framePath)).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    unique.push(frame);
  }
  return unique;
}

function normalizeKeyFrameCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(40, Math.max(1, Math.round(parsed)));
}

function normalizeDurationSeconds(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatViralTimestamp(timestamp: number): string {
  return `${Math.max(0, Math.round(timestamp))}s`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === 'string' ? reason : 'Viral analysis aborted.');
}

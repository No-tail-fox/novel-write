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
  ViralAnalysisCheckpoint,
  ViralTranscriptSegment,
  ViralVideoSource,
  ViralPlatform,
  ViralProductionTaskOptions,
  ViralCookieSource,
  ViralDownloadProvider,
} from './types';
export type { ViralTemplateDraftOptions, ViralTemplateDrafts } from './viral-template-extraction';
export { createViralTemplateDrafts } from './viral-template-extraction';

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
  resumeFrom?: ViralAnalysisCheckpoint | null;
  persistCheckpoint?: (checkpoint: ViralAnalysisCheckpoint) => Promise<void>;
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

const VIRAL_DIAGNOSTIC_MAX_CHARS = 4096;

export function boundViralDiagnosticText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '');
  if (text.length <= VIRAL_DIAGNOSTIC_MAX_CHARS) return text;
  return `${text.slice(0, VIRAL_DIAGNOSTIC_MAX_CHARS - 14)}...[truncated]`;
}

export function viralCheckpointResumeState(checkpoint?: ViralAnalysisCheckpoint | null): {
  stage: ViralAnalysisRecord['currentStage'];
  progress: number;
} {
  if (checkpoint?.completed) return { stage: 'completed', progress: 1 };
  if (checkpoint?.recreation) return { stage: 'recreating', progress: 0.88 };
  if (checkpoint?.contentBreakdown) return { stage: 'recreating', progress: 0.88 };
  if (checkpoint?.frames) return { stage: 'breaking_down', progress: 0.72 };
  if (checkpoint?.transcript) return { stage: 'analyzing_frames', progress: 0.45 };
  if (checkpoint?.extracted) return { stage: 'transcribing', progress: 0.32 };
  if (checkpoint?.downloaded) return { stage: 'extracting', progress: 0.18 };
  return { stage: 'downloading', progress: 0.05 };
}

export const VIRAL_SOURCE_DOMAINS = {
  douyin: ['douyin.com', 'iesdouyin.com', 'amemv.com'],
  kuaishou: ['kuaishou.com', 'gifshow.com', 'kwai.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
} as const;

export function hostnameMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '');
  const base = domain.toLowerCase().replace(/\.$/u, '');
  return host === base || host.endsWith(`.${base}`);
}

export function detectViralPlatform(url: string): ViralPlatform {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    return 'unknown';
  }
  for (const [platform, domains] of Object.entries(VIRAL_SOURCE_DOMAINS) as Array<
    [Exclude<ViralPlatform, 'unknown'>, readonly string[]]
  >) {
    if (domains.some((domain) => hostnameMatches(hostname, domain))) return platform;
  }
  return 'unknown';
}

export function assertViralSourceUrl(url: string, platform: ViralPlatform): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('视频链接格式无效，仅支持 HTTPS 链接。');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('视频链接仅支持 HTTPS。');
  }
  if (parsed.username || parsed.password) {
    throw new Error('视频链接不得包含用户名、密码或其他 URL 凭证。');
  }
  const detected = detectViralPlatform(parsed.toString());
  if (detected === 'unknown') {
    throw new Error('视频链接域名不受支持。');
  }
  if (platform === 'unknown' || detected !== platform) {
    throw new Error('视频链接与所选平台不匹配。');
  }
  return parsed.toString();
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

  const checkpoint: ViralAnalysisCheckpoint = options.resumeFrom
    ? structuredClone(options.resumeFrom)
    : { runGeneration: record.runGeneration ?? 0 };
  if (record.runGeneration !== undefined && checkpoint.runGeneration !== record.runGeneration) {
    throw new Error('STALE_VIRAL_RUN: Recovery checkpoint belongs to another run generation.');
  }
  const persistCheckpoint = async () => options.persistCheckpoint?.(structuredClone(checkpoint));

  const emit = async (type: string, stage: ViralAnalysisEvent['stage'], detail: string, progress: number, data?: unknown) => {
    throwIfAborted(options.signal);
    await options.emit?.({ type, stage, detail, progress, data });
  };

  let downloaded = checkpoint.downloaded;
  if (!downloaded) {
    await emit('stage_start', 'downloading', 'Downloading source video', 0.05);
    const next = await options.download(record, options.workDir, options.signal);
    downloaded = {
      source: next.source,
      videoPath: next.videoPath,
      provider: next.provider,
      normalizedUrl: next.normalizedUrl,
      usedCookieSource: next.usedCookieSource,
    };
    checkpoint.downloaded = downloaded;
    await persistCheckpoint();
    await emit('stage_done', 'downloading', 'Downloaded source video', 0.16, {
      provider: downloaded.provider,
      normalizedUrl: downloaded.normalizedUrl,
      usedCookieSource: downloaded.usedCookieSource,
      metadataTitle: downloaded.source.title,
    });
  }
  if (!downloaded) throw new Error('VIRAL_CHECKPOINT_INVALID: Download stage is missing.');

  let extracted = checkpoint.extracted;
  if (!extracted) {
    await emit('stage_start', 'extracting', 'Extracting audio and frames', 0.18);
    const extractionRequest: ViralMediaExtractionRequest = {
      keyFrameCount: normalizeKeyFrameCount(record.settings.keyFrameCount),
      sourceDurationSeconds: normalizeDurationSeconds(downloaded.source.duration),
    };
    extracted = await options.extract(downloaded.videoPath, options.workDir, options.signal, extractionRequest);
    checkpoint.extracted = extracted;
    await persistCheckpoint();
  }
  if (!extracted) throw new Error('VIRAL_CHECKPOINT_INVALID: Extraction stage is missing.');

  let transcript = checkpoint.transcript;
  if (!transcript) {
    await emit('stage_start', 'transcribing', 'Transcribing narration', 0.32);
    transcript = await options.transcribe(extracted.audioPath, options.signal);
    checkpoint.transcript = transcript;
    await persistCheckpoint();
  }
  if (!transcript) throw new Error('VIRAL_CHECKPOINT_INVALID: Transcript stage is missing.');

  let frames = checkpoint.frames;
  if (!frames) {
    await emit('stage_start', 'analyzing_frames', 'Analyzing key frames', 0.45);
    const uniqueFrames = await filterUniqueExtractedFrames(extracted.frames);
    frames = [];
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
    checkpoint.frames = frames;
    await persistCheckpoint();
  }
  if (!frames) throw new Error('VIRAL_CHECKPOINT_INVALID: Frame stage is missing.');

  let contentBreakdown = checkpoint.contentBreakdown;
  if (!contentBreakdown) {
    await emit('stage_start', 'breaking_down', 'Breaking down opening, structure, ending, and viral points', 0.72);
    const breakdownInput = {
      title: downloaded.source.title,
      author: downloaded.source.author,
      transcriptText: transcript.map((segment) => segment.text).join('\n'),
      frameSummary: frames.map((frame) => `${frame.timestamp}s: ${frame.visualDescription}`).join('\n'),
    };
    contentBreakdown = await options.analyzeBreakdown(breakdownInput, options.signal);
    checkpoint.contentBreakdown = contentBreakdown;
    await persistCheckpoint();
  }
  if (!contentBreakdown) throw new Error('VIRAL_CHECKPOINT_INVALID: Breakdown stage is missing.');

  let recreation = checkpoint.recreation;
  if (!recreation) {
    await emit('stage_start', 'recreating', 'Creating structure-level recreation draft', 0.88);
    recreation = normalizeViralRecreationDraft(
      await options.createRecreation(
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
      ),
      contentBreakdown,
      record.settings,
    );
    checkpoint.recreation = recreation;
    await persistCheckpoint();
  }
  if (!recreation) throw new Error('VIRAL_CHECKPOINT_INVALID: Recreation stage is missing.');

  const result: ViralAnalysisResult = {
    source: downloaded.source,
    transcript,
    frames,
    contentBreakdown,
    recreation,
    createdAt: new Date().toISOString(),
  };
  const resultPath = join(options.workDir, `viral-analysis-result-${checkpoint.runGeneration}.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf8');
  checkpoint.completed = { resultPath, videoPath: downloaded.videoPath };
  await persistCheckpoint();
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
  const { result } = input;
  const schema = {
    formula: {
      main: '',
      title: '',
      cover: '',
      opening: '',
      structure: '',
      ending: '',
    },
    templatePrompt: '',
    storyCore: {
      who: '',
      where: '',
      whatHappened: '',
      why: '',
      turningPoint: '',
      result: '',
    },
    storyContent: '',
    blueprint: '',
    script: '',
    openingOptions: [],
    titleOptions: [],
    coverIdeas: [],
    storyboardHints: [],
    taskDefaults: result.recreation.taskDefaults,
  };
  const transcriptText = result.transcript.map((segment) => segment.text.trim()).filter(Boolean).join('\n');
  const frameSummary = result.frames.map((frame) => `${frame.timestamp}s: ${frame.visualDescription}`).join('\n');
  return [
    '你是一位短视频编导。请先抽出故事事实层，再做结构级复刻。故事事实层必须具体到人物、场景、冲突、转折和结果，不要只写结构骨架。',
    '不要逐句照搬原文，不要复用原标题，不要复用原视频独特表达，不要逐镜头高仿。',
    '输出必须是 strict JSON only，且字段必须精确到公式层、模板层、故事层和兼容层。',
    'formula.main 是主公式总纲，必须概括这条爆款的复刻逻辑；formula.title / cover / opening / structure / ending 是子公式，分别描述标题、封面、开头、结构和收尾的复刻规则。',
    'templatePrompt 必须是可直接复刻的标准提示词模板，保留原文案的段落功能、信息推进顺序、转折节奏和收尾方式，主题只通过占位符替换。',
    'storyCore 必须只保留故事事实骨架；storyContent 必须是具体可讲述的故事底稿，不能只写提纲，不能只写结构骨架。',
    'script 作为兼容字段，内容应与 storyContent 保持一致；blueprint 只作为兼容摘要，不得代替故事正文。',
    `JSON Schema: ${JSON.stringify(schema, null, 2)}`,
    `原视频标题：${result.source.title || '未知'}`,
    `原视频作者：${result.source.author || '未知'}`,
    `原视频逐字稿：\n${transcriptText || '无语音内容'}`,
    `原视频画面摘要：\n${frameSummary || '无画面摘要'}`,
    `故事主线：${result.contentBreakdown.topic || result.recreation.blueprint || result.source.title || '未知'}`,
    `情节钩子：${result.contentBreakdown.opening.reusablePattern || '一开头就给结果或冲突'}`,
    '故事内容要求：必须写成具体可讲述的故事，先写清楚是谁、在哪、遇到了什么、为什么会发生、怎么转折、最后变成什么。不要只写结构提纲。',
    `目标赛道：${input.track}`,
    input.extraRequirements ? `额外要求：${input.extraRequirements}` : '',
    `拆解结果：\n${JSON.stringify(input.result.contentBreakdown, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function createViralProductionTaskInput(result: ViralAnalysisResult, options: ViralProductionTaskOptions = {}): CreateTaskInput {
  const defaults = result.recreation.taskDefaults;
  const storyContent = result.recreation.storyContent?.trim() || '';
  const script = result.recreation.script?.trim() || '';
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
    inputText: storyContent || script,
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
    formula: {
      main: '',
      title: '',
      cover: '',
      opening: '',
      structure: '',
      ending: '',
    },
    templatePrompt: '',
    storyCore: {
      who: '',
      where: '',
      whatHappened: '',
      why: '',
      turningPoint: '',
      result: '',
    },
    storyContent: '',
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

function normalizeViralRecreationDraft(
  recreation: Partial<ViralRecreationDraft> | null | undefined,
  breakdown: ViralContentBreakdown,
  settings: ViralAnalysisSettings,
): ViralRecreationDraft {
  const storyContent = String(recreation?.storyContent ?? recreation?.script ?? recreation?.blueprint ?? '').trim();
  const script = String(recreation?.script ?? storyContent).trim() || storyContent;
  const formula = recreation?.formula ?? {
    main: '',
    title: '',
    cover: '',
    opening: '',
    structure: '',
    ending: '',
  };
  const storyCore = recreation?.storyCore ?? {
    who: '',
    where: '',
    whatHappened: '',
    why: '',
    turningPoint: '',
    result: '',
  };
  const taskDefaults = recreation?.taskDefaults ?? {
    track: settings.track,
    style: settings.style,
    ratio: settings.ratio,
    storyboardSceneCount: settings.storyboardSceneCount ?? 12,
  };
  return {
    formula: {
      main: String(formula.main ?? recreation?.blueprint ?? breakdown.topic ?? storyContent ?? '').trim(),
      title: String(formula.title ?? breakdown.title.pattern ?? '').trim(),
      cover: String(formula.cover ?? breakdown.cover.pattern ?? breakdown.cover.observed ?? '').trim(),
      opening: String(formula.opening ?? breakdown.opening.reusablePattern ?? '').trim(),
      structure: String(formula.structure ?? breakdown.structure.analysis ?? '').trim(),
      ending: String(formula.ending ?? breakdown.ending.reusablePattern ?? '').trim(),
    },
    templatePrompt: String(recreation?.templatePrompt ?? buildViralTemplatePromptFallback(breakdown)).trim(),
    storyCore: {
      who: String(storyCore.who ?? '').trim(),
      where: String(storyCore.where ?? '').trim(),
      whatHappened: String(storyCore.whatHappened ?? '').trim(),
      why: String(storyCore.why ?? '').trim(),
      turningPoint: String(storyCore.turningPoint ?? '').trim(),
      result: String(storyCore.result ?? '').trim(),
    },
    storyContent,
    blueprint: String(recreation?.blueprint ?? storyContent ?? breakdown.topic ?? '').trim(),
    openingOptions: normalizeStringArray(recreation?.openingOptions),
    titleOptions: normalizeStringArray(recreation?.titleOptions),
    coverIdeas: normalizeStringArray(recreation?.coverIdeas),
    script,
    storyboardHints: normalizeStringArray(recreation?.storyboardHints),
    taskDefaults: {
      track: taskDefaults.track ?? settings.track,
      style: taskDefaults.style ?? settings.style,
      ratio: taskDefaults.ratio ?? settings.ratio,
      storyboardSceneCount: taskDefaults.storyboardSceneCount ?? settings.storyboardSceneCount,
    },
  };
}

function buildViralTemplatePromptFallback(breakdown: ViralContentBreakdown): string {
  return [
    '保留段落功能、信息推进顺序、转折节奏和收尾方式，主题只通过占位符替换。',
    `标题模式：${breakdown.title.pattern || '高辨识度承诺 / 痛点 / 反差'}`,
    `开头功能：${breakdown.opening.reusablePattern || '结果 / 冲突前置'}`,
    `结构功能：${breakdown.structure.analysis || '痛点 -> 证据 -> 方法 -> 结果'}`,
    `结尾功能：${breakdown.ending.reusablePattern || '总结 / 行动提示 / 期待下一步'}`,
  ].join(' ');
}

function normalizeStringArray(values: Array<string | undefined | null> | undefined): string[] {
  return (values ?? []).map((value) => value?.trim() ?? '').filter(Boolean);
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

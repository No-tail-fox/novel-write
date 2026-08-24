import { cloneState, hydrateState, initialState } from './app-state';
import { stripConfigSecrets, type PublicAppState } from '../shared/config-secrets';
import { HOT_BOARD_SOURCE_ASSESSMENTS } from '../shared/hotboard-catalog';
import { fallbackEffectCatalog, volcengineVoicePresets } from '../shared/editorial-options';
import { resolveVolcengineTtsApiVersion } from '../shared/volcengine-tts';
import { validateConfigTarget } from '../shared/config-utils';
import {
  applyHtmlVideoConfigChanges,
  applyHtmlVideoSceneChanges,
  applyHtmlVideoSceneStructureChange,
  prepareHtmlVideoPipelineForRerender,
  htmlVideoVisibleSteps,
  parseHtmlVideoPipelineData,
} from '../shared/html-video-workflow';
import { loadDefaultPromptTemplates } from '../shared/prompt-template-loader';
import { mergeMinimaxCloneVoice } from '../shared/minimax-clone-voices';
import { taskToSummary } from '../shared/state-reconciliation';
import type { StoryDreamApi } from '../shared/storydream-api';
import { taskSpeakerLabel } from '../shared/tts-voices';
import { normalizeBenchmarkGroupInput, normalizeBenchmarkPostInput } from '../shared/benchmark-monitoring';
import { buildBookDiscoveryFallback } from '../shared/book-discovery-fallback';
import {
  EDITORIAL_COLLAGE_TASK_TYPE,
  createEditorialCollageDraft,
  createEditorialCollageStarterPlan,
  editorialCollageCreateInputSchema,
  editorialCollageSaveInputSchema,
  parseEditorialCollagePipelineData,
} from '../shared/editorial-collage';
import {
  MOTION_COMIC_TASK_TYPE,
  createMotionComicDraft,
  createMotionComicStarterProject,
  motionComicCreateInputSchema,
  motionComicSaveInputSchema,
  parseMotionComicPipelineData,
} from '../shared/motion-comic';
import type {
  AccountProfile,
  ActivationState,
  AppDelta,
  AppMutationResult,
  BootstrapState,
  BenchmarkGroup,
  BenchmarkPost,
  BookSelectionRecord,
  CreateTaskInput,
  CreateViralAnalysisInput,
  CustomStyle,
  DraftTemplate,
  HistoryFamily,
  HistoryListInput,
  HistoryPage,
  HtmlVideoConfigChange,
  HtmlVideoSceneChange,
  HtmlVideoSceneStructureChange,
  HtmlVideoCompositionSourceSaveInput,
  HotBoardArchiveResult,
  ImageLabGenerateInput,
  ImageLabImportInput,
  ImageLabRecord,
  MusicMvTaskUpdateInput,
  PromptTemplate,
  Task,
  TaskEvent,
  TaskStatus,
  UiPreferencesUpdate,
  ViralAnalysisResult,
  ViralAnalysisStatus,
  ViralPlatform,
  VoiceLabGenerateInput,
  VoiceLabRecord,
} from '../shared/types';

type AppState = PublicAppState;

const BROWSER_HOT_BOARD_PREVIEW_WARNING = '浏览器预览展示本地归档样例，不代表实时数据；标题和摘要仅用于验收正文与创作交接，真实热榜请在 Electron 桌面端刷新。';

export function createBrowserHotBoardPreviewArchive(archiveDate: string): HotBoardArchiveResult {
  const fetchedAt = new Date(`${archiveDate}T09:00:00+08:00`).toISOString();
  const previewMessage = '本地预览归档，不代表实时平台状态。';
  return {
    archiveDate,
    availableDates: [archiveDate],
    origin: 'cache',
    snapshot: {
      fetchedAt,
      items: [
        {
          id: `browser-preview:zhihu:${archiveDate}`,
          platform: 'zhihu',
          platformLabel: '知乎',
          category: 'knowledge',
          rank: 1,
          title: '为什么越来越多创作者开始用 AI 做视频分镜？',
          url: 'https://example.com/storydream-preview/ai-storyboard',
          hotValue: '',
          summary: '讨论集中在三个变化：先用文字拆出冲突、转折和证据，再生成镜头清单，最后把旁白、字幕和画面放到同一条时间线上校验。实际效率取决于资料质量和人工复核，而不是单次生成速度。',
          updatedAt: fetchedAt,
          sourceId: 'uapi',
          sourceLabel: '本地预览归档',
        },
        {
          id: `browser-preview:bilibili:${archiveDate}`,
          platform: 'bilibili',
          platformLabel: 'B 站',
          category: 'video',
          rank: 2,
          title: '一条知识短视频，从选题到成片要经过哪些步骤',
          url: 'https://example.com/storydream-preview/video-workflow',
          hotValue: '',
          summary: '内容把流程拆为选题验证、资料收集、脚本结构、分镜设计、配音字幕和成片复核六步，并强调每个事实都要保留来源链接。评论关注最多的是如何避免只根据标题扩写，以及怎样让字幕时间与镜头节奏一致。',
          updatedAt: fetchedAt,
          sourceId: 'uapi',
          sourceLabel: '本地预览归档',
        },
        {
          id: `browser-preview:techmeme:${archiveDate}`,
          platform: 'techmeme',
          platformLabel: '科技 / AI',
          category: 'tech',
          rank: 3,
          title: '多模态模型更新后，内容团队更关注工作流落地',
          url: 'https://example.com/storydream-preview/multimodal-workflow',
          hotValue: '',
          summary: '行业讨论从单项模型能力转向完整工作流：来源正文能否追溯、提示词是否可复用、图像与视频风格能否保持一致，以及失败环节能否单独重跑。对内容团队而言，稳定交付比一次演示效果更重要。',
          updatedAt: fetchedAt,
          sourceId: 'techmeme',
          sourceLabel: '本地预览归档',
        },
      ],
      platformStatuses: [
        { platform: 'zhihu', label: '知乎', state: 'ready', count: 1, updatedAt: fetchedAt, message: previewMessage },
        { platform: 'bilibili', label: 'B 站', state: 'ready', count: 1, updatedAt: fetchedAt, message: previewMessage },
        { platform: 'techmeme', label: '科技 / AI', state: 'ready', count: 1, updatedAt: fetchedAt, message: previewMessage },
      ],
      sourceAssessments: HOT_BOARD_SOURCE_ASSESSMENTS.map((source) => ({ ...source })),
      warnings: [BROWSER_HOT_BOARD_PREVIEW_WARNING],
    },
  };
}

function detectBrowserViralPlatform(url: string): ViralPlatform {
  const normalized = url.toLowerCase();
  if (/douyin\.com|iesdouyin\.com|amemv\.com/.test(normalized)) return 'douyin';
  if (/kuaishou\.com|gifshow\.com|kwai\.com/.test(normalized)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/.test(normalized)) return 'bilibili';
  return 'unknown';
}

function buildImageStyleDraftFromPrompt(prompt: string, base: CustomStyle): Pick<CustomStyle, 'name' | 'tag' | 'shortName' | 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor' | 'description'> {
  const normalized = prompt.trim() || base.name;
  const tags = normalized
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const name = tags[0] || normalized.slice(0, 12) || base.name;
  return {
    name,
    tag: tags.length ? tags.join('、') : base.tag,
    shortName: name.slice(0, 4),
    prefix: [normalized, base.prefix].filter(Boolean).join('，'),
    suffix: base.suffix || '高质量，清晰细节，电影级构图',
    negativePrompt: base.negativePrompt || '模糊，噪点，过曝，低质量，水印，文字',
    allowColor: !/黑白|单色|mono/i.test(normalized) && base.allowColor,
    description: `适合${normalized}题材。`,
  };
}

function activeImageResolution(config: AppState['config']) {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

type FallbackTombstoneEntry = {
  revision: number;
  cleanupState: 'unmanaged-legacy';
};

type FallbackGovernanceState = {
  revision: number;
  tombstones: Partial<Record<HistoryFamily, Record<string, FallbackTombstoneEntry>>>;
};

function fallbackTombstoneResult(
  family: HistoryFamily,
  id: string,
  revision: number,
): AppMutationResult {
  switch (family) {
    case 'task':
      return { kind: 'task-tombstone', id, revision };
    case 'viral-analysis':
      return { kind: 'viral-tombstone', id, revision };
    case 'image-lab':
      return { kind: 'image-lab-tombstone', id, revision };
    case 'voice-lab':
      return { kind: 'voice-lab-tombstone', id, revision };
  }
}

const fallbackGovernanceStorageKey = 'storydream-history-governance-v1';
const fallbackEnvelopeVersion = 1 as const;

type FallbackStorageEnvelope = FallbackGovernanceState & {
  version: typeof fallbackEnvelopeVersion;
  state: AppState;
};

function parseFallbackGovernance(value: unknown): FallbackGovernanceState {
  const empty: FallbackGovernanceState = { revision: 0, tombstones: {} };
  if (!value || typeof value !== 'object') return empty;
  const parsed = value as Partial<FallbackGovernanceState>;
  const revision = Number.isSafeInteger(parsed.revision) && Number(parsed.revision) >= 0
    ? Number(parsed.revision)
    : 0;
  const tombstones: FallbackGovernanceState['tombstones'] = {};
  for (const family of ['task', 'viral-analysis', 'image-lab', 'voice-lab'] as HistoryFamily[]) {
    const incoming = parsed.tombstones?.[family];
    if (!incoming || typeof incoming !== 'object') continue;
    for (const [id, entry] of Object.entries(incoming)) {
      if (!Number.isSafeInteger(entry?.revision) || entry.revision < 0) continue;
      (tombstones[family] ??= {})[id] = {
        revision: entry.revision,
        cleanupState: 'unmanaged-legacy',
      };
    }
  }
  return { revision, tombstones };
}

function readFallbackEnvelope(): FallbackStorageEnvelope {
  let stored: Partial<FallbackStorageEnvelope> | null = null;
  const rawEnvelope = localStorage.getItem(fallbackGovernanceStorageKey);
  if (rawEnvelope) {
    try {
      stored = JSON.parse(rawEnvelope) as Partial<FallbackStorageEnvelope>;
    } catch {
      stored = null;
    }
  }
  const governance = parseFallbackGovernance(stored);
  let sourceState: AppState;
  if (stored?.version === fallbackEnvelopeVersion && stored.state && typeof stored.state === 'object') {
    sourceState = hydrateState(stored.state as AppState);
  } else {
    const rawState = localStorage.getItem('storydream-state') ?? localStorage.getItem('storybound-state');
    sourceState = rawState ? hydrateState(JSON.parse(rawState) as AppState) : cloneState(initialState);
  }
  const filtered = filterFallbackTombstones(sourceState, governance);
  return {
    version: fallbackEnvelopeVersion,
    ...governance,
    state: { ...filtered, config: stripConfigSecrets(filtered.config), secretStatus: {} },
  };
}

function commitFallbackEnvelope(envelope: FallbackStorageEnvelope): void {
  // One synchronous tab-local write; localStorage provides neither cross-tab CAS nor crash transactions.
  localStorage.setItem(fallbackGovernanceStorageKey, JSON.stringify(envelope));
}

function filterFallbackTombstones(state: AppState, governance: FallbackGovernanceState): AppState {
  const deleted = (family: HistoryFamily, id: string) => Boolean(governance.tombstones[family]?.[id]);
  return {
    ...state,
    tasks: state.tasks.filter((task) => !deleted('task', task.id)),
    events: state.events.filter((event) => !deleted('task', event.taskId)),
    viralAnalyses: state.viralAnalyses.filter((record) => !deleted('viral-analysis', record.id)),
    viralEvents: state.viralEvents.filter((event) => !deleted('viral-analysis', event.analysisId)),
    imageLabRecords: state.imageLabRecords.filter((record) => !deleted('image-lab', record.id)),
    voiceLabRecords: state.voiceLabRecords.filter((record) => !deleted('voice-lab', record.id)),
  };
}

function fallbackHistoryPage<F extends HistoryFamily, T>(family: F, items: T[]): HistoryPage<F, T> {
  return {
    family,
    items,
    totalCount: items.length,
    hasMore: false,
    nextCursor: null,
  };
}

export function makeFallbackApi(setState: (state: AppState) => void): StoryDreamApi {
  const readEnvelope = () => readFallbackEnvelope();
  const read = () => readEnvelope().state;
  const commitState = (state: AppState, governance: FallbackGovernanceState): AppState => {
    const filtered = filterFallbackTombstones(hydrateState(state), governance);
    const sanitized = { ...filtered, config: stripConfigSecrets(filtered.config), secretStatus: {} };
    commitFallbackEnvelope({ version: fallbackEnvelopeVersion, ...governance, state: sanitized });
    setState(sanitized);
    return sanitized;
  };
  const loadFallbackPromptTemplates = async (): Promise<AppState> => {
    const defaults = await loadDefaultPromptTemplates();
    const envelope = readEnvelope();
    const custom = envelope.state.promptTemplates.filter((template) => !template.isBuiltin);
    const next = { ...envelope.state, promptTemplates: [...defaults, ...custom] as PromptTemplate[] };
    if (!changed(envelope.state.promptTemplates, next.promptTemplates)) return envelope.state;
    return commitState(next, { revision: envelope.revision, tombstones: envelope.tombstones });
  };
  const readBookSelections = () => {
    const raw = localStorage.getItem('storybound-book-selections');
    if (!raw) return [] as BookSelectionRecord[];
    try {
      return JSON.parse(raw) as BookSelectionRecord[];
    } catch {
      return [] as BookSelectionRecord[];
    }
  };
  const writeBookSelections = (records: BookSelectionRecord[]) => {
    localStorage.setItem('storybound-book-selections', JSON.stringify(records));
    return records;
  };
  const readBenchmarkGroups = (): BenchmarkGroup[] => {
    try {
      return JSON.parse(localStorage.getItem('storydream-benchmark-groups') || '[]') as BenchmarkGroup[];
    } catch {
      return [];
    }
  };
  const writeBenchmarkGroups = (records: BenchmarkGroup[]): BenchmarkGroup[] => {
    localStorage.setItem('storydream-benchmark-groups', JSON.stringify(records));
    return records;
  };
  const readBenchmarkPosts = (): BenchmarkPost[] => {
    try {
      return JSON.parse(localStorage.getItem('storydream-benchmark-posts') || '[]') as BenchmarkPost[];
    } catch {
      return [];
    }
  };
  const writeBenchmarkPosts = (records: BenchmarkPost[]): BenchmarkPost[] => {
    localStorage.setItem('storydream-benchmark-posts', JSON.stringify(records));
    return records;
  };
  const changed = (left: unknown, right: unknown) => JSON.stringify(left) !== JSON.stringify(right);
  const mutationForState = (previous: AppState, next: AppState, revision: number): AppMutationResult | null => {
    const task = next.tasks.find((item) => {
      const old = previous.tasks.find((candidate) => candidate.id === item.id);
      return !old || changed(old, item);
    });
    if (task) return { kind: 'task-upsert', task: taskToSummary(task), revision };
    const viral = next.viralAnalyses.find((item) => {
      const old = previous.viralAnalyses.find((candidate) => candidate.id === item.id);
      return !old || changed(old, item);
    });
    if (viral) {
      const { settings: _settings, resultPath: _resultPath, videoPath: _videoPath, ...record } = viral;
      return { kind: 'viral-upsert', record, revision };
    }
    let patch: Extract<AppDelta, { kind: 'state-patch' }>['patch'] | null = null;
    if (changed(previous.config, next.config) && changed(previous.ui, next.ui)) {
      patch = { kind: 'theme-preference', config: next.config, ui: next.ui };
    } else if (changed(previous.config, next.config)) patch = { kind: 'config', config: next.config, secretStatus: {} };
    else if (changed(previous.promptTemplates, next.promptTemplates)) {
      const changedTemplates = next.promptTemplates.filter((template) => {
        const old = previous.promptTemplates.find((candidate) => candidate.id === template.id);
        return !old || changed(old, template);
      });
      patch = changedTemplates.length === 1
        ? { kind: 'prompt-template-upsert', template: changedTemplates[0] }
        : {
            kind: 'prompt-templates-reset',
            templates: next.promptTemplates.filter((template) => template.isBuiltin).map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
          };
    } else if (changed(previous.customStyles, next.customStyles)) {
      const style = next.customStyles.find((item) => !previous.customStyles.some((old) => old.id === item.id && !changed(old, item)));
      if (style) patch = { kind: 'custom-style-upsert', style };
    } else if (changed(previous.draftTemplates, next.draftTemplates)) {
      const template = next.draftTemplates.find((item) => !previous.draftTemplates.some((old) => old.id === item.id && !changed(old, item)));
      const deletedTemplate = previous.draftTemplates.find((item) => !next.draftTemplates.some((candidate) => candidate.id === item.id));
      if (template) patch = { kind: 'draft-template-upsert', template };
      else if (deletedTemplate) patch = { kind: 'draft-template-delete', templateId: deletedTemplate.id };
    } else if (changed(previous.imageLabRecords, next.imageLabRecords) && next.imageLabRecords[0]) {
      const { prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record } = next.imageLabRecords[0];
      patch = { kind: 'image-lab-upsert', record: { ...record, promptPreview: prompt.slice(0, 160) } };
    } else if (changed(previous.voiceLabRecords, next.voiceLabRecords) && next.voiceLabRecords[0]) {
      const { text, ...record } = next.voiceLabRecords[0];
      patch = { kind: 'voice-lab-upsert', record: { ...record, textPreview: text.slice(0, 160) } };
    } else if (changed(previous.minimaxCloneVoices, next.minimaxCloneVoices)) {
      const changedVoice = next.minimaxCloneVoices.find((voice) => {
        const existing = previous.minimaxCloneVoices.find((candidate) => candidate.voiceId === voice.voiceId);
        return !existing || changed(existing, voice);
      });
      const deletedVoice = previous.minimaxCloneVoices.find((voice) => !next.minimaxCloneVoices.some((candidate) => candidate.voiceId === voice.voiceId));
      if (changedVoice) patch = { kind: 'minimax-clone-voice-upsert', voice: changedVoice };
      else if (deletedVoice) patch = { kind: 'minimax-clone-voice-delete', voiceId: deletedVoice.voiceId };
    } else if (changed(previous.account, next.account)) patch = { kind: 'account', account: next.account };
    else if (changed(previous.activation, next.activation)) patch = { kind: 'activation', activation: next.activation };
    else if (changed(previous.ui, next.ui)) patch = { kind: 'ui', ui: next.ui };
    return patch ? { kind: 'state-patch', patch, revision } : null;
  };
  const persist = (state: AppState): AppMutationResult | null => {
    const previous = readEnvelope();
    const next = filterFallbackTombstones(hydrateState(state), previous);
    const sanitized = { ...next, config: stripConfigSecrets(next.config), secretStatus: {} };
    const revision = previous.revision + 1;
    const mutation = mutationForState(previous.state, sanitized, revision);
    commitState(sanitized, {
      revision: mutation ? revision : previous.revision,
      tombstones: previous.tombstones,
    });
    return mutation;
  };

  const historyRecord = (state: AppState, family: HistoryFamily, id: string) => {
    if (family === 'task') return state.tasks.find((record) => record.id === id);
    if (family === 'viral-analysis') return state.viralAnalyses.find((record) => record.id === id);
    if (family === 'image-lab') return state.imageLabRecords.find((record) => record.id === id);
    return state.voiceLabRecords.find((record) => record.id === id);
  };

  const commitFallbackHistoryUpsert = (
    family: HistoryFamily,
    state: AppState,
    id: string,
  ): AppMutationResult => {
    const current = readEnvelope();
    const revision = current.revision + 1;
    const saved = commitState(state, { revision, tombstones: current.tombstones });
    if (family === 'task') {
      const task = saved.tasks.find((record) => record.id === id);
      if (!task) throw new Error(`Task not found: ${id}`);
      return { kind: 'task-upsert', task: taskToSummary(task), revision };
    }
    if (family === 'viral-analysis') {
      const record = saved.viralAnalyses.find((item) => item.id === id);
      if (!record) throw new Error(`Viral analysis not found: ${id}`);
      const { settings: _settings, resultPath: _resultPath, videoPath: _videoPath, ...summary } = record;
      return { kind: 'viral-upsert', record: summary, revision };
    }
    if (family === 'image-lab') {
      const record = saved.imageLabRecords.find((item) => item.id === id);
      if (!record) throw new Error(`Image lab record not found: ${id}`);
      const { prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...summary } = record;
      return {
        kind: 'state-patch',
        patch: { kind: 'image-lab-upsert', record: { ...summary, promptPreview: prompt.slice(0, 160) } },
        revision,
      };
    }
    const record = saved.voiceLabRecords.find((item) => item.id === id);
    if (!record) throw new Error(`Voice lab record not found: ${id}`);
    const { text, ...summary } = record;
    return {
      kind: 'state-patch',
      patch: { kind: 'voice-lab-upsert', record: { ...summary, textPreview: text.slice(0, 160) } },
      revision,
    };
  };

  const archiveFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const state = read();
    const record = historyRecord(state, family, id);
    if (!record) throw new Error(`History record not found or deleted: ${family}/${id}`);
    if ((family === 'task' || family === 'viral-analysis')
      && (record.status === 'pending' || record.status === 'running')) {
      throw new Error('HISTORY_ACTIVE: Pending or running history cannot be archived.');
    }
    const archivedAt = record.archivedAt ?? new Date().toISOString();
    if (family === 'task') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    if (family === 'viral-analysis') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        viralAnalyses: state.viralAnalyses.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    if (family === 'image-lab') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        imageLabRecords: state.imageLabRecords.map((item) => item.id === id ? { ...item, archivedAt } : item),
      }, id);
    }
    return commitFallbackHistoryUpsert(family, {
      ...state,
      voiceLabRecords: state.voiceLabRecords.map((item) => item.id === id ? { ...item, archivedAt } : item),
    }, id);
  };

  const restoreFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const state = read();
    if (!historyRecord(state, family, id)) throw new Error(`History record not found or deleted: ${family}/${id}`);
    if (family === 'task') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    if (family === 'viral-analysis') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        viralAnalyses: state.viralAnalyses.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    if (family === 'image-lab') {
      return commitFallbackHistoryUpsert(family, {
        ...state,
        imageLabRecords: state.imageLabRecords.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
      }, id);
    }
    return commitFallbackHistoryUpsert(family, {
      ...state,
      voiceLabRecords: state.voiceLabRecords.map((item) => item.id === id ? { ...item, archivedAt: null } : item),
    }, id);
  };

  const deleteFallbackHistory = (family: HistoryFamily, id: string): AppMutationResult => {
    const current = readEnvelope();
    const existing = current.tombstones[family]?.[id];
    if (existing) return fallbackTombstoneResult(family, id, existing.revision);
    const state = current.state;
    const record = historyRecord(state, family, id);
    if (!record) throw new Error(`History record not found: ${family}/${id}`);
    if (!record.archivedAt) throw new Error('HISTORY_NOT_ARCHIVED: Permanent deletion requires an archived history record.');
    const revision = current.revision + 1;
    const entry: FallbackTombstoneEntry = { revision, cleanupState: 'unmanaged-legacy' };
    const tombstones = {
      ...current.tombstones,
      [family]: { ...current.tombstones[family], [id]: entry },
    };
    commitState(state, { revision, tombstones });
    return fallbackTombstoneResult(family, id, revision);
  };

  const matchesArchiveFilter = (record: { archivedAt?: string | null }, filter: 'active' | 'archived' = 'active') => (
    filter === 'archived' ? Boolean(record.archivedAt) : !record.archivedAt
  );
  const matchesFallbackQuery = (query: string | undefined, values: unknown[]) => {
    const normalized = query?.trim().toLocaleLowerCase();
    return !normalized || values.some((value) => String(value ?? '').toLocaleLowerCase().includes(normalized));
  };

  return {
    async getState() {
      return loadFallbackPromptTemplates();
    },
    async getBootstrap() {
      const state = await loadFallbackPromptTemplates();
      const envelope = readEnvelope();
      return {
        revision: envelope.revision,
        config: state.config,
        secretStatus: {},
        tasks: fallbackHistoryPage('task', state.tasks.filter((record) => !record.archivedAt).map(taskToSummary)),
        viralAnalyses: fallbackHistoryPage('viral-analysis', state.viralAnalyses.filter((record) => !record.archivedAt)),
        imageLabRecords: fallbackHistoryPage(
          'image-lab',
          state.imageLabRecords.filter((record) => !record.archivedAt).map(({ prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record }) => ({ ...record, promptPreview: prompt.slice(0, 160) })),
        ),
        voiceLabRecords: fallbackHistoryPage(
          'voice-lab',
          state.voiceLabRecords.filter((record) => !record.archivedAt).map(({ text, ...record }) => ({ ...record, textPreview: text.slice(0, 160) })),
        ),
        promptTemplates: {
          items: state.promptTemplates.map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
          nextCursor: null,
        },
        draftTemplates: {
          items: state.draftTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            isDefault: template.isDefault,
            canvas: { width: template.canvas.width, height: template.canvas.height, ratio: template.canvas.ratio },
            updatedAt: '',
          })),
          nextCursor: null,
        },
        customStyles: state.customStyles,
        customCoverTemplates: state.customCoverTemplates,
        creditTransactions: state.creditTransactions,
        minimaxCloneVoices: state.minimaxCloneVoices,
        account: state.account,
        activation: state.activation,
        ui: state.ui,
      } satisfies BootstrapState;
    },
    async reconcileDeltas(input) {
      const envelope = readEnvelope();
      const state = envelope.state;
      const revision = envelope.revision;
      return {
        revision,
        deltas: [],
        resetRequired: input.forceReset === true || input.sinceRevision < revision,
        task: input.taskId ? state.tasks.find((task) => task.id === input.taskId) ?? null : null,
        taskEvents: input.taskId
          ? state.events.filter((event) => event.taskId === input.taskId && Number.isInteger(event.seq)) as Array<TaskEvent & { seq: number }>
          : [],
        viralAnalysis: input.viralAnalysisId ? state.viralAnalyses.find((record) => record.id === input.viralAnalysisId) ?? null : null,
        viralEvents: input.viralAnalysisId ? state.viralEvents.filter((event) => event.analysisId === input.viralAnalysisId) : [],
      };
    },
    async listTasks(request: HistoryListInput<'task'> = {}) {
      const tasks = read().tasks.filter((task) => {
        if (!matchesArchiveFilter(task, request.filter)) return false;
        if (request.status && task.status !== request.status) return false;
        if (request.statuses && !request.statuses.includes(task.status)) return false;
        if (request.favorite !== undefined && Boolean(task.isFavorite) !== request.favorite) return false;
        const taskType = task.taskType?.trim() || (task.taskKind === 'music-mv' ? 'music-mv' : 'story');
        if (request.taskType && taskType !== request.taskType) return false;
        return matchesFallbackQuery(request.query, [task.title, task.inputText, task.aiKeyword]);
      });
      return fallbackHistoryPage('task', tasks.map(taskToSummary));
    },
    async setTaskFavorite(id: string, isFavorite: boolean) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task) throw new Error(`Task not found: ${id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      return commitFallbackHistoryUpsert('task', {
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? { ...item, isFavorite } : item),
      }, id);
    },
    async archiveTask(id: string) {
      return archiveFallbackHistory('task', id);
    },
    async restoreTask(id: string) {
      return restoreFallbackHistory('task', id);
    },
    async deleteTaskPermanently(id: string) {
      return deleteFallbackHistory('task', id);
    },
    async getTaskDetail(id) {
      return read().tasks.find((task) => task.id === id) ?? null;
    },
    async listTaskEvents(taskId) {
      return {
        items: read().events.filter((event) => event.taskId === taskId && Number.isInteger(event.seq)) as Array<TaskEvent & { seq: number }>,
        nextCursor: null,
      };
    },
    async openTaskOutputDirectory() {
      throw new Error('浏览器预览不能打开本地任务目录，请在 Electron 桌面端操作。');
    },
    async launchJianying() {
      throw new Error('浏览器预览不能启动剪映，请在 Electron 桌面端操作。');
    },
    async listViralAnalyses(request: HistoryListInput<'viral-analysis'> = {}) {
      const records = read().viralAnalyses.filter((record) => (
        matchesArchiveFilter(record, request.filter)
        && (!request.status || record.status === request.status)
        && matchesFallbackQuery(request.query, [record.title, record.url, record.platform])
      ));
      return fallbackHistoryPage('viral-analysis', records);
    },
    async archiveViralAnalysis(id: string) {
      return archiveFallbackHistory('viral-analysis', id);
    },
    async restoreViralAnalysis(id: string) {
      return restoreFallbackHistory('viral-analysis', id);
    },
    async deleteViralAnalysisPermanently(id: string) {
      return deleteFallbackHistory('viral-analysis', id);
    },
    async getViralAnalysisDetail(id) {
      return read().viralAnalyses.find((record) => record.id === id) ?? null;
    },
    async listViralEvents(analysisId) {
      return { items: read().viralEvents.filter((event) => event.analysisId === analysisId), nextCursor: null };
    },
    async listImageLabRecords(request: HistoryListInput<'image-lab'> = {}) {
      return fallbackHistoryPage(
        'image-lab',
        read().imageLabRecords
          .filter((record) => (
            matchesArchiveFilter(record, request.filter)
            && (!request.status || record.status === request.status)
            && matchesFallbackQuery(request.query, [record.prompt, record.provider, record.style])
          ))
          .map(({ prompt, referenceImagePaths: _paths, referenceImagePath: _path, ...record }) => ({ ...record, promptPreview: prompt.slice(0, 160) })),
      );
    },
    async archiveImageLabRecord(id: string) {
      return archiveFallbackHistory('image-lab', id);
    },
    async restoreImageLabRecord(id: string) {
      return restoreFallbackHistory('image-lab', id);
    },
    async deleteImageLabRecordPermanently(id: string) {
      return deleteFallbackHistory('image-lab', id);
    },
    async getImageLabRecordDetail(id) {
      return read().imageLabRecords.find((record) => record.id === id) ?? null;
    },
    async openImageLabOutputDirectory() {
      throw new Error('浏览器预览不能打开本地图片任务目录，请在 Electron 桌面端操作。');
    },
    async listVoiceLabRecords(request: HistoryListInput<'voice-lab'> = {}) {
      return fallbackHistoryPage(
        'voice-lab',
        read().voiceLabRecords
          .filter((record) => (
            matchesArchiveFilter(record, request.filter)
            && (!request.status || record.status === request.status)
            && matchesFallbackQuery(request.query, [record.text, record.voiceLabel, record.provider])
          ))
          .map(({ text, ...record }) => ({ ...record, textPreview: text.slice(0, 160) })),
      );
    },
    async archiveVoiceLabRecord(id: string) {
      return archiveFallbackHistory('voice-lab', id);
    },
    async restoreVoiceLabRecord(id: string) {
      return restoreFallbackHistory('voice-lab', id);
    },
    async deleteVoiceLabRecordPermanently(id: string) {
      return deleteFallbackHistory('voice-lab', id);
    },
    async getVoiceLabRecordDetail(id) {
      return read().voiceLabRecords.find((record) => record.id === id) ?? null;
    },
    async listPromptTemplates() {
      const state = await loadFallbackPromptTemplates();
      return {
        items: state.promptTemplates.map(({ content: _content, stepPrompts: _steps, imageSeedPoolsJson: _seeds, ...summary }) => summary),
        nextCursor: null,
      };
    },
    async getPromptTemplateDetail(id) {
      return (await loadFallbackPromptTemplates()).promptTemplates.find((template) => template.id === id) ?? null;
    },
    async listDraftTemplates() {
      return {
        items: read().draftTemplates.map((template) => ({
          id: template.id,
          name: template.name,
          isDefault: template.isDefault,
          canvas: { width: template.canvas.width, height: template.canvas.height, ratio: template.canvas.ratio },
          updatedAt: '',
        })),
        nextCursor: null,
      };
    },
    async getDraftTemplateDetail(id) {
      return read().draftTemplates.find((template) => template.id === id) ?? null;
    },
    async listMinimaxCloneVoices(request = {}) {
      const voices = read().minimaxCloneVoices;
      const start = request.cursor ? Math.max(0, Number.parseInt(request.cursor, 10) || 0) : 0;
      const limit = Math.min(100, Math.max(1, Math.trunc(request.limit ?? 50)));
      const items = voices.slice(start, start + limit);
      const next = start + items.length;
      return { items, totalCount: voices.length, nextCursor: next < voices.length ? String(next) : null };
    },
    async saveMinimaxCloneVoice(input) {
      const state = read();
      const existing = state.minimaxCloneVoices.find((voice) => voice.voiceId === input.voiceId) ?? null;
      const voice = mergeMinimaxCloneVoice(existing, input);
      return persist({
        ...state,
        minimaxCloneVoices: existing
          ? state.minimaxCloneVoices.map((item) => item.voiceId === voice.voiceId ? voice : item)
          : [voice, ...state.minimaxCloneVoices],
      });
    },
    async deleteMinimaxCloneVoice(voiceId) {
      const state = read();
      return persist({ ...state, minimaxCloneVoices: state.minimaxCloneVoices.filter((voice) => voice.voiceId !== voiceId) });
    },
    async saveConfig(input) {
      if (Object.keys(input.secretChanges).length > 0) {
        throw new Error('浏览器预览不会安全保存接口密钥，请在 Electron 桌面端配置并保存。');
      }
      return persist({ ...read(), config: input.config });
    },
    async testLlmConfig(config) {
      const endpoint =
        config.protocol === 'anthropic'
          ? `${config.baseUrl || 'https://api.anthropic.com'}/v1/messages`
          : `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
      return {
        status: config.apiKey ? 'warn' : 'fail',
        detail: config.apiKey ? '浏览器预览无法调用模型测试接口，请在 Electron 桌面端测试。' : '接口密钥未填写，请先补全模型凭证。',
        latencyMs: 0,
        model: config.model,
        endpoint,
        requestId: null,
      };
    },
    async listProviderModels(request) {
      const baseUrl = request.baseUrl.trim().replace(/\/+$/, '');
      const endpoint = `${baseUrl || (request.protocol === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com')}/v1/models`;
      return {
        status: 'warn',
        detail: '浏览器预览无法安全加载模型列表，请在 Electron 桌面端使用。',
        latencyMs: 0,
        endpoint,
        models: [],
      };
    },
    async listVolcengineSpeakers() {
      const speakers = volcengineVoicePresets.map(([name, voiceType]) => ({ voiceType, name }));
      return {
        status: 'warn',
        detail: '浏览器预览无法调用火山 OpenAPI，已展示本地预设音色。请在 Electron 桌面端加载全部音色。',
        latencyMs: 0,
        endpoint: 'https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20',
        speakers,
        total: speakers.length,
        requestId: null,
      };
    },
    async testAppConfig(target, config) {
      return validateConfigTarget(target, config);
    },
    async fetchImaKnowledge() {
      return {
        status: 'fail',
        detail: '浏览器预览无法安全访问 IMA 知识库，请在 Electron 桌面端使用。',
        latencyMs: 0,
        endpoint: 'https://ima.qq.com/openapi/wiki/v1/search_knowledge',
        requestId: null,
        knowledgeBaseId: '',
        records: [],
        totalCount: 0,
      };
    },
    async searchWebSources(input) {
      const query = typeof input === 'string' ? input : input.query;
      return {
        query,
        sections: [],
        warnings: ['浏览器预览无法直接抓取网页正文，请在 Electron 桌面端使用搜索。'],
      };
    },
    async composeResearchCopy() {
      throw new Error('浏览器预览无法调用真实 LLM 生成文案，请在 Electron 桌面端配置模型后使用。');
    },
    async fetchHotBoard(input = {}) {
      const previewDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
      const archiveDate = input.date ?? previewDate;
      if (archiveDate !== previewDate) {
        return { archiveDate, availableDates: [previewDate], origin: 'missing' as const, snapshot: null };
      }
      return createBrowserHotBoardPreviewArchive(archiveDate);
    },
    async readHotBoardSource(input) {
      const content = input.summary?.trim() ?? '';
      const media = input.url.includes('/storydream-preview/ai-storyboard') ? [
        {
          type: 'image' as const,
          url: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80',
          width: 1200,
          height: 800,
          alt: '内容团队协作空间',
        },
        {
          type: 'image' as const,
          url: 'https://images.unsplash.com/photo-1497215842964-222b430dc094?auto=format&fit=crop&w=1200&q=80',
          width: 1200,
          height: 800,
          alt: '创作工作台与分镜讨论',
        },
      ] : undefined;
      return {
        title: input.title.trim(),
        url: input.url.trim(),
        content,
        excerpt: content.slice(0, 600),
        kind: content ? 'summary' as const : 'unavailable' as const,
        fetchedAt: new Date().toISOString(),
        ...(media ? { media } : {}),
        warning: '浏览器预览不执行跨站正文读取；当前只使用本地预览归档摘要，不代表实时数据。',
      };
    },
    async queryAiHot() {
      throw new Error('浏览器预览无法读取 AIHOT 实时信息，请在 Electron 桌面端使用。');
    },
    async openHotBoardUrl(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    async savePromptTemplate(template: PromptTemplate) {
      const state = read();
      const next = state.promptTemplates.filter((item) => item.id !== template.id);
      return persist({ ...state, promptTemplates: [{ ...template, updatedAt: new Date().toISOString() }, ...next] });
    },
    async resetPromptTemplates() {
      const state = read();
      const custom = state.promptTemplates.filter((template) => !template.isBuiltin);
      const defaults = await loadDefaultPromptTemplates();
      return persist({ ...state, promptTemplates: [...defaults, ...custom] as PromptTemplate[] });
    },
    async saveCustomStyle(style: CustomStyle) {
      const state = read();
      const next = state.customStyles.filter((item) => item.id !== style.id);
      const now = new Date().toISOString();
      return persist({ ...state, customStyles: [{ ...style, updatedAt: now, createdAt: style.createdAt || now }, ...next] });
    },
    async saveViralTemplates(input) {
      const state = read();
      const promptTemplates = [
        { ...input.storyTemplate, isBuiltin: false, updatedAt: new Date().toISOString() },
        ...state.promptTemplates.filter((item) => item.id !== input.storyTemplate.id),
      ];
      const now = new Date().toISOString();
      const customStyles = [
        { ...input.imageTemplate, createdAt: input.imageTemplate.createdAt || now, updatedAt: input.imageTemplate.updatedAt || now },
        ...state.customStyles.filter((item) => item.id !== input.imageTemplate.id),
      ];
      return persist({ ...state, promptTemplates, customStyles });
    },
    async generateCustomStyleDraft(input) {
      return { ...input.baseStyle, ...buildImageStyleDraftFromPrompt(input.prompt, input.baseStyle) };
    },
    async saveDraftTemplate(template: DraftTemplate) {
      const state = read();
      const exists = state.draftTemplates.some((item) => item.id === template.id);
      const templates = exists ? state.draftTemplates.map((item) => (item.id === template.id ? template : item)) : [template, ...state.draftTemplates];
      return persist({ ...state, draftTemplates: templates });
    },
    async deleteDraftTemplate(id: string) {
      const state = read();
      const template = state.draftTemplates.find((item) => item.id === id);
      if (!template) throw new Error(`DRAFT_TEMPLATE_NOT_FOUND: ${id}`);
      if (template.isDefault) throw new Error('DRAFT_TEMPLATE_BUILTIN_DELETE_FORBIDDEN: System draft templates cannot be deleted.');
      return persist({ ...state, draftTemplates: state.draftTemplates.filter((item) => item.id !== id) });
    },
    async generateImageLab(input: ImageLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: state.config.imageProvider,
        imagePath: '',
        status: 'failed',
        errorMessage: '浏览器预览无法调用真实生图模型，请在 Electron 桌面端使用。',
        resolution: input.resolution ?? activeImageResolution(state.config),
        quality: input.quality ?? 'medium',
        smartMode: input.smartMode ?? 'text-to-image',
        referenceImagePaths: input.referenceImagePaths?.length ? input.referenceImagePaths : input.referenceImagePath ? [input.referenceImagePath] : [],
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async generateVoiceLabPreview(input: VoiceLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: VoiceLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        text: input.text,
        provider: input.provider,
        voiceId: input.voiceId,
        voiceLabel: input.voiceLabel ?? taskSpeakerLabel(input.provider, input.voiceId, state.minimaxCloneVoices),
        speed: input.speed,
        audioPath: '',
        status: 'failed',
        errorMessage: '浏览器预览不能调用真实 TTS，请在 Electron 桌面端生成试听。',
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, voiceLabRecords: [record, ...state.voiceLabRecords] });
    },
    async addImageLabRecord(input: ImageLabImportInput) {
      void input;
      throw new Error('IMAGE_LAB_IMPORT_REQUIRES_ELECTRON: 浏览器预览不能导入受管图片。');
    },
    async saveAccount(account: AccountProfile) {
      return persist({ ...read(), account });
    },
    async saveActivation(activation: ActivationState) {
      return persist({ ...read(), activation });
    },
    async saveUiPreferences(update: UiPreferencesUpdate) {
      const current = read();
      const ui = {
        ...current.ui,
        ...update,
        themePreferenceVersion: 1 as const,
      };
      return persist({ ...current, ui, config: { ...current.config, ui: { theme: ui.theme } } });
    },
    async listBookSelections(theme) {
      const records = readBookSelections();
      return theme ? records.filter((record) => record.theme === theme) : records;
    },
    async discoverBooks(input) {
      return buildBookDiscoveryFallback(input, '浏览器预览不直接访问当当，Electron 桌面端会读取真实公开结果。');
    },
    async saveBookSelection(input) {
      const records = readBookSelections();
      const record = { theme: input.theme.trim(), bookId: input.bookId?.trim() || `b-${Date.now()}`, data: input.data, updatedAt: Date.now() };
      const previous = input.previousIdentity;
      const previousIndex = previous ? records.findIndex((item) => item.theme === previous.theme && item.bookId === previous.bookId) : -1;
      if (previous && previousIndex < 0) throw new Error('BOOK_SELECTION_STALE_IDENTITY: 所选记录已被修改或删除。');
      const destinationIndex = records.findIndex((item) => item.theme === record.theme && item.bookId === record.bookId);
      const sameIdentity = previous?.theme === record.theme && previous?.bookId === record.bookId;
      if ((!previous && destinationIndex >= 0) || (previous && !sameIdentity && destinationIndex >= 0)) {
        throw new Error('BOOK_SELECTION_DESTINATION_CONFLICT: 目标主题和书目 ID 已存在。');
      }
      const retained = records.filter((_, index) => index !== previousIndex && index !== (sameIdentity ? destinationIndex : -1));
      writeBookSelections([record, ...retained]);
      return record;
    },
    async deleteBookSelection(theme, bookId) {
      writeBookSelections(readBookSelections().filter((record) => !(record.theme === theme && record.bookId === bookId)));
      return undefined;
    },
    async listBenchmarkGroups() {
      return readBenchmarkGroups();
    },
    async saveBenchmarkGroup(input) {
      const records = readBenchmarkGroups();
      const existing = input.id ? records.find((record) => record.id === input.id) : null;
      const record = normalizeBenchmarkGroupInput(input, existing);
      writeBenchmarkGroups([record, ...records.filter((item) => item.id !== record.id)]);
      return record;
    },
    async deleteBenchmarkGroup(id) {
      writeBenchmarkGroups(readBenchmarkGroups().filter((record) => record.id !== id));
      writeBenchmarkPosts(readBenchmarkPosts().filter((record) => record.groupId !== id));
    },
    async listBenchmarkPosts(groupId) {
      const records = readBenchmarkPosts();
      return groupId ? records.filter((record) => record.groupId === groupId) : records;
    },
    async saveBenchmarkPost(input) {
      const groups = readBenchmarkGroups();
      if (!groups.some((group) => group.id === input.groupId)) throw new Error('BENCHMARK_GROUP_NOT_FOUND: 对标组不存在或已删除。');
      const records = readBenchmarkPosts();
      const existing = input.id ? records.find((record) => record.id === input.id) : null;
      const record = normalizeBenchmarkPostInput(input, existing);
      writeBenchmarkPosts([record, ...records.filter((item) => item.id !== record.id)]);
      return record;
    },
    async deleteBenchmarkPost(id) {
      writeBenchmarkPosts(readBenchmarkPosts().filter((record) => record.id !== id));
    },
    async syncBenchmarkGroup() {
      throw new Error('BENCHMARK_SYNC_REQUIRES_ELECTRON: 浏览器预览只保留本地作品和指标快照，请在 Electron 桌面端同步账号。');
    },
    async openBenchmarkLogin() {
      throw new Error('BENCHMARK_LOGIN_REQUIRES_ELECTRON: 浏览器预览不能保存平台登录会话。');
    },
    async listPersonAssets() {
      return [];
    },
    async createPersonAsset(name) {
      return { name, count: 0, dir: '', updatedAt: Date.now() };
    },
    async renamePersonAsset(_oldName, newName) {
      return newName;
    },
    async deletePersonAsset() {
      return undefined;
    },
    async importPersonAssetImages() {
      return 0;
    },
    async listPersonAssetImages() {
      return [];
    },
    async openPersonAssetDirectory() {
      throw new Error('浏览器预览不能打开本地人物素材目录，请在 Electron 桌面端操作。');
    },
    async createEditorialCollage(input) {
      const validated = editorialCollageCreateInputSchema.parse(input);
      const state = read();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const draft = createEditorialCollageDraft({ id, title: validated.title, ratio: validated.ratio, now });
      const document = createEditorialCollageStarterPlan(draft, validated.sourceText, now, {
        beatCount: validated.beatCount,
        totalDurationMs: validated.totalDurationMs,
      });
      const task: Task = {
        id,
        title: document.title,
        inputText: validated.sourceText,
        taskKind: 'story',
        processingMode: 'manual',
        publishMode: 'review-rewrite',
        status: 'draft',
        currentStep: 0,
        runGeneration: 0,
        track: 'editorial-explainer',
        style: 'archival-red',
        speaker: '灿博小叔',
        ratio: document.ratio,
        templateId: 'default-portrait-9-16',
        bgmId: '',
        pausePoints: [],
        outputDir: '',
        errorMessage: '',
        createdAt: now,
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: 'paste',
        aiKeyword: '',
        aiSources: [],
        selectedSources: [],
        extraRequirements: '',
        imagePromptReference: '',
        promptTemplateId: null,
        promptTemplateType: null,
        referenceImagePath: '',
        rewriteIntensity: 'standard',
        narrativePov: 'keep-original',
        keepPromotion: false,
        ttsProvider: 'volcengine',
        ttsSpeed: 1,
        step3PromptSnapshot: '',
        musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'none', visualMotif: '', audioPath: '' },
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: '',
        videoForm: 'narration',
        materialSource: 'paste',
        taskType: EDITORIAL_COLLAGE_TASK_TYPE,
        pipelineStep: document.stage,
        pipelineData: JSON.stringify(document),
      };
      return commitFallbackHistoryUpsert('task', { ...state, tasks: [task, ...state.tasks] }, task.id);
    },
    async saveEditorialCollage(input) {
      const validated = editorialCollageSaveInputSchema.parse(input);
      const state = read();
      const task = state.tasks.find((item) => item.id === validated.id);
      if (!task) throw new Error(`EDITORIAL_COLLAGE_NOT_FOUND: ${validated.id}`);
      if (task.taskType !== EDITORIAL_COLLAGE_TASK_TYPE) throw new Error('EDITORIAL_COLLAGE_TASK_INVALID: The selected task is not a VOX project.');
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('EDITORIAL_COLLAGE_ACTIVE: 运行中的项目不能编辑。');
      const current = parseEditorialCollagePipelineData(task.pipelineData);
      if (current.updatedAt !== validated.expectedUpdatedAt) throw new Error('EDITORIAL_COLLAGE_STALE_WRITE: The project changed after it was loaded.');
      if (validated.document.id !== validated.id || validated.document.createdAt !== current.createdAt) throw new Error('EDITORIAL_COLLAGE_IDENTITY_MISMATCH: Project identity fields cannot be changed.');
      if (validated.document.updatedAt !== validated.expectedUpdatedAt) throw new Error('EDITORIAL_COLLAGE_REVISION_MISMATCH: The document revision must match expectedUpdatedAt.');
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const document = parseEditorialCollagePipelineData({ ...validated.document, title: validated.document.title.trim(), updatedAt });
      const updated: Task = {
        ...task,
        title: document.title,
        ratio: document.ratio,
        status: document.stage === 'completed' ? 'completed' : 'draft',
        pipelineStep: document.stage,
        pipelineData: JSON.stringify(document),
        completedAt: document.stage === 'completed' ? updatedAt : null,
      };
      return commitFallbackHistoryUpsert('task', {
        ...state,
        tasks: state.tasks.map((item) => item.id === task.id ? updated : item),
      }, task.id);
    },
    async createMotionComic(input) {
      const validated = motionComicCreateInputSchema.parse(input);
      const state = read();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const draft = createMotionComicDraft({ id, title: validated.title, premise: validated.premise, ratio: validated.ratio, now });
      const document = createMotionComicStarterProject(draft, validated.episodeTitle, now);
      const task: Task = {
        id,
        title: document.title,
        inputText: validated.premise,
        taskKind: 'story',
        processingMode: 'manual',
        publishMode: 'review-rewrite',
        status: 'draft',
        currentStep: 0,
        runGeneration: 0,
        track: 'motion-comic',
        style: 'cinematic-comic',
        speaker: '灿博小叔',
        ratio: document.ratio,
        templateId: 'default-portrait-9-16',
        bgmId: '',
        pausePoints: [],
        outputDir: '',
        errorMessage: '',
        createdAt: now,
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: 'paste',
        aiKeyword: '',
        aiSources: [],
        selectedSources: [],
        extraRequirements: '',
        imagePromptReference: '',
        promptTemplateId: null,
        promptTemplateType: null,
        referenceImagePath: '',
        rewriteIntensity: 'standard',
        narrativePov: 'keep-original',
        keepPromotion: false,
        ttsProvider: 'volcengine',
        ttsSpeed: 1,
        step3PromptSnapshot: '',
        musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'none', visualMotif: '', audioPath: '' },
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: '',
        videoForm: 'narration',
        materialSource: 'paste',
        taskType: MOTION_COMIC_TASK_TYPE,
        pipelineStep: document.stage,
        pipelineData: JSON.stringify(document),
      };
      return commitFallbackHistoryUpsert('task', { ...state, tasks: [task, ...state.tasks] }, task.id);
    },
    async saveMotionComic(input) {
      const validated = motionComicSaveInputSchema.parse(input);
      const state = read();
      const task = state.tasks.find((item) => item.id === validated.id);
      if (!task) throw new Error(`MOTION_COMIC_NOT_FOUND: ${validated.id}`);
      if (task.taskType !== MOTION_COMIC_TASK_TYPE) throw new Error('MOTION_COMIC_TASK_INVALID: The selected task is not an AI motion-comic project.');
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('MOTION_COMIC_ACTIVE: 运行中的项目不能编辑。');
      const current = parseMotionComicPipelineData(task.pipelineData);
      if (current.updatedAt !== validated.expectedUpdatedAt) throw new Error('MOTION_COMIC_STALE_WRITE: The project changed after it was loaded.');
      if (validated.document.id !== validated.id || validated.document.createdAt !== current.createdAt) throw new Error('MOTION_COMIC_IDENTITY_MISMATCH: Project identity fields cannot be changed.');
      if (validated.document.updatedAt !== validated.expectedUpdatedAt) throw new Error('MOTION_COMIC_REVISION_MISMATCH: The document revision must match expectedUpdatedAt.');
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString();
      const document = parseMotionComicPipelineData({ ...validated.document, title: validated.document.title.trim(), updatedAt });
      const updated: Task = {
        ...task,
        title: document.title,
        ratio: document.ratio,
        status: document.stage === 'completed' ? 'completed' : 'draft',
        pipelineStep: document.stage,
        pipelineData: JSON.stringify(document),
        completedAt: document.stage === 'completed' ? updatedAt : null,
      };
      return commitFallbackHistoryUpsert('task', {
        ...state,
        tasks: state.tasks.map((item) => item.id === task.id ? updated : item),
      }, task.id);
    },
    async renderDirectorProject() {
      throw new Error('DIRECTOR_RENDER_DESKTOP_ONLY: 导演台成片需要 Electron 桌面端的本地渲染器。');
    },
    async createHtmlVideoTask(input: CreateTaskInput) {
      const state = read();
      const now = new Date().toISOString();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'HTML 动画视频',
        inputText: input.inputText,
        taskKind: 'story',
        processingMode: input.processingMode ?? 'full-auto',
        publishMode: input.publishMode ?? 'review-rewrite',
        status: 'draft',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'modern-film',
        speaker: input.speaker ?? '灿博小叔',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: '',
        createdAt: now,
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        imagePromptReference: input.imagePromptReference ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.targetScenes ?? input.storyboardSceneCount,
        targetLength: input.targetLength,
        targetScenes: input.targetScenes ?? input.storyboardSceneCount,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        musicMv: input.musicMv ?? { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
        videoForm: input.videoForm ?? 'narration',
        failedStep: null,
        retryFromStep: null,
        artifactStatePath: '',
        materialSource: input.materialSource ?? 'paste',
        taskType: 'html-video',
        pipelineStep: input.pipelineStep ?? 'rewrite',
        pipelineData: input.pipelineData ?? '{}',
        coverImageMode: input.coverImageMode ?? 'off',
        coverTemplateId: input.coverTemplateId ?? 'cinematic-poster',
        autoBorrowImage: input.autoBorrowImage ?? false,
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'pipeline_ready', step: 0, agent: 'HTML Video', tool: null, detail: 'HTML 动画视频任务已创建，等待改写与分句。', dataJson: task.pipelineData ?? null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async updateHtmlVideoConfig(id: string, changes: HtmlVideoConfigChange[]) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task || task.taskType !== 'html-video') throw new Error(`HTML 视频任务不存在：${id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('HTML_VIDEO_CONFIG_ACTIVE: 运行中的任务不能编辑参数。');
      const applied = applyHtmlVideoConfigChanges(parseHtmlVideoPipelineData(task.pipelineData), changes);
      const currentStep = htmlVideoVisibleSteps.indexOf(applied.invalidateFrom);
      const updated: Task = {
        ...task,
        ...applied.legacyMirrors,
        status: 'paused',
        currentStep,
        pipelineStep: applied.invalidateFrom,
        pipelineData: JSON.stringify(applied.pipeline),
        completedAt: null,
        errorMessage: '',
        failedStep: null,
        retryFromStep: null,
        lastHeartbeatAt: new Date().toISOString(),
      };
      const event: TaskEvent = {
        taskId: id,
        type: 'config_update',
        step: currentStep,
        agent: 'HTML Video',
        tool: null,
        detail: `已更新 HTML 视频参数，从${applied.invalidateFrom}阶段继续。`,
        dataJson: JSON.stringify({ changedFields: applied.changedFields, invalidateFrom: applied.invalidateFrom }),
        ts: Date.now(),
      };
      return persist({
        ...state,
        tasks: state.tasks.map((item) => item.id === id ? updated : item),
        events: [...state.events, event],
      });
    },
    async updateHtmlVideoScene(id: string, sceneIndex: number, changes: HtmlVideoSceneChange[]) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task || task.taskType !== 'html-video') throw new Error(`HTML 视频任务不存在：${id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      const pipeline = applyHtmlVideoSceneChanges(parseHtmlVideoPipelineData(task.pipelineData), sceneIndex, changes);
      const updated: Task = { ...task, pipelineData: JSON.stringify(pipeline), lastHeartbeatAt: new Date().toISOString() };
      return persist({ ...state, tasks: state.tasks.map((item) => item.id === id ? updated : item) });
    },
    async updateHtmlVideoSceneStructure(id: string, change: HtmlVideoSceneStructureChange) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task || task.taskType !== 'html-video') throw new Error(`HTML 视频任务不存在：${id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('HTML 视频正在运行，暂时不能修改场景结构。');
      const pipeline = applyHtmlVideoSceneStructureChange(parseHtmlVideoPipelineData(task.pipelineData), change);
      const updated: Task = { ...task, status: 'paused', currentStep: htmlVideoVisibleSteps.indexOf('assets'), pipelineStep: 'assets', pipelineData: JSON.stringify(pipeline), completedAt: null, lastHeartbeatAt: new Date().toISOString() };
      return persist({ ...state, tasks: state.tasks.map((item) => item.id === id ? updated : item) });
    },
    async updateMusicMvTask(input: MusicMvTaskUpdateInput) {
      const state = read();
      const task = state.tasks.find((item) => item.id === input.id);
      if (!task || (task.taskType !== 'music-mv' && task.taskKind !== 'music-mv')) throw new Error(`音乐 MV 任务不存在：${input.id}`);
      if (task.archivedAt) throw new Error('HISTORY_ARCHIVED: 已归档任务只读。');
      if (task.status === 'pending' || task.status === 'running') throw new Error('音乐 MV 正在运行，暂时不能修改。');
      const updated: Task = {
        ...task,
        title: input.title.trim(), inputText: input.lyrics.trim(), style: input.style, ratio: input.ratio,
        templateId: input.templateId, bgmId: input.bgmId, storyboardSceneCount: input.storyboardSceneCount,
        targetScenes: input.storyboardSceneCount, processingMode: input.processingMode, pausePoints: [...input.pausePoints],
        musicMv: { ...input.musicMv }, status: 'paused', currentStep: 0, completedAt: null, failedStep: null,
        retryFromStep: 0, outputDir: '', errorMessage: '音乐 MV 参数已更新，待重新生成。', lastHeartbeatAt: new Date().toISOString(),
      };
      return persist({ ...state, tasks: state.tasks.map((item) => item.id === input.id ? updated : item) });
    },
    async addHtmlVideoAsset() {
      throw new Error('浏览器预览不能添加本地素材，请在 Electron 桌面端操作。');
    },
    async replaceHtmlVideoAsset() {
      throw new Error('浏览器预览不能替换本地素材，请在 Electron 桌面端操作。');
    },
    async regenerateHtmlVideoAsset() {
      throw new Error('浏览器预览不能调用图片服务，请在 Electron 桌面端操作。');
    },
    async removeHtmlVideoAssetBackground() {
      throw new Error('浏览器预览不能执行本地抠图，请在 Electron 桌面端操作。');
    },
    async removeAllHtmlVideoAssetBackgrounds() {
      throw new Error('浏览器预览不能执行本地抠图，请在 Electron 桌面端操作。');
    },
    async regenerateHtmlVideoVoice() {
      throw new Error('浏览器预览不能调用配音服务，请在 Electron 桌面端操作。');
    },
    async regenerateHtmlVideoCover() {
      throw new Error('浏览器预览不能调用图片服务，请在 Electron 桌面端操作。');
    },
    async rerenderHtmlVideo(id: string) {
      const state = read();
      const task = state.tasks.find((item) => item.id === id);
      if (!task || task.taskType !== 'html-video') throw new Error(`HTML 视频任务不存在：${id}`);
      const pipeline = prepareHtmlVideoPipelineForRerender(parseHtmlVideoPipelineData(task.pipelineData));
      const updated: Task = {
        ...task,
        status: 'paused',
        currentStep: htmlVideoVisibleSteps.indexOf('render'),
        pipelineStep: 'render',
        pipelineData: JSON.stringify(pipeline),
        completedAt: null,
        errorMessage: '',
      };
      return persist({ ...state, tasks: state.tasks.map((item) => item.id === id ? updated : item) });
    },
    async importHtmlVideoCover() {
      throw new Error('浏览器预览不能导入本地封面，请在 Electron 桌面端操作。');
    },
    async getHtmlVideoCompositionSource() {
      throw new Error('浏览器预览不能读取任务目录内的 HTML 源码，请在 Electron 桌面端操作。');
    },
    async lintHtmlVideoCompositionSource() {
      throw new Error('浏览器预览不能运行桌面端 HyperFrames 源码检查。');
    },
    async saveHtmlVideoCompositionSource(_input: HtmlVideoCompositionSourceSaveInput) {
      throw new Error('浏览器预览不能写入任务目录内的 HTML 源码，请在 Electron 桌面端操作。');
    },
    async importOrdinaryTaskCover() {
      throw new Error('浏览器预览不能导入普通任务封面，请在 Electron 桌面端操作。');
    },
    async openHtmlVideoPreview() {
      throw new Error('浏览器预览仅创建任务快照，未执行特权 HTML 渲染。请在 Electron 桌面端打开预览。');
    },
    async getHtmlVideoMediaUrl() {
      throw new Error('浏览器预览仅创建任务快照，未执行特权 HTML 渲染。请在 Electron 桌面端读取媒体。');
    },
    async createAndRunTask(input: CreateTaskInput) {
      const browserPipelineError =
        '浏览器预览无法运行真实供应商流水线。请在 Electron 桌面端配置 LLM、生图、TTS、Python 和 pyJianYingDraft 后执行。';
      const state = read();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'New task',
        inputText: input.inputText,
        taskKind: input.taskKind ?? 'story',
        processingMode: input.processingMode ?? 'full-auto',
        publishMode: input.publishMode ?? 'review-rewrite',
        status: 'paused',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'photo-real',
        speaker: input.speaker ?? '灿博小叔',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: browserPipelineError,
        createdAt: new Date().toISOString(),
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        imagePromptReference: input.imagePromptReference ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        autoBorrowImage: input.autoBorrowImage ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.targetScenes ?? input.storyboardSceneCount,
        targetLength: input.targetLength,
        targetScenes: input.targetScenes ?? input.storyboardSceneCount,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        musicMv: input.musicMv ?? { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
        videoForm: input.videoForm ?? 'narration',
        failedStep: 0,
        retryFromStep: 0,
        artifactStatePath: '',
        materialSource: input.materialSource ?? 'ai',
        productInfo: input.productInfo ?? null,
        materialPerson: input.materialPerson ?? null,
        draftDir: input.draftDir ?? null,
        fixedIntro: input.fixedIntro ?? null,
        outroCta: input.outroCta ?? null,
        lockIntroSentences: input.lockIntroSentences ?? 0,
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'step_error', step: 0, agent: 'Reviewer', tool: null, detail: browserPipelineError, dataJson: null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async createAndRunViralAnalysis(input: CreateViralAnalysisInput) {
      const state = read();
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      return persist({
        ...state,
        viralAnalyses: [
          {
            id,
            url: input.url,
            platform: input.platform ?? detectBrowserViralPlatform(input.url),
            title: input.title ?? input.url,
            status: 'paused',
            currentStage: 'failed',
            progress: 0,
            settings: input.settings,
            resultPath: '',
            videoPath: '',
            errorMessage: '浏览器预览无法运行爆款视频拆解。请在 Electron 桌面端下载并处理视频。',
            createdAt: now,
            startedAt: now,
            completedAt: null,
            lastHeartbeatAt: now,
          },
          ...state.viralAnalyses,
        ],
        viralEvents: [
          ...state.viralEvents,
          {
            analysisId: id,
            type: 'error',
            stage: 'failed',
            detail: '浏览器预览无法运行爆款视频拆解。请在 Electron 桌面端下载并处理视频。',
            dataJson: null,
            ts: Date.now(),
          },
        ],
      });
    },
    async updateViralAnalysisStatus(id: string, status: ViralAnalysisStatus) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status } : item)) });
    },
    async retryViralAnalysis(id: string) {
      const state = read();
      return persist({ ...state, viralAnalyses: state.viralAnalyses.map((item) => (item.id === id ? { ...item, status: 'pending', errorMessage: '' } : item)) });
    },
    async getViralAnalysisResult(id: string): Promise<ViralAnalysisResult> {
      const state = read();
      const record = state.viralAnalyses.find((item) => item.id === id);
      throw new Error(`浏览器预览无法读取爆款拆解结果：${record?.title ?? id}`);
    },
    async createProductionTaskFromViral(id: string) {
      throw new Error(`浏览器预览无法从爆款拆解创建成片任务：${id}`);
    },
    async updateTaskStatus(id: string, status: TaskStatus) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status, errorMessage: status === 'cancelled' ? '用户取消' : task.errorMessage } : task)) });
    },
    async updateTaskTemplate(id: string, templateId: string) {
      const state = read();
      if (!state.draftTemplates.some((template) => template.id === templateId)) {
        throw new Error(`草稿模板不存在：${templateId}`);
      }
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, templateId } : task)) });
    },
    async updateTaskBgm(id: string, bgmId: string) {
      const state = read();
      if (bgmId && !state.config.jianying.bgmLibrary.some((item) => item.id === bgmId)) {
        throw new Error(`背景音乐不存在：${bgmId}`);
      }
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, bgmId } : task)) });
    },
    async updateTaskSubtitleLines() {
      throw new Error('浏览器预览不能保存真实任务字幕，请在 Electron 桌面端操作。');
    },
    async retryTask(id: string) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status: 'pending', errorMessage: '' } : task)) });
    },
    async regenerateTaskImage() {
      throw new Error('浏览器预览不能重新生成真实图片，请在 Electron 应用中操作。');
    },
    async regenerateTaskImages() {
      throw new Error('浏览器预览不能批量重新生成真实图片，请在 Electron 应用中操作。');
    },
    async replaceTaskImage() {
      throw new Error('浏览器预览不能替换真实任务图片，请在 Electron 应用中操作。');
    },
    async listSceneVideoLibrary() {
      return [];
    },
    async replaceTaskSceneVideo() {
      throw new Error('浏览器预览不能替换真实任务视频，请在 Electron 应用中操作。');
    },
    async restoreTaskSceneImage() {
      throw new Error('浏览器预览不能恢复真实任务图片，请在 Electron 应用中操作。');
    },
    async updateTaskSceneVideoTrim() {
      throw new Error('浏览器预览不能修改真实任务视频，请在 Electron 应用中操作。');
    },
    async copyTaskImage() {
      throw new Error('浏览器预览不能复制真实任务图片，请在 Electron 应用中操作。');
    },
    async importTaskImages() {
      throw new Error('浏览器预览不能批量导入真实任务图片，请在 Electron 应用中操作。');
    },
    async referenceEditTaskImage() {
      throw new Error('浏览器预览不能编辑真实任务图片，请在 Electron 应用中操作。');
    },
    async regenerateTaskNarration() {
      throw new Error('浏览器预览不能重新生成真实配音，请在 Electron 应用中操作。');
    },
    async updateTaskImagePrompt() {
      throw new Error('浏览器预览不能修改真实任务提示词，请在 Electron 应用中操作。');
    },
    async rerunTaskStep() {
      throw new Error('浏览器预览不能重新执行真实流水线步骤，请在 Electron 应用中操作。');
    },
    async repackTaskDraft() {
      throw new Error('浏览器预览不能重新打包剪映草稿，请在 Electron 桌面端操作。');
    },
    async getTaskArtifacts(id: string) {
      const task = read().tasks.find((item) => item.id === id);
      return {
        available: false,
        message: '浏览器预览无法读取本地任务产物，请在 Electron 桌面端查看。',
        taskId: id,
        statePath: task?.artifactStatePath ?? '',
        outputDir: task?.outputDir ?? '',
        updatedAt: null,
        steps: {},
        artifact: {},
        assets: { cover: [], images: [], videos: [], imageErrors: [], narration: [] },
        draft: null,
      };
    },
    async readAssetDataUrl() {
      throw new Error('浏览器预览不能读取本地媒体预览，请在 Electron 应用中查看。');
    },
    async getTaskMediaUrl() {
      throw new Error('浏览器预览不能读取本地视频，请在 Electron 应用中查看。');
    },
    async selectLocalImage() {
      return null;
    },
    async importBgmAudio() {
      return null;
    },
    async selectLocalAudio(_purpose?: 'managed-bgm') {
      return null;
    },
    async selectLocalFolder() {
      return null;
    },
    async selectCookieFile() {
      return null;
    },
    async openViralLoginWindow() {
      throw new Error('浏览器预览不能打开抖音登录窗口，请在 Electron 桌面端操作。');
    },
    async detectJianyingDraftPath() {
      return {
        status: 'warn' as const,
        reason: 'not-found' as const,
        path: '',
        detail: '浏览器预览无法检测本机剪映目录，请在 Electron 桌面端使用自动检测。',
        installationDetected: false,
        candidatesChecked: 0,
        draftCount: 0,
        checks: { isDirectory: false, writable: false, hasJianyingMetadata: false },
      };
    },
    async getJianyingEffectCatalog() {
      return fallbackEffectCatalog;
    },
    async runDiagnostics() {
      const state = read();
      const volcengineVersion = resolveVolcengineTtsApiVersion(state.config.tts.volcengine);
      const ttsReady = state.config.tts.provider === 'minimax'
        ? Boolean(state.config.tts.minimax.apiKey)
        : volcengineVersion === 'v3'
          ? Boolean(state.config.tts.volcengine.apiKey)
          : Boolean((state.config.tts.volcengine.appId || state.config.tts.appId) && (state.config.tts.volcengine.accessKey || state.config.tts.accessKey));
      return {
        generatedAt: new Date().toISOString(),
        checks: [
          { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
          { id: 'tts-config', label: 'TTS 凭证已填写', status: ttsReady ? 'pass' : 'warn', detail: state.config.tts.provider === 'volcengine' ? `volcengine · ${volcengineVersion}` : state.config.tts.provider },
          { id: 'jianying-sidecar', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath },
          { id: 'account-state', label: '账户状态', status: 'pass', detail: state.activation.message },
        ],
      };
    },
    windowControl: async () => undefined,
    onAppDelta: () => () => undefined,
  };
}

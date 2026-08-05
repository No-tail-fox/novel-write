import { useEffect, useRef, useState } from 'react';
import { Check, FileText, Image as ImageIcon, Link2, Loader2, Mic2, Play, Plus, RotateCcw, Save, Search, Trash2, Upload, Wand2 } from 'lucide-react';
import { FormField as Field } from '../../components/FormField';
import { OptionGroup as OptionCloud } from '../../components/OptionGroup';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { ToggleField } from '../../components/ToggleField';
import { EmptyState } from '../../components/EmptyState';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { AspectRatioSwatch } from '../../components/AspectRatioSwatch';
import type { RendererAppState as AppState, ApplyMutationResult } from '../../app/route-types';
import {
  countVisibleCharacters,
  normalizeStoryboardSceneCount,
  storyboardSceneCountPreviewRange,
  storyboardSceneCountRange,
  targetWordCountRange,
} from '../../shared/content-metrics';
import {
  povOptions,
  rewriteOptions,
  sampleText,
} from '../../shared/editorial-options';
import {
  buildImageTemplateStyleOptions,
  buildStoryTemplateOptions,
  buildTaskPromptTemplateOptions,
  resolvePromptTemplateDefaultDraftTemplateId,
  resolvePromptTemplateDefaultStyleId,
} from '../../shared/prompt-templates';
import type { PersonAssetSummary } from '../../shared/person-assets';
import type { StoryDreamApi } from '../../shared/storydream-api';
import {
  defaultPodcastSpeakersForProvider,
  defaultTaskSpeakerForProvider,
  normalizeRuntimeTtsProvider,
  taskSpeakerLabel,
  ttsVoiceOptionsForProvider,
  type RuntimeTtsProvider,
} from '../../shared/tts-voices';
import type {
  AiSourceContext,
  ImageGenerationQuality,
  OrdinaryTaskCoverRatio,
  OrdinaryTaskCoverSelection,
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  RewriteIntensity,
  Task,
  TaskMode,
  TaskVideoForm,
  WebSearchProvider,
} from '../../shared/types';
import { MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH, ORDINARY_TASK_COVER_PAGE_DURATION_MS, ordinaryTaskCoverDimensions, validateOrdinaryTaskCoverSelection } from '../../shared/ordinary-task-cover';
import { imageGenerationQualityLabel, normalizeImageGenerationQuality } from '../../shared/image-quality';
import { useAsyncAction } from '../../ui/async-action';
import { buildTaskCreateInput } from './task-create-input';
import {
  clearNewTaskDraft,
  createNewTaskPreset,
  deleteNewTaskPreset,
  readNewTaskDraft,
  readNewTaskPresets,
  upsertNewTaskPreset,
  writeNewTaskDraft,
  writeNewTaskPresets,
  type NewTaskDraftSnapshot,
  type NewTaskPreset,
} from './new-task-draft';
import {
  NEW_TASK_CREATE_FIELDS_BY_STAGE,
  NEW_TASK_PAUSE_OPTIONS,
  type OrdinaryCoverMode,
} from './task-control-manifest';
import {
  addUploadedBgm,
  characterPolicyLabel,
  defaultTaskDraftTemplateId,
  draftTemplateImageRatio,
  draftTemplateLabel,
  normalizeLockIntroSentencesInput,
  normalizeTaskStoryboardSceneCount,
  normalizeTaskTargetLength,
  productInfoSummary,
  referenceKindLabel,
  resolveDefaultBgmId,
  resolvePromptTemplateForTrack,
  sourceKey,
  styleLabel,
  taskFromMutation,
  toggleArray,
  validBgmItems,
} from './task-formatters';
import '../../styles/features/new-task.css';

type NewTaskStage = 'material' | 'creative' | 'output';

function deriveTaskTitle(text: string): string {
  const firstLine = text.trim().split(/[。！？!?\n]/u).find(Boolean)?.trim() ?? '';
  return firstLine.slice(0, 42);
}

function newTaskPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const NEW_TASK_STAGE_META: ReadonlyArray<{ id: NewTaskStage; label: string; heading: string; description: string }> = [
  { id: 'material', label: '素材输入', heading: '原始素材', description: '粘贴文案或从本地导入，任务标题会自动提取' },
  { id: 'creative', label: '创作参数', heading: '内容赛道', description: '决定改写策略、分镜节奏与画面提示词' },
  { id: 'output', label: '输出设置', heading: '输出设置', description: '配音、分镜、封面与剪映草稿' },
];

const WEB_SEARCH_PROVIDER_OPTIONS: ReadonlyArray<{ id: WebSearchProvider; label: string; domain: string }> = [
  { id: 'bing', label: '必应', domain: 'bing.com' },
  { id: 'baidu', label: '百度', domain: 'baidu.com' },
  { id: 'sogou', label: '搜狗', domain: 'sogou.com' },
  { id: 'toutiao', label: '头条', domain: 'toutiao.com' },
];

function isWebSearchProvider(value: unknown): value is WebSearchProvider {
  return WEB_SEARCH_PROVIDER_OPTIONS.some((option) => option.id === value);
}

function webSearchProviderLabel(provider: WebSearchProvider | undefined): string {
  return WEB_SEARCH_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? '网页';
}

function ContentMetricsSummary({
  text,
  targetLength,
  storyboardSceneCount,
}: {
  text: string;
  targetLength: string;
  storyboardSceneCount: string;
}) {
  const visibleCount = countVisibleCharacters(text);
  const reviewRange = targetWordCountRange(targetLength, text);
  const previewSceneRange = storyboardSceneCountPreviewRange(text, targetLength);
  const manualSceneCount = normalizeStoryboardSceneCount(storyboardSceneCount);
  const manualSceneRange = manualSceneCount ? storyboardSceneCountRange(text, manualSceneCount) : null;

  return (
    <div className="content-metrics-row">
      <span>字数：{visibleCount}</span>
      <span>预审字数：{reviewRange ? `${reviewRange.min}-${reviewRange.max}` : '待输入'}</span>
      <span>自动分镜：{previewSceneRange ? `自动（${previewSceneRange.target}）` : '待输入'}</span>
      {manualSceneRange ? <span>当前目标：{manualSceneRange.target} 个（{manualSceneRange.min}-{manualSceneRange.max}）</span> : null}
    </div>
  );
}
export function NewTaskPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const initialDraftTemplateId = defaultTaskDraftTemplateId(state.draftTemplates);
  const [activeStage, setActiveStage] = useState<NewTaskStage>('material');
  const [mode, setMode] = useState<TaskMode>('paste');
  const [title, setTitle] = useState(() => deriveTaskTitle(sampleText));
  const [inputText, setInputText] = useState(sampleText);
  const [aiKeyword, setAiKeyword] = useState('武则天回宫');
  const [aiSources, setAiSources] = useState(['web']);
  const [webSearchProviders, setWebSearchProviders] = useState<WebSearchProvider[]>(() => WEB_SEARCH_PROVIDER_OPTIONS.map((option) => option.id));
  const [extraRequirements, setExtraRequirements] = useState('字数控制在 500 字左右，聚焦人物转折经历，语气偏感性');
  const [track, setTrack] = useState('character-story');
  const [style, setStyle] = useState('photo-real');
  const [templateId, setTemplateId] = useState(initialDraftTemplateId);
  const [ratio, setRatio] = useState(() => draftTemplateImageRatio(state.draftTemplates, initialDraftTemplateId));
  const [imageQuality, setImageQuality] = useState<'default' | ImageGenerationQuality>('default');
  const [selectedTaskLlmProfileId, setSelectedTaskLlmProfileId] = useState(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
  const [promptTemplateOverrideId, setPromptTemplateOverrideId] = useState('');
  const [promptTemplateManuallyOverridden, setPromptTemplateManuallyOverridden] = useState(false);
  const [styleManuallyOverridden, setStyleManuallyOverridden] = useState(false);
  const [draftTemplateManuallyOverridden, setDraftTemplateManuallyOverridden] = useState(false);
  const [ratioManuallyOverridden, setRatioManuallyOverridden] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<RuntimeTtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [speaker, setSpeaker] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [bgmId, setBgmId] = useState(() => resolveDefaultBgmId(state.config));
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pausePoint, setPausePoint] = useState<PausePoint>('none');
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('full-auto');
  const [rewriteIntensity, setRewriteIntensity] = useState<RewriteIntensity>('standard');
  const [narrativePov, setNarrativePov] = useState<Task['narrativePov']>('keep-original');
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [productInfo, setProductInfo] = useState<string | null>(null);
  const [materialSource, setMaterialSource] = useState<'ai' | 'local'>('ai');
  const [materialPerson, setMaterialPerson] = useState('');
  const [fixedIntro, setFixedIntro] = useState('');
  const [outroCta, setOutroCta] = useState('');
  const [lockIntroSentences, setLockIntroSentences] = useState('0');
  const [personAssets, setPersonAssets] = useState<PersonAssetSummary[]>([]);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [targetLength, setTargetLength] = useState('');
  const [storyboardSceneCount, setStoryboardSceneCount] = useState('');
  const [publishMode, setPublishMode] = useState<'review-rewrite' | 'direct-copy'>('review-rewrite');
  const [videoForm, setVideoForm] = useState<TaskVideoForm>('narration');
  const [coverImageMode, setCoverImageMode] = useState<OrdinaryCoverMode>('off');
  const [coverTemplateId, setCoverTemplateId] = useState('cinematic-poster');
  const [coverPageEnabled, setCoverPageEnabled] = useState(false);
  const [coverPageText, setCoverPageText] = useState('');
  const [manualCoverAsset, setManualCoverAsset] = useState<OrdinaryTaskCoverSelection | null>(null);
  const [autoBorrowImage, setAutoBorrowImage] = useState(false);
  const [podcastImageMode, setPodcastImageMode] = useState('multi');
  const [podcastSpeakers, setPodcastSpeakers] = useState<PodcastSpeakerPair>('kazai-dayi');
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(null);
  const [selectedSearchSourceIds, setSelectedSearchSourceIds] = useState<string[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [composingCopy, setComposingCopy] = useState(false);
  const [researchCopy, setResearchCopy] = useState('');
  const [researchCopyMessage, setResearchCopyMessage] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [taskPresets, setTaskPresets] = useState<NewTaskPreset[]>(() => []);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const searchRequestIdRef = useRef(0);
  const searchAction = useAsyncAction();
  const taskAction = useAsyncAction();

  const searchSections = searchContext?.query === aiKeyword.trim() ? searchContext.sections.slice(0, 10) : [];
  const selectedSources = searchSections.filter((source, index) => selectedSearchSourceIds.includes(sourceKey(source, index)));
  const taskPromptTemplates = state.promptTemplates.filter((template) => template.type === 'task');
  const storyTemplateOptions = buildStoryTemplateOptions(taskPromptTemplates);
  const taskPromptTemplateOptions = buildTaskPromptTemplateOptions(state.promptTemplates, track);
  const imageTemplateStyleOptions = buildImageTemplateStyleOptions(state.customStyles);
  const resolvedPromptTemplate = resolvePromptTemplateForTrack(state.promptTemplates, track, promptTemplateOverrideId || null);
  const selectedStoryTemplateId = promptTemplateOverrideId || resolvedPromptTemplate?.id || '';
  const availableStyleIds = state.customStyles.map((customStyle) => customStyle.id);
  const availableDraftTemplateIds = state.draftTemplates.map((draftTemplate) => draftTemplate.id);
  const bgmOptions = validBgmItems(state.config);
  const ttsVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider, state.minimaxCloneVoices);
  const podcastVoiceDefaults = defaultPodcastSpeakersForProvider(ttsProvider, podcastSpeakers);
  const storyboardScenePreviewRange = storyboardSceneCountPreviewRange(inputText, targetLength);
  const storyDreamCoverTemplateIds = ['cinematic-poster', 'podcast-cover'];
  const coverTemplateOptions = state.customCoverTemplates.map((template) => [template.id, template.name, template.description]);
  const coverTemplateSelectOptions = coverTemplateOptions.length
    ? coverTemplateOptions
    : [['cinematic-poster', '电影海报封面', 'StoryDream 默认封面模板']];
  const coverTemplateHint = storyDreamCoverTemplateIds.includes(coverTemplateId) ? 'StoryDream 兼容模板' : '自定义封面模板';
  const selectedMaterialAsset = personAssets.find((asset) => asset.name === materialPerson) ?? null;
  const isLocalMaterialInvalid = materialSource === 'local' && (!materialPerson || !selectedMaterialAsset || selectedMaterialAsset.count <= 0);
  const sourceText = mode === 'paste' ? inputText : researchCopy.trim() || `${aiKeyword}\n\n${extraRequirements}`;
  const createTaskDisabled = running
    || isBrowserPreview
    || isLocalMaterialInvalid
    || (coverPageEnabled && (coverImageMode === 'off' || (coverImageMode === 'manual' && !manualCoverAsset)))
    || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0);
  const executionSceneCount = normalizeTaskStoryboardSceneCount(storyboardSceneCount)
    ?? storyboardScenePreviewRange?.target
    ?? null;
  const processingModeLabel = processingMode === 'full-auto' ? '全自动' : processingMode === 'semi-auto' ? '半自动' : '只出方案';
  const publishModeLabel = publishMode === 'review-rewrite' ? '审核 + 改写' : '直接复用';
  const coverPageTextHint = coverImageMode === 'auto' ? '可选 · 留空保留 AI 封面原图' : '可选 · 留空使用 AI 创作标题';
  const coverPageTextPlaceholder = coverImageMode === 'auto' ? '留空则不叠加文字' : '留空则自动使用 AI 创作标题';
  const coverPageTextSummary = coverPageText.trim() ? '自定义文字' : coverImageMode === 'auto' ? '不叠加文字' : 'AI 标题';
  const supportsImageQuality = state.config.imageProvider !== 'jimeng';
  const configuredImageQuality = state.config.imageProvider === 'custom'
    ? normalizeImageGenerationQuality(state.config.customImage.quality)
    : normalizeImageGenerationQuality(state.config.gptImage.quality ?? state.config.image.quality);
  const imageQualityOverrideEnabled = supportsImageQuality && imageQuality !== 'default';

  function createDraftSnapshot(savedAt = new Date().toISOString()): NewTaskDraftSnapshot {
    return {
      version: 1,
      savedAt,
      activeStage,
      values: {
        title,
        inputText,
        mode,
        aiKeyword,
        aiSources,
        webSearchProviders,
        extraRequirements,
        track,
        style,
        templateId,
        ratio,
        imageQuality,
        selectedTaskLlmProfileId,
        promptTemplateOverrideId,
        promptTemplateManuallyOverridden,
        styleManuallyOverridden,
        draftTemplateManuallyOverridden,
        ratioManuallyOverridden,
        ttsProvider,
        speaker,
        bgmId,
        referenceImagePath,
        pausePoint,
        processingMode,
        rewriteIntensity,
        narrativePov,
        keepPromotion,
        productInfo,
        materialSource,
        materialPerson,
        fixedIntro,
        outroCta,
        lockIntroSentences,
        ttsSpeed,
        targetLength,
        storyboardSceneCount,
        publishMode,
        videoForm,
        coverImageMode,
        coverTemplateId,
        coverPageEnabled,
        coverPageText,
        manualCoverAsset: manualCoverAsset ?? undefined,
        autoBorrowImage,
        podcastImageMode,
        podcastSpeakers,
        selectedSearchSourceIds,
        selectedSources,
        researchCopy,
      },
    };
  }

  function applyDraftSnapshot(draft: NewTaskDraftSnapshot): void {
    const values = draft.values;
    searchRequestIdRef.current += 1;
    setActiveStage(draft.activeStage);
    if (typeof values.title === 'string') setTitle(values.title);
    if (typeof values.inputText === 'string') setInputText(values.inputText);
    if (values.mode === 'paste' || values.mode === 'ai') setMode(values.mode);
    if (typeof values.aiKeyword === 'string') setAiKeyword(values.aiKeyword);
    if (Array.isArray(values.aiSources)) setAiSources(values.aiSources.filter((value): value is string => typeof value === 'string'));
    if (Array.isArray(values.webSearchProviders)) {
      const restoredProviders = values.webSearchProviders.filter(isWebSearchProvider);
      if (restoredProviders.length > 0) setWebSearchProviders([...new Set(restoredProviders)]);
    }
    if (typeof values.extraRequirements === 'string') setExtraRequirements(values.extraRequirements);
    if (typeof values.track === 'string') setTrack(values.track);
    if (typeof values.style === 'string') setStyle(values.style);
    if (typeof values.templateId === 'string') setTemplateId(values.templateId);
    if (typeof values.ratio === 'string') setRatio(values.ratio);
    if (values.imageQuality === 'default' || values.imageQuality === 'low' || values.imageQuality === 'medium' || values.imageQuality === 'high') setImageQuality(values.imageQuality);
    if (typeof values.selectedTaskLlmProfileId === 'string') setSelectedTaskLlmProfileId(values.selectedTaskLlmProfileId);
    if (typeof values.promptTemplateOverrideId === 'string') setPromptTemplateOverrideId(values.promptTemplateOverrideId);
    if (typeof values.promptTemplateManuallyOverridden === 'boolean') setPromptTemplateManuallyOverridden(values.promptTemplateManuallyOverridden);
    if (typeof values.styleManuallyOverridden === 'boolean') setStyleManuallyOverridden(values.styleManuallyOverridden);
    if (typeof values.draftTemplateManuallyOverridden === 'boolean') setDraftTemplateManuallyOverridden(values.draftTemplateManuallyOverridden);
    if (typeof values.ratioManuallyOverridden === 'boolean') setRatioManuallyOverridden(values.ratioManuallyOverridden);
    if (values.ttsProvider === 'volcengine' || values.ttsProvider === 'minimax') setTtsProvider(values.ttsProvider);
    if (typeof values.speaker === 'string') setSpeaker(values.speaker);
    if (typeof values.bgmId === 'string') setBgmId(values.bgmId);
    if (typeof values.referenceImagePath === 'string') setReferenceImagePath(values.referenceImagePath);
    if (values.pausePoint === 'none' || values.pausePoint === 'critical' || values.pausePoint === 'every-step') setPausePoint(values.pausePoint);
    if (values.processingMode === 'full-auto' || values.processingMode === 'semi-auto' || values.processingMode === 'clip-only') setProcessingMode(values.processingMode);
    if (values.rewriteIntensity === 'standard' || values.rewriteIntensity === 'deep' || values.rewriteIntensity === 'original') setRewriteIntensity(values.rewriteIntensity);
    if (values.narrativePov === 'keep-original' || values.narrativePov === 'first-person' || values.narrativePov === 'third-person') setNarrativePov(values.narrativePov);
    if (typeof values.keepPromotion === 'boolean') setKeepPromotion(values.keepPromotion);
    if (typeof values.productInfo === 'string' || values.productInfo === null) setProductInfo(values.productInfo);
    if (values.materialSource === 'ai' || values.materialSource === 'local') setMaterialSource(values.materialSource);
    if (typeof values.materialPerson === 'string') setMaterialPerson(values.materialPerson);
    if (typeof values.fixedIntro === 'string') setFixedIntro(values.fixedIntro);
    if (typeof values.outroCta === 'string') setOutroCta(values.outroCta);
    if (typeof values.lockIntroSentences === 'string') setLockIntroSentences(values.lockIntroSentences);
    if (typeof values.ttsSpeed === 'number' && Number.isFinite(values.ttsSpeed)) setTtsSpeed(values.ttsSpeed);
    if (typeof values.targetLength === 'string') setTargetLength(values.targetLength);
    if (typeof values.storyboardSceneCount === 'string') setStoryboardSceneCount(values.storyboardSceneCount);
    if (values.publishMode === 'review-rewrite' || values.publishMode === 'direct-copy') setPublishMode(values.publishMode);
    if (values.videoForm === 'narration' || values.videoForm === 'two-host-podcast') setVideoForm(values.videoForm);
    if (values.coverImageMode === 'off' || values.coverImageMode === 'auto' || values.coverImageMode === 'manual') setCoverImageMode(values.coverImageMode);
    if (typeof values.coverTemplateId === 'string') setCoverTemplateId(values.coverTemplateId);
    if (typeof values.coverPageEnabled === 'boolean') setCoverPageEnabled(values.coverPageEnabled);
    if (typeof values.coverPageText === 'string') setCoverPageText(values.coverPageText.slice(0, MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH));
    if (typeof values.autoBorrowImage === 'boolean') setAutoBorrowImage(values.autoBorrowImage);
    if (values.manualCoverAsset) {
      try {
        setManualCoverAsset(validateOrdinaryTaskCoverSelection(values.manualCoverAsset));
      } catch {
        setManualCoverAsset(null);
      }
    } else setManualCoverAsset(null);
    if (typeof values.podcastImageMode === 'string') setPodcastImageMode(values.podcastImageMode);
    if (values.podcastSpeakers === 'kazai-dayi' || values.podcastSpeakers === 'liufei-xiaolei') setPodcastSpeakers(values.podcastSpeakers);
    if (Array.isArray(values.selectedSearchSourceIds)) setSelectedSearchSourceIds(values.selectedSearchSourceIds.filter((value): value is string => typeof value === 'string'));
    if (Array.isArray(values.selectedSources) && values.selectedSources.length) {
      setSearchContext({ query: values.aiKeyword ?? '', sections: values.selectedSources, warnings: [] });
    }
    if (typeof values.researchCopy === 'string') setResearchCopy(values.researchCopy);
  }

  function saveDraft(): void {
    writeNewTaskDraft(window.localStorage, createDraftSnapshot());
    setHasSavedDraft(true);
    setDraftNotice('已保存本地任务草稿，可在下次打开时继续编辑。');
  }

  function restoreDraft(): void {
    const draft = readNewTaskDraft(window.localStorage);
    if (!draft) {
      setDraftNotice('没有可恢复的本地任务草稿。');
      return;
    }
    applyDraftSnapshot(draft);
    setDraftNotice('已恢复本地任务草稿。');
  }

  function saveTaskPreset(): void {
    const name = presetName.trim().replace(/\s+/gu, ' ').slice(0, 60);
    if (!name) {
      setDraftNotice('请先填写预设名称。');
      return;
    }
    const existing = taskPresets.find((preset) => preset.name === name);
    const preset = createNewTaskPreset({
      id: existing?.id ?? newTaskPresetId(),
      name,
      snapshot: createDraftSnapshot(),
    });
    const next = upsertNewTaskPreset(taskPresets, preset);
    writeNewTaskPresets(window.localStorage, next);
    setTaskPresets(next);
    setSelectedPresetId(preset.id);
    setPresetName(preset.name);
    setDraftNotice(`已保存预设“${preset.name}”。`);
  }

  function selectTaskPreset(id: string): void {
    setSelectedPresetId(id);
    const preset = taskPresets.find((item) => item.id === id);
    if (preset) setPresetName(preset.name);
  }

  function applyTaskPreset(): void {
    const preset = taskPresets.find((item) => item.id === selectedPresetId);
    if (!preset) {
      setDraftNotice('请先选择要应用的预设。');
      return;
    }
    applyDraftSnapshot(preset.snapshot);
    setDraftNotice(preset.snapshot.values.coverImageMode === 'manual'
      ? `已应用预设“${preset.name}”，请重新导入手动封面。`
      : `已应用预设“${preset.name}”。`);
  }

  function deleteTaskPreset(): void {
    const preset = taskPresets.find((item) => item.id === selectedPresetId);
    if (!preset) return;
    const next = deleteNewTaskPreset(taskPresets, preset.id);
    writeNewTaskPresets(window.localStorage, next);
    setTaskPresets(next);
    setSelectedPresetId('');
    setPresetName('');
    setDraftNotice(`已删除预设“${preset.name}”。`);
  }

  function importBenchmarkScript(): void {
    const benchmarkScript = sessionStorage.getItem('benchmark_script');
    if (!benchmarkScript) {
      setDraftNotice('暂无可带入的对标文案，请先在对标导入页面完成采集。');
      return;
    }
    setMode('paste');
    setInputText(benchmarkScript);
    setTitle(deriveTaskTitle(benchmarkScript));
    sessionStorage.removeItem('benchmark_script');
    setDraftNotice('已带入对标文案。');
  }

  useEffect(() => {
    const incomingProductInfo = sessionStorage.getItem('book_product_info');
    if (incomingProductInfo) {
      setProductInfo(incomingProductInfo);
      setKeepPromotion(true);
      sessionStorage.removeItem('book_product_info');
    }
    const incomingBenchmarkScript = sessionStorage.getItem('benchmark_script');
    if (incomingBenchmarkScript) {
      setInputText(incomingBenchmarkScript);
      setMode('paste');
      sessionStorage.removeItem('benchmark_script');
    }
  }, []);

  useEffect(() => {
    const draft = readNewTaskDraft(window.localStorage);
    if (draft) {
      applyDraftSnapshot(draft);
      setHasSavedDraft(true);
    }
    setTaskPresets(readNewTaskPresets(window.localStorage));
    setDraftReady(true);
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    writeNewTaskDraft(window.localStorage, createDraftSnapshot());
    setHasSavedDraft(true);
  }, [
    draftReady, activeStage, title, inputText, mode, aiKeyword, aiSources, webSearchProviders, extraRequirements,
    track, style, templateId, ratio, imageQuality, selectedTaskLlmProfileId, promptTemplateOverrideId,
    promptTemplateManuallyOverridden, styleManuallyOverridden, draftTemplateManuallyOverridden,
    ratioManuallyOverridden, ttsProvider, speaker, bgmId, referenceImagePath, pausePoint,
    processingMode, rewriteIntensity, narrativePov, keepPromotion, productInfo, materialSource,
    materialPerson, fixedIntro, outroCta, lockIntroSentences, ttsSpeed, targetLength,
    storyboardSceneCount, publishMode, videoForm, coverImageMode, coverTemplateId, coverPageEnabled, coverPageText, manualCoverAsset, autoBorrowImage,
    podcastImageMode, podcastSpeakers, selectedSearchSourceIds, searchContext, researchCopy,
  ]);

  useEffect(() => {
    let active = true;
    api
      .listPersonAssets()
      .then((assets) => {
        if (active) setPersonAssets(assets);
      })
      .catch(taskAction.reportError);
    return () => {
      active = false;
    };
  }, [api, taskAction.reportError]);

  useEffect(() => {
    if (materialSource === 'local' && !materialPerson && personAssets[0]) {
      setMaterialPerson(personAssets[0].name);
    }
  }, [materialSource, materialPerson, personAssets]);

  useEffect(() => {
    setBgmId((current) => (current && bgmOptions.some((bgm) => bgm.id === current) ? current : resolveDefaultBgmId(state.config)));
  }, [state.config.jianying.bgmLibrary, state.config.jianying.defaultBgmId]);

  useEffect(() => {
    const provider = normalizeRuntimeTtsProvider(state.config.tts.provider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }, [state.config.activeTtsProfileId, state.config.tts.provider, state.config.tts.speaker, state.config.tts.volcengine.speaker, state.config.tts.minimax.voiceId]);

  useEffect(() => {
    if (!state.config.llmProfiles.some((profile) => profile.id === selectedTaskLlmProfileId)) {
      setSelectedTaskLlmProfileId(state.config.activeLlmProfileId || state.config.llm.id || state.config.llmProfiles[0]?.id || '');
    }
  }, [state.config.activeLlmProfileId, state.config.llm.id, state.config.llmProfiles, selectedTaskLlmProfileId]);

  useEffect(() => {
    if (manualCoverAsset && manualCoverAsset.ratio !== ratio) setManualCoverAsset(null);
  }, [ratio, manualCoverAsset]);

  useEffect(() => {
    if (!styleManuallyOverridden && resolvedPromptTemplate) {
      setStyle(resolvePromptTemplateDefaultStyleId(resolvedPromptTemplate, availableStyleIds));
    }
  }, [resolvedPromptTemplate?.id, styleManuallyOverridden, state.customStyles]);

  function handleStoryTemplateChange(nextTemplateId: string) {
    setPromptTemplateManuallyOverridden(true);
    setPromptTemplateOverrideId(nextTemplateId);
    const template = state.promptTemplates.find((item) => item.id === nextTemplateId && item.type === 'task') ?? null;
    const nextTrack = template?.baseTrack || track;
    if (nextTrack !== track) {
      setTrack(nextTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextDraftTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextDraftTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextDraftTemplateId));
      }
    }
  }

  function handleStyleChange(nextStyle: string) {
    setStyleManuallyOverridden(true);
    setStyle(nextStyle);
  }

  function handleDraftTemplateChange(nextTemplateId: string) {
    setDraftTemplateManuallyOverridden(true);
    setTemplateId(nextTemplateId);
    setRatioManuallyOverridden(false);
    setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
  }

  function handleRatioChange(nextRatio: string) {
    setRatioManuallyOverridden(true);
    setRatio(nextRatio);
  }

  function handlePromptTemplateOverrideChange(nextId: string) {
    setPromptTemplateManuallyOverridden(Boolean(nextId));
    setPromptTemplateOverrideId(nextId);
    const template = resolvePromptTemplateForTrack(state.promptTemplates, track, nextId || null);
    if (template?.baseTrack && template.baseTrack !== track) {
      setTrack(template.baseTrack);
    }
    if (!styleManuallyOverridden && template) {
      setStyle(resolvePromptTemplateDefaultStyleId(template, availableStyleIds));
    }
    if (!draftTemplateManuallyOverridden && template) {
      const nextTemplateId = resolvePromptTemplateDefaultDraftTemplateId(template, availableDraftTemplateIds, templateId);
      setTemplateId(nextTemplateId);
      if (!ratioManuallyOverridden) {
        setRatio(draftTemplateImageRatio(state.draftTemplates, nextTemplateId));
      }
    }
  }

  function handleTtsProviderChange(nextProvider: string) {
    const provider = normalizeRuntimeTtsProvider(nextProvider);
    const nextSpeaker = defaultTaskSpeakerForProvider(provider, state.config);
    setTtsProvider(provider);
    setSpeaker(nextSpeaker);
  }

  function invalidateSearchResults(): void {
    searchRequestIdRef.current += 1;
    searchAction.clearFeedback();
    setSearchContext(null);
    setSelectedSearchSourceIds([]);
    setSearchMessage('');
    setResearchCopy('');
    setResearchCopyMessage('');
  }

  function handleAiKeywordChange(nextKeyword: string): void {
    if (nextKeyword !== aiKeyword) invalidateSearchResults();
    setAiKeyword(nextKeyword);
  }

  function handleWebSearchProviderChange(provider: WebSearchProvider): void {
    const nextProviders = webSearchProviders.includes(provider)
      ? webSearchProviders.filter((item) => item !== provider)
      : WEB_SEARCH_PROVIDER_OPTIONS.map((option) => option.id).filter((item) => item === provider || webSearchProviders.includes(item));
    invalidateSearchResults();
    setWebSearchProviders(nextProviders);
  }

  async function searchWebSources() {
    const keyword = aiKeyword.trim();
    if (!keyword) {
      setSearchMessage('请先输入关键词。');
      return;
    }
    if (webSearchProviders.length === 0) {
      setSearchMessage('请至少选择一个搜索渠道。');
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    const providerNames = WEB_SEARCH_PROVIDER_OPTIONS
      .filter((option) => webSearchProviders.includes(option.id))
      .map((option) => option.label)
      .join('、');
    await searchAction.run(async () => {
      setSearchMessage(`正在从${providerNames}搜索并读取网页正文...`);
      const context = await api.searchWebSources({ query: keyword, providers: webSearchProviders });
      if (searchRequestIdRef.current !== requestId) return;
      const limitedContext = { ...context, sections: context.sections.slice(0, 10) };
      setSearchContext(limitedContext);
      setSelectedSearchSourceIds([]);
      const summary = limitedContext.sections.length > 0
        ? `已获取 ${limitedContext.sections.length} 条精准网页资料，请勾选要使用的页面。`
        : '未找到标题或正文与当前关键词精确匹配的网页。';
      setSearchMessage([...context.warnings, summary].join('；'));
    }, {
      onError: (error) => {
        if (searchRequestIdRef.current === requestId) setSearchMessage(error.message);
      },
    });
  }

  async function composeResearchCopy() {
    if (selectedSources.length === 0) {
      setResearchCopyMessage('请先勾选至少 1 个网页来源。');
      return;
    }
    await taskAction.run(async () => {
      setComposingCopy(true);
      setResearchCopyMessage('正在结合所选页面信息生成文案...');
      try {
        const result = await api.composeResearchCopy({
          keyword: aiKeyword.trim(),
          extraRequirements,
          selectedSources,
          targetLength: normalizeTaskTargetLength(targetLength) ?? undefined,
        });
        setResearchCopy(result.copy);
        setInputText(result.copy);
        setTitle(result.title || aiKeyword.trim());
        setMode('paste');
        setResearchCopyMessage(`已生成文案并填入粘贴文案${result.requestId ? `（request ${result.requestId}）` : ''}。`);
      } finally {
        setComposingCopy(false);
      }
    }, { onError: (error) => setResearchCopyMessage(error.message) });
  }

  async function addBgmFromTask() {
    await taskAction.run(async () => {
      const imported = await api.importBgmAudio();
      if (!imported) return;
      const nextBgm = addUploadedBgm(state.config, imported);
      const next = await api.saveConfig({ config: nextBgm.config, secretChanges: {} });
      applyState(next);
      setBgmId(nextBgm.bgmId);
    });
  }

  async function selectTaskReferenceImage() {
    await taskAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (imagePath) setReferenceImagePath(imagePath);
    });
  }

  async function importOrdinaryTaskCover() {
    if (isBrowserPreview) {
      setDraftNotice('浏览器预览不能导入本地封面，请在 Electron 应用中操作。');
      return;
    }
    if (!['9:16', '4:3', '1:1', '16:9'].includes(ratio)) {
      setDraftNotice('当前画面比例不支持手动封面，请先选择 9:16、4:3、1:1 或 16:9。');
      return;
    }
    await taskAction.run(async () => {
      const selected = await api.importOrdinaryTaskCover(ratio as OrdinaryTaskCoverRatio);
      if (!selected) return;
      setManualCoverAsset(selected);
      setCoverImageMode('manual');
      setCoverPageEnabled(true);
      setDraftNotice(`已导入手动封面：${selected.originalName}`);
    }, { onError: (error) => setDraftNotice(error.message) });
  }

  function advanceStage() {
    setActiveStage(activeStage === 'material' ? 'creative' : 'output');
  }

  async function run() {
    if (isBrowserPreview) {
      setDraftNotice('浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。');
      return;
    }
    if (materialSource === 'local' && !materialPerson) {
      setDraftNotice('请先选择人物素材。');
      return;
    }
    if (materialSource === 'local' && (!selectedMaterialAsset || selectedMaterialAsset.count <= 0)) {
      setDraftNotice('所选人物素材至少导入 1 张图片后才能创建任务。');
      return;
    }
    if (coverPageEnabled && coverImageMode === 'manual' && !manualCoverAsset) {
      setDraftNotice('请先导入与当前画面比例一致的手动封面。');
      return;
    }
    setDraftNotice('');
    await taskAction.run(async () => {
      setRunning(true);
      try {
        const next = await api.createAndRunTask(buildTaskCreateInput({
        title,
        inputText: sourceText,
        mode,
        aiKeyword,
        aiSources,
        selectedSources: mode === 'ai' ? selectedSources : [],
        extraRequirements,
        track,
        style,
        speaker,
        ratio,
        imageQuality: imageQualityOverrideEnabled ? imageQuality : null,
        templateId,
        llmProfileId: selectedTaskLlmProfileId,
        videoForm,
        coverImageMode,
        coverTemplateId,
        coverPageEnabled,
        coverPageText,
        manualCoverAssetId: manualCoverAsset?.id,
        autoBorrowImage,
        podcastImageMode,
        podcastSpeakers: videoForm === 'two-host-podcast' ? podcastSpeakers : null,
        podcastSpeakerA: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerA : null,
        podcastSpeakerB: videoForm === 'two-host-podcast' ? podcastVoiceDefaults.podcastSpeakerB : null,
        scriptFormat: videoForm === 'two-host-podcast' ? 'dialogue' : 'narration',
        bgmId,
        pausePoints: [pausePoint],
        processingMode,
        referenceImagePath,
        rewriteIntensity,
        narrativePov,
        keepPromotion,
        productInfo,
        materialSource,
        materialPerson: materialSource === 'local' ? materialPerson : null,
        fixedIntro,
        outroCta,
        lockIntroSentences: normalizeLockIntroSentencesInput(lockIntroSentences),
        ttsProvider,
        ttsSpeed,
        publishMode,
        targetLength: normalizeTaskTargetLength(targetLength) ?? undefined,
        targetScenes: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        storyboardSceneCount: normalizeTaskStoryboardSceneCount(storyboardSceneCount),
        promptTemplateId: resolvedPromptTemplate?.id ?? null,
        promptTemplateType: 'task',
        }, state.customCoverTemplates));
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) {
          clearNewTaskDraft(window.localStorage);
          setHasSavedDraft(false);
          openTaskDetail(createdTask.id);
        }
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setDraftNotice(error.message) });
  }

  const activeStageMeta = NEW_TASK_STAGE_META.find((stage) => stage.id === activeStage) ?? NEW_TASK_STAGE_META[0];

  return (
    <div
      className="new-task-scroll"
      data-new-task-stage={activeStage}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || createTaskDisabled) return;
        event.preventDefault();
        void run();
      }}
    >
      <nav className="new-task-stage-tabs" aria-label="新建任务步骤">
        {NEW_TASK_STAGE_META.map((stage, index) => (
          <button
            key={stage.id}
            type="button"
            data-new-task-stage-tab={stage.id}
            className={activeStage === stage.id ? 'active' : ''}
            aria-current={activeStage === stage.id ? 'step' : undefined}
            onClick={() => setActiveStage(stage.id)}
          >
            <span>{index + 1}</span>
            {stage.label}
          </button>
        ))}
      </nav>

      <div className="new-task-workbench" data-new-task-workbench>
        <main className="new-task-editor">
          <header className="new-task-stage-heading">
            <h2>{activeStageMeta.heading}</h2>
            <p>{activeStageMeta.description}</p>
          </header>

          {activeStage === 'material' ? (
            <section className="new-task-stage-panel" data-create-fields={NEW_TASK_CREATE_FIELDS_BY_STAGE.material.join(' ')}>
              <Field label="任务标题">
                <input value={title} placeholder="留空会从文案自动提取" onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <div className="new-task-source-actions" role="group" aria-label="素材输入方式">
                <button type="button" className={mode === 'paste' ? 'active' : ''} onClick={() => setMode('paste')}><FileText size={15} />粘贴文案</button>
                <button type="button" className={mode === 'ai' ? 'active' : ''} onClick={() => setMode('ai')}><Wand2 size={15} />AI 创作</button>
                <button type="button" onClick={importBenchmarkScript}><Link2 size={15} />对标导入</button>
              </div>

              {mode === 'paste' ? (
                <Field label="文案内容">
                  <textarea
                    className="source-textarea"
                    value={inputText}
                    onChange={(event) => {
                      const nextText = event.target.value;
                      setTitle((current) => (!current.trim() || current === deriveTaskTitle(inputText) ? deriveTaskTitle(nextText) : current));
                      setInputText(nextText);
                    }}
                  />
                  <ContentMetricsSummary text={inputText} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
                </Field>
              ) : (
                <div className="ai-create-panel">
                  <div className="new-task-inline-fields">
                    <Field label="关键词">
                      <input value={aiKeyword} onChange={(event) => handleAiKeywordChange(event.target.value)} placeholder="例如：钱学森回国 / 张桂梅 / 苹果秋季发布会" />
                    </Field>
                    <Field label="额外要求" hint="可选">
                      <input className="extra-requirements-input" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
                    </Field>
                  </div>
                  <span className="field-title">数据源</span>
                  <div className="new-task-check-grid">
                    <label className="check-row"><input type="checkbox" checked={aiSources.includes('web')} onChange={() => setAiSources(toggleArray(aiSources, 'web'))} />全网搜索 <small>必应、百度、搜狗、头条与正文来源</small></label>
                    <label className="check-row"><input type="checkbox" checked={aiSources.includes('builtin-knowledge')} onChange={() => setAiSources(toggleArray(aiSources, 'builtin-knowledge'))} />AI 内置知识补全 <small>允许模型补全细节</small></label>
                    <label className="check-row muted"><input type="checkbox" checked={aiSources.includes('ima')} onChange={() => setAiSources(toggleArray(aiSources, 'ima'))} />IMA 知识库 <small>使用系统设置中的知识库</small></label>
                  </div>
                  <div className="web-search-provider-panel">
                    <span className="field-title">搜索渠道</span>
                    <div className="web-search-provider-grid">
                      {WEB_SEARCH_PROVIDER_OPTIONS.map((provider) => (
                        <label className="web-search-provider" key={provider.id}>
                          <input
                            type="checkbox"
                            checked={webSearchProviders.includes(provider.id)}
                            onChange={() => handleWebSearchProviderChange(provider.id)}
                          />
                          <span><strong>{provider.label}</strong><small>{provider.domain}</small></span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="ghost-action" disabled={searchAction.busy || !aiKeyword.trim() || webSearchProviders.length === 0} onClick={searchWebSources}>
                    {searchAction.busy ? <Loader2 className="spin" size={15} /> : <Search size={15} />}搜索
                  </button>
                  {searchMessage ? <div className="test-result">{searchMessage}</div> : null}
                  <InlineActionFeedback feedback={searchAction.feedback} />
                  {searchContext && searchContext.query === aiKeyword.trim() ? (
                    <div className="ai-search-block">
                      <div className="ai-search-results ai-search-results-scroll">
                        <div className="panel-title-row ai-search-title-row">
                          <div><h3>网页候选（前 10 条）</h3><small>实际查询：{searchContext.query}</small></div>
                          <small>{selectedSources.length}/{searchSections.length} 已选择</small>
                        </div>
                        {searchContext.providerStatuses?.length ? (
                          <div className="web-search-provider-statuses">
                            {searchContext.providerStatuses.map((status) => (
                              <span className="web-search-provider-status" data-state={status.state} key={status.provider}>
                                {status.label} · {status.state === 'ready' ? `${status.count} 条` : status.state === 'empty' ? '无精准结果' : '失败'}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {searchSections.length === 0 ? <EmptyState title="暂无可用网页资料" /> : null}
                        {searchSections.map((source, index) => {
                          const id = sourceKey(source, index);
                          return (
                            <label className="search-source-card" key={id}>
                              <input type="checkbox" checked={selectedSearchSourceIds.includes(id)} onChange={() => setSelectedSearchSourceIds(toggleArray(selectedSearchSourceIds, id))} />
                              <div>
                                <div className="search-source-heading"><span className="search-source-provider">{webSearchProviderLabel(source.provider)}</span><strong>{source.title}</strong></div>
                                {source.url ? <span className="search-source-url">{source.url}</span> : null}
                                <p>{(source.content || source.snippet || '').slice(0, 220)}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <div className="ai-search-actions">
                        <button type="button" className="primary-action slim" disabled={composingCopy || selectedSources.length === 0} onClick={composeResearchCopy}>
                          {composingCopy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}结合所选页面信息生成文案
                        </button>
                      </div>
                      {researchCopyMessage ? <div className="test-result">{researchCopyMessage}</div> : null}
                      {researchCopy ? (
                        <Field label="生成文案（可编辑）">
                          <textarea className="small-textarea research-copy-textarea" value={researchCopy} onChange={(event) => { setResearchCopy(event.target.value); setInputText(event.target.value); }} />
                          <ContentMetricsSummary text={researchCopy} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="new-task-material-options">
                <Segmented label="素材来源" value={materialSource} options={['ai', 'local']} labels={['AI 生图', '本地人物素材']} onChange={(value) => setMaterialSource(value as 'ai' | 'local')} />
                {materialSource === 'local' ? (
                  <Field label="本地人物素材">
                    <select value={materialPerson} onChange={(event) => setMaterialPerson(event.target.value)}>
                      <option value="">请选择人物</option>
                      {personAssets.map((asset) => <option key={asset.name} value={asset.name}>{asset.name} · {asset.count} 张</option>)}
                    </select>
                  </Field>
                ) : null}
              </div>
            </section>
          ) : null}

          {activeStage === 'creative' ? (
            <section className="new-task-stage-panel" data-create-fields={NEW_TASK_CREATE_FIELDS_BY_STAGE.creative.join(' ')}>
              <div className="new-task-track-options">
                <OptionCloud title="内容赛道" options={storyTemplateOptions} value={selectedStoryTemplateId} onChange={handleStoryTemplateChange} />
              </div>
              <div className="new-task-field-grid">
                <Field label="提示词模板" hint={resolvedPromptTemplate ? `当前使用：${resolvedPromptTemplate.name}` : '自动匹配赛道模板'}>
                  <select className="prompt-template-selector" value={promptTemplateOverrideId || resolvedPromptTemplate?.id || ''} onChange={(event) => handlePromptTemplateOverrideChange(event.target.value)}>
                    <option value="">自动匹配赛道模板</option>
                    {taskPromptTemplateOptions.map(([id, label, hint]) => <option key={id} value={id}>{hint ? `${label} · ${hint}` : label}</option>)}
                  </select>
                </Field>
                <Field label="画面风格" hint={styleLabel(style, state.customStyles)}>
                  <select value={style} onChange={(event) => handleStyleChange(event.target.value)}>
                    {imageTemplateStyleOptions.map(([id, label, hint]) => <option key={id} value={id}>{hint ? `${label} · ${hint}` : label}</option>)}
                  </select>
                </Field>
              </div>
              <div className="new-task-field-grid">
                <Field label="草稿模板" hint={draftTemplateLabel(templateId, state.draftTemplates)}>
                  <select value={templateId} onChange={(event) => handleDraftTemplateChange(event.target.value)}>
                    {state.draftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · 出图 {template.image.ratio}</option>)}
                  </select>
                </Field>
                <div className="video-form-panel">
                  <div className="video-form-head"><span className="field-title">视频形态</span><small>{videoForm === 'two-host-podcast' ? '自动使用对话脚本与播客配图' : '单人配音讲述'}</small></div>
                  <div className="video-form-grid">
                    <button type="button" className={videoForm === 'narration' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('narration')}><strong>旁白视频</strong><span>单人配音讲述（默认）</span></button>
                    <button type="button" className={videoForm === 'two-host-podcast' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('two-host-podcast')}><strong>双人播客</strong><span>两位主播一问一答</span></button>
                  </div>
                  {videoForm === 'two-host-podcast' ? (
                    <div className="podcast-form-controls">
                      <span className="podcast-form-label">播客配图</span>
                      <Segmented label="配图方式" value={podcastImageMode} options={['multi', 'single']} labels={['按分镜配图', '单图封面']} onChange={setPodcastImageMode} />
                      <Segmented label="主播组合" value={podcastSpeakers} options={['kazai-dayi', 'liufei-xiaolei']} labels={['咔仔 x 大壹', '刘飞 x 潇磊']} onChange={(value) => setPodcastSpeakers(value as PodcastSpeakerPair)} />
                      <p className="podcast-form-note">主播组合会写入对话脚本与播客封面提示，并自动使用两套默认音色生成 A/B 对话。</p>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="new-task-field-grid compact-controls">
                <Segmented label="处理模式" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['全自动', '半自动', '只出方案']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
                <Segmented label="发布方式" value={publishMode} options={['review-rewrite', 'direct-copy']} labels={['预审改写', '直接复用']} onChange={(value) => setPublishMode(value as 'review-rewrite' | 'direct-copy')} />
              </div>
              {resolvedPromptTemplate ? (
                <div className="template-default-summary">
                  <strong>模板默认项</strong><span>故事模板：{resolvedPromptTemplate.name}</span><span>默认图像模板：{styleLabel(style, state.customStyles)}</span><span>默认草稿模板：{draftTemplateLabel(templateId, state.draftTemplates)}</span><span>主角档案：{characterPolicyLabel(resolvedPromptTemplate.characterPolicy)}</span><span>参考图类型：{referenceKindLabel(resolvedPromptTemplate.referenceKind)}</span><span>Step 3 骨架：{(resolvedPromptTemplate.step3SkeletonModules ?? []).join('、') || '未设置'}</span>
                </div>
              ) : null}
              <button type="button" className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '收起' : '展开'}高级创作参数 <span>改写强度 · 叙事视角 · 带货 · 文案把控</span>
              </button>
              {showAdvanced ? (
                <div className="advanced-grid">
                  <Segmented label="改写强度" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
                  <Segmented label="叙事视角" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
                  <label className="toggle-row"><input type="checkbox" checked={keepPromotion} onChange={(event) => setKeepPromotion(event.target.checked)} />带货保留 <small>启用后保留原素材中的商品与推广信息</small></label>
                  <div className="advanced-section copy-control-section">
                    <div className="section-title-row"><span className="field-title">文案把控</span>{productInfo ? <small>已带入：{productInfoSummary(productInfo)}</small> : null}</div>
                    <div className="copy-control-grid">
                      <Field label="固定开头" hint="可选"><textarea className="small-textarea" value={fixedIntro} onChange={(event) => setFixedIntro(event.target.value)} placeholder="例如：今天这本书，先看第一句话。" /></Field>
                      <Field label="结尾引导" hint="可用 {主角}"><textarea className="small-textarea" value={outroCta} onChange={(event) => setOutroCta(event.target.value)} placeholder="例如：想读{主角}，去橱窗找这本书。" /></Field>
                      <Field label="锁定开头句数"><input type="number" min="0" max="20" step="1" value={lockIntroSentences} onChange={(event) => setLockIntroSentences(event.target.value)} /></Field>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {activeStage === 'output' ? (
            <section className="new-task-stage-panel" data-create-fields={NEW_TASK_CREATE_FIELDS_BY_STAGE.output.join(' ')}>
              <div className="new-task-field-grid">
                <label className="target-number-field"><span>目标字数</span><input type="number" min="100" max="5000" step="50" value={targetLength} placeholder="自动" onChange={(event) => setTargetLength(event.target.value)} /><small>字（±20%，留空跟随原文）</small></label>
                <label className="target-number-field"><span>目标分镜数</span><input type="number" min="1" max="60" step="1" value={storyboardSceneCount} placeholder={storyboardScenePreviewRange ? `自动（${storyboardScenePreviewRange.target}）` : '自动'} onChange={(event) => setStoryboardSceneCount(event.target.value)} /><small>个（±10%，建议每镜 25-45 字）</small></label>
              </div>
              <div className="new-task-field-grid">
                <div><span className="field-title">AI 出图比例 <small>{ratioManuallyOverridden ? '已手动覆盖' : '已跟随草稿模板'}</small></span><div className="ratio-grid">{['9:16', '4:3', '1:1', '16:9'].map((item) => <button type="button" key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => handleRatioChange(item)}><AspectRatioSwatch ratio={item} />{item}</button>)}</div></div>
                <div className="new-task-quality-override">
                  <ToggleField
                    label="覆盖生图质量"
                    checked={imageQualityOverrideEnabled}
                    disabled={!supportsImageQuality}
                    onChange={(enabled) => setImageQuality(enabled ? configuredImageQuality : 'default')}
                  />
                  {imageQualityOverrideEnabled
                    ? <Segmented label="生图质量" value={imageQuality} options={['low', 'medium', 'high']} labels={['低成本', '标准', '高质量']} onChange={(value) => setImageQuality(value as ImageGenerationQuality)} />
                    : <span className="hint-text">{supportsImageQuality ? `使用默认：${imageGenerationQualityLabel(configuredImageQuality)}质量` : '质量由即梦服务控制'}</span>}
                </div>
              </div>
              <Segmented label="暂停确认" value={pausePoint} options={NEW_TASK_PAUSE_OPTIONS.map(([id]) => id)} labels={NEW_TASK_PAUSE_OPTIONS.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
              <div className="new-task-field-grid">
                <div><span className="field-title">配音员</span><Segmented label="配音模型" value={ttsProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={handleTtsProviderChange} /></div>
                <Segmented label="配音语速" value={String(ttsSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setTtsSpeed(Number(value))} />
              </div>
              {videoForm !== 'two-host-podcast' ? (
                <><div className="chip-row">{ttsVoiceOptions.map((voice) => <button type="button" key={voice.id} className={speaker === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setSpeaker(voice.id)}><Mic2 size={14} />{voice.label}</button>)}</div><span className="hint-text">当前默认配音员：{taskSpeakerLabel(ttsProvider, speaker, state.minimaxCloneVoices)} · {speaker}</span></>
              ) : <span className="hint-text">双人播客会按主播组合自动拆分 A/B 音色，当前模型：{ttsProvider}</span>}
              <div className="new-task-field-grid">
                <div><span className="field-title">背景音乐</span><div className="chip-row"><button type="button" className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>无 BGM</button>{bgmOptions.map((bgm) => <button type="button" key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>)}<button type="button" className="chip" disabled={taskAction.busy} onClick={addBgmFromTask}><Plus size={14} />添加</button></div></div>
                <Field label="文本模型"><select value={selectedTaskLlmProfileId} onChange={(event) => setSelectedTaskLlmProfileId(event.target.value)}>{state.config.llmProfiles.map((profile) => <option key={profile.id ?? profile.model} value={profile.id ?? profile.model}>{profile.provider}: {profile.model}</option>)}</select></Field>
              </div>
              <section className={coverPageEnabled ? 'ordinary-cover-page-editor enabled' : 'ordinary-cover-page-editor'} data-cover-page-enabled={coverPageEnabled ? 'true' : 'false'}>
                <header>
                  <div><span className="field-title">片头封面页</span><small>{ORDINARY_TASK_COVER_PAGE_DURATION_MS / 1000} 秒独立首屏</small></div>
                  <ToggleField
                    label="启用封面页"
                    checked={coverPageEnabled}
                    onChange={(enabled) => {
                      setCoverPageEnabled(enabled);
                      setCoverImageMode(enabled ? (coverImageMode === 'off' ? 'auto' : coverImageMode) : 'off');
                    }}
                  />
                </header>
                {coverPageEnabled ? (
                  <div className="ordinary-cover-page-body">
                    <div className="new-task-field-grid">
                      <Segmented label="封面图片" value={coverImageMode} options={['auto', 'manual']} labels={['AI 单独生成', '本地导入']} onChange={(value) => setCoverImageMode(value as OrdinaryCoverMode)} />
                      {coverImageMode === 'auto' ? <Field label="封面模板" hint={coverTemplateHint}><select className="cover-template-select" value={coverTemplateId} onChange={(event) => setCoverTemplateId(event.target.value)}>{coverTemplateSelectOptions.map(([id, label, hint]) => <option key={id} value={id}>{hint ? `${label} · ${id}` : label}</option>)}</select></Field> : <div className="ordinary-cover-source-note"><ImageIcon size={16} /><span>使用当前视频比例导入封面图</span></div>}
                    </div>
                    {coverImageMode === 'manual' ? (
                      <div className="manual-cover-import" data-manual-cover-state={manualCoverAsset ? 'ready' : 'required'}>
                        <div><strong>{manualCoverAsset ? manualCoverAsset.originalName : '尚未导入手动封面'}</strong><span>{manualCoverAsset ? `${manualCoverAsset.width} × ${manualCoverAsset.height} · ${(manualCoverAsset.sizeBytes / 1024 / 1024).toFixed(2)} MB` : `需要 ${ordinaryTaskCoverDimensions(ratio as OrdinaryTaskCoverRatio).width} × ${ordinaryTaskCoverDimensions(ratio as OrdinaryTaskCoverRatio).height} 的 PNG / JPG / WebP`}</span></div>
                        <button type="button" className="ghost-action" disabled={taskAction.busy || isBrowserPreview} onClick={importOrdinaryTaskCover}><Upload size={15} />导入手动封面</button>
                      </div>
                    ) : null}
                    <Field label="封面文字" hint={coverPageTextHint}><textarea className="small-textarea ordinary-cover-page-text" maxLength={MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH} value={coverPageText} onChange={(event) => setCoverPageText(event.target.value)} placeholder={coverPageTextPlaceholder} /></Field>
                  </div>
                ) : null}
              </section>
              <Field label="主角参考图" hint="可选"><div className="upload-row"><input value={referenceImagePath} placeholder="上传后出现主角的分镜会以这张为基础保持人物一致" onChange={(event) => setReferenceImagePath(event.target.value)} /><button type="button" className="ghost-action" disabled={taskAction.busy} onClick={selectTaskReferenceImage}><Upload size={15} />上传主角参考图</button></div></Field>
              <label className="new-task-borrow-toggle toggle-row" title="开启后，生图失败的镜头会在全部尝试结束后借用最近的可用图片。">
                <input type="checkbox" checked={autoBorrowImage} onChange={(event) => setAutoBorrowImage(event.target.checked)} />
                <span>相邻镜头补位</span>
              </label>
            </section>
          ) : null}

          <footer className="new-task-stage-footer">
            <button type="button" className="ghost-action" disabled={activeStage === 'material'} onClick={() => setActiveStage(activeStage === 'output' ? 'creative' : 'material')}>上一步</button>
            <button
              type="button"
              className={activeStage === 'output' ? 'primary-action' : 'ghost-action'}
              disabled={activeStage === 'output' ? createTaskDisabled : false}
              onClick={activeStage === 'output' ? run : advanceStage}
            >
              {activeStage === 'output' ? <Play size={15} /> : null}
              {activeStage === 'output' ? '开始创作' : '下一步'}
            </button>
          </footer>
        </main>

        <aside className="new-task-summary" data-new-task-summary>
          <div className="new-task-summary-title"><div><span>执行摘要</span><strong>{title || '待补充标题'}</strong></div><small>待创建</small></div>
          <dl>
            <div><dt>处理模式</dt><dd>{processingModeLabel} · {publishModeLabel}</dd></div>
            <div><dt>目标长度</dt><dd>{targetLength ? `${targetLength} 字` : '跟随原文'}</dd></div>
            <div><dt>分镜数量</dt><dd>{executionSceneCount ? `${executionSceneCount} 个场景` : '自动计算'}</dd></div>
            <div><dt>画面比例</dt><dd>{ratio}</dd></div>
            <div><dt>图片质量</dt><dd>{supportsImageQuality ? (imageQualityOverrideEnabled ? `覆盖为${imageGenerationQualityLabel(imageQuality)}质量` : `默认（${imageGenerationQualityLabel(configuredImageQuality)}质量）`) : '由即梦服务控制'}</dd></div>
            <div><dt>配音角色</dt><dd>{videoForm === 'two-host-podcast' ? podcastSpeakers : taskSpeakerLabel(ttsProvider, speaker, state.minimaxCloneVoices)}</dd></div>
            <div><dt>草稿模板</dt><dd>{draftTemplateLabel(templateId, state.draftTemplates)}</dd></div>
            <div><dt>片头封面</dt><dd>{coverPageEnabled ? `${coverImageMode === 'manual' ? (manualCoverAsset?.originalName ?? '待导入') : 'AI 单独生成'} · ${coverPageTextSummary}` : '关闭'}</dd></div>
            <div><dt>失败补位</dt><dd>{autoBorrowImage ? '已启用' : '关闭'}</dd></div>
          </dl>
          <div className="new-task-readiness">
            <span className={selectedTaskLlmProfileId ? 'ready' : ''}><Check size={15} />LLM {selectedTaskLlmProfileId ? '已配置' : '未配置'}</span>
            <span className={state.config.imageProvider !== 'mock' ? 'ready' : ''}><Check size={15} />图片服务{state.config.imageProvider !== 'mock' ? '已配置' : '未配置'}</span>
            <span className={state.config.jianying.draftPath ? 'ready' : ''}><Check size={15} />剪映目录{state.config.jianying.draftPath ? '可写' : '未配置'}</span>
          </div>
          <div className="new-task-summary-actions">
            <button type="button" className="primary-action" onClick={run} disabled={createTaskDisabled}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}{running ? '运行中' : '创建并开始任务'}
            </button>
            <div className="new-task-draft-actions">
              <button type="button" className="ghost-action" onClick={saveDraft}><Save size={14} />保存草稿</button>
              <button type="button" className="ghost-action" disabled={!hasSavedDraft} onClick={restoreDraft}><RotateCcw size={14} />恢复草稿</button>
            </div>
            <section className="new-task-preset-panel" aria-label="创建预设">
              <div className="new-task-preset-heading"><strong>创建预设</strong><span>{taskPresets.length} 个已保存</span></div>
              <div className="new-task-preset-save-row">
                <input aria-label="预设名称" value={presetName} maxLength={60} placeholder="预设名称" onChange={(event) => setPresetName(event.target.value)} />
                <button type="button" className="ghost-action" onClick={saveTaskPreset}><Save size={14} />保存为预设</button>
              </div>
              <div className="new-task-preset-apply-row">
                <select aria-label="选择创建预设" value={selectedPresetId} onChange={(event) => selectTaskPreset(event.target.value)}>
                  <option value="">选择预设</option>
                  {taskPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                <button type="button" className="ghost-action" disabled={!selectedPresetId} onClick={applyTaskPreset}><RotateCcw size={14} />应用预设</button>
                <button type="button" className="icon-button" title="删除预设" aria-label="删除预设" disabled={!selectedPresetId} onClick={deleteTaskPreset}><Trash2 size={14} /></button>
              </div>
            </section>
          </div>
          <p>创建后进入任务队列，可在任务详情中暂停、重试或重新生成单个步骤。</p>
          <span className="new-task-runtime-note">{isBrowserPreview ? '浏览器预览不能执行真实流水线' : '试用已用尽时仍保留本地生成能力'}</span>
          {draftNotice ? <span className="local-note">{draftNotice}</span> : null}
          <InlineActionFeedback feedback={taskAction.feedback} />
        </aside>
      </div>
    </div>
  );
}

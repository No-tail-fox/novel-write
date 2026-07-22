import { useEffect, useState } from 'react';
import { Loader2, Mic2, Play, Plus, Search, Upload, Wand2 } from 'lucide-react';
import { FormField as Field } from '../../components/FormField';
import { OptionGroup as OptionCloud } from '../../components/OptionGroup';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { RendererAppState as AppState, ApplyMutationResult } from '../../app/route-types';
import {
  countVisibleCharacters,
  normalizeStoryboardSceneCount,
  storyboardSceneCountPreviewRange,
  storyboardSceneCountRange,
  targetWordCountRange,
} from '../../shared/content-metrics';
import {
  pauseOptions,
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
  PausePoint,
  PodcastSpeakerPair,
  ProcessingMode,
  RewriteIntensity,
  Task,
  TaskMode,
  TaskVideoForm,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import { buildTaskCreateInput } from './task-create-input';
import {
  ORDINARY_AVAILABLE_COVER_MODES,
  ORDINARY_COVER_MODE_MANIFEST,
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
  const [mode, setMode] = useState<TaskMode>('paste');
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState(sampleText);
  const [aiKeyword, setAiKeyword] = useState('武则天回宫');
  const [aiSources, setAiSources] = useState(['web']);
  const [extraRequirements, setExtraRequirements] = useState('字数控制在 500 字左右，聚焦人物转折经历，语气偏感性');
  const [track, setTrack] = useState('character-story');
  const [style, setStyle] = useState('photo-real');
  const [templateId, setTemplateId] = useState(initialDraftTemplateId);
  const [ratio, setRatio] = useState(() => draftTemplateImageRatio(state.draftTemplates, initialDraftTemplateId));
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
  const [podcastImageMode, setPodcastImageMode] = useState('multi');
  const [podcastSpeakers, setPodcastSpeakers] = useState<PodcastSpeakerPair>('kazai-dayi');
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [searchingSources, setSearchingSources] = useState(false);
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(null);
  const [selectedSearchSourceIds, setSelectedSearchSourceIds] = useState<string[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [composingCopy, setComposingCopy] = useState(false);
  const [researchCopy, setResearchCopy] = useState('');
  const [researchCopyMessage, setResearchCopyMessage] = useState('');
  const taskAction = useAsyncAction();

  const searchSections = (searchContext?.sections ?? []).slice(0, 10);
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
  const ttsVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider);
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

  async function searchWebSources() {
    const keyword = aiKeyword.trim();
    if (!keyword) {
      setSearchMessage('请先输入关键词。');
      return;
    }
    await taskAction.run(async () => {
      setSearchingSources(true);
      setSearchMessage('正在从 Bing 搜索并读取网页正文...');
      try {
        const context = await api.searchWebSources(keyword);
        const limitedContext = { ...context, sections: context.sections.slice(0, 10) };
        setSearchContext(limitedContext);
        setSelectedSearchSourceIds([]);
        setSearchMessage(context.warnings.length ? context.warnings.join('；') : `已获取前 ${limitedContext.sections.length} 条网页资料，请勾选要使用的页面。`);
      } finally {
        setSearchingSources(false);
      }
    }, { onError: (error) => setSearchMessage(error.message) });
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
      const audioPath = await api.selectLocalAudio();
      if (!audioPath) return;
      const nextBgm = addUploadedBgm(state.config, audioPath);
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
    setDraftNotice('');
    await taskAction.run(async () => {
      setRunning(true);
      try {
        const next = await api.createAndRunTask(buildTaskCreateInput({
        title,
        inputText: mode === 'paste' ? inputText : researchCopy.trim() || `${aiKeyword}\n\n${extraRequirements}`,
        mode,
        aiKeyword,
        aiSources,
        selectedSources: mode === 'ai' ? selectedSources : [],
        extraRequirements,
        track,
        style,
        speaker,
        ratio,
        templateId,
        llmProfileId: selectedTaskLlmProfileId,
        videoForm,
        coverImageMode,
        coverTemplateId,
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
          openTaskDetail(createdTask.id);
        }
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setDraftNotice(error.message) });
  }

  return (
    <div className="new-task-scroll">
      <section className="task-card">
        <Field label="标题" hint="可选">
          <input value={title} placeholder="留空会从文案自动提取" onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="mode-grid">
          <button className={mode === 'paste' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('paste')}>
            <strong>粘贴文案</strong>
            <span>已有对标文案，直接贴进来改写</span>
          </button>
          <button className={mode === 'ai' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('ai')}>
            <strong>AI 创作 <em>NEW</em></strong>
            <span>输入关键词，AI 自动搜索并创作原稿</span>
          </button>
        </div>

        {mode === 'paste' ? (
          <Field label="文案内容">
            <textarea className="source-textarea" value={inputText} onChange={(event) => setInputText(event.target.value)} />
            <ContentMetricsSummary text={inputText} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
          </Field>
        ) : (
          <div className="ai-create-panel">
            <Field label="关键词">
              <input value={aiKeyword} onChange={(event) => setAiKeyword(event.target.value)} placeholder="例如：钱学森回国 / 张桂梅 / 苹果秋季发布会" />
            </Field>
            <span className="field-title">数据源</span>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('web')} onChange={() => setAiSources(toggleArray(aiSources, 'web'))} />
              全网搜索 <small>从 Bing + 搜狗 + 百度 + 360 搜索，补充百科、知乎、百家号、头条正文</small>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('builtin-knowledge')} onChange={() => setAiSources(toggleArray(aiSources, 'builtin-knowledge'))} />
              AI 内置知识补全 <small>允许 AI 用自己的知识补全细节</small>
            </label>
            <label className="check-row muted">
              <input type="checkbox" checked={aiSources.includes('ima')} onChange={() => setAiSources(toggleArray(aiSources, 'ima'))} />
              IMA 知识库 <small>前往系统设置 · AI 创作配置</small>
            </label>
            <Field label="额外要求" hint="可选">
              <input className="extra-requirements-input" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
            </Field>
            <button className="ghost-action" disabled={searchingSources || !aiKeyword.trim()} onClick={searchWebSources}>
              {searchingSources ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              搜索
            </button>
            {searchMessage ? <div className="test-result">{searchMessage}</div> : null}
            {searchContext ? (
              <div className="ai-search-block">
                <div className="ai-search-results ai-search-results-scroll">
                  <div className="panel-title-row">
                    <h3>网页候选（前 10 条）</h3>
                    <small>{selectedSources.length}/{searchContext.sections.length} 已选择</small>
                  </div>
                  {searchContext.sections.length === 0 ? <EmptyState title="暂无可用网页资料" /> : null}
                  {searchContext.sections.map((source, index) => {
                    const id = sourceKey(source, index);
                    return (
                      <label className="search-source-card" key={id}>
                        <input type="checkbox" checked={selectedSearchSourceIds.includes(id)} onChange={() => setSelectedSearchSourceIds(toggleArray(selectedSearchSourceIds, id))} />
                        <div>
                          <strong>{source.title}</strong>
                          {source.url ? <span>{source.url}</span> : null}
                          <p>{(source.content || source.snippet || '').slice(0, 220)}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="ai-search-actions">
                  <button className="primary-action slim" disabled={composingCopy || selectedSources.length === 0} onClick={composeResearchCopy}>
                    {composingCopy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
                    结合所选页面信息生成文案
                  </button>
                </div>
                {researchCopyMessage ? <div className="test-result">{researchCopyMessage}</div> : null}
                {researchCopy ? (
                  <Field label="生成文案（可编辑）">
                    <textarea
                      className="small-textarea research-copy-textarea"
                      value={researchCopy}
                      onChange={(event) => {
                        setResearchCopy(event.target.value);
                        setInputText(event.target.value);
                      }}
                    />
                    <ContentMetricsSummary text={researchCopy} targetLength={targetLength} storyboardSceneCount={storyboardSceneCount} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <OptionCloud title="内容赛道" options={storyTemplateOptions} value={selectedStoryTemplateId} onChange={handleStoryTemplateChange} />
        <Field label="提示词模板" hint={resolvedPromptTemplate ? `当前使用：${resolvedPromptTemplate.name}` : '自动匹配赛道模板'}>
          <select className="prompt-template-selector" value={promptTemplateOverrideId || resolvedPromptTemplate?.id || ''} onChange={(event) => handlePromptTemplateOverrideChange(event.target.value)}>
            <option value="">自动匹配赛道模板</option>
            {taskPromptTemplateOptions.map(([id, label, hint]) => (
              <option key={id} value={id}>
                {hint ? `${label} · ${hint}` : label}
              </option>
            ))}
          </select>
        </Field>
        <OptionCloud title="画面风格" options={imageTemplateStyleOptions} value={style} onChange={handleStyleChange} />
        {resolvedPromptTemplate ? (
          <div className="template-default-summary">
            <strong>模板默认项</strong>
            <span>故事模板：{resolvedPromptTemplate.name}</span>
            <span>默认图像模板：{styleLabel(style, state.customStyles)}</span>
            <span>默认草稿模板：{draftTemplateLabel(templateId, state.draftTemplates)}</span>
            <span>主角档案：{characterPolicyLabel(resolvedPromptTemplate.characterPolicy)}</span>
            <span>参考图类型：{referenceKindLabel(resolvedPromptTemplate.referenceKind)}</span>
            <span>Step 3 骨架：{(resolvedPromptTemplate.step3SkeletonModules ?? []).join('、') || '未设置'}</span>
          </div>
        ) : null}

        <div className="video-form-panel">
          <div className="video-form-head">
            <span className="field-title">视频形态</span>
            <small>{videoForm === 'two-host-podcast' ? '双人播客会自动使用对话脚本和播客配图策略' : '单人配音讲述，适合常规旁白视频'}</small>
          </div>
          <div className="video-form-grid">
            <button className={videoForm === 'narration' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('narration')}>
              <strong>旁白视频</strong>
              <span>单人配音讲述（默认）</span>
            </button>
            <button className={videoForm === 'two-host-podcast' ? 'video-form-option active' : 'video-form-option'} onClick={() => setVideoForm('two-host-podcast')}>
              <strong>双人播客</strong>
              <span>两位主播一问一答聊内容</span>
            </button>
          </div>
          {videoForm === 'two-host-podcast' ? (
            <div className="podcast-form-controls">
              <span className="podcast-form-label">播客配图</span>
              <Segmented label="配图方式" value={podcastImageMode} options={['multi', 'single']} labels={['按分镜配图', '单图封面']} onChange={setPodcastImageMode} />
              <Segmented
                label="主播组合"
                value={podcastSpeakers}
                options={['kazai-dayi', 'liufei-xiaolei']}
                labels={['咔仔 x 大壹', '刘飞 x 潇磊']}
                onChange={(value) => setPodcastSpeakers(value as PodcastSpeakerPair)}
              />
              <p className="podcast-form-note">主播组合会写入对话脚本与播客封面提示，并自动使用两套默认音色生成 A/B 对话。</p>
            </div>
          ) : null}
        </div>

        <div className="option-two-col">
          <Field label="封面模板" hint={coverTemplateHint}>
            <select className="cover-template-select" value={coverTemplateId} onChange={(event) => setCoverTemplateId(event.target.value)}>
              {coverTemplateSelectOptions.map(([id, label, hint]) => (
                <option key={id} value={id}>
                  {hint ? `${label} · ${id}` : label}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <Segmented
              label="封面生成"
              value={coverImageMode}
              options={[...ORDINARY_AVAILABLE_COVER_MODES]}
              labels={ORDINARY_AVAILABLE_COVER_MODES.map((mode) => ORDINARY_COVER_MODE_MANIFEST[mode].label)}
              onChange={(value) => setCoverImageMode(value as OrdinaryCoverMode)}
            />
            <small className="hint-text">手动封面暂不可用，待专用素材导入与校验完成后开放。</small>
          </div>
        </div>

        <div className="option-two-col">
          <OptionCloud title="草稿模板" options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])} value={templateId} onChange={handleDraftTemplateChange} />
          <div>
            <span className="field-title">AI 出图比例 <small>{ratioManuallyOverridden ? '已手动覆盖' : '已跟随草稿模板'}</small></span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => handleRatioChange(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="target-controls-row">
          <label className="target-number-field">
            <span>目标字数</span>
            <input
              type="number"
              min="100"
              max="5000"
              step="50"
              value={targetLength}
              placeholder="自动"
              onChange={(event) => setTargetLength(event.target.value)}
            />
            <small>字（±20%，留空跟随原文）</small>
          </label>
          <label className="target-number-field">
            <span>目标分镜数</span>
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={storyboardSceneCount}
              placeholder={storyboardScenePreviewRange ? `自动（${storyboardScenePreviewRange.target}）` : '自动'}
              onChange={(event) => setStoryboardSceneCount(event.target.value)}
            />
            <small>个（±10%，建议每镜 25-45 字）</small>
          </label>
          <label className="target-number-field">
            <span>发布方式</span>
            <Segmented
              label=""
              value={publishMode}
              options={['review-rewrite', 'direct-copy']}
              labels={['预审改写', '直接复用']}
              onChange={(value) => setPublishMode(value as 'review-rewrite' | 'direct-copy')}
            />
            <small>预审改写会走完整流程，直接复用原文可跳过 Step 0 / 1</small>
          </label>
        </div>

        <>
          <span className="field-title">配音员</span>
          <Segmented label="配音模型" value={ttsProvider} options={['volcengine', 'minimax']} labels={['豆包', 'MiniMax']} onChange={handleTtsProviderChange} />
          {videoForm !== 'two-host-podcast' ? (
            <>
            <div className="chip-row">
              {ttsVoiceOptions.map((voice) => (
                <button key={voice.id} className={speaker === voice.id ? 'chip active' : 'chip'} title={voice.id} onClick={() => setSpeaker(voice.id)}>
                  <Mic2 size={14} />
                  {voice.label}
                </button>
              ))}
            </div>
            <span className="hint-text">当前默认配音员：{taskSpeakerLabel(ttsProvider, speaker)} · {speaker}</span>
            </>
          ) : <span className="hint-text">双人播客会按主播组合自动拆分 A/B 音色，当前模型：{ttsProvider}</span>}
        </>

        <span className="field-title">背景音乐</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>
            无 BGM
          </button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>
              {bgm.title}
            </button>
          ))}
          <button className="chip" onClick={addBgmFromTask}><Plus size={14} />添加</button>
        </div>

        <Field label="主角参考图" hint="可选">
          <div className="upload-row">
            <input value={referenceImagePath} placeholder="上传后出现主角的分镜会以这张为基础保持人物一致" onChange={(event) => setReferenceImagePath(event.target.value)} />
            <button className="ghost-action" onClick={selectTaskReferenceImage}>
              <Upload size={15} />
              上传主角参考图
            </button>
          </div>
        </Field>

        <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▼' : '▶'} 高级选项 <span>改写强度 · 叙事视角 · 带货 · 处理模式 · 暂停确认</span>
        </button>
        {showAdvanced ? (
          <div className="advanced-grid">
            <Segmented label="处理模式" value={processingMode} options={['full-auto', 'semi-auto', 'clip-only']} labels={['全自动', '半自动', '只出方案']} onChange={(value) => setProcessingMode(value as ProcessingMode)} />
            <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
            <Segmented label="改写强度" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
            <Segmented label="叙事视角" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
            <label className="toggle-row">
              <input type="checkbox" checked={keepPromotion} onChange={(event) => setKeepPromotion(event.target.checked)} />
              带货保留 <small>启用后保留原素材中的商品与推广信息</small>
            </label>
            <div className="advanced-section copy-control-section">
              <div className="section-title-row">
                <span className="field-title">文案把控</span>
                {productInfo ? <small>已带入：{productInfoSummary(productInfo)}</small> : null}
              </div>
              <div className="copy-control-grid">
                <Field label="固定开头" hint="可选">
                  <textarea className="small-textarea" value={fixedIntro} onChange={(event) => setFixedIntro(event.target.value)} placeholder="例如：今天这本书，先看第一句话。" />
                </Field>
                <Field label="结尾引导" hint="可用 {主角}">
                  <textarea className="small-textarea" value={outroCta} onChange={(event) => setOutroCta(event.target.value)} placeholder="例如：想读{主角}，去橱窗找这本书。" />
                </Field>
                <Field label="锁定开头句数">
                  <input type="number" min="0" max="20" step="1" value={lockIntroSentences} onChange={(event) => setLockIntroSentences(event.target.value)} />
                </Field>
              </div>
            </div>
            <div className="advanced-section material-source-section">
              <Segmented label="素材来源" value={materialSource} options={['ai', 'local']} labels={['AI 生图', '本地人物素材']} onChange={(value) => setMaterialSource(value as 'ai' | 'local')} />
              {materialSource === 'local' ? (
                <Field label="本地人物素材">
                  <select value={materialPerson} onChange={(event) => setMaterialPerson(event.target.value)}>
                    <option value="">请选择人物</option>
                    {personAssets.map((asset) => (
                      <option key={asset.name} value={asset.name}>
                        {asset.name} · {asset.count} 张
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
            <Segmented label="配音语速" value={String(ttsSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setTtsSpeed(Number(value))} />
            <Field label="自定义 / 其他模型">
              <select value={selectedTaskLlmProfileId} onChange={(event) => setSelectedTaskLlmProfileId(event.target.value)}>
                {state.config.llmProfiles.map((profile) => (
                  <option key={profile.id ?? profile.model} value={profile.id ?? profile.model}>
                    {profile.provider}: {profile.model}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <div className="task-footer">
          <span className="danger-text">{isBrowserPreview ? '浏览器预览不能执行真实流水线' : '试用已用尽，复刻版仅本地模拟，不阻断生成'}</span>
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraftNotice('已保存为本地草稿预设')}>
              保存为草稿
            </button>
            <button className="primary-action" onClick={run} disabled={running || isBrowserPreview || isLocalMaterialInvalid || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0)}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              {running ? '运行中' : '开始生成'}
            </button>
          </div>
        </div>
        {draftNotice ? <span className="local-note">{draftNotice}</span> : null}
        <InlineActionFeedback feedback={taskAction.feedback} />
      </section>
    </div>
  );
}

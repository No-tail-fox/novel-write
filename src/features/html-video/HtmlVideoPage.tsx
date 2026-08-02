import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, Eye, FileText, FolderOpen, Image as ImageIcon, Loader2, Mic2, Pause, Play, Plus, RotateCcw, Save, Settings2, XCircle } from 'lucide-react';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { OptionGroup as OptionCloud } from '../../components/OptionGroup';
import { RangeField } from '../../components/RangeField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { ToggleField } from '../../components/ToggleField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppConfig, CustomStyle, DraftTemplate, HtmlVideoConfigChange, HtmlVideoCoverMode, HtmlVideoCoverRatio, HtmlVideoJobConfig, HtmlVideoStepStatus, HtmlVideoTabKey, MinimaxCloneVoice, Task, TaskStatus, TtsProvider } from '../../shared/types';
import type { TemplateOption } from '../../shared/prompt-templates';
import { htmlVideoStyleOptions } from '../../shared/editorial-options';
import { HTML_VIDEO_BGM_VOLUMES, HTML_VIDEO_JOB_DEFAULTS, HTML_VIDEO_RATIOS, HTML_VIDEO_TRANSITIONS, HTML_VIDEO_TTS_PROVIDERS, HTML_VIDEO_TTS_SPEED_MAX, HTML_VIDEO_TTS_SPEED_MIN } from '../../shared/html-video-config';
import { HTML_VIDEO_COVER_MODES, HTML_VIDEO_COVER_RATIOS } from '../../shared/html-video-cover';
import { createHtmlVideoMediaCache, htmlVideoMediaElementScopeMatches, loadHtmlVideoMedia, recordHtmlVideoMediaElementFailure, syncHtmlVideoMediaCache, type HtmlVideoMediaElementFailureState, type HtmlVideoMediaElementScope } from '../../shared/html-video-media';
import { classifyHtmlVideoTaskMessage, createHtmlVideoTaskInput, htmlVideoSteps, htmlVideoTabs, htmlVideoUserFacingError, isHtmlVideoTask, nextHtmlVideoTabKey, safeParseHtmlVideoPipelineData, tabForHtmlVideoStep, taskProgressLabel } from '../../shared/html-video-workflow';
import { defaultTaskSpeakerForProvider, normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider } from '../../shared/tts-voices';
import { taskDetailRefreshKey } from '../../shared/state-reconciliation';
import { useAsyncAction } from '../../ui/async-action';
import { resolveDefaultBgmId, taskFromMutation, validBgmItems } from '../tasks/task-formatters';
import { HtmlVideoAuthoringWorkspace } from './HtmlVideoAuthoringWorkspace';
import { HtmlVideoTabPanel } from './HtmlVideoTabPanel';
import '../../styles/features/html-video.css';

type HtmlVideoWorkspaceMode = 'automatic' | 'authoring';
type HtmlVideoPageMode = 'create' | 'workspace';

export function HtmlVideoPage({
  api,
  state,
  applyState,
  refreshTaskDetail,
  onActiveTaskChange,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  onActiveTaskChange: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [copy, setCopy] = useState('');
  const [style, setStyle] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.style);
  const [ratio, setRatio] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.ratio);
  const [maxScenes, setMaxScenes] = useState<number>(HTML_VIDEO_JOB_DEFAULTS.maxScenes);
  const [foreground, setForeground] = useState<boolean>(HTML_VIDEO_JOB_DEFAULTS.foreground);
  const [bgmId, setBgmId] = useState(resolveDefaultBgmId(state.config));
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>(() => normalizeRuntimeTtsProvider(state.config.tts.provider));
  const [voiceId, setVoiceId] = useState(() => defaultTaskSpeakerForProvider(state.config.tts.provider, state.config));
  const [ttsSpeed, setTtsSpeed] = useState<number>(HTML_VIDEO_JOB_DEFAULTS.ttsSpeed);
  const [bgmVolume, setBgmVolume] = useState<HtmlVideoJobConfig['bgmVolume']>(HTML_VIDEO_JOB_DEFAULTS.bgmVolume);
  const [transitionType, setTransitionType] = useState<HtmlVideoTransition>(HTML_VIDEO_JOB_DEFAULTS.transitionType);
  const [coverImageMode, setCoverImageMode] = useState<HtmlVideoCoverMode>(HTML_VIDEO_JOB_DEFAULTS.coverImageMode);
  const [coverTemplate, setCoverTemplate] = useState<string>(HTML_VIDEO_JOB_DEFAULTS.coverTemplate);
  const [coverRatio, setCoverRatio] = useState<HtmlVideoCoverRatio>(HTML_VIDEO_JOB_DEFAULTS.coverRatio);
  const [draftTemplate, setDraftTemplate] = useState<string>('');
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [pageMode, setPageMode] = useState<HtmlVideoPageMode>('create');
  const [activeTab, setActiveTab] = useState<HtmlVideoTabKey>('text');
  const [workspaceMode, setWorkspaceMode] = useState<HtmlVideoWorkspaceMode>('automatic');
  const [mediaRetryRevision, setMediaRetryRevision] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const htmlVideoAction = useAsyncAction();
  const bgmOptions = validBgmItems(state.config);
  const createVoiceOptions = ttsVoiceOptionsForProvider(ttsProvider, state.minimaxCloneVoices);
  const createStyleOptions = editableHtmlVideoStyleOptions(state.customStyles, style);
  const htmlTasks = state.tasks.filter(isHtmlVideoTask);
  const activeTask = pageMode === 'workspace'
    ? htmlTasks.find((task) => task.id === activeTaskId) ?? null
    : null;
  const activeTaskRefreshKey = taskDetailRefreshKey(activeTask);
  const pipelineParse = useMemo(
    () => safeParseHtmlVideoPipelineData(activeTask?.pipelineData, activeTask?.inputText),
    [activeTask?.inputText, activeTask?.pipelineData],
  );
  const pipelineData = pipelineParse.data;
  const activeStep = pipelineData.current;
  const derivedTab = tabForHtmlVideoStep(activeStep);
  const firstPreviewComposition = pipelineData.compositions.find((composition) => Boolean(composition.htmlPath));
  const mediaTaskId = activeTask?.id ?? '';
  const mediaPaths = useMemo(() => [...new Set([
    ...pipelineData.assets.map((asset) => asset.src),
    ...pipelineData.voices.map((voice) => voice.src),
    ...pipelineData.compositions.flatMap((composition) => [
      composition.thumbnailPath,
      composition.audio.src,
      composition.background.src,
    ]),
    pipelineData.coverAsset?.path,
    pipelineData.output?.path,
  ].filter((path): path is string => Boolean(path)))], [pipelineData]);
  const mediaPathKey = JSON.stringify(mediaPaths);
  const mediaCacheRef = useRef(createHtmlVideoMediaCache());
  const mediaRequestGeneration = useRef(0);
  const currentMediaElementScopeRef = useRef<HtmlVideoMediaElementScope>({
    taskId: mediaTaskId,
    pathKey: mediaPathKey,
    generation: mediaRetryRevision,
  });
  const htmlVideoTabRefs = useRef<Partial<Record<HtmlVideoTabKey, HTMLButtonElement | null>>>({});
  const htmlVideoPanelRef = useRef<HTMLDivElement | null>(null);
  const [mediaState, setMediaState] = useState<{ taskId: string; urls: Record<string, string> }>({ taskId: '', urls: {} });
  const [mediaErrorState, setMediaErrorState] = useState<{ taskId: string; pathKey: string; message: string; failedPaths: string[] }>({
    taskId: '',
    pathKey: '',
    message: '',
    failedPaths: [],
  });
  const [mediaElementFailureState, setMediaElementFailureState] = useState<HtmlVideoMediaElementFailureState>({
    taskId: '', pathKey: '', generation: 0, failedPaths: [],
  });
  const mediaUrls: Record<string, string> = !isBrowserPreview && mediaState.taskId === mediaTaskId
    ? Object.fromEntries(mediaPaths.filter((path) => mediaState.urls[path]).map((path) => [path, mediaState.urls[path]]))
    : {};
  const mediaUrlError = mediaErrorState.taskId === mediaTaskId && mediaErrorState.pathKey === mediaPathKey
    ? mediaErrorState.message
    : '';
  const failedMediaUrlPaths = new Set(
    mediaErrorState.taskId === mediaTaskId && mediaErrorState.pathKey === mediaPathKey
      ? mediaErrorState.failedPaths
      : [],
  );
  const failedMediaElementPaths = new Set(
    mediaElementFailureState.taskId === mediaTaskId
      && mediaElementFailureState.pathKey === mediaPathKey
      && mediaElementFailureState.generation === mediaRetryRevision
      ? mediaElementFailureState.failedPaths
      : [],
  );
  const failedMediaPaths = new Set([...failedMediaUrlPaths, ...failedMediaElementPaths]);
  const mediaError = mediaUrlError || (failedMediaElementPaths.size
    ? '部分媒体文件加载失败，可重新加载媒体。'
    : '');
  const mediaLoading = !isBrowserPreview && mediaPaths.some(
    (path) => !mediaUrls[path] && !failedMediaPaths.has(path),
  );
  const taskBusy = running || htmlVideoAction.busy;
  const runProgress = activeTask ? taskProgressLabel(activeTask) : '0/6';
  const runProgressValue = Number(runProgress.split('/')[0] ?? 0);
  const runProgressPercent = Math.round((runProgressValue / 6) * 100);
  const taskDisplayMessage = activeTask ? htmlVideoUserFacingError(activeTask.errorMessage) : '';
  const taskMessageKind = activeTask
    ? classifyHtmlVideoTaskMessage(activeTask.status, taskDisplayMessage)
    : null;

  useLayoutEffect(() => {
    currentMediaElementScopeRef.current = {
      taskId: mediaTaskId,
      pathKey: mediaPathKey,
      generation: mediaRetryRevision,
    };
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  useEffect(() => {
    if (!activeTask) {
      onActiveTaskChange('');
      return;
    }
    onActiveTaskChange(activeTask.id);
    return () => onActiveTaskChange('');
  }, [activeTask?.id, onActiveTaskChange]);

  useEffect(() => {
    if (activeTask) void refreshTaskDetail(activeTask.id);
  }, [activeTask?.id, activeTaskRefreshKey, refreshTaskDetail]);

  useEffect(() => {
    setActiveTab(derivedTab);
  }, [derivedTab, activeTask?.id]);

  useLayoutEffect(() => {
    if (workspaceMode !== 'automatic') return;
    htmlVideoPanelRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab, activeTask?.id, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === 'authoring' && (!activeTask || pipelineData.compositions.length === 0 || pipelineParse.error)) {
      setWorkspaceMode('automatic');
    }
  }, [activeTask, pipelineData.compositions.length, pipelineParse.error, workspaceMode]);

  useEffect(() => {
    const generation = ++mediaRequestGeneration.current;
    let disposed = false;
    const paths = JSON.parse(mediaPathKey) as string[];
    if (!mediaTaskId || isBrowserPreview || paths.length === 0) {
      syncHtmlVideoMediaCache(mediaCacheRef.current, mediaTaskId, []);
      setMediaState((current) => current.taskId === mediaTaskId && Object.keys(current.urls).length === 0
        ? current
        : { taskId: mediaTaskId, urls: {} });
      setMediaErrorState({ taskId: mediaTaskId, pathKey: mediaPathKey, message: '', failedPaths: [] });
      return () => {
        disposed = true;
      };
    }

    const cache = syncHtmlVideoMediaCache(mediaCacheRef.current, mediaTaskId, paths);
    const retainedUrls = Object.fromEntries(paths.flatMap((path) => {
      const url = cache.urls.get(path);
      return url ? [[path, url]] : [];
    }));
    setMediaState((current) => current.taskId === mediaTaskId && current.urls === retainedUrls
      ? current
      : { taskId: mediaTaskId, urls: retainedUrls });
    setMediaErrorState({ taskId: mediaTaskId, pathKey: mediaPathKey, message: '', failedPaths: [] });
    const pathRequests = paths.map(async (path) => {
      try {
        const url = await loadHtmlVideoMedia(
          cache,
          mediaTaskId,
          path,
          (taskId, mediaPath) => api.getHtmlVideoMediaUrl(taskId, mediaPath),
        );
        return [path, url] as const;
      } catch {
        return [path, null] as const;
      }
    });

    void Promise.all(pathRequests).then((entries) => {
      if (disposed || generation !== mediaRequestGeneration.current) return;
      const availableUrls = Object.fromEntries(entries.flatMap(([path, url]) => url ? [[path, url]] : []));
      setMediaState((current) => current.taskId === mediaTaskId
        ? { taskId: mediaTaskId, urls: { ...current.urls, ...availableUrls } }
        : current);
      setMediaErrorState({
        taskId: mediaTaskId,
        pathKey: mediaPathKey,
        message: entries.every(([, url]) => Boolean(url)) ? '' : '部分媒体文件不可用，可重试任务或检查任务目录。',
        failedPaths: entries.flatMap(([path, url]) => url ? [] : [path]),
      });
    });

    return () => {
      disposed = true;
    };
  }, [api, isBrowserPreview, mediaPathKey, mediaRetryRevision, mediaTaskId]);

  const markMediaElementFailed = useCallback((path: string) => {
    const eventScope = { taskId: mediaTaskId, pathKey: mediaPathKey, generation: mediaRetryRevision };
    if (!mediaTaskId || !htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)) return;
    setMediaElementFailureState((current) => recordHtmlVideoMediaElementFailure(
      current,
      eventScope,
      currentMediaElementScopeRef.current,
      path,
    ));
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  const markMediaElementReady = useCallback((path: string) => {
    const eventScope = { taskId: mediaTaskId, pathKey: mediaPathKey, generation: mediaRetryRevision };
    if (!htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)) return;
    setMediaElementFailureState((current) => {
      if (
        !htmlVideoMediaElementScopeMatches(eventScope, currentMediaElementScopeRef.current)
        || !htmlVideoMediaElementScopeMatches(current, eventScope)
        || !current.failedPaths.includes(path)
      ) return current;
      return { ...current, failedPaths: current.failedPaths.filter((failedPath) => failedPath !== path) };
    });
  }, [mediaPathKey, mediaRetryRevision, mediaTaskId]);

  async function createHtmlVideoTask() {
    if (!copy.trim()) {
      setMessage('请先输入文案。');
      return;
    }
    await htmlVideoAction.run(async () => {
      setRunning(true);
      setMessage('');
      try {
        const next = await api.createHtmlVideoTask(createHtmlVideoTaskInput({
          copy,
          ratio,
          style,
          bgmId,
          maxScenes,
          foreground,
          ttsProvider,
          voiceId,
          ttsSpeed,
          bgmVolume,
          transitionType,
          coverImageMode,
          coverTemplate,
          coverRatio,
          draftTemplate,
          }));
        applyState(next);
        const createdTask = taskFromMutation(next);
        if (createdTask) {
          setActiveTaskId(createdTask.id);
          setPageMode('workspace');
        }
        setMessage(isBrowserPreview ? '已创建浏览器预览快照，未执行特权渲染。' : 'HTML 动画视频任务已创建并开始生成。');
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function changeCreateTtsProvider(value: string) {
    const provider = value as TtsProvider;
    setTtsProvider(provider);
    setVoiceId(ttsVoiceOptionsForProvider(provider, state.minimaxCloneVoices)[0]?.id ?? '');
  }

  function openHtmlVideoTask(taskId: string) {
    if (!taskId) return;
    setActiveTaskId(taskId);
    setPageMode('workspace');
    setWorkspaceMode('automatic');
    setMessage('');
  }

  function openHtmlVideoCreation() {
    setPageMode('create');
    setActiveTaskId('');
    setWorkspaceMode('automatic');
    setMessage('');
  }

  async function setTaskStatus(status: Extract<TaskStatus, 'paused' | 'cancelled' | 'running'>) {
    if (!activeTask) return;
    await htmlVideoAction.run(async () => {
      const next = await api.updateTaskStatus(activeTask.id, status);
      applyState(next);
      setMessage(status === 'paused' ? '任务已暂停。' : status === 'cancelled' ? '任务已取消。' : '任务已继续。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function retryTask() {
    if (!activeTask) return;
    await htmlVideoAction.run(async () => {
      const next = await api.retryTask(activeTask.id);
      applyState(next);
      setMessage('任务已从断点重试。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function openPreview(sceneIndex?: number) {
    if (!activeTask) return;
    await htmlVideoAction.run(
      () => api.openHtmlVideoPreview(activeTask.id, sceneIndex),
      { onError: (error) => setMessage(error.message) },
    );
  }

  async function openOutputDirectory() {
    if (!activeTask?.outputDir) return;
    await htmlVideoAction.run(
      () => api.openTaskOutputDirectory(activeTask.id),
      { onError: (error) => setMessage(error.message) },
    );
  }

  function handleHtmlVideoTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tabKey: HtmlVideoTabKey) {
    const nextTab = nextHtmlVideoTabKey(tabKey, event.key);
    if (!nextTab) return;
    event.preventDefault();
    setActiveTab(nextTab);
    htmlVideoTabRefs.current[nextTab]?.focus();
  }

  if (pageMode === 'create' || !activeTask) {
    return (
      <div className="hv-create-page" data-html-video-create-page="true">
        <div className="hv-create-shell">
          <header className="hv-create-header">
            <div>
              <h1>HTML 动画视频</h1>
              <p>输入文案，AI 自动规划分镜 → 出素材 → 配音 → 生成动画分镜</p>
            </div>
            {htmlTasks.length ? (
              <label className="hv-create-history">
                <span>已有任务</span>
                <select
                  value=""
                  aria-label="打开已有 HTML 动画视频任务"
                  onChange={(event) => openHtmlVideoTask(event.target.value)}
                >
                  <option value="">选择任务...</option>
                  {htmlTasks.map((task) => <option key={task.id} value={task.id}>{task.title || task.id}</option>)}
                </select>
              </label>
            ) : null}
          </header>

          <div className="hv-create-sheet">
            <section className="hv-create-section">
              <header><FileText size={17} /><div><h2>文案</h2><p>粘贴文案 · 处理方式</p></div></header>
              <div className="hv-create-section-content">
                <Field label="文案" hint="可直接粘贴口播稿，生成后会自动改写并切分场景">
                  <textarea
                    className="source-textarea"
                    value={copy}
                    placeholder="在这里粘贴或输入完整口播文案..."
                    onChange={(event) => setCopy(event.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="hv-create-section">
              <header><ImageIcon size={17} /><div><h2>画面</h2><p>风格 · 分镜 · 画布</p></div></header>
              <div className="hv-create-section-content hv-create-stack">
                <div data-html-video-create-field="style">
                  <OptionCloud title="画面风格" options={createStyleOptions} value={style} onChange={setStyle} />
                </div>
                <div className="advanced-grid">
                  <div data-html-video-create-field="ratio">
                    <Segmented label="画布比例" value={ratio} options={[...HTML_VIDEO_RATIOS]} onChange={setRatio} />
                  </div>
                  <div data-html-video-create-field="maxScenes">
                    <Field label="场景上限"><input type="number" min={1} max={30} step={1} value={maxScenes} onChange={(event) => setMaxScenes(Number(event.target.value))} /></Field>
                  </div>
                  <div data-html-video-create-field="foreground">
                    <Segmented label="前景图" value={foreground ? 'on' : 'off'} options={['on', 'off']} labels={['生成', '跳过']} onChange={(value) => setForeground(value === 'on')} />
                  </div>
                  <div data-html-video-create-field="transitionType">
                    <Field label="转场">
                      <select value={transitionType} onChange={(event) => setTransitionType(event.target.value as HtmlVideoTransition)}>
                        {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{transition}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
              </div>
            </section>

            <section className="hv-create-section">
              <header><Clapperboard size={17} /><div><h2>封面海报</h2><p>发布封面 · 独立于正片</p></div></header>
              <div className="hv-create-section-content advanced-grid hv-cover-create-grid">
                <div data-html-video-create-field="coverImageMode">
                  <Segmented label="封面" value={coverImageMode} options={[...HTML_VIDEO_COVER_MODES]} labels={['关闭', '自动', '手动']} onChange={(value) => setCoverImageMode(value as HtmlVideoCoverMode)} />
                </div>
                <div data-html-video-create-field="coverTemplate">
                  <Field label="封面模板">
                    <select value={coverTemplate} onChange={(event) => setCoverTemplate(event.target.value)}>
                      {coverTemplate && !state.customCoverTemplates.some((item) => item.id === coverTemplate)
                        ? <option value={coverTemplate}>{coverTemplate}（目录中已缺失）</option>
                        : null}
                      {state.customCoverTemplates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div data-html-video-create-field="coverRatio">
                  <Segmented label="封面比例" value={coverRatio} options={[...HTML_VIDEO_COVER_RATIOS]} onChange={(value) => setCoverRatio(value as HtmlVideoCoverRatio)} />
                </div>
              </div>
            </section>

            <section className="hv-create-section">
              <header><Mic2 size={17} /><div><h2>配音</h2><p>音色 · 语速 · 背景音乐</p></div></header>
              <div className="hv-create-section-content hv-create-stack">
                <div className="advanced-grid">
                  <div data-html-video-create-field="ttsProvider">
                    <Field label="配音模型">
                      <select value={ttsProvider} onChange={(event) => changeCreateTtsProvider(event.target.value)}>
                        {HTML_VIDEO_TTS_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div data-html-video-create-field="voiceId">
                    <Field label="音色">
                      <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)}>
                        {voiceId && !createVoiceOptions.some((option) => option.id === voiceId)
                          ? <option value={voiceId}>{taskSpeakerLabel(ttsProvider, voiceId, state.minimaxCloneVoices)}</option>
                          : null}
                        {createVoiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div data-html-video-create-field="ttsSpeed">
                    <RangeField label="语速" min={HTML_VIDEO_TTS_SPEED_MIN} max={HTML_VIDEO_TTS_SPEED_MAX} step={0.1} value={ttsSpeed} onChange={setTtsSpeed} />
                  </div>
                  <div data-html-video-create-field="bgmVolume">
                    <Segmented label="配乐音量" value={bgmVolume ?? 'soft'} options={[...HTML_VIDEO_BGM_VOLUMES]} labels={['轻', '中', '响']} onChange={(value) => setBgmVolume(value as NonNullable<typeof bgmVolume>)} />
                  </div>
                </div>
                <div data-html-video-create-field="bgmId">
                  <span className="field-title">背景音乐</span>
                  <div className="chip-row">
                    <button type="button" className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>无配乐</button>
                    {bgmOptions.map((bgm) => (
                      <button type="button" key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>{bgm.title}</button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="hv-create-section">
              <header><Settings2 size={17} /><div><h2>输出</h2><p>草稿模板 · 生成方式</p></div></header>
              <div className="hv-create-section-content">
                <div data-html-video-create-field="draftTemplate">
                  <Field label="剪映草稿模板">
                    <select value={draftTemplate} onChange={(event) => setDraftTemplate(event.target.value)}>
                      <option value="">只输出 HTML 视频</option>
                      {draftTemplate && !state.draftTemplates.some((item) => item.id === draftTemplate)
                        ? <option value={draftTemplate}>{draftTemplate}（目录中已缺失）</option>
                        : null}
                      {state.draftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            </section>

            <footer className="hv-create-footer">
              <div>
                {isBrowserPreview ? <span className="local-note">浏览器模式只保存预览快照，不生成本地媒体或视频。</span> : null}
                {message ? <span className="local-note" role="status">{message}</span> : null}
                <InlineActionFeedback feedback={htmlVideoAction.feedback} />
              </div>
              <button className="primary-action hv-create-submit" type="button" onClick={createHtmlVideoTask} disabled={taskBusy || !copy.trim()}>
                {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                开始生成
              </button>
            </footer>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="hv-studio" data-html-video-studio="html-video" data-has-task="true">
      <section className="hv-studio-parameters" aria-label="HTML 动画视频制作参数">
        <div className="hv-studio-panel-heading">
          <div>
            <h2>{activeTask.title}</h2>
            <span>{activeTask.id}</span>
          </div>
          <button className="mini-button hv-new-task-button" type="button" onClick={openHtmlVideoCreation}>
            <Plus size={14} />新建
          </button>
        </div>

        <div className="hv-reference-summary-stats">
          <div><strong>{runProgressValue}/{htmlVideoSteps.length}</strong><small>当前步骤</small></div>
          <div><strong>{pipelineData.compositions.length}/{pipelineData.scenes.length || '-'}</strong><small>场景数</small></div>
          <div><strong>{pipelineData.output?.durationSec?.toFixed(1) ?? '-'}</strong><small>总时长（秒）</small></div>
        </div>

        {htmlTasks.length ? (
          <Field label="HTML 任务">
            <select value={activeTask.id} onChange={(event) => openHtmlVideoTask(event.target.value)} aria-label="切换 HTML 动画视频任务">
              {htmlTasks.map((task) => <option key={task.id} value={task.id}>{task.title || task.id}</option>)}
            </select>
          </Field>
        ) : null}

        {isBrowserPreview ? <span className="local-note">浏览器模式只保存预览快照，不生成本地媒体或视频。</span> : null}
        {message ? <span className="local-note">{message}</span> : null}
        <InlineActionFeedback feedback={htmlVideoAction.feedback} />
        {activeTask && !pipelineParse.error ? (<details className="hv-reference-task-settings">
          <summary>任务参数</summary>
          <HtmlVideoConfigEditor
            key={`${activeTask.id}:${pipelineData.revision}`}
            api={api}
            task={activeTask}
            config={pipelineData.config}
            appConfig={state.config}
            customStyles={state.customStyles}
            draftTemplates={state.draftTemplates}
            cloneVoices={state.minimaxCloneVoices}
            applyState={applyState}
            refreshTaskDetail={refreshTaskDetail}
          />
        </details>) : null}
      </section>

      <section className="hv-studio-canvas" aria-label="HTML 动画视频媒体工作区">
        <div className="hv-studio-canvas-heading">
          <div>
            <strong>{activeTask?.title ?? '等待创建 HTML 动画视频任务'}</strong>
            <span>{activeTask ? `当前阶段：${htmlVideoPipelineStepLabel(activeStep)}` : '创建后在此查看文案、素材、配音、预览、封面和出片。'}</span>
          </div>
          <div className="hv-studio-canvas-actions">
            <div className="hv-workspace-mode" role="group" aria-label="HTML 动画工作区模式">
              <button type="button" className={workspaceMode === 'automatic' ? 'active' : ''} aria-pressed={workspaceMode === 'automatic'} onClick={() => setWorkspaceMode('automatic')}>自动制作</button>
              <button
                type="button"
                className={workspaceMode === 'authoring' ? 'active' : ''}
                aria-pressed={workspaceMode === 'authoring'}
                disabled={!activeTask || pipelineData.compositions.length === 0 || Boolean(pipelineParse.error)}
                onClick={() => setWorkspaceMode('authoring')}
              >
                可视编排
              </button>
            </div>
            <span className="hv-studio-canvas-ratio">{pipelineData.config.ratio ?? ratio}</span>
          </div>
        </div>
        {pipelineParse.error && activeTask ? (
          <div className="hv-workspace-error" role="alert" aria-live="assertive">
            <ErrorSummaryButton compact title="HTML 视频任务数据损坏" fullMessage={pipelineParse.error} />
          </div>
        ) : taskMessageKind === 'error' && activeTask ? (
          <div className="hv-workspace-error" role="alert" aria-live="assertive">
            <ErrorSummaryButton compact title={`${activeTask.title || 'HTML 动画视频任务'}错误`} fullMessage={taskDisplayMessage} />
          </div>
        ) : taskMessageKind === 'status' && activeTask ? (
          <div className="hv-workspace-status" role="status" aria-live="polite">{taskDisplayMessage}</div>
        ) : null}
        {workspaceMode === 'authoring' && activeTask && pipelineData.compositions.length ? (
          <HtmlVideoAuthoringWorkspace
            key={activeTask.id}
            api={api}
            taskId={activeTask.id}
            taskStatus={activeTask.status}
            scenes={pipelineData.compositions}
            applyState={applyState}
            refreshTaskDetail={refreshTaskDetail}
            isBrowserPreview={isBrowserPreview}
          />
        ) : <div className="hv-studio-media-canvas" data-media-canvas="html-video">
          <div className="hv-tabs" role="tablist" aria-label="HTML 动画视频内容">
            {htmlVideoTabs.map((tab) => (
              <button
                key={tab.key}
                id={`html-video-tab-${tab.key}`}
                ref={(element) => {
                  htmlVideoTabRefs.current[tab.key] = element;
                }}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-controls="html-video-panel"
                tabIndex={activeTab === tab.key ? 0 : -1}
                className={activeTab === tab.key ? 'hv-tab active' : 'hv-tab'}
                onClick={() => setActiveTab(tab.key)}
                onKeyDown={(event) => handleHtmlVideoTabKeyDown(event, tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {mediaError ? (
            <div className="hv-media-error" role="alert">
              <span>{mediaError}</span>
              <button className="mini-button" type="button" onClick={() => setMediaRetryRevision((revision) => revision + 1)}>
                <RotateCcw size={14} />重新加载媒体
              </button>
            </div>
          ) : null}
          <div ref={htmlVideoPanelRef} id="html-video-panel" className="hv-studio-media-panel" role="tabpanel" aria-labelledby={`html-video-tab-${activeTab}`} aria-busy={mediaLoading}>
            <HtmlVideoTabPanel
              api={api}
              tab={activeTab}
              task={activeTask}
              data={pipelineData}
              customCoverTemplates={state.customCoverTemplates}
              applyState={applyState}
              refreshTaskDetail={refreshTaskDetail}
              mediaUrls={mediaUrls}
              failedMediaPaths={failedMediaPaths}
              mediaRetryRevision={mediaRetryRevision}
              onMediaElementError={markMediaElementFailed}
              onMediaElementReady={markMediaElementReady}
              busy={taskBusy}
              isBrowserPreview={isBrowserPreview}
              openPreview={openPreview}
              onRetry={retryTask}
              cloneVoices={state.minimaxCloneVoices}
              bgmOptions={bgmOptions}
              openOutputDirectory={openOutputDirectory}
            />
          </div>
          <div className="hv-timeline" aria-label="HTML 动画视频时间线">
            <span className="hv-timeline-label">画面</span>
            <div className="hv-timeline-track">
              {pipelineData.compositions.length ? pipelineData.compositions.map((composition) => (
                <span key={composition.index} style={{ flexGrow: Math.max(1, composition.durationSec) }}>场景 {String(composition.index).padStart(2, '0')}</span>
              )) : <small>等待动画预览生成</small>}
            </div>
            <span className="hv-timeline-label">配音</span>
            <div className="hv-timeline-audio" aria-label="配音轨道">
              {pipelineData.voiceClips.length ? pipelineData.voiceClips.map((clip) => <i key={`${clip.sceneIndex}-${clip.src}`} />) : <small>等待配音生成</small>}
            </div>
          </div>
        </div>}
      </section>

      <aside className="hv-studio-run-rail" aria-label="HTML 动画视频渲染进度">
        <div className="hv-run-rail-heading">
          <div><h3>渲染进度</h3><span>{activeTask ? '任务正在处理' : '等待创建任务'}</span></div>
          <strong>{runProgress} · {runProgressPercent}%</strong>
        </div>
        <div className="hv-run-progress" aria-label={`当前进度 ${runProgress}`}><i style={{ width: `${runProgressPercent}%` }} /></div>
        {pipelineData.warnings.length ? (
          <div className="hv-warning-list" role="status" aria-live="polite">
            <strong>流水线提示</strong>
            <ul>{pipelineData.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
          </div>
        ) : null}
        <div className="task-metrics">
          <div><small>计划场景</small><strong>{pipelineData.scenes.length}</strong></div>
          <div><small>完成预览</small><strong>{pipelineData.compositions.length}</strong></div>
          <div><small>画布</small><strong>{pipelineData.config.ratio ?? ratio}</strong></div>
          <div><small>逐帧截图</small><strong>{htmlVideoStepStatusLabel(pipelineData.steps.render.status, activeTask?.status)}</strong></div>
        </div>
        <div className="hv-run-steps">
          {htmlVideoSteps.map((step, index) => {
            const stepState = pipelineData.steps[step.key];
            const status = stepState.status;
            return (
              <div key={step.key} className={`hv-step ${htmlVideoStepClass(status)}`}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.name}</strong>
                  <small>{step.sub} · {htmlVideoStepStatusLabel(stepState.status, activeTask?.status)}</small>
                  {stepState.error ? <div className="hv-step-error" role="alert" aria-live="assertive"><ErrorSummaryButton compact title={`${step.name}错误`} fullMessage={htmlVideoUserFacingError(stepState.error)} /></div> : null}
                </div>
              </div>
            );
          })}
        </div>
        {activeTask ? (
          <div className="hv-run-controls" aria-label="HTML 动画视频任务控制">
            {activeTask.status === 'running' || activeTask.status === 'pending' ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('paused')}><Pause size={14} />暂停</button> : null}
            {['running', 'pending', 'paused'].includes(activeTask.status) ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('cancelled')}><XCircle size={14} />取消</button> : null}
            {activeTask.status === 'paused' ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => setTaskStatus('running')}><Play size={14} />继续</button> : null}
            {pipelineParse.error || activeTask.status === 'failed' || activeTask.status === 'cancelled' ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={retryTask}><RotateCcw size={14} />重试</button> : null}
            {firstPreviewComposition ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={() => openPreview(firstPreviewComposition.index)}><Eye size={14} />预览</button> : null}
            {activeTask.outputDir ? <button className="mini-button" disabled={taskBusy || isBrowserPreview} onClick={openOutputDirectory}><FolderOpen size={14} />打开目录</button> : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

type HtmlVideoTransition = Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'];

interface HtmlVideoEditableValues {
  style: string;
  voiceId: string;
  ttsProvider: TtsProvider;
  ttsSpeed: number;
  bgmId: string;
  bgmVolume: 'soft' | 'medium' | 'loud';
  transitionType: HtmlVideoTransition;
  foreground: boolean;
  maxScenes: number;
  ratio: '9:16' | '16:9' | '1:1' | '4:3';
  draftTemplate: string;
}

function editableHtmlVideoValues(config: HtmlVideoJobConfig): Omit<HtmlVideoEditableValues, 'transitionType'> & { transitionType: HtmlVideoTransition } {
  return {
    style: config.style ?? HTML_VIDEO_JOB_DEFAULTS.style,
    voiceId: config.voiceId ?? HTML_VIDEO_JOB_DEFAULTS.voiceId,
    ttsProvider: config.ttsProvider ?? HTML_VIDEO_JOB_DEFAULTS.ttsProvider,
    ttsSpeed: config.ttsSpeed ?? HTML_VIDEO_JOB_DEFAULTS.ttsSpeed,
    bgmId: config.bgmId ?? HTML_VIDEO_JOB_DEFAULTS.bgmId,
    bgmVolume: config.bgmVolume ?? 'soft',
    transitionType: (config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as HtmlVideoTransition,
    foreground: config.foreground ?? HTML_VIDEO_JOB_DEFAULTS.foreground,
    maxScenes: config.maxScenes ?? HTML_VIDEO_JOB_DEFAULTS.maxScenes,
    ratio: (config.ratio ?? HTML_VIDEO_JOB_DEFAULTS.ratio) as HtmlVideoEditableValues['ratio'],
    draftTemplate: config.draftTemplate ?? '',
  };
}

function editableHtmlVideoStyleOptions(customStyles: CustomStyle[], currentStyle: string): TemplateOption[] {
  const options = new Map(htmlVideoStyleOptions.map((option) => [option[0], option]));
  for (const style of customStyles) options.set(style.id, [style.id, style.name, '自定义画风']);
  if (currentStyle && !options.has(currentStyle)) options.set(currentStyle, [currentStyle, currentStyle, '当前任务画风']);
  return [...options.values()];
}

function HtmlVideoConfigEditor({
  api,
  task,
  config,
  appConfig,
  customStyles,
  draftTemplates,
  cloneVoices,
  applyState,
  refreshTaskDetail,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  appConfig: AppConfig;
  customStyles: CustomStyle[];
  draftTemplates: DraftTemplate[];
  cloneVoices: readonly MinimaxCloneVoice[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
}) {
  const initial = editableHtmlVideoValues(config);
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState('');
  const htmlVideoConfigAction = useAsyncAction();
  const bgmOptions = validBgmItems(appConfig);
  const htmlVideoStyleChoices = editableHtmlVideoStyleOptions(customStyles, values.style);
  const voiceOptions = ttsVoiceOptionsForProvider(values.ttsProvider, cloneVoices);
  const disabled = task.status === 'pending' || task.status === 'running' || htmlVideoConfigAction.busy;

  function setValue<K extends keyof typeof values>(field: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function changeProvider(value: string) {
    const ttsProvider = value as TtsProvider;
    const nextVoice = ttsVoiceOptionsForProvider(ttsProvider, cloneVoices)[0]?.id ?? '';
    setValues((current) => ({ ...current, ttsProvider, voiceId: nextVoice }));
  }

  async function saveConfig() {
    const changes: HtmlVideoConfigChange[] = [];
    for (const field of [
      'style', 'voiceId', 'ttsProvider', 'ttsSpeed', 'bgmId', 'bgmVolume',
      'transitionType', 'foreground', 'maxScenes', 'ratio', 'draftTemplate',
    ] as const) {
      if (values[field] !== initial[field]) {
        changes.push({ field, value: values[field] } as HtmlVideoConfigChange);
      }
    }
    if (changes.length === 0) {
      setMessage('参数没有变化。');
      return;
    }
    await htmlVideoConfigAction.run(async () => {
      const next = await api.updateHtmlVideoConfig(task.id, changes);
      applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('参数已保存，任务已回到可继续状态。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-config-editor" aria-label="当前 HTML 视频任务参数">
      <div className="panel-title-row">
        <div><h4>任务参数</h4><span>保存后从最早受影响阶段继续</span></div>
        <button className="mini-button" type="button" onClick={saveConfig} disabled={disabled}>
          {htmlVideoConfigAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存参数
        </button>
      </div>
      <fieldset className="advanced-grid hv-config-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="style">
          <Field label="画面风格">
            <select value={values.style} onChange={(event) => setValue('style', event.target.value)} disabled={disabled}>
              {htmlVideoStyleChoices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="ttsProvider">
          <Field label="配音模型">
            <select value={values.ttsProvider} onChange={(event) => changeProvider(event.target.value)} disabled={disabled}>
              {HTML_VIDEO_TTS_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="voiceId">
          <Field label="音色">
            <select value={values.voiceId} onChange={(event) => setValue('voiceId', event.target.value)} disabled={disabled}>
              {values.voiceId && !voiceOptions.some((option) => option.id === values.voiceId)
                ? <option value={values.voiceId}>{taskSpeakerLabel(values.ttsProvider, values.voiceId, cloneVoices)}</option>
                : null}
              {voiceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="ttsSpeed">
          <RangeField label="语速" min={HTML_VIDEO_TTS_SPEED_MIN} max={HTML_VIDEO_TTS_SPEED_MAX} step={0.1} value={values.ttsSpeed} onChange={(value) => setValue('ttsSpeed', value)} />
        </div>
        <div data-html-video-edit-field="bgmId">
          <Field label="背景音乐">
            <select value={values.bgmId} onChange={(event) => setValue('bgmId', event.target.value)} disabled={disabled}>
              <option value="">无配乐</option>
              {values.bgmId && !bgmOptions.some((bgm) => bgm.id === values.bgmId)
                ? <option value={values.bgmId}>{values.bgmId}（素材库中已缺失）</option>
                : null}
              {bgmOptions.map((bgm) => <option key={bgm.id} value={bgm.id}>{bgm.title}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="bgmVolume">
          <Segmented label="配乐音量" value={values.bgmVolume} options={[...HTML_VIDEO_BGM_VOLUMES]} labels={['轻', '中', '响']} onChange={(value) => setValue('bgmVolume', value as typeof values.bgmVolume)} />
        </div>
        <div data-html-video-edit-field="transitionType">
          <Field label="转场">
            <select value={values.transitionType} onChange={(event) => setValue('transitionType', event.target.value as HtmlVideoTransition)} disabled={disabled}>
              {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{transition}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="foreground">
          <ToggleField label="生成前景图" checked={values.foreground} onChange={(value) => setValue('foreground', value)} />
        </div>
        <div data-html-video-edit-field="maxScenes">
          <Field label="场景上限">
            <input type="number" min={1} max={30} step={1} value={values.maxScenes} onChange={(event) => setValue('maxScenes', Number(event.target.value))} disabled={disabled} />
          </Field>
        </div>
        <div data-html-video-edit-field="ratio">
          <Segmented label="画布比例" value={values.ratio} options={[...HTML_VIDEO_RATIOS]} onChange={(value) => setValue('ratio', value as typeof values.ratio)} />
        </div>
        <div data-html-video-edit-field="draftTemplate">
          <Field label="剪映草稿模板">
            <select value={values.draftTemplate} onChange={(event) => setValue('draftTemplate', event.target.value)} disabled={disabled}>
              <option value="">只输出 HTML 视频</option>
              {values.draftTemplate && !draftTemplates.some((template) => template.id === values.draftTemplate)
                ? <option value={values.draftTemplate}>{values.draftTemplate}（目录中已缺失）</option>
                : null}
              {draftTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={htmlVideoConfigAction.feedback} />
    </section>
  );
}

function htmlVideoStepClass(status: HtmlVideoStepStatus): string {
  return status === 'completed' ? 'done' : status;
}

function htmlVideoStepStatusLabel(status: HtmlVideoStepStatus, taskStatus?: TaskStatus): string {
  if (status === 'cancelled' && taskStatus === 'paused') return '已暂停';
  return {
    pending: '等待',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function htmlVideoPipelineStepLabel(step: string): string {
  return {
    rewrite: '改写与分句',
    planning: '场景规划',
    assets: '素材生成',
    voice: '配音生成',
    preview: '动画预览',
    render: '逐帧合成',
    done: '出片完成',
  }[step] ?? '等待推进';
}

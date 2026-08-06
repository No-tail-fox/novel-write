import React, { useEffect, useState } from 'react';
import { Copy, FolderOpen, Image as ImageIcon, Loader2, Music2, Play, RefreshCw, RotateCcw, Save, Upload, WandSparkles } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { BgmItem, CustomCoverTemplate, HtmlVideoConfigChange, HtmlVideoCoverAsset, HtmlVideoCoverMode, HtmlVideoCoverRatio, HtmlVideoJobConfig, HtmlVideoTabKey, MinimaxCloneVoice, Task } from '../../shared/types';
import { HTML_VIDEO_CAPTION_ANIMATIONS, HTML_VIDEO_CAPTION_COLOR_KEYS, HTML_VIDEO_CAPTION_PRESETS, htmlVideoCaptionColorsEqual, htmlVideoCaptionPickerColor, resolveHtmlVideoCaptionStyle, validateHtmlVideoCaptionColors, type HtmlVideoCaptionAnimation, type HtmlVideoCaptionColorKey, type HtmlVideoCaptionColorOverrides, type HtmlVideoCaptionPreset } from '../../shared/html-video-captions';
import { HTML_VIDEO_CONTROL_MANIFEST_V1 } from '../../shared/html-video-control-manifest';
import { HTML_VIDEO_COVER_MODES, HTML_VIDEO_COVER_RATIOS, buildHtmlVideoCoverPrompt, htmlVideoCoverDimensions } from '../../shared/html-video-cover';
import { HTML_VIDEO_BGM_VOLUMES, HTML_VIDEO_JOB_DEFAULTS, HTML_VIDEO_TRANSITION_LABELS, HTML_VIDEO_TRANSITIONS } from '../../shared/html-video-config';
import { htmlVideoMediaElementKey, htmlVideoMediaStatus } from '../../shared/html-video-media';
import { fitHtmlVideoOutputSize, htmlVideoUserFacingError, safeParseHtmlVideoPipelineData } from '../../shared/html-video-workflow';
import { useAsyncAction } from '../../ui/async-action';
import {
  HtmlVideoStoryboundAssetsPanel,
  HtmlVideoStoryboundPreviewPanel,
  HtmlVideoStoryboundTextPanel,
  HtmlVideoStoryboundVoicePanel,
} from './HtmlVideoStoryboundPanels';

const htmlVideoCaptionPresetLabels: Record<HtmlVideoCaptionPreset, string> = {
  classic: '经典',
  editorial: '编辑部',
  karaoke: '卡拉 OK',
};

const htmlVideoCaptionAnimationLabels: Record<HtmlVideoCaptionAnimation, string> = {
  none: '无动画',
  'fade-up': '淡入上浮',
  pop: '弹入',
};

const htmlVideoCaptionColorLabels: Record<HtmlVideoCaptionColorKey, string> = {
  text: '文字',
  accent: '强调',
  background: '底色',
  shadow: '阴影',
};

function HtmlVideoCaptionEditor({
  api,
  task,
  config,
  applyState,
  refreshTaskDetail,
  busy,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
}) {
  const initial = resolveHtmlVideoCaptionStyle(config);
  const configColorsKey = JSON.stringify(config.captionColors ?? {});
  const [preset, setPreset] = useState<HtmlVideoCaptionPreset>(initial.preset);
  const [animation, setAnimation] = useState<HtmlVideoCaptionAnimation>(initial.requestedAnimation);
  const [colors, setColors] = useState(initial.colors);
  const [colorOverrides, setColorOverrides] = useState<HtmlVideoCaptionColorOverrides>({ ...(config.captionColors ?? {}) });
  const [message, setMessage] = useState('');
  const captionAction = useAsyncAction();
  const disabled = busy || task.status === 'pending' || task.status === 'running' || captionAction.busy;

  useEffect(() => {
    const next = resolveHtmlVideoCaptionStyle(config);
    setPreset(next.preset);
    setAnimation(next.requestedAnimation);
    setColors(next.colors);
    setColorOverrides({ ...(config.captionColors ?? {}) });
    setMessage('');
  }, [task.id, config.captionPreset, config.captionAnim, configColorsKey]);

  function changePreset(value: HtmlVideoCaptionPreset) {
    setPreset(value);
    setColors(resolveHtmlVideoCaptionStyle({ captionPreset: value, captionColors: colorOverrides }).colors);
  }

  function changeColor(key: HtmlVideoCaptionColorKey, value: string) {
    setColors((current) => ({ ...current, [key]: value }));
    try {
      const validated = validateHtmlVideoCaptionColors({ [key]: value });
      setColorOverrides((current) => ({ ...current, [key]: validated[key] }));
      setMessage('');
    } catch {
      setMessage('颜色代码仅支持 3、4、6 或 8 位十六进制。');
    }
  }

  function resetColor(key: HtmlVideoCaptionColorKey) {
    const next = { ...colorOverrides };
    delete next[key];
    setColorOverrides(next);
    setColors(resolveHtmlVideoCaptionStyle({ captionPreset: preset, captionColors: next }).colors);
    setMessage('');
  }

  async function saveCaptionConfig() {
    try {
      validateHtmlVideoCaptionColors(colors);
    } catch {
      setMessage('请先修正无效的字幕颜色代码。');
      return;
    }
    const changes: HtmlVideoConfigChange[] = [];
    if (preset !== initial.preset) changes.push({ field: 'captionPreset', value: preset });
    if (animation !== initial.requestedAnimation) changes.push({ field: 'captionAnim', value: animation });
    if (!htmlVideoCaptionColorsEqual(config.captionColors, colorOverrides)) {
      changes.push({ field: 'captionColors', value: colorOverrides });
    }
    if (!changes.length) {
      setMessage('字幕参数没有变化。');
      return;
    }
    await captionAction.run(async () => {
      const next = await api.updateHtmlVideoConfig(task.id, changes);
      applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('字幕参数已保存。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-caption-editor" aria-label="字幕样式参数">
      <div className="panel-title-row">
        <h4>字幕样式</h4>
        <button className="mini-button" type="button" disabled={disabled} onClick={saveCaptionConfig}>
          {captionAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存字幕
        </button>
      </div>
      <fieldset className="hv-caption-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="captionPreset">
          <Field label="字幕预设">
            <select value={preset} onChange={(event) => changePreset(event.target.value as HtmlVideoCaptionPreset)} disabled={disabled}>
              {HTML_VIDEO_CAPTION_PRESETS.map((value) => <option key={value} value={value}>{htmlVideoCaptionPresetLabels[value]}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="captionAnim">
          <Field label="字幕动画">
            <select value={animation} onChange={(event) => setAnimation(event.target.value as HtmlVideoCaptionAnimation)} disabled={disabled}>
              {HTML_VIDEO_CAPTION_ANIMATIONS.map((value) => <option key={value} value={value}>{htmlVideoCaptionAnimationLabels[value]}</option>)}
            </select>
          </Field>
        </div>
        <div className="hv-caption-colors" data-html-video-edit-field="captionColors">
          {HTML_VIDEO_CAPTION_COLOR_KEYS.map((key) => (
            <div className="hv-caption-color-item" key={key}>
              <span>{htmlVideoCaptionColorLabels[key]}</span>
              <div className="hv-caption-color-controls">
                <input
                  type="color"
                  aria-label={`${htmlVideoCaptionColorLabels[key]}颜色选择`}
                  value={htmlVideoCaptionPickerColor(colors[key])}
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
                <input
                  className="hv-caption-color-code"
                  type="text"
                  aria-label={`${htmlVideoCaptionColorLabels[key]}十六进制颜色`}
                  value={colors[key]}
                  maxLength={9}
                  spellCheck={false}
                  disabled={disabled}
                  onChange={(event) => changeColor(key, event.target.value)}
                />
                <button
                  className="icon-button hv-caption-color-reset"
                  type="button"
                  title="恢复预设颜色"
                  aria-label={`恢复${htmlVideoCaptionColorLabels[key]}预设颜色`}
                  disabled={disabled || colorOverrides[key] === undefined}
                  onClick={() => resetColor(key)}
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={captionAction.feedback} />
    </section>
  );
}

function HtmlVideoCoverEditor({
  api,
  task,
  config,
  coverAsset,
  templates,
  summary,
  renderError,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
  openOutputDirectory,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  coverAsset?: HtmlVideoCoverAsset;
  templates: CustomCoverTemplate[];
  summary: string;
  renderError?: string;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
  isBrowserPreview: boolean;
  openOutputDirectory: () => Promise<void>;
}) {
  const initialMode = config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode;
  const initialTemplate = config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate;
  const initialRatio = config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio;
  const [mode, setMode] = useState<HtmlVideoCoverMode>(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [ratio, setRatio] = useState<HtmlVideoCoverRatio>(initialRatio);
  const [prompt, setPrompt] = useState(
    config.coverPrompt?.trim() || createCoverPrompt(task.title, summary, templates, initialTemplate, initialRatio),
  );
  const [usesDefaultPrompt, setUsesDefaultPrompt] = useState(!config.coverPrompt?.trim());
  const [message, setMessage] = useState('');
  const coverAction = useAsyncAction();
  const taskActive = task.status === 'pending' || task.status === 'running';
  const disabled = busy || taskActive || coverAction.busy;
  const dimensions = htmlVideoCoverDimensions(ratio);
  const selectedTemplate = templates.find((item) => item.id === templateId);

  useEffect(() => {
    const nextMode = config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode;
    const nextTemplate = config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate;
    const nextRatio = config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio;
    setMode(nextMode);
    setTemplateId(nextTemplate);
    setRatio(nextRatio);
    setPrompt(config.coverPrompt?.trim() || createCoverPrompt(task.title, summary, templates, nextTemplate, nextRatio));
    setUsesDefaultPrompt(!config.coverPrompt?.trim());
    setMessage('');
  }, [task.id, task.title, summary, templates, config.coverImageMode, config.coverTemplate, config.coverRatio, config.coverPrompt]);

  function pendingChanges(): HtmlVideoConfigChange[] {
    const changes: HtmlVideoConfigChange[] = [];
    if (mode !== initialMode) changes.push({ field: 'coverImageMode', value: mode });
    if (templateId !== initialTemplate) changes.push({ field: 'coverTemplate', value: templateId });
    if (ratio !== initialRatio) changes.push({ field: 'coverRatio', value: ratio });
    const nextPrompt = usesDefaultPrompt ? '' : prompt.trim();
    if (nextPrompt !== (config.coverPrompt ?? '')) changes.push({ field: 'coverPrompt', value: nextPrompt });
    return changes;
  }

  function chooseTemplate(value: string) {
    setTemplateId(value);
    if (usesDefaultPrompt) setPrompt(createCoverPrompt(task.title, summary, templates, value, ratio));
  }

  function chooseRatio(value: HtmlVideoCoverRatio) {
    setRatio(value);
    if (usesDefaultPrompt) setPrompt(createCoverPrompt(task.title, summary, templates, templateId, value));
  }

  function resetPrompt() {
    setUsesDefaultPrompt(true);
    setPrompt(createCoverPrompt(task.title, summary, templates, templateId, ratio));
  }

  async function saveCoverConfig() {
    const changes = pendingChanges();
    if (!changes.length) {
      setMessage('封面参数没有变化。');
      return;
    }
    await coverAction.run(async () => {
      applyState(await api.updateHtmlVideoConfig(task.id, changes));
      await refreshTaskDetail(task.id);
      setMessage('封面参数已保存。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function regenerateCover() {
    if (mode !== 'auto') return;
    await coverAction.run(async () => {
      const changes = pendingChanges();
      if (changes.length) applyState(await api.updateHtmlVideoConfig(task.id, changes));
      applyState(await api.regenerateHtmlVideoCover(task.id));
      await refreshTaskDetail(task.id);
      setMessage('封面已按当前参数重画。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function importManualCover() {
    if (mode !== 'manual') return;
    await coverAction.run(async () => {
      const changes = pendingChanges();
      if (changes.length) applyState(await api.updateHtmlVideoConfig(task.id, changes));
      const next = await api.importHtmlVideoCover(task.id);
      if (!next) return;
      applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('手动封面已导入。');
    }, { onError: (error) => setMessage(error.message) });
  }

  async function copyPrompt() {
    if (!prompt.trim()) return;
    await coverAction.run(async () => {
      await navigator.clipboard.writeText(prompt.trim());
      setMessage('封面提示词已复制。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-cover-editor" aria-label="封面参数">
      <div className="panel-title-row">
        <div>
          <h4>封面设置</h4>
          <span>{dimensions.width}x{dimensions.height} · {coverAsset ? `第 ${coverAsset.revision} 版` : '尚未生成'}</span>
        </div>
        <div className="hv-cover-actions">
          <button className="mini-button primary" type="button" disabled={disabled || isBrowserPreview || mode !== 'auto' || !selectedTemplate} onClick={regenerateCover}>
            {coverAction.busy ? <Loader2 className="spin" size={14} /> : <WandSparkles size={14} />}重画封面
          </button>
          <button
            className="mini-button"
            type="button"
            disabled={disabled || isBrowserPreview || mode !== 'manual'}
            onClick={importManualCover}
          >
            <Upload size={14} />换本地封面
          </button>
          <button className="mini-button" type="button" disabled={disabled || !coverAsset || !task.outputDir} onClick={openOutputDirectory}><FolderOpen size={14} />打开封面</button>
          <button className="mini-button" type="button" disabled={disabled} onClick={saveCoverConfig}>
            <Save size={14} />保存封面
          </button>
        </div>
      </div>
      <fieldset className="hv-cover-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="coverImageMode">
          <Segmented label="模式" value={mode} options={[...HTML_VIDEO_COVER_MODES]} labels={['关闭', '自动', '手动']} onChange={(value) => setMode(value as HtmlVideoCoverMode)} />
        </div>
        <div data-html-video-edit-field="coverRatio">
          <Segmented label="比例" value={ratio} options={[...HTML_VIDEO_COVER_RATIOS]} onChange={(value) => chooseRatio(value as HtmlVideoCoverRatio)} />
        </div>
      </fieldset>
      {mode !== 'off' ? <>
        <div className="hv-cover-template-section" data-html-video-edit-field="coverTemplate">
          <strong>封面模板</strong>
          <div className="hv-cover-template-options" role="listbox" aria-label="封面模板">
            {templates.map((item) => <button key={item.id} type="button" role="option" aria-selected={item.id === templateId} className={item.id === templateId ? 'selected' : ''} onClick={() => chooseTemplate(item.id)}>{item.name}</button>)}
          </div>
        </div>
        {selectedTemplate ? <dl className="hv-cover-template-summary">
          <div><dt>构图方向</dt><dd>{selectedTemplate.compositionRule}</dd></div>
          <div><dt>标题文字</dt><dd>{selectedTemplate.titleLayout}</dd></div>
          <div><dt>副标题</dt><dd>{selectedTemplate.subtitleLayout}</dd></div>
        </dl> : <div className="hv-cover-error" role="alert">当前封面模板已不存在，请重新选择。</div>}
        <label className="hv-cover-prompt" data-html-video-edit-field="coverPrompt">
          <span><strong>封面提示词</strong><button type="button" title="恢复模板默认提示词" disabled={disabled || usesDefaultPrompt} onClick={resetPrompt}><RotateCcw size={13} /></button><button type="button" title="复制提示词" disabled={!prompt.trim()} onClick={copyPrompt}><Copy size={13} /></button></span>
          <textarea value={prompt} rows={6} disabled={disabled || mode !== 'auto'} onChange={(event) => { setPrompt(event.target.value); setUsesDefaultPrompt(false); }} />
        </label>
      </> : null}
      {coverAsset ? (
        <div className="hv-cover-artifact-meta">
          <strong>{coverAsset.mode === 'manual' ? '手动封面' : '自动封面'} · r{coverAsset.revision}</strong>
          <small>{coverAsset.width}x{coverAsset.height} · {formatFileSize(coverAsset.sizeBytes)}</small>
        </div>
      ) : null}
      {renderError ? <div className="hv-cover-error" role="alert">{renderError}</div> : null}
      {message ? <span className="local-note" role="status">{message}</span> : null}
      <InlineActionFeedback feedback={coverAction.feedback} />
    </section>
  );
}

function createCoverPrompt(
  taskTitle: string,
  summary: string,
  templates: readonly CustomCoverTemplate[],
  templateId: string,
  ratio: HtmlVideoCoverRatio,
): string {
  const template = templates.find((item) => item.id === templateId);
  return template ? buildHtmlVideoCoverPrompt({ taskTitle, summary, template, ratio }) : '';
}

const htmlVideoStepLabels = {
  rewrite: '改写与分句',
  planning: '场景规划',
  assets: '素材生成',
  voice: '配音生成',
  preview: '动画预览',
  render: '出片',
} as const;

function HtmlVideoWorkflowBlocked({
  tab,
  task,
  data,
  busy,
  onRetry,
}: {
  tab: HtmlVideoTabKey;
  task: Task;
  data: ReturnType<typeof safeParseHtmlVideoPipelineData>['data'];
  busy: boolean;
  onRetry: () => Promise<void>;
}) {
  const failedStep = (Object.keys(htmlVideoStepLabels) as Array<keyof typeof htmlVideoStepLabels>)
    .find((step) => data.steps[step].status === 'failed');
  const nextStep = failedStep
    ?? (Object.keys(htmlVideoStepLabels) as Array<keyof typeof htmlVideoStepLabels>)
      .find((step) => data.steps[step].status !== 'completed')
    ?? 'render';
  const detail = failedStep
    ? htmlVideoUserFacingError(data.steps[failedStep].error || task.errorMessage || `${htmlVideoStepLabels[failedStep]}未完成。`)
    : `${htmlVideoStepLabels[nextStep]}完成后，这里会显示${tab === 'preview' ? '可播放的动画' : tab === 'cover' ? '封面内容' : tab === 'output' ? '成片文件' : '对应素材'}。`;
  return (
    <section className="hv-workflow-blocked" aria-live="polite">
      <strong>{failedStep ? `${htmlVideoStepLabels[failedStep]}未完成` : '等待上一步完成'}</strong>
      <p>{detail}</p>
      {failedStep ? (
        <button className="mini-button" type="button" disabled={busy} onClick={() => void onRetry()}>
          <RotateCcw size={14} />从{htmlVideoStepLabels[failedStep]}重试
        </button>
      ) : null}
    </section>
  );
}

function HtmlVideoOutputActions({
  api,
  task,
  config,
  bgmOptions,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
  openOutputDirectory,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  bgmOptions: readonly BgmItem[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
  isBrowserPreview: boolean;
  openOutputDirectory: () => Promise<void>;
}) {
  const action = useAsyncAction();
  const [bgmId, setBgmId] = useState(config.bgmId ?? '');
  const [bgmVolume, setBgmVolume] = useState(config.bgmVolume ?? 'soft');
  const [transitionType, setTransitionType] = useState<Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value']>(
    (config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'],
  );
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;

  useEffect(() => {
    setBgmId(config.bgmId ?? '');
    setBgmVolume(config.bgmVolume ?? 'soft');
    setTransitionType((config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value']);
  }, [config.bgmId, config.bgmVolume, config.transitionType, task.id]);

  async function rerender() {
    await action.run(async () => {
      const changes: HtmlVideoConfigChange[] = [];
      if (bgmId !== (config.bgmId ?? '')) changes.push({ field: 'bgmId', value: bgmId });
      if (bgmVolume !== (config.bgmVolume ?? 'soft')) changes.push({ field: 'bgmVolume', value: bgmVolume });
      if (transitionType !== (config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType)) changes.push({ field: 'transitionType', value: transitionType });
      applyState(changes.length
        ? await api.updateHtmlVideoConfig(task.id, changes)
        : await api.rerenderHtmlVideo(task.id));
      await refreshTaskDetail(task.id);
      applyState(await api.updateTaskStatus(task.id, 'running'));
      await refreshTaskDetail(task.id);
    });
  }

  return (
    <section className="hv-output-actions" aria-label="出片设置">
      <div className="hv-output-control">
        <label><span>背景音乐</span><select value={bgmId} disabled={locked} onChange={(event) => setBgmId(event.target.value)}><option value="">无配乐</option>{bgmId && !bgmOptions.some((item) => item.id === bgmId) ? <option value={bgmId}>{bgmId}（已缺失）</option> : null}{bgmOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label><span>配乐音量</span><select value={bgmVolume} disabled={locked} onChange={(event) => setBgmVolume(event.target.value as typeof bgmVolume)}>{HTML_VIDEO_BGM_VOLUMES.map((value, index) => <option key={value} value={value}>{['轻', '中', '响'][index]}</option>)}</select></label>
        <label><span>场景转场</span><select value={transitionType} disabled={locked} onChange={(event) => setTransitionType(event.target.value as typeof transitionType)}>{HTML_VIDEO_TRANSITIONS.map((value) => <option key={value} value={value}>{HTML_VIDEO_TRANSITION_LABELS[value]}</option>)}</select></label>
      </div>
      <div className="hv-output-buttons">
        <button className="mini-button primary" type="button" disabled={!task.outputDir || isBrowserPreview} onClick={openOutputDirectory}><FolderOpen size={14} />打开目录</button>
        <button className="mini-button" type="button" disabled={locked} onClick={rerender}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}重新出片</button>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </section>
  );
}

export function HtmlVideoTabPanel({
  api,
  tab,
  task,
  data,
  customCoverTemplates,
  applyState,
  refreshTaskDetail,
  mediaUrls,
  failedMediaPaths,
  mediaRetryRevision,
  onMediaElementError,
  onMediaElementReady,
  busy,
  isBrowserPreview,
  openPreview,
  onRetry,
  cloneVoices,
  bgmOptions,
  openOutputDirectory,
}: {
  api: StoryDreamApi;
  tab: HtmlVideoTabKey;
  task: Task | null;
  data: ReturnType<typeof safeParseHtmlVideoPipelineData>['data'];
  customCoverTemplates: CustomCoverTemplate[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  mediaUrls: Record<string, string>;
  failedMediaPaths: ReadonlySet<string>;
  mediaRetryRevision: number;
  onMediaElementError: (path: string) => void;
  onMediaElementReady: (path: string) => void;
  busy: boolean;
  isBrowserPreview: boolean;
  openPreview: (sceneIndex?: number) => Promise<void>;
  onRetry: () => Promise<void>;
  cloneVoices: readonly MinimaxCloneVoice[];
  bgmOptions: readonly BgmItem[];
  openOutputDirectory: () => Promise<void>;
}) {
  if (!task) {
    return <EmptyState title="暂无 HTML 动画视频任务" />;
  }

  const editorialProps = {
    api,
    task,
    data,
    applyState,
    refreshTaskDetail,
    mediaUrls,
    failedMediaPaths,
    mediaRetryRevision,
    onMediaElementError,
    onMediaElementReady,
    busy,
    isBrowserPreview,
    cloneVoices,
  };
  const planningFailed = data.steps.planning.status === 'failed';
  const noScenes = data.scenes.length === 0;
  const blocked = () => <HtmlVideoWorkflowBlocked tab={tab} task={task} data={data} busy={busy} onRetry={onRetry} />;

  if (planningFailed || noScenes) {
    return <div className="hv-tab-content">{blocked()}</div>;
  }
  if (tab === 'preview') {
    if (!data.compositions.length) {
      return (
        <div className="hv-tab-content">
          <HtmlVideoCaptionEditor key={task.id} api={api} task={task} config={data.config} applyState={applyState} refreshTaskDetail={refreshTaskDetail} busy={busy} />
          {blocked()}
        </div>
      );
    }
    return (
      <div className="hv-tab-content hv-preview-workspace">
        <HtmlVideoStoryboundPreviewPanel
          {...editorialProps}
          captionEditor={(
            <HtmlVideoCaptionEditor
              key={task.id}
              api={api}
              task={task}
              config={data.config}
              applyState={applyState}
              refreshTaskDetail={refreshTaskDetail}
              busy={busy}
            />
          )}
        />
      </div>
    );
  }
  if (tab === 'text') return <HtmlVideoStoryboundTextPanel {...editorialProps} />;
  if (tab === 'assets') return <HtmlVideoStoryboundAssetsPanel {...editorialProps} />;
  if (tab === 'voice') return <HtmlVideoStoryboundVoicePanel {...editorialProps} />;

  if (tab === 'cover') {
    const coverPath = data.coverAsset?.path;
    const coverUrl = coverPath ? mediaUrls[coverPath] : '';
    const coverStatus = coverPath
      ? htmlVideoMediaStatus(coverPath, mediaUrls, failedMediaPaths, isBrowserPreview)
      : 'desktop-only';
    const coverDimensions = htmlVideoCoverDimensions(data.config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio);
    return (
      <div className="hv-tab-content hv-cover-workspace">
        <div className="hv-cover-layout">
          <section className="hv-cover-preview-pane" aria-label="封面预览">
            <header className="hv-reference-panel-head"><strong>封面预览</strong><span>{coverDimensions.width}x{coverDimensions.height}</span></header>
            {data.config.coverImageMode === 'off' ? (
              <EmptyState title="封面已关闭" />
            ) : coverPath ? (
              <figure className="hv-media-item hv-cover-preview">
                <div className="hv-media-frame" style={{ aspectRatio: `${coverDimensions.width} / ${coverDimensions.height}` }} aria-busy={coverStatus === 'loading'}>
                  {coverStatus === 'ready' && coverUrl ? (
                    <img
                      key={htmlVideoMediaElementKey(task.id, coverPath, mediaRetryRevision)}
                      src={coverUrl}
                      alt="HTML 视频封面预览"
                      onError={() => onMediaElementError(coverPath)}
                      onLoad={() => onMediaElementReady(coverPath)}
                    />
                  ) : coverStatus === 'loading' ? (
                    <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={18} />封面加载中</span>
                  ) : coverStatus === 'unavailable' ? (
                    <span className="hv-media-state" role="status"><ImageIcon size={22} />封面加载失败</span>
                  ) : (
                    <span className="hv-media-state" role="status"><ImageIcon size={22} />本地封面仅桌面端可用</span>
                  )}
                </div>
                <figcaption><strong>{task.title}</strong><small>{data.coverAsset?.path}</small></figcaption>
              </figure>
            ) : (
              <EmptyState title="等待封面生成" />
            )}
          </section>
          <HtmlVideoCoverEditor
            key={task.id}
            api={api}
            task={task}
            config={data.config}
            coverAsset={data.coverAsset}
            templates={customCoverTemplates}
            summary={data.scenes[0]?.narration ?? task.inputText}
            renderError={data.steps.render.error}
            applyState={applyState}
            refreshTaskDetail={refreshTaskDetail}
            busy={busy}
            isBrowserPreview={isBrowserPreview}
            openOutputDirectory={openOutputDirectory}
          />
        </div>
      </div>
    );
  }

  const outputUrl = data.output ? mediaUrls[data.output.path] : '';
  const outputStatus = data.output
    ? htmlVideoMediaStatus(data.output.path, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  const outputSize = fitHtmlVideoOutputSize(Number.POSITIVE_INFINITY, 520, data.config.ratio || task.ratio);
  const outputStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: outputSize.width,
    maxHeight: outputSize.height,
    aspectRatio: String(outputSize.aspectRatio),
  };
  return (
    <div className="hv-tab-content hv-output-workspace">
      <header className="hv-reference-panel-head"><strong>出片</strong><span>逐帧截图 → ffmpeg 合成 mp4</span></header>
      {data.output ? (
        <div className="hv-video-output">
          <strong className="hv-output-ready"><span />成片已生成</strong>
          {outputStatus === 'ready' && outputUrl ? (
            <video
              key={htmlVideoMediaElementKey(task.id, data.output.path, mediaRetryRevision)}
              controls
              preload="metadata"
              src={outputUrl}
              aria-label={`${task.title || 'HTML 动画视频'}成片预览`}
              style={outputStyle}
              onError={() => onMediaElementError(data.output!.path)}
              onCanPlay={() => onMediaElementReady(data.output!.path)}
            />
          ) : (
            <div className="hv-video-placeholder" style={outputStyle} aria-busy={outputStatus === 'loading'} role={outputStatus === 'loading' ? 'status' : undefined}>
              {outputStatus === 'loading' ? (
                <><Loader2 className="spin" size={28} /><span>视频加载中</span></>
              ) : outputStatus === 'unavailable' ? (
                <><Play size={28} /><span>视频文件暂不可用</span></>
              ) : <><Play size={28} /><span>本地视频请在 Electron 桌面端查看</span></>}
            </div>
          )}
          <div className="hv-output-meta">
            <strong>{task.title}</strong>
            <small>{formatFileSize(data.output.sizeBytes)}{data.output.durationSec ? ` · ${data.output.durationSec.toFixed(1)} 秒` : ''}</small>
          </div>
          <div className="hv-output-path">
            <small>输出路径</small>
            <code>{data.output.path}</code>
          </div>
        </div>
      ) : <EmptyState title="等待出片" />}
      <HtmlVideoOutputActions api={api} task={task} config={data.config} bgmOptions={bgmOptions} applyState={applyState} refreshTaskDetail={refreshTaskDetail} busy={busy} isBrowserPreview={isBrowserPreview} openOutputDirectory={openOutputDirectory} />
      <div className="hv-output-contracts" aria-hidden="true">
        <span data-html-video-control="transitionType" data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.transitionType.availability} />
        <span data-html-video-control="coverRatio" data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.coverRatio.availability} />
        <Music2 size={14} />
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

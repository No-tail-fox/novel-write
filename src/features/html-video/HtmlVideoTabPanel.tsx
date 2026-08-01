import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2, Play, RotateCcw, Save, Upload } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { CustomCoverTemplate, HtmlVideoConfigChange, HtmlVideoCoverAsset, HtmlVideoCoverMode, HtmlVideoCoverRatio, HtmlVideoJobConfig, HtmlVideoTabKey, Task } from '../../shared/types';
import { HTML_VIDEO_CAPTION_ANIMATIONS, HTML_VIDEO_CAPTION_COLOR_KEYS, HTML_VIDEO_CAPTION_PRESETS, htmlVideoCaptionColorsEqual, htmlVideoCaptionPickerColor, resolveHtmlVideoCaptionStyle, validateHtmlVideoCaptionColors, type HtmlVideoCaptionAnimation, type HtmlVideoCaptionColorKey, type HtmlVideoCaptionColorOverrides, type HtmlVideoCaptionPreset } from '../../shared/html-video-captions';
import { HTML_VIDEO_CONTROL_MANIFEST_V1 } from '../../shared/html-video-control-manifest';
import { HTML_VIDEO_COVER_MODES, HTML_VIDEO_COVER_RATIOS, htmlVideoCoverDimensions } from '../../shared/html-video-cover';
import { HTML_VIDEO_JOB_DEFAULTS } from '../../shared/html-video-config';
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
  renderError,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  task: Task;
  config: HtmlVideoJobConfig;
  coverAsset?: HtmlVideoCoverAsset;
  templates: CustomCoverTemplate[];
  renderError?: string;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  busy: boolean;
  isBrowserPreview: boolean;
}) {
  const initialMode = config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode;
  const initialTemplate = config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate;
  const initialRatio = config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio;
  const [mode, setMode] = useState<HtmlVideoCoverMode>(initialMode);
  const [templateId, setTemplateId] = useState(initialTemplate);
  const [ratio, setRatio] = useState<HtmlVideoCoverRatio>(initialRatio);
  const [message, setMessage] = useState('');
  const coverAction = useAsyncAction();
  const taskActive = task.status === 'pending' || task.status === 'running';
  const disabled = busy || taskActive || coverAction.busy;
  const dimensions = htmlVideoCoverDimensions(ratio);

  useEffect(() => {
    setMode(config.coverImageMode ?? HTML_VIDEO_JOB_DEFAULTS.coverImageMode);
    setTemplateId(config.coverTemplate ?? HTML_VIDEO_JOB_DEFAULTS.coverTemplate);
    setRatio(config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio);
    setMessage('');
  }, [task.id, config.coverImageMode, config.coverTemplate, config.coverRatio]);

  async function saveCoverConfig() {
    const changes: HtmlVideoConfigChange[] = [];
    if (mode !== initialMode) changes.push({ field: 'coverImageMode', value: mode });
    if (templateId !== initialTemplate) changes.push({ field: 'coverTemplate', value: templateId });
    if (ratio !== initialRatio) changes.push({ field: 'coverRatio', value: ratio });
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

  async function importManualCover() {
    if (config.coverImageMode !== 'manual') {
      setMessage('请先保存手动封面模式。');
      return;
    }
    await coverAction.run(async () => {
      const next = await api.importHtmlVideoCover(task.id);
      if (next) applyState(next);
      await refreshTaskDetail(task.id);
      setMessage('手动封面已导入。');
    }, { onError: (error) => setMessage(error.message) });
  }

  return (
    <section className="hv-cover-editor" aria-label="封面参数">
      <div className="panel-title-row">
        <div>
          <h4>封面参数</h4>
          <span>{dimensions.width}x{dimensions.height}</span>
        </div>
        <div className="hv-cover-actions">
          <button
            className="mini-button"
            type="button"
            disabled={disabled || isBrowserPreview || config.coverImageMode !== 'manual'}
            onClick={importManualCover}
          >
            {coverAction.busy ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}导入封面
          </button>
          <button className="mini-button" type="button" disabled={disabled} onClick={saveCoverConfig}>
            <Save size={14} />保存封面
          </button>
        </div>
      </div>
      <fieldset className="hv-cover-editor-grid" disabled={disabled}>
        <div data-html-video-edit-field="coverImageMode">
          <Segmented label="模式" value={mode} options={[...HTML_VIDEO_COVER_MODES]} labels={['关闭', '自动', '手动']} onChange={(value) => setMode(value as HtmlVideoCoverMode)} />
        </div>
        <div data-html-video-edit-field="coverTemplate">
          <Field label="模板">
            <select value={templateId} disabled={disabled} onChange={(event) => setTemplateId(event.target.value)}>
              {templateId && !templates.some((item) => item.id === templateId)
                ? <option value={templateId}>{templateId}（目录中已缺失）</option>
                : null}
              {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        </div>
        <div data-html-video-edit-field="coverRatio">
          <Segmented label="比例" value={ratio} options={[...HTML_VIDEO_COVER_RATIOS]} onChange={(value) => setRatio(value as HtmlVideoCoverRatio)} />
        </div>
      </fieldset>
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
      <div className="hv-tab-content">
        <HtmlVideoCaptionEditor key={task.id} api={api} task={task} config={data.config} applyState={applyState} refreshTaskDetail={refreshTaskDetail} busy={busy} />
        <HtmlVideoStoryboundPreviewPanel {...editorialProps} />
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
      <div className="hv-tab-content">
        <HtmlVideoCoverEditor
          key={task.id}
          api={api}
          task={task}
          config={data.config}
          coverAsset={data.coverAsset}
          templates={customCoverTemplates}
          renderError={data.steps.render.error}
          applyState={applyState}
          refreshTaskDetail={refreshTaskDetail}
          busy={busy}
          isBrowserPreview={isBrowserPreview}
        />
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
            <figcaption>
              <strong>{task.title}</strong>
              <small>{data.coverAsset?.path}</small>
            </figcaption>
          </figure>
        ) : (
          <EmptyState title="等待封面生成" />
        )}
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
    <div className="hv-tab-content">
      <div className="task-metrics">
        <div
          data-html-video-control="transitionType"
          data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.transitionType.availability}
        ><small>转场</small><strong>{data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType}</strong></div>
        <div><small>背景音乐</small><strong>{data.config.bgmId || '无'}</strong></div>
        <div
          data-html-video-control="coverRatio"
          data-control-availability={HTML_VIDEO_CONTROL_MANIFEST_V1.coverRatio.availability}
        ><small>封面比例</small><strong>{data.config.coverRatio ?? HTML_VIDEO_JOB_DEFAULTS.coverRatio}</strong></div>
      </div>
      {data.output ? (
        <div className="hv-video-output">
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
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

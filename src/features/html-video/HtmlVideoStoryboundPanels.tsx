import React, { useEffect, useRef, useState } from 'react';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Upload,
} from 'lucide-react';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  HtmlVideoAsset,
  HtmlVideoAssetTarget,
  HtmlVideoCompositionSnapshot,
  HtmlVideoPipelineData,
  HtmlVideoSceneChange,
  HtmlVideoScenePlan,
  Task,
} from '../../shared/types';
import { htmlVideoMediaElementKey, htmlVideoMediaStatus } from '../../shared/html-video-media';
import { useAsyncAction } from '../../ui/async-action';

const sceneTemplateOptions = [
  ['center-focus', '中心聚焦'],
  ['split-left', '左右对比'],
  ['split-right', '左字右物'],
  ['lower-third', '上物下字'],
  ['cinematic-title', '电影标题'],
] as const;

interface EditorialPanelProps {
  api: StoryDreamApi;
  task: Task;
  data: HtmlVideoPipelineData;
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  mediaUrls: Record<string, string>;
  failedMediaPaths: ReadonlySet<string>;
  mediaRetryRevision: number;
  onMediaElementError: (path: string) => void;
  onMediaElementReady: (path: string) => void;
  busy: boolean;
  isBrowserPreview: boolean;
}

export function HtmlVideoStoryboundTextPanel(props: EditorialPanelProps) {
  return (
    <section className="hv-reference-panel hv-reference-text" aria-label="HTML 动画文案与场景规划">
      <header className="hv-reference-panel-head"><strong>改写 + 分句</strong><span>{props.data.scenes.length} 个场景</span></header>
      <div className="hv-reference-copy">
        {props.data.scenes.map((scene) => <p key={scene.index}><b>{scene.index}.</b> {scene.narration}</p>)}
      </div>
      <header className="hv-reference-panel-head"><strong>场景规划</strong><span>标题 · 字幕 · 动态版式</span></header>
      <div className="hv-reference-scene-editors">
        {props.data.scenes.map((scene) => <SceneTextEditor key={`${scene.index}-${props.data.revision}`} {...props} scene={scene} />)}
      </div>
    </section>
  );
}

function SceneTextEditor({ api, task, scene, applyState, refreshTaskDetail, busy, isBrowserPreview }: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const action = useAsyncAction();
  const [title, setTitle] = useState(scene.title);
  const [captions, setCaptions] = useState(scene.captions.join('\n'));
  const [template, setTemplate] = useState(scene.sceneTemplate);
  const locked = busy || action.busy || isBrowserPreview;

  async function mutate(changes: HtmlVideoSceneChange[]) {
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, scene.index, changes);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  async function save() {
    const lines = captions.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (!title.trim() || lines.length === 0) return;
    await mutate([
      { field: 'title', value: title.trim() },
      { field: 'captions', value: lines },
      { field: 'sceneTemplate', value: template },
    ]);
  }

  return (
    <article className="hv-reference-scene-card">
      <div className="hv-reference-scene-number">{scene.index}</div>
      <div className="hv-reference-scene-copy"><strong>{scene.narration}</strong></div>
      <label><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} /></label>
      <label><span>字幕</span><textarea value={captions} onChange={(event) => setCaptions(event.target.value)} disabled={locked} rows={Math.min(4, Math.max(2, scene.captions.length))} /></label>
      <div className="hv-reference-scene-row">
        <label><span>动态版式</span><select value={template} onChange={(event) => setTemplate(event.target.value)} disabled={locked}>
          {sceneTemplateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="mini-button" type="button" disabled={locked} onClick={() => mutate([{ field: 'titleHidden', value: !scene.titleHidden }])}>
          {scene.titleHidden ? <Eye size={14} /> : <EyeOff size={14} />}{scene.titleHidden ? '显示标题' : '隐藏标题'}
        </button>
        <button className="mini-button primary" type="button" disabled={locked || !title.trim() || !captions.trim()} onClick={save}>
          {action.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存
        </button>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </article>
  );
}

export function HtmlVideoStoryboundAssetsPanel(props: EditorialPanelProps) {
  return (
    <section className="hv-reference-panel hv-reference-assets" aria-label="HTML 动画场景素材">
      {props.data.scenes.map((scene) => (
        <SceneAssets key={`${scene.index}-${props.data.revision}`} {...props} scene={scene} />
      ))}
    </section>
  );
}

function SceneAssets(props: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const { scene, data } = props;
  const background = data.assets.find((asset) => asset.sceneIndex === scene.index && asset.kind === 'bg');
  return (
    <article className="hv-reference-asset-scene">
      <header><span>场景 {scene.index}</span><p>{scene.narration}</p></header>
      <div className="hv-reference-asset-grid">
        <AssetCard {...props} target={{ sceneIndex: scene.index, kind: 'bg', slot: 0 }} asset={background} prompt={scene.background.prompt} />
        {scene.elements.map((element) => (
          <AssetCard
            key={element.slot}
            {...props}
            target={{ sceneIndex: scene.index, kind: 'fg', slot: element.slot }}
            asset={data.assets.find((asset) => asset.sceneIndex === scene.index && asset.kind === 'fg' && asset.slot === element.slot)}
            prompt={element.prompt}
            hidden={scene.foregroundHidden || scene.hiddenElementSlots?.includes(element.slot)}
          />
        ))}
      </div>
    </article>
  );
}

function AssetCard({
  api,
  task,
  scene,
  target,
  asset,
  prompt,
  hidden,
  mediaUrls,
  failedMediaPaths,
  mediaRetryRevision,
  onMediaElementError,
  onMediaElementReady,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
}: EditorialPanelProps & {
  scene: HtmlVideoScenePlan;
  target: HtmlVideoAssetTarget;
  asset?: HtmlVideoAsset;
  prompt: string;
  hidden?: boolean;
}) {
  const action = useAsyncAction();
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const locked = busy || action.busy || isBrowserPreview;

  async function run(operation: () => Promise<Awaited<ReturnType<StoryDreamApi['updateHtmlVideoScene']>>>) {
    await action.run(async () => {
      const mutation = await operation();
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  async function savePrompt() {
    if (!draftPrompt.trim() || draftPrompt.trim() === prompt) return;
    const change: HtmlVideoSceneChange = target.kind === 'bg'
      ? { field: 'backgroundPrompt', value: draftPrompt.trim() }
      : { field: 'elementPrompt', slot: target.slot, value: draftPrompt.trim() };
    await run(() => api.updateHtmlVideoScene(task.id, scene.index, [change]));
  }

  const url = asset ? mediaUrls[asset.src] : '';
  const assetStatus = asset
    ? htmlVideoMediaStatus(asset.src, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  return (
    <div className={`hv-reference-asset-card${hidden ? ' hidden' : ''}`}>
      <div className="hv-reference-asset-frame" aria-busy={assetStatus === 'loading'}>
        {!asset ? (
          <span><ImageIcon size={22} />添加素材</span>
        ) : assetStatus === 'ready' && url ? (
          <img
            key={htmlVideoMediaElementKey(task.id, asset.src, mediaRetryRevision)}
            src={url}
            alt={target.kind === 'bg' ? `场景 ${scene.index} 背景` : `场景 ${scene.index} 前景 ${target.slot + 1}`}
            onError={() => onMediaElementError(asset.src)}
            onLoad={() => onMediaElementReady(asset.src)}
          />
        ) : assetStatus === 'loading' ? (
          <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={18} />图片加载中</span>
        ) : assetStatus === 'unavailable' ? (
          <span className="hv-media-state" role="status"><ImageIcon size={22} />图片加载失败</span>
        ) : (
          <span className="hv-media-state" role="status"><ImageIcon size={22} />本地图片仅桌面端可用</span>
        )}
        {hidden ? <i>已隐藏</i> : null}
      </div>
      <strong>{target.kind === 'bg' ? 'BG 背景' : `PNG 前景 ${target.slot + 1}`}</strong>
      <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} rows={3} disabled={locked} />
      <div className="hv-reference-asset-actions">
        <button type="button" title="保存提示词" disabled={locked || draftPrompt.trim() === prompt} onClick={savePrompt}><Save size={14} /></button>
        <button type="button" title="重画素材" disabled={locked} onClick={() => run(() => api.regenerateHtmlVideoAsset(task.id, target))}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}</button>
        <button type="button" title="本地替换" disabled={locked} onClick={() => run(() => api.replaceHtmlVideoAsset(task.id, target))}><Upload size={14} /></button>
        {target.kind === 'fg' ? <button type="button" title={hidden ? '显示前景' : '隐藏前景'} disabled={locked} onClick={() => run(() => api.updateHtmlVideoScene(task.id, scene.index, [{ field: 'elementHidden', slot: target.slot, value: !hidden }]))}>{hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button> : null}
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </div>
  );
}

export function HtmlVideoStoryboundVoicePanel(props: EditorialPanelProps) {
  return (
    <section className="hv-reference-panel hv-reference-voice" aria-label="HTML 动画逐场景配音">
      <header className="hv-reference-panel-head"><strong>配音员</strong><span>{props.data.config.ttsProvider} · {props.data.config.voiceId}</span></header>
      <div className="hv-reference-voice-list">
        {props.data.scenes.map((scene) => <VoiceRow key={`${scene.index}-${props.data.revision}`} {...props} scene={scene} />)}
      </div>
    </section>
  );
}

function VoiceRow({
  api,
  task,
  data,
  scene,
  mediaUrls,
  failedMediaPaths,
  mediaRetryRevision,
  onMediaElementError,
  onMediaElementReady,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
}: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const action = useAsyncAction();
  const voice = data.voices.find((item) => item.sceneIndex === scene.index);
  const voiceStatus = voice
    ? htmlVideoMediaStatus(voice.src, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  const locked = busy || action.busy || isBrowserPreview;
  async function regenerate() {
    await action.run(async () => {
      const mutation = await api.regenerateHtmlVideoVoice(task.id, scene.index);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }
  return (
    <article className="hv-reference-voice-row">
      <span>{scene.index}</span>
      {!voice ? (
        <div className="hv-reference-audio-empty">等待配音</div>
      ) : voiceStatus === 'ready' && mediaUrls[voice.src] ? (
        <audio
          key={htmlVideoMediaElementKey(task.id, voice.src, mediaRetryRevision)}
          controls
          preload="metadata"
          src={mediaUrls[voice.src]}
          aria-label={`场景 ${voice.sceneIndex} 配音`}
          onError={() => onMediaElementError(voice.src)}
          onCanPlay={() => onMediaElementReady(voice.src)}
        />
      ) : voiceStatus === 'loading' ? (
        <div className="hv-reference-audio-empty hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={15} />音频加载中</div>
      ) : voiceStatus === 'unavailable' ? (
        <div className="hv-reference-audio-empty hv-media-state" role="status">音频文件暂不可用</div>
      ) : (
        <div className="hv-reference-audio-empty hv-media-state" role="status">本地音频仅桌面端可用</div>
      )}
      <p>{scene.narration}</p>
      <small>{voice ? `${voice.durationSec.toFixed(1)}s` : '-'}</small>
      <button className="mini-button" type="button" disabled={locked} onClick={regenerate}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}重配</button>
      <InlineActionFeedback feedback={action.feedback} />
    </article>
  );
}

export function HtmlVideoStoryboundPreviewPanel(props: EditorialPanelProps) {
  const {
    api,
    task,
    data,
    mediaUrls,
    failedMediaPaths,
    mediaRetryRevision,
    onMediaElementError,
    onMediaElementReady,
    applyState,
    refreshTaskDetail,
    busy,
    isBrowserPreview,
  } = props;
  const [active, setActive] = useState(0);
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoplayAll = useRef(false);
  const shouldResume = useRef(false);
  const action = useAsyncAction();
  const compositions = data.compositions;
  const composition = compositions[active];

  useEffect(() => {
    if (active >= compositions.length) setActive(Math.max(0, compositions.length - 1));
  }, [active, compositions.length]);

  useEffect(() => {
    let disposed = false;
    setSource('');
    setSourceError('');
    setProgress(0);
    setPlaying(false);
    if (!composition || isBrowserPreview) return;
    void api.getHtmlVideoCompositionSource(task.id, composition.index).then((loaded) => {
      if (disposed) return;
      setSource(prepareCompositionSrcDoc(loaded.source, loaded.mediaUrl, data, mediaUrls));
    }).catch((error) => {
      if (!disposed) setSourceError(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [api, composition?.index, composition?.rev, data, isBrowserPreview, mediaUrls, task.id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: string; time?: number; duration?: number };
      if (message?.type !== 'hvtick' || !message.duration) return;
      const next = Math.min(1, Math.max(0, Number(message.time ?? 0) / message.duration));
      setProgress(next);
      if (next >= 0.995) {
        if (autoplayAll.current && active < compositions.length - 1) {
          shouldResume.current = true;
          setActive((index) => index + 1);
        } else {
          autoplayAll.current = false;
          setPlaying(false);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, compositions.length]);

  function post(message: object) {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }

  function play() { autoplayAll.current = false; post({ type: 'hvplay' }); setPlaying(true); }
  function pause() { autoplayAll.current = false; post({ type: 'hvpause' }); setPlaying(false); }
  function restart() { autoplayAll.current = false; post({ type: 'hvrestart' }); setProgress(0); setPlaying(true); }
  function playAll() {
    autoplayAll.current = true;
    if (active === 0) { post({ type: 'hvrestart' }); setPlaying(true); }
    else { shouldResume.current = true; setActive(0); }
  }

  async function toggle(sceneIndex: number, field: 'foregroundHidden' | 'titleHidden', value: boolean) {
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, sceneIndex, [{ field, value }]);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  if (!composition) return <div className="hv-empty">场景生成中，完成后可在此预览动画。</div>;
  return (
    <section className={`hv-reference-preview${maximized ? ' maxed' : ''}`}>
      <header className="hv-reference-panel-head"><strong>动画预览</strong><span>WebView 真实渲染 · 所见即所得</span><button className="mini-button" onClick={playAll}><Play size={13} />连播全部</button></header>
      <div className="hv-reference-preview-main">
        <div className="hv-reference-stage">
          <div className="hv-reference-phone" style={{ aspectRatio: `${composition.canvas.w} / ${composition.canvas.h}` }}>
            {source ? <iframe
              key={`${composition.index}-${composition.rev}`}
              ref={iframeRef}
              srcDoc={source}
              title={`场景 ${composition.index}`}
              onLoad={() => {
                if (shouldResume.current) {
                  shouldResume.current = false;
                  post({ type: 'hvplay' });
                  setPlaying(true);
                }
              }}
            /> : <div className="hv-reference-preview-loading">{sourceError || <><Loader2 className="spin" size={20} />正在载入场景</>}</div>}
          </div>
          <div className="hv-reference-transport">
            <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(event) => {
              const next = Number(event.target.value) / 1000;
              autoplayAll.current = false;
              post({ type: 'hvseek', time: composition.durationSec * next });
              setProgress(next);
              setPlaying(false);
            }} aria-label="场景播放进度" />
            <button type="button" title={playing ? '暂停' : '播放'} onClick={playing ? pause : play}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
            <span>{(progress * composition.durationSec).toFixed(1)}s / {composition.durationSec.toFixed(1)}s</span>
            <button type="button" title="上一场景" disabled={active === 0} onClick={() => setActive((index) => Math.max(0, index - 1))}><ChevronLeft size={16} /></button>
            <button type="button" title="下一场景" disabled={active >= compositions.length - 1} onClick={() => setActive((index) => Math.min(compositions.length - 1, index + 1))}><ChevronRight size={16} /></button>
            <button type="button" title="重播" onClick={restart}><RotateCcw size={15} /></button>
            <button type="button" title={maximized ? '退出最大化' : '最大化'} onClick={() => setMaximized((value) => !value)}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          </div>
        </div>
        <aside className="hv-reference-scene-strip">
          <strong>场景 · 共 {data.scenes.length}</strong>
          {data.scenes.map((item) => {
            const index = compositions.findIndex((candidate) => candidate.index === item.index);
            const snapshot = index >= 0 ? compositions[index] : undefined;
            const thumbnail = snapshot?.thumbnailPath ?? snapshot?.background.src;
            const thumbnailStatus = thumbnail
              ? htmlVideoMediaStatus(thumbnail, mediaUrls, failedMediaPaths, isBrowserPreview)
              : 'desktop-only';
            return <div key={item.index} className={`hv-reference-scene-item${index === active ? ' active' : ''}`}>
              <button className="hv-reference-scene-select" type="button" disabled={index < 0} onClick={() => index >= 0 && setActive(index)}>
                <span className="hv-reference-thumb" aria-busy={thumbnailStatus === 'loading'}>
                  {thumbnail && thumbnailStatus === 'ready' && mediaUrls[thumbnail] ? (
                    <img
                      key={htmlVideoMediaElementKey(task.id, thumbnail, mediaRetryRevision)}
                      src={mediaUrls[thumbnail]}
                      alt=""
                      onError={() => onMediaElementError(thumbnail)}
                      onLoad={() => onMediaElementReady(thumbnail)}
                    />
                  ) : thumbnailStatus === 'loading' ? (
                    <span className="hv-media-state hv-media-loading" role="status"><Loader2 className="spin" size={15} />预览加载中</span>
                  ) : thumbnailStatus === 'unavailable' ? (
                    <span className="hv-media-state" role="status">预览加载失败</span>
                  ) : thumbnail ? (
                    <span className="hv-media-state" role="status">本地预览仅桌面端可用</span>
                  ) : (
                    <Loader2 className="spin" size={15} />
                  )}
                </span>
                <span><small>场景 {item.index} · {snapshot ? `${snapshot.durationSec.toFixed(1)}s` : '生成中'}</small><b>{item.title}</b><i>{sceneTemplateOptions.find(([value]) => value === item.sceneTemplate)?.[1] ?? item.sceneTemplate}</i></span>
              </button>
              {snapshot ? <span className="hv-reference-thumb-actions">
                <button
                  type="button"
                  disabled={busy || action.busy || isBrowserPreview}
                  onClick={() => void toggle(item.index, 'foregroundHidden', !item.foregroundHidden)}
                >{item.foregroundHidden ? '显示前景' : '隐藏前景'}</button>
                <button
                  type="button"
                  disabled={busy || action.busy || isBrowserPreview}
                  onClick={() => void toggle(item.index, 'titleHidden', !item.titleHidden)}
                >{item.titleHidden ? '显示标题' : '隐藏标题'}</button>
              </span> : null}
            </div>;
          })}
        </aside>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </section>
  );
}

function prepareCompositionSrcDoc(source: string, mediaUrl: string, data: HtmlVideoPipelineData, mediaUrls: Record<string, string>): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const replacements = new Map<string, string>();
  const paths = [
    ...data.assets.map((asset) => asset.src),
    ...data.voices.map((voice) => voice.src),
  ];
  for (const path of paths) {
    const replacement = mediaUrls[path];
    if (!replacement) continue;
    for (const alias of [path, path.replace(/\\/gu, '/'), localFileUrl(path)]) {
      replacements.set(normalizeMediaReference(alias), replacement);
    }
  }

  for (const element of document.querySelectorAll<HTMLElement>('[src]')) {
    const current = element.getAttribute('src');
    if (!current) continue;
    const replacement = replacements.get(normalizeMediaReference(current));
    element.setAttribute('src', replacement ?? resolveCompositionReference(mediaUrl, current));
  }
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function localFileUrl(path: string): string {
  const normalized = path.replace(/\\/gu, '/');
  const prefixed = /^[A-Za-z]:\//u.test(normalized) ? `/${normalized}` : normalized;
  return `file://${encodeURI(prefixed).replace(/#/gu, '%23').replace(/\?/gu, '%3F')}`;
}

function normalizeMediaReference(value: string): string {
  const normalized = value.trim().replace(/\\/gu, '/');
  try {
    const url = new URL(normalized);
    if (url.protocol === 'file:') {
      const decodedPath = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/u, '$1');
      return decodedPath.toLocaleLowerCase('en-US');
    }
  } catch {
    // Relative paths and raw Windows paths are matched below.
  }
  try {
    return decodeURI(normalized).replace(/^\/([A-Za-z]:\/)/u, '$1').toLocaleLowerCase('en-US');
  } catch {
    return normalized.toLocaleLowerCase('en-US');
  }
}

function compositionBaseUrl(mediaUrl: string): string {
  try {
    return new URL('.', mediaUrl).toString();
  } catch {
    return mediaUrl.slice(0, mediaUrl.lastIndexOf('/') + 1);
  }
}

function resolveCompositionReference(mediaUrl: string, reference: string): string {
  if (/^(?:data|blob|https?|file|storydream-media):/iu.test(reference)) return reference;
  try {
    return new URL(reference, compositionBaseUrl(mediaUrl)).toString();
  } catch {
    return reference;
  }
}

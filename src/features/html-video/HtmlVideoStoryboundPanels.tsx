import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  Settings2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  HtmlVideoAsset,
  HtmlVideoAssetTarget,
  HtmlVideoCompositionSnapshot,
  HtmlVideoConfigChange,
  HtmlVideoPipelineData,
  HtmlVideoSceneChange,
  HtmlVideoScenePlan,
  MinimaxCloneVoice,
  Task,
  TtsProvider,
} from '../../shared/types';
import { HTML_VIDEO_JOB_DEFAULTS, HTML_VIDEO_SCENE_MOTION_LABELS, HTML_VIDEO_SCENE_MOTIONS, HTML_VIDEO_TRANSITION_LABELS, HTML_VIDEO_TRANSITIONS, HTML_VIDEO_TTS_SPEED_MAX, HTML_VIDEO_TTS_SPEED_MIN } from '../../shared/html-video-config';
import { htmlVideoMediaElementKey, htmlVideoMediaStatus } from '../../shared/html-video-media';
import { HYPERFRAMES_RUNTIME_FILENAME } from '../../shared/hyperframes';
import {
  HTML_VIDEO_SCENE_TEMPLATES,
  htmlVideoSceneTemplate,
  normalizeHtmlVideoSceneTemplate,
  type HtmlVideoAnimationCue,
} from '../../shared/html-video-scene-templates';
import { normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider } from '../../shared/tts-voices';
import { Button, IconButton, Pane, Tabs } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';

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
  cloneVoices: readonly MinimaxCloneVoice[];
}

export function HtmlVideoStoryboundTextPanel(props: EditorialPanelProps) {
  return (
    <section className="hv-reference-panel hv-reference-text" aria-label="HTML 动画文案与场景规划">
      <header className="hv-reference-panel-head"><strong>改写 + 分句</strong><span>{props.data.scenes.length} 个场景 · 可编辑成稿</span></header>
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
  const [narration, setNarration] = useState(scene.narration);
  const [title, setTitle] = useState(scene.title);
  const [captions, setCaptions] = useState(scene.captions.join('\n'));
  const [template, setTemplate] = useState(normalizeHtmlVideoSceneTemplate(scene.sceneTemplate));
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;

  async function mutate(changes: HtmlVideoSceneChange[]) {
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, scene.index, changes);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  async function save() {
    const lines = captions.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (!narration.trim() || !title.trim() || lines.length === 0) return;
    const narrationChanged = narration.trim() !== scene.narration;
    await action.run(async () => {
      applyState(await api.updateHtmlVideoScene(task.id, scene.index, [
        { field: 'narration', value: narration.trim() },
        { field: 'title', value: title.trim() },
        { field: 'captions', value: lines },
        { field: 'sceneTemplate', value: template },
      ]));
      await refreshTaskDetail(task.id);
      if (narrationChanged) {
        applyState(await api.regenerateHtmlVideoVoice(task.id, scene.index));
        await refreshTaskDetail(task.id);
      }
    });
  }

  return (
    <article className="hv-reference-scene-card">
      <div className="hv-reference-scene-number">{scene.index}</div>
      <label className="hv-reference-scene-copy"><span>口播</span><textarea value={narration} onChange={(event) => setNarration(event.target.value)} disabled={locked} rows={2} /></label>
      <label><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} /></label>
      <label><span>字幕</span><textarea value={captions} onChange={(event) => setCaptions(event.target.value)} disabled={locked} rows={Math.min(4, Math.max(2, scene.captions.length))} /></label>
      <div className="hv-reference-scene-row">
        <label><span>画面预设</span><select value={template} onChange={(event) => setTemplate(normalizeHtmlVideoSceneTemplate(event.target.value))} disabled={locked}>
          {HTML_VIDEO_SCENE_TEMPLATES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <button className="mini-button" type="button" disabled={locked} onClick={() => mutate([{ field: 'titleHidden', value: !scene.titleHidden }])}>
          {scene.titleHidden ? <Eye size={14} /> : <EyeOff size={14} />}{scene.titleHidden ? '显示标题' : '隐藏标题'}
        </button>
        <button className="mini-button primary" type="button" disabled={locked || !narration.trim() || !title.trim() || !captions.trim()} onClick={save}>
          {action.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}{narration.trim() !== scene.narration ? '保存并重配' : '保存'}
        </button>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </article>
  );
}

export function HtmlVideoStoryboundAssetsPanel(props: EditorialPanelProps) {
  const { api, task, applyState, refreshTaskDetail } = props;
  const action = useAsyncAction();
  const foregrounds = props.data.assets.filter((asset) => asset.kind === 'fg');
  const expectedCount = props.data.scenes.reduce((total, scene) => (
    total + 1 + (props.data.config.foreground === false ? 0 : scene.elements.length)
  ), 0);
  const pendingCount = foregrounds.filter((asset) => asset.transparency !== 'transparent').length;
  const locked = props.busy || action.busy || props.task.status === 'running' || props.task.status === 'pending' || props.isBrowserPreview;

  async function removeAllBackgrounds() {
    await action.run(async () => {
      const mutation = await api.removeAllHtmlVideoAssetBackgrounds(task.id);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  return (
    <section className="hv-reference-panel hv-reference-assets" aria-label="HTML 动画场景素材">
      <header className="hv-reference-panel-head">
        <strong>前后景素材</strong>
        <span>已生成 {props.data.assets.length}/{expectedCount} 张 · {foregrounds.length} 张前景 · {pendingCount} 张待确认透明</span>
        <button className="mini-button" type="button" title="批量移除所有不透明前景的背景" disabled={locked || foregrounds.length === 0 || pendingCount === 0} onClick={removeAllBackgrounds}>
          {action.busy ? <Loader2 className="spin" size={14} /> : <Scissors size={14} />}全部去背景
        </button>
      </header>
      <InlineActionFeedback feedback={action.feedback} />
      {props.data.scenes.map((scene) => (
        <SceneAssets key={`${scene.index}-${props.data.revision}`} {...props} scene={scene} />
      ))}
    </section>
  );
}

function SceneAssets(props: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const { scene, data } = props;
  const background = data.assets.find((asset) => asset.sceneIndex === scene.index && asset.kind === 'bg');
  const generating = data.steps.assets.status === 'running';
  return (
    <article className="hv-reference-asset-scene">
      <header><span>场景 {scene.index}</span><p>{scene.narration}</p></header>
      <div className="hv-reference-asset-grid">
        <AssetCard {...props} target={{ sceneIndex: scene.index, kind: 'bg', slot: 0 }} asset={background} prompt={scene.background.prompt} generating={generating} />
        {scene.elements.map((element) => (
          <AssetCard
            key={element.slot}
            {...props}
            target={{ sceneIndex: scene.index, kind: 'fg', slot: element.slot }}
            asset={data.assets.find((asset) => asset.sceneIndex === scene.index && asset.kind === 'fg' && asset.slot === element.slot)}
            prompt={element.prompt}
            hidden={scene.foregroundHidden || scene.hiddenElementSlots?.includes(element.slot)}
            generating={generating}
          />
        ))}
        <AddForegroundCard {...props} />
      </div>
    </article>
  );
}

function AddForegroundCard({ api, task, scene, applyState, refreshTaskDetail, busy, isBrowserPreview }: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const action = useAsyncAction();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview || scene.elements.length >= 4;

  async function addForeground() {
    if (!prompt.trim()) return;
    await action.run(async () => {
      const mutation = await api.addHtmlVideoAsset(task.id, scene.index, prompt.trim());
      if (!mutation) return;
      applyState(mutation);
      await refreshTaskDetail(task.id);
      setOpen(false);
      setPrompt('');
    });
  }

  return (
    <>
      <button className="hv-reference-add-asset" type="button" disabled={locked} onClick={() => setOpen(true)}>
        <span><Plus size={20} /></span>
        <strong>{scene.elements.length >= 4 ? '前景已满' : '手动添加前景'}</strong>
        <small>PNG / JPG / WebP</small>
      </button>
      {open ? (
        <div className="hv-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="hv-editor-modal" role="dialog" aria-modal="true" aria-label={`为场景 ${scene.index} 添加前景`}>
            <header><div><strong>添加前景素材</strong><span>场景 {scene.index}</span></div><button type="button" title="关闭" onClick={() => setOpen(false)}><X size={16} /></button></header>
            <label><span>前景提示词</span><textarea autoFocus rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：人物半身像，侧面光，平静注视镜头…" /></label>
            <footer><button className="mini-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="mini-button primary" type="button" disabled={!prompt.trim() || action.busy} onClick={addForeground}>{action.busy ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}选图并添加</button></footer>
            <InlineActionFeedback feedback={action.feedback} />
          </section>
        </div>
      ) : null}
    </>
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
  generating = false,
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
  generating?: boolean;
}) {
  const action = useAsyncAction();
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const [previewOpen, setPreviewOpen] = useState(false);
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;

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
  const transparencyLabel = asset?.transparency === 'transparent'
    ? '已检测：透明通道'
    : asset?.transparency === 'opaque'
      ? '已检测：背景未透明'
      : '透明状态待检测';
  return (
    <div className={`hv-reference-asset-card${hidden ? ' hidden' : ''}`}>
      <div className="hv-reference-asset-frame" aria-busy={assetStatus === 'loading'}>
        {!asset ? (
          <span className={generating ? 'hv-media-state hv-media-loading' : undefined} role={generating ? 'status' : undefined}>
            {generating ? <Loader2 className="spin" size={18} /> : <ImageIcon size={22} />}
            {generating ? '正在生成' : '添加素材'}
          </span>
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
      <strong>{target.kind === 'bg' ? 'BG 背景' : `前景 ${target.slot + 1}`}</strong>
      {target.kind === 'fg' ? <span className={`hv-reference-asset-transparency ${asset?.transparency ?? 'unknown'}`}>{transparencyLabel}</span> : null}
      <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} rows={3} disabled={locked} />
      <div className="hv-reference-asset-actions">
        <button type="button" title="预览素材" disabled={assetStatus !== 'ready' || !url} onClick={() => setPreviewOpen(true)}><Eye size={14} /></button>
        <button type="button" title="保存提示词" disabled={locked || draftPrompt.trim() === prompt} onClick={savePrompt}><Save size={14} /></button>
        <button type="button" title="重画素材" disabled={locked} onClick={() => run(() => api.regenerateHtmlVideoAsset(task.id, target))}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}</button>
        <button type="button" title="本地替换" disabled={locked} onClick={() => run(() => api.replaceHtmlVideoAsset(task.id, target))}><Upload size={14} /></button>
        {target.kind === 'fg' ? <button type="button" title={asset?.transparency === 'transparent' ? '素材已有透明通道' : '移除背景'} disabled={locked || !asset || asset.transparency === 'transparent'} onClick={() => run(() => api.removeHtmlVideoAssetBackground(task.id, target))}><Scissors size={14} /></button> : null}
        {target.kind === 'fg' ? <button type="button" title={hidden ? '显示前景' : '隐藏前景'} disabled={locked} onClick={() => run(() => api.updateHtmlVideoScene(task.id, scene.index, [{ field: 'elementHidden', slot: target.slot, value: !hidden }]))}>{hidden ? <Eye size={14} /> : <EyeOff size={14} />}</button> : null}
      </div>
      <InlineActionFeedback feedback={action.feedback} />
      {previewOpen && url ? (
        <div className="hv-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewOpen(false)}>
          <section className="hv-asset-preview-modal" role="dialog" aria-modal="true" aria-label="素材预览">
            <header><div><strong>{target.kind === 'bg' ? `场景 ${scene.index} 背景` : `场景 ${scene.index} 前景 ${target.slot + 1}`}</strong><span>{draftPrompt}</span></div><button type="button" title="关闭" onClick={() => setPreviewOpen(false)}><X size={16} /></button></header>
            <img src={url} alt="素材大图预览" />
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function HtmlVideoStoryboundVoicePanel(props: EditorialPanelProps) {
  return (
    <section className="hv-reference-panel hv-reference-voice" aria-label="HTML 动画逐场景配音">
      <VoiceSettings {...props} />
      <header className="hv-reference-panel-head"><strong>逐场景配音</strong><span>{props.data.voices.length}/{props.data.scenes.length} 已生成</span></header>
      <div className="hv-reference-voice-list">
        {props.data.scenes.map((scene) => <VoiceRow key={`${scene.index}-${props.data.revision}`} {...props} scene={scene} />)}
      </div>
    </section>
  );
}

function VoiceSettings({ api, task, data, cloneVoices, applyState, refreshTaskDetail, busy, isBrowserPreview }: EditorialPanelProps) {
  const action = useAsyncAction();
  const initialProvider = normalizeRuntimeTtsProvider(data.config.ttsProvider);
  const [provider, setProvider] = useState<TtsProvider>(initialProvider);
  const [voiceId, setVoiceId] = useState(data.config.voiceId || ttsVoiceOptionsForProvider(initialProvider, cloneVoices)[0]?.id || '');
  const [speed, setSpeed] = useState(data.config.ttsSpeed ?? 1);
  const voiceOptions = ttsVoiceOptionsForProvider(provider, cloneVoices);
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;
  const changed = provider !== initialProvider || voiceId !== data.config.voiceId || speed !== (data.config.ttsSpeed ?? 1);

  useEffect(() => {
    const nextProvider = normalizeRuntimeTtsProvider(data.config.ttsProvider);
    setProvider(nextProvider);
    setVoiceId(data.config.voiceId || ttsVoiceOptionsForProvider(nextProvider, cloneVoices)[0]?.id || '');
    setSpeed(data.config.ttsSpeed ?? 1);
  }, [cloneVoices, data.config.ttsProvider, data.config.ttsSpeed, data.config.voiceId, task.id]);

  function changeProvider(value: TtsProvider) {
    setProvider(value);
    setVoiceId(ttsVoiceOptionsForProvider(value, cloneVoices)[0]?.id ?? '');
  }

  async function applyVoiceSettings() {
    if (!changed || !voiceId) return;
    await action.run(async () => {
      const changes = [
        ...(provider !== initialProvider ? [{ field: 'ttsProvider' as const, value: provider }] : []),
        ...(voiceId !== data.config.voiceId ? [{ field: 'voiceId' as const, value: voiceId }] : []),
        ...(speed !== (data.config.ttsSpeed ?? 1) ? [{ field: 'ttsSpeed' as const, value: speed }] : []),
      ];
      applyState(await api.updateHtmlVideoConfig(task.id, changes));
      await refreshTaskDetail(task.id);
      applyState(await api.updateTaskStatus(task.id, 'running'));
      await refreshTaskDetail(task.id);
    });
  }

  return (
    <section className="hv-voice-settings" aria-label="配音设置">
      <div className="hv-voice-setting-line">
        <strong>配音员</strong>
        <div className="hv-voice-provider" role="group" aria-label="配音服务">
          <button type="button" className={provider === 'volcengine' ? 'active' : ''} disabled={locked} onClick={() => changeProvider('volcengine')}>豆包</button>
          <button type="button" className={provider === 'minimax' ? 'active' : ''} disabled={locked} onClick={() => changeProvider('minimax')}>MiniMax</button>
        </div>
        <label className="hv-voice-speed"><span>语速 {speed.toFixed(1)}x</span><input type="range" min={Math.max(0.5, HTML_VIDEO_TTS_SPEED_MIN)} max={Math.min(2, HTML_VIDEO_TTS_SPEED_MAX)} step={0.1} value={speed} disabled={locked} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
        <button className="mini-button primary" type="button" disabled={locked || !changed || !voiceId} onClick={applyVoiceSettings}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}应用并重配全部</button>
      </div>
      <div className="hv-voice-choice-list" role="listbox" aria-label="选择音色">
        {voiceOptions.map((voice) => (
          <button key={voice.id} type="button" role="option" aria-selected={voiceId === voice.id} className={voiceId === voice.id ? 'active' : ''} disabled={locked} onClick={() => setVoiceId(voice.id)}>
            <Volume2 size={13} /><span>{voice.label}</span><small>{voice.hint}</small>
          </button>
        ))}
      </div>
      <InlineActionFeedback feedback={action.feedback} />
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
  cloneVoices,
}: EditorialPanelProps & { scene: HtmlVideoScenePlan }) {
  const action = useAsyncAction();
  const [editing, setEditing] = useState(false);
  const [narration, setNarration] = useState(scene.narration);
  const voice = data.voices.find((item) => item.sceneIndex === scene.index);
  const voiceStatus = voice
    ? htmlVideoMediaStatus(voice.src, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;
  async function regenerate(nextNarration = scene.narration) {
    await action.run(async () => {
      if (nextNarration.trim() !== scene.narration) {
        applyState(await api.updateHtmlVideoScene(task.id, scene.index, [{ field: 'narration', value: nextNarration.trim() }]));
        await refreshTaskDetail(task.id);
      }
      const mutation = await api.regenerateHtmlVideoVoice(task.id, scene.index);
      applyState(mutation);
      await refreshTaskDetail(task.id);
      setEditing(false);
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
      <button className="mini-button" type="button" disabled={locked} onClick={() => setEditing(true)}>{action.busy ? <Loader2 className="spin" size={14} /> : <Settings2 size={14} />}重配</button>
      <InlineActionFeedback feedback={action.feedback} />
      {editing ? (
        <div className="hv-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditing(false)}>
          <section className="hv-editor-modal" role="dialog" aria-modal="true" aria-label={`重配场景 ${scene.index}`}>
            <header><div><strong>重配场景 {scene.index}</strong><span>{taskSpeakerLabel(data.config.ttsProvider, data.config.voiceId ?? '', cloneVoices)} · {(data.config.ttsSpeed ?? 1).toFixed(1)}x</span></div><button type="button" title="关闭" onClick={() => setEditing(false)}><X size={16} /></button></header>
            <label><span>口播文案</span><textarea autoFocus rows={6} value={narration} onChange={(event) => setNarration(event.target.value)} /></label>
            <footer><button className="mini-button" type="button" onClick={() => setEditing(false)}>取消</button><button className="mini-button primary" type="button" disabled={!narration.trim() || action.busy} onClick={() => regenerate(narration)}>{action.busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}保存并重配</button></footer>
          </section>
        </div>
      ) : null}
    </article>
  );
}

export function HtmlVideoStoryboundPreviewPanel(props: EditorialPanelProps & { captionEditor?: React.ReactNode }) {
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
  const [loadedSource, setLoadedSource] = useState({ key: '', html: '' });
  const [sourceError, setSourceError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sceneMotion, setSceneMotion] = useState<Extract<HtmlVideoConfigChange, { field: 'sceneMotion' }>['value']>(
    data.config.sceneMotion ?? HTML_VIDEO_JOB_DEFAULTS.sceneMotion,
  );
  const [transitionType, setTransitionType] = useState<Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value']>(
    (data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'],
  );
  const [effectsMessage, setEffectsMessage] = useState('');
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'starting' | 'playing' | 'paused' | 'error'>('loading');
  const [transitionFrame, setTransitionFrame] = useState<{
    key: number;
    url: string;
    type: typeof transitionType;
    running: boolean;
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoplayAll = useRef(false);
  const runtimeReady = useRef(false);
  const pendingCommand = useRef<{ command: 'play' | 'restart'; requestId: number } | null>(null);
  const playbackRequestId = useRef(0);
  const progressRef = useRef(0);
  const transitioning = useRef(false);
  const playbackWatchdog = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const maximizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreScrollRef = useRef<{ workspace: HTMLElement; top: number; left: number } | null>(null);
  const action = useAsyncAction();
  const compositions = data.compositions;
  const composition = compositions[active];
  const mediaUrlSignature = [...new Set([
    ...data.assets.map((asset) => asset.src),
    ...data.voices.map((voice) => voice.src),
  ])].map((path) => [path, mediaUrls[path] ?? '']);
  const compositionSourceKey = composition
    ? JSON.stringify([task.id, composition.index, composition.rev ?? 0, data.revision, mediaUrlSignature])
    : '';
  const source = loadedSource.key === compositionSourceKey ? loadedSource.html : '';
  const effectsLocked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;
  const activeScene = data.scenes.find((item) => item.index === composition?.index);
  const activeBackground = activeScene
    ? data.assets.find((asset) => asset.sceneIndex === activeScene.index && asset.kind === 'bg')
    : undefined;
  const activeForegrounds = activeScene
    ? activeScene.elements.map((element) => ({
      element,
      asset: data.assets.find((asset) => asset.sceneIndex === activeScene.index && asset.kind === 'fg' && asset.slot === element.slot),
    }))
    : [];
  const sceneStripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSceneMotion(data.config.sceneMotion ?? HTML_VIDEO_JOB_DEFAULTS.sceneMotion);
    setTransitionType(
      (data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'],
    );
    setEffectsMessage('');
  }, [data.config.sceneMotion, data.config.transitionType, task.id]);

  useEffect(() => {
    if (active >= compositions.length) setActive(Math.max(0, compositions.length - 1));
  }, [active, compositions.length]);

  useEffect(() => {
    let disposed = false;
    setSourceError('');
    setProgress(0);
    progressRef.current = 0;
    setPlaying(false);
    setRuntimeState('loading');
    runtimeReady.current = false;
    if (!composition || isBrowserPreview) {
      setLoadedSource({ key: '', html: '' });
      return;
    }
    const requestedSourceKey = compositionSourceKey;
    void api.getHtmlVideoCompositionSource(task.id, composition.index).then((loaded) => {
      if (disposed) return;
      setLoadedSource({
        key: requestedSourceKey,
        html: prepareCompositionSrcDoc(loaded.source, loaded.mediaUrl, data, mediaUrls),
      });
    }).catch((error) => {
      if (!disposed) setSourceError(error instanceof Error ? error.message : String(error));
    });
    return () => { disposed = true; };
  }, [api, compositionSourceKey, isBrowserPreview]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: string; state?: string; time?: number; duration?: number; playing?: boolean };
      if (message?.type === 'hvruntime') {
        if (message.state === 'ready') {
          runtimeReady.current = true;
          setRuntimeState('ready');
          post({ type: 'hvpreviewmotion', preset: sceneMotion });
          if (transitionFrame) {
            setTransitionFrame((current) => current ? { ...current, running: true } : current);
            if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
            transitionTimer.current = window.setTimeout(() => setTransitionFrame(null), 340);
          }
          const pending = pendingCommand.current;
          if (pending) {
            pendingCommand.current = null;
            post({ type: pending.command === 'restart' ? 'hvrestart' : 'hvplay' });
            armPlaybackWatchdog(pending.requestId, pending.command);
          }
        } else if (message.state === 'playing') {
          setPlaying(true);
          setRuntimeState('starting');
        } else if (message.state === 'paused') {
          setPlaying(false);
          setRuntimeState('paused');
        } else if (message.state === 'ended') {
          acknowledgePlayback();
          progressRef.current = 1;
          setProgress(1);
          setPlaying(false);
          setRuntimeState('paused');
        }
        return;
      }
      if (message?.type !== 'hvtick' || !message.duration) return;
      const next = Math.min(1, Math.max(0, Number(message.time ?? 0) / message.duration));
      const advanced = next > progressRef.current + 0.0005;
      progressRef.current = next;
      setProgress(next);
      if (advanced && message.playing !== false) {
        setPlaying(true);
        setRuntimeState('playing');
      } else if (message.playing === false && next < 0.995) {
        setPlaying(false);
      }
      if (next >= 0.995) {
        if (autoplayAll.current && active < compositions.length - 1 && !transitioning.current) {
          changeScene(active + 1, true, true);
        } else {
          autoplayAll.current = false;
          setPlaying(false);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, compositions.length, sceneMotion]);

  useEffect(() => () => {
    if (playbackWatchdog.current !== null) window.clearTimeout(playbackWatchdog.current);
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (maximized || !restoreScrollRef.current) return;
    const { workspace, top, left } = restoreScrollRef.current;
    restoreScrollRef.current = null;
    workspace.scrollTo({ top, left, behavior: 'instant' });
    maximizeButtonRef.current?.focus({ preventScroll: true });
  }, [maximized]);

  useEffect(() => {
    if (!maximized) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMaximized(false);
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => window.removeEventListener('keydown', exitOnEscape);
  }, [maximized]);

  function post(message: object) {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }

  function acknowledgePlayback() {
    if (playbackWatchdog.current !== null) window.clearTimeout(playbackWatchdog.current);
    playbackWatchdog.current = null;
  }

  function armPlaybackWatchdog(
    requestId: number,
    command: 'play' | 'restart',
    retryCount = 0,
    baselineProgress = progressRef.current,
  ) {
    if (playbackWatchdog.current !== null) window.clearTimeout(playbackWatchdog.current);
    playbackWatchdog.current = window.setTimeout(() => {
      if (requestId === playbackRequestId.current) {
        if (progressRef.current > baselineProgress + 0.01) {
          armPlaybackWatchdog(requestId, command, retryCount, progressRef.current);
          return;
        }
        if (retryCount < 1 && runtimeReady.current) {
          setRuntimeState('starting');
          post({ type: command === 'restart' ? 'hvrestart' : 'hvplay' });
          armPlaybackWatchdog(requestId, command, retryCount + 1, progressRef.current);
          return;
        }
        pendingCommand.current = null;
        setPlaying(false);
        setRuntimeState('error');
        setEffectsMessage('预览运行时未能启动，请重试或重新生成该场景预览。');
      }
    }, 1800);
  }

  function requestPlayback(command: 'play' | 'restart') {
    const requestId = playbackRequestId.current + 1;
    playbackRequestId.current = requestId;
    if (command === 'restart') {
      progressRef.current = 0;
      setProgress(0);
    }
    pendingCommand.current = { command, requestId };
    setSettingsOpen(false);
    setRuntimeState('starting');
    if (!runtimeReady.current || !source) return;
    pendingCommand.current = null;
    post({ type: command === 'restart' ? 'hvrestart' : 'hvplay' });
    armPlaybackWatchdog(requestId, command);
  }

  function changeScene(next: number, resume: boolean, animate: boolean) {
    if (next < 0 || next >= compositions.length || next === active) return;
    transitioning.current = true;
    const outgoingPath = composition?.thumbnailPath ?? composition?.background.src;
    const outgoingUrl = outgoingPath ? mediaUrls[outgoingPath] : '';
    if (animate && outgoingUrl) {
      setTransitionFrame({ key: Date.now(), url: outgoingUrl, type: transitionType, running: false });
    } else {
      setTransitionFrame(null);
    }
    acknowledgePlayback();
    const requestId = playbackRequestId.current + 1;
    playbackRequestId.current = requestId;
    pendingCommand.current = resume ? { command: 'restart', requestId } : null;
    setSettingsOpen(false);
    progressRef.current = 0;
    setProgress(0);
    setPlaying(false);
    setRuntimeState(resume ? 'starting' : 'loading');
    setActive(next);
    window.setTimeout(() => { transitioning.current = false; }, 380);
  }

  function play() {
    autoplayAll.current = false;
    requestPlayback(progressRef.current >= 0.995 ? 'restart' : 'play');
  }
  function pause() {
    autoplayAll.current = false;
    playbackRequestId.current += 1;
    pendingCommand.current = null;
    acknowledgePlayback();
    setPlaying(false);
    setRuntimeState('paused');
    if (progressRef.current <= 0.0005) {
    }
    post({ type: 'hvpause' });
  }
  function restart() {
    autoplayAll.current = false;
    requestPlayback('restart');
  }
  function playAll() {
    autoplayAll.current = true;
    if (active === 0) requestPlayback('restart');
    else changeScene(0, true, true);
  }

  function scrollScenes(direction: -1 | 1) {
    const track = sceneStripRef.current;
    if (!track) return;
    const horizontal = track.scrollWidth > track.clientWidth + 2;
    track.scrollBy({
      left: horizontal ? direction * 220 : 0,
      top: horizontal ? 0 : direction * 180,
      behavior: 'smooth',
    });
  }

  function toggleMaximized() {
    if (!maximized) {
      const workspace = previewRef.current?.closest<HTMLElement>('.hv-preview-workspace');
      restoreScrollRef.current = workspace
        ? { workspace, top: workspace.scrollTop, left: workspace.scrollLeft }
        : null;
      setMaximized(true);
      return;
    }
    setMaximized(false);
  }

  async function saveEffects() {
    const changes: HtmlVideoConfigChange[] = [];
    if (sceneMotion !== (data.config.sceneMotion ?? HTML_VIDEO_JOB_DEFAULTS.sceneMotion)) {
      changes.push({ field: 'sceneMotion', value: sceneMotion });
    }
    if (transitionType !== (data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType)) {
      changes.push({ field: 'transitionType', value: transitionType });
    }
    if (!changes.length) {
      setEffectsMessage('动效设置没有变化。');
      return;
    }
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoConfig(task.id, changes);
      applyState(mutation);
      await refreshTaskDetail(task.id);
      setSettingsOpen(false);
      setEffectsMessage('动效已保存，可从动画预览继续生成。');
    }, { onError: (error) => setEffectsMessage(error.message) });
  }

  if (!composition) return <div className="hv-empty">场景生成中，完成后可在此预览动画。</div>;
  return (
    <section
      ref={previewRef}
      className={`hv-reference-preview${maximized ? ' maxed' : ''}${settingsOpen ? ' settings-open' : ''}`}
      data-maximized={maximized ? 'true' : 'false'}
    >
      <header className="hv-reference-panel-head hv-preview-commandbar">
        <div className="hv-preview-command-context">
          <strong>{activeScene ? `场景 ${activeScene.index}` : '动画预览'}</strong>
          <span>{activeScene?.title ?? '真实画布预览'}</span>
        </div>
        <span className="hv-preview-runtime" data-runtime-state={runtimeState}>{runtimeState === 'error' ? '运行时异常' : runtimeState === 'playing' ? '正在播放' : runtimeState === 'starting' ? '正在启动' : '预览就绪'}</span>
        <Button className="hv-preview-play-all" density="compact" variant="primary" icon={<Play size={14} />} onClick={playAll}>连播全部</Button>
      </header>
      <div className="hv-preview-workbench">
        <div className="hv-preview-canvas-column">
          <div className="hv-reference-stage">
            <div className="hv-reference-phone" data-runtime-state={runtimeState} style={{ aspectRatio: `${composition.canvas.w} / ${composition.canvas.h}` }}>
              {source ? <iframe
                key={compositionSourceKey}
                ref={iframeRef}
                srcDoc={source}
                title={`场景 ${composition.index}`}
                onLoad={() => post({ type: 'hvprobe' })}
              /> : <div className="hv-reference-preview-loading">{sourceError || <><Loader2 className="spin" size={20} />正在载入场景</>}</div>}
              {transitionFrame ? <img
                key={transitionFrame.key}
                className={`hv-scene-transition-overlay${transitionFrame.running ? ' running' : ''}`}
                data-transition={transitionFrame.type}
                src={transitionFrame.url}
                alt=""
                aria-hidden="true"
              /> : null}
            </div>
            <div className="hv-reference-transport">
              <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(event) => {
                const next = Number(event.target.value) / 1000;
                autoplayAll.current = false;
                playbackRequestId.current += 1;
                pendingCommand.current = null;
                acknowledgePlayback();
                setPlaying(false);
                setRuntimeState('paused');
                post({ type: 'hvseek', time: composition.durationSec * next });
                progressRef.current = next;
                setProgress(next);
              }} aria-label="场景播放进度" />
              <IconButton density="compact" variant="subtle" label={playing ? '暂停' : '播放'} icon={playing ? <Pause size={17} /> : <Play size={17} />} onClick={playing ? pause : play} />
              <span>{(progress * composition.durationSec).toFixed(1)}s / {composition.durationSec.toFixed(1)}s</span>
              <IconButton density="compact" variant="subtle" label="上一场景" icon={<ChevronLeft size={16} />} disabled={active === 0} onClick={() => changeScene(active - 1, false, true)} />
              <IconButton density="compact" variant="subtle" label="下一场景" icon={<ChevronRight size={16} />} disabled={active >= compositions.length - 1} onClick={() => changeScene(active + 1, false, true)} />
              <IconButton density="compact" variant="subtle" label="重播" icon={<RotateCcw size={15} />} onClick={restart} />
              <button
                ref={maximizeButtonRef}
                type="button"
                title={maximized ? '退出最大化' : '最大化'}
                aria-label={maximized ? '退出最大化动画预览' : '最大化动画预览'}
                aria-pressed={maximized}
                onClick={toggleMaximized}
              >{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
            </div>
          </div>
          <aside className="hv-reference-scene-strip" aria-label="场景列表">
            <header>
              <div><strong>场景</strong><span>{activeScene ? `当前 ${activeScene.index}/${data.scenes.length}` : `共 ${data.scenes.length} 个`}</span></div>
              <span className="hv-scene-strip-nav">
                <button type="button" title="向前浏览场景" onClick={() => scrollScenes(-1)}><ChevronLeft size={14} /></button>
                <button type="button" title="向后浏览场景" onClick={() => scrollScenes(1)}><ChevronRight size={14} /></button>
              </span>
            </header>
            <div ref={sceneStripRef} className="hv-reference-scene-track">
              {data.scenes.map((item) => {
                const index = compositions.findIndex((candidate) => candidate.index === item.index);
                const snapshot = index >= 0 ? compositions[index] : undefined;
                const thumbnail = snapshot?.thumbnailPath ?? snapshot?.background.src;
                const thumbnailStatus = thumbnail
                  ? htmlVideoMediaStatus(thumbnail, mediaUrls, failedMediaPaths, isBrowserPreview)
                  : 'desktop-only';
                return <div key={item.index} className={`hv-reference-scene-item${index === active ? ' active' : ''}`}>
                  <button className="hv-reference-scene-select" type="button" disabled={index < 0} aria-current={index === active ? 'true' : undefined} onClick={() => index >= 0 && changeScene(index, false, true)}>
                    <span className="hv-reference-thumb" aria-busy={thumbnailStatus === 'loading'}>
                      <b>{item.index}</b>
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
                    <span><strong>{item.title}</strong><small>{snapshot ? `${snapshot.durationSec.toFixed(1)}s` : '生成中'} · {htmlVideoSceneTemplate(item.sceneTemplate).label}</small></span>
                  </button>
                </div>;
              })}
            </div>
          </aside>
        </div>
        <Pane as="aside" tone="subtle" className="hv-preview-inspector-pane" aria-label="当前场景检查器">
          <details className="hv-preview-settings" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
            <summary><span><Settings2 size={14} />镜头与转场设置</span><small>作用于画布</small></summary>
            <div className="hv-preview-settings-content">
              <section className="hv-preview-effects" data-html-video-preview-effects="true" aria-label="镜头动效与场景转场">
                <div className="panel-title-row">
                  <h4>镜头与转场</h4>
                  <Button density="compact" variant="secondary" icon={action.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />} disabled={effectsLocked} onClick={() => void saveEffects()}>保存动效</Button>
                </div>
                <div className="hv-preview-effects-controls">
                  <label>
                    <span>镜头动效</span>
                    <select value={sceneMotion} disabled={effectsLocked} onChange={(event) => {
                      const value = event.target.value as typeof sceneMotion;
                      setSceneMotion(value);
                      if (runtimeReady.current) post({ type: 'hvpreviewmotion', preset: value });
                    }}>
                      {HTML_VIDEO_SCENE_MOTIONS.map((motion) => <option key={motion} value={motion}>{HTML_VIDEO_SCENE_MOTION_LABELS[motion]}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>场景转场</span>
                    <select value={transitionType} disabled={effectsLocked} onChange={(event) => setTransitionType(event.target.value as typeof transitionType)}>
                      {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{HTML_VIDEO_TRANSITION_LABELS[transition]}</option>)}
                    </select>
                  </label>
                  <span className="hv-effect-output-note">转场时长 0.3 秒，连播与最终输出一致</span>
                </div>
                {effectsMessage ? <span className="local-note" role="status">{effectsMessage}</span> : null}
              </section>
            </div>
          </details>
          {activeScene ? (
            <ScenePreviewEditor
              {...props}
              key={activeScene.index}
              scene={activeScene}
              composition={composition}
              currentTimeSec={progress * composition.durationSec}
              background={activeBackground}
              foregrounds={activeForegrounds}
              captionEditor={props.captionEditor}
              onActivate={() => setSettingsOpen(false)}
            />
          ) : null}
        </Pane>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </section>
  );
}

type ScenePreviewEditorTab = 'layout' | 'foreground' | 'title' | 'caption' | 'prompt';

function ScenePreviewEditor({
  api,
  task,
  scene,
  composition,
  currentTimeSec,
  background,
  foregrounds,
  mediaUrls,
  failedMediaPaths,
  mediaRetryRevision,
  onMediaElementError,
  onMediaElementReady,
  applyState,
  refreshTaskDetail,
  busy,
  isBrowserPreview,
  captionEditor,
  onActivate,
}: EditorialPanelProps & {
  scene: HtmlVideoScenePlan;
  composition: HtmlVideoCompositionSnapshot;
  currentTimeSec: number;
  background?: HtmlVideoAsset;
  foregrounds: Array<{ element: HtmlVideoScenePlan['elements'][number]; asset?: HtmlVideoAsset }>;
  captionEditor?: React.ReactNode;
  onActivate: () => void;
}) {
  const [tab, setTab] = useState<ScenePreviewEditorTab>('layout');
  const [title, setTitle] = useState(scene.title);
  const templateCaptionY = htmlVideoSceneTemplate(scene.sceneTemplate).captionY;
  const [captionScale, setCaptionScale] = useState(scene.captionScale ?? 1);
  const [captionY, setCaptionY] = useState(scene.captionYOverride ?? templateCaptionY);
  const [backgroundPrompt, setBackgroundPrompt] = useState(scene.background.prompt);
  const [elementPrompts, setElementPrompts] = useState<Record<number, string>>(
    Object.fromEntries(scene.elements.map((element) => [element.slot, element.prompt])),
  );
  const action = useAsyncAction();
  const locked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;
  const templates = HTML_VIDEO_SCENE_TEMPLATES.filter((template) => template.materialSlots === scene.elements.length);
  const normalizedTemplate = normalizeHtmlVideoSceneTemplate(scene.sceneTemplate);
  const backgroundStatus = background
    ? htmlVideoMediaStatus(background.src, mediaUrls, failedMediaPaths, isBrowserPreview)
    : 'desktop-only';
  const backgroundUrl = background && backgroundStatus === 'ready' ? mediaUrls[background.src] : '';
  const foregroundUrls = scene.elements.map((element) => {
    const asset = foregrounds.find((item) => item.element.slot === element.slot)?.asset;
    return asset && htmlVideoMediaStatus(asset.src, mediaUrls, failedMediaPaths, isBrowserPreview) === 'ready'
      ? mediaUrls[asset.src]
      : '';
  });
  const titleChanged = title.trim() !== scene.title;
  const captionChanges: HtmlVideoSceneChange[] = [];
  if (Math.abs(captionScale - (scene.captionScale ?? 1)) > 0.001) {
    captionChanges.push({ field: 'captionScale', value: captionScale });
  }
  if (Math.abs(captionY - (scene.captionYOverride ?? templateCaptionY)) > 0.001) {
    captionChanges.push({ field: 'captionYOverride', value: captionY });
  }
  const promptChanges: HtmlVideoSceneChange[] = [];
  if (backgroundPrompt.trim() && backgroundPrompt.trim() !== scene.background.prompt) {
    promptChanges.push({ field: 'backgroundPrompt', value: backgroundPrompt.trim() });
  }
  for (const element of scene.elements) {
    const value = (elementPrompts[element.slot] ?? '').trim();
    if (value && value !== element.prompt) promptChanges.push({ field: 'elementPrompt', slot: element.slot, value });
  }

  useEffect(() => {
    setTitle(scene.title);
    setCaptionScale(scene.captionScale ?? 1);
    setCaptionY(scene.captionYOverride ?? htmlVideoSceneTemplate(scene.sceneTemplate).captionY);
    setBackgroundPrompt(scene.background.prompt);
    setElementPrompts(Object.fromEntries(scene.elements.map((element) => [element.slot, element.prompt])));
  }, [scene.background.prompt, scene.captionScale, scene.captionYOverride, scene.elements, scene.sceneTemplate, scene.title]);

  async function mutate(changes: HtmlVideoSceneChange[]) {
    if (!changes.length) return;
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, scene.index, changes);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  const tabs: Array<{ value: ScenePreviewEditorTab; label: string }> = [
    { value: 'layout', label: '版式' },
    { value: 'foreground', label: '前景' },
    { value: 'title', label: '标题' },
    { value: 'caption', label: '字幕' },
    { value: 'prompt', label: '提示词' },
  ];

  return (
    <section className="hv-scene-preview-editor" aria-label={`场景 ${scene.index} 画面设置`}>
      <header className="hv-scene-editor-head">
        <div><strong>场景 {scene.index}</strong><span>{scene.title}</span></div>
        <Tabs
          className="hv-scene-editor-tabs"
          label="当前场景设置"
          items={tabs}
          value={tab}
          onChange={(value) => {
            setTab(value as ScenePreviewEditorTab);
            onActivate();
          }}
        />
      </header>
      <div className="hv-scene-editor-body">
        {tab === 'layout' ? (
          <div className="hv-scene-template-grid" aria-label="选择当前场景版式">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={normalizedTemplate === template.id ? 'selected' : ''}
                aria-pressed={normalizedTemplate === template.id}
                disabled={locked}
                title={template.description}
                onClick={() => void mutate([{ field: 'sceneTemplate', value: template.id }])}
              >
                <PresetSwatch template={template} backgroundUrl={backgroundUrl} foregroundUrls={foregroundUrls} />
                <span><strong>{template.label}</strong><small>{template.description}</small></span>
              </button>
            ))}
          </div>
        ) : null}
        {tab === 'foreground' ? (
          <div className="hv-scene-foreground-editor">
            <div className="hv-scene-editor-toolbar">
              <span><strong>{foregrounds.length} 个前景</strong><small>{scene.foregroundHidden ? '当前场景前景已隐藏' : '当前场景前景已显示'}</small></span>
              <button className="mini-button" type="button" disabled={locked || foregrounds.length === 0} onClick={() => void mutate([{ field: 'foregroundHidden', value: !scene.foregroundHidden }])}>
                {scene.foregroundHidden ? <Eye size={15} /> : <EyeOff size={15} />}{scene.foregroundHidden ? '显示全部' : '隐藏全部'}
              </button>
            </div>
            <div className="hv-scene-foreground-list">
              {foregrounds.length ? foregrounds.map(({ element, asset }) => {
                const status = asset
                  ? htmlVideoMediaStatus(asset.src, mediaUrls, failedMediaPaths, isBrowserPreview)
                  : 'desktop-only';
                const slotHidden = Boolean(scene.hiddenElementSlots?.includes(element.slot));
                const hidden = Boolean(scene.foregroundHidden || slotHidden);
                const stateLabel = !asset
                  ? '未生成'
                  : status === 'ready'
                    ? hidden ? '已隐藏' : '已显示'
                    : status === 'loading'
                      ? '加载中'
                      : status === 'unavailable'
                        ? '加载失败'
                        : '仅桌面端可用';
                return (
                  <article key={element.slot} className={hidden ? 'hidden' : ''}>
                    <div className="hv-scene-foreground-thumb" aria-busy={status === 'loading'}>
                      {asset && status === 'ready' && mediaUrls[asset.src] ? (
                        <img
                          key={htmlVideoMediaElementKey(task.id, asset.src, mediaRetryRevision)}
                          src={mediaUrls[asset.src]}
                          alt={`前景 ${element.slot + 1}`}
                          onError={() => onMediaElementError(asset.src)}
                          onLoad={() => onMediaElementReady(asset.src)}
                        />
                      ) : status === 'loading' ? <Loader2 className="spin" size={17} /> : <ImageIcon size={18} />}
                    </div>
                    <span><strong>前景 {element.slot + 1}</strong><small data-state={status}>{stateLabel}</small></span>
                    <button type="button" title={scene.foregroundHidden ? '场景前景已全部隐藏' : slotHidden ? '显示前景' : '隐藏前景'} aria-label={slotHidden ? `显示前景 ${element.slot + 1}` : `隐藏前景 ${element.slot + 1}`} disabled={locked || scene.foregroundHidden} onClick={() => void mutate([{ field: 'elementHidden', slot: element.slot, value: !slotHidden }])}>
                      {slotHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </article>
                );
              }) : <div className="hv-scene-editor-empty">当前版式不使用前景素材</div>}
            </div>
          </div>
        ) : null}
        {tab === 'title' ? (
          <div className="hv-scene-title-editor">
            <label><span>画面标题</span><input value={title} disabled={locked} onChange={(event) => setTitle(event.target.value)} /></label>
            <button className="mini-button" type="button" disabled={locked} onClick={() => void mutate([{ field: 'titleHidden', value: !scene.titleHidden }])}>
              {scene.titleHidden ? <Eye size={15} /> : <EyeOff size={15} />}{scene.titleHidden ? '显示标题' : '隐藏标题'}
            </button>
            <button className="mini-button primary" type="button" disabled={locked || !title.trim() || !titleChanged} onClick={() => void mutate([{ field: 'title', value: title.trim() }])}>
              {action.busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}保存标题
            </button>
          </div>
        ) : null}
        {tab === 'caption' ? (
          <div className="hv-scene-caption-editor" data-html-video-caption-workspace="true">
            <div className="hv-scene-caption-primary">
              <div className="hv-scene-caption-controls">
                <label>
                  <span>场景垂直位置 <b>{captionY.toFixed(0)}%</b></span>
                  <input type="range" min={8} max={92} step={1} value={captionY} disabled={locked} onChange={(event) => setCaptionY(Number(event.target.value))} />
                </label>
                <label>
                  <span>场景字号倍率 <b>{captionScale.toFixed(2)}x</b></span>
                  <input type="range" min={0.6} max={1.8} step={0.05} value={captionScale} disabled={locked} onChange={(event) => setCaptionScale(Number(event.target.value))} />
                </label>
                <button className="mini-button" type="button" disabled={locked} onClick={() => {
                  setCaptionY(templateCaptionY);
                  setCaptionScale(1);
                }}><RotateCcw size={14} />跟随版式</button>
                <button className="mini-button primary" type="button" disabled={locked || captionChanges.length === 0} onClick={() => void mutate(captionChanges)}>
                  {action.busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}保存场景字幕
                </button>
              </div>
              {captionEditor}
            </div>
            <div className="hv-scene-caption-cues" aria-label="当前场景字幕时段">
              {composition.captions.map((cue, index) => {
                const endSec = cue.startSec + cue.durationSec;
                const active = currentTimeSec >= cue.startSec
                  && (currentTimeSec < endSec || (index === composition.captions.length - 1 && currentTimeSec <= endSec));
                return (
                  <article key={cue.id} className={active ? 'active' : ''} aria-current={active ? 'true' : undefined}>
                    <span>{index + 1}</span>
                    <p>{cue.text}</p>
                    <time>{formatCaptionCueTime(cue.startSec)} - {formatCaptionCueTime(endSec)}</time>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
        {tab === 'prompt' ? (
          <div className="hv-scene-prompt-editor">
            <label><span>背景提示词</span><textarea rows={3} value={backgroundPrompt} disabled={locked} onChange={(event) => setBackgroundPrompt(event.target.value)} /></label>
            {scene.elements.map((element) => (
              <label key={element.slot}><span>前景 {element.slot + 1} 提示词</span><textarea rows={3} value={elementPrompts[element.slot] ?? ''} disabled={locked} onChange={(event) => setElementPrompts((current) => ({ ...current, [element.slot]: event.target.value }))} /></label>
            ))}
            <button className="mini-button primary" type="button" disabled={locked || promptChanges.length === 0} onClick={() => void mutate(promptChanges)}>
              {action.busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}保存提示词
            </button>
          </div>
        ) : null}
      </div>
      <InlineActionFeedback feedback={action.feedback} />
    </section>
  );
}

function formatCaptionCueTime(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function PresetSwatch({
  template,
  backgroundUrl,
  foregroundUrls = [],
}: {
  template: typeof HTML_VIDEO_SCENE_TEMPLATES[number];
  backgroundUrl?: string;
  foregroundUrls?: readonly string[];
}) {
  const cueStyle = (cue: HtmlVideoAnimationCue, fallbackDurationSec = 0.8) => ({
    '--hv-preview-delay': `${cue.startSec ?? 0}s`,
    '--hv-preview-duration': `${cue.durationSec ?? fallbackDurationSec}s`,
  }) as React.CSSProperties;
  const choreography = template.choreography;
  return (
    <span
      className="hv-template-swatch"
      data-variant={template.swatch}
      data-background-motion={choreography.background.preset}
      aria-hidden="true"
    >
      <i
        data-layer="background"
        data-motion={choreography.background.preset}
        style={{
          ...cueStyle(choreography.background, 2.4),
          ...(backgroundUrl ? { backgroundImage: `url(${JSON.stringify(backgroundUrl)})` } : {}),
        }}
      />
      {choreography.title ? (
        <i
          data-layer="title"
          data-motion={choreography.title.preset}
          style={cueStyle(choreography.title)}
        />
      ) : null}
      {choreography.elements.map((cue, index) => (
        <i
          key={`${cue.preset}-${index}`}
          data-layer="element"
          data-element-index={index}
          data-motion={cue.preset}
          style={{
            ...cueStyle(cue),
            ...(foregroundUrls[index] ? { backgroundImage: `url(${JSON.stringify(foregroundUrls[index])})` } : {}),
          }}
        />
      ))}
      <i
        data-layer="caption"
        data-motion={choreography.caption.preset}
        style={cueStyle(choreography.caption)}
      />
    </span>
  );
}

function prepareCompositionSrcDoc(
  source: string,
  mediaUrl: string,
  data: HtmlVideoPipelineData,
  mediaUrls: Record<string, string>,
): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
    const scriptSource = script.getAttribute('src')?.replace(/\\/gu, '/').split(/[?#]/u)[0] ?? '';
    if (scriptSource === HYPERFRAMES_RUNTIME_FILENAME || scriptSource.endsWith(`/${HYPERFRAMES_RUNTIME_FILENAME}`)) {
      script.remove();
    }
  }
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

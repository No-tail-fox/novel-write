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
  Pencil,
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
import {
  HTML_VIDEO_SCENE_TEMPLATES,
  htmlVideoSceneTemplate,
  normalizeHtmlVideoSceneTemplate,
  type HtmlVideoAnimationCue,
} from '../../shared/html-video-scene-templates';
import { normalizeRuntimeTtsProvider, taskSpeakerLabel, ttsVoiceOptionsForProvider } from '../../shared/tts-voices';
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
        <span>{foregrounds.length} 张前景 · {pendingCount} 张待确认透明</span>
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
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [presetSceneIndex, setPresetSceneIndex] = useState<number | null>(null);
  const [sceneMotion, setSceneMotion] = useState<Extract<HtmlVideoConfigChange, { field: 'sceneMotion' }>['value']>(
    data.config.sceneMotion ?? HTML_VIDEO_JOB_DEFAULTS.sceneMotion,
  );
  const [transitionType, setTransitionType] = useState<Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value']>(
    (data.config.transitionType ?? HTML_VIDEO_JOB_DEFAULTS.transitionType) as Extract<HtmlVideoConfigChange, { field: 'transitionType' }>['value'],
  );
  const [motionDemoRevision, setMotionDemoRevision] = useState(0);
  const [demoRevision, setDemoRevision] = useState(0);
  const [effectsMessage, setEffectsMessage] = useState('');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoplayAll = useRef(false);
  const shouldResume = useRef(false);
  const action = useAsyncAction();
  const compositions = data.compositions;
  const composition = compositions[active];
  const transitionThumbnails = compositions
    .slice(0, 2)
    .map((item) => item.thumbnailPath ?? item.background.src)
    .filter((path): path is string => Boolean(path));
  const effectsLocked = busy || action.busy || task.status === 'running' || task.status === 'pending' || isBrowserPreview;
  const activeScene = data.scenes.find((item) => item.index === composition?.index);
  const motionThumbnail = composition?.thumbnailPath ?? composition?.background.src;
  const motionThumbnailUrl = motionThumbnail ? mediaUrls[motionThumbnail] : '';
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

  function playScene(index: number) {
    autoplayAll.current = false;
    if (index === active) {
      post({ type: 'hvrestart' });
      setProgress(0);
      setPlaying(true);
      return;
    }
    shouldResume.current = true;
    setActive(index);
  }

  function scrollScenes(direction: -1 | 1) {
    sceneStripRef.current?.scrollBy({ left: direction * 260, behavior: 'smooth' });
  }

  async function toggle(sceneIndex: number, field: 'foregroundHidden' | 'titleHidden', value: boolean) {
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, sceneIndex, [{ field, value }]);
      applyState(mutation);
      await refreshTaskDetail(task.id);
    });
  }

  async function selectTemplate(sceneIndex: number, value: string) {
    await action.run(async () => {
      const mutation = await api.updateHtmlVideoScene(task.id, sceneIndex, [{ field: 'sceneTemplate', value }]);
      applyState(mutation);
      await refreshTaskDetail(task.id);
      setPresetSceneIndex(null);
    });
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
      setEffectsMessage('动效已保存，可从动画预览继续生成。');
    }, { onError: (error) => setEffectsMessage(error.message) });
  }

  if (!composition) return <div className="hv-empty">场景生成中，完成后可在此预览动画。</div>;
  return (
    <section className={`hv-reference-preview${maximized ? ' maxed' : ''}`}>
      <header className="hv-reference-panel-head"><strong>动画预览</strong><span>WebView 真实渲染 · 所见即所得</span><button className="mini-button primary" onClick={playAll}><Play size={13} />连播全部</button></header>
      <div className="hv-preview-workbench">
        <div className="hv-preview-canvas-column">
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
          <aside className="hv-reference-scene-strip" aria-label="场景胶片条">
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
                  <button className="hv-reference-scene-select" type="button" disabled={index < 0} aria-current={index === active ? 'true' : undefined} onClick={() => index >= 0 && setActive(index)}>
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
            {activeScene ? <span className="hv-reference-thumb-actions">
              <button className="hv-scene-icon-action" type="button" title={`播放场景 ${activeScene.index}`} aria-label={`播放场景 ${activeScene.index}`} onClick={() => playScene(active)}><Play size={12} /></button>
              <button className="hv-scene-template-action" type="button" title={`选择版式：${htmlVideoSceneTemplate(activeScene.sceneTemplate).label}`} disabled={busy || action.busy || isBrowserPreview} onClick={() => setPresetSceneIndex(activeScene.index)}><Pencil size={12} />版式</button>
              <button
                className="hv-scene-state-action"
                type="button"
                title={activeScene.foregroundHidden ? '显示前景' : '隐藏前景'}
                aria-label={activeScene.foregroundHidden ? '显示前景' : '隐藏前景'}
                disabled={busy || action.busy || isBrowserPreview}
                onClick={() => void toggle(activeScene.index, 'foregroundHidden', !activeScene.foregroundHidden)}
              >{activeScene.foregroundHidden ? <Eye size={12} /> : <EyeOff size={12} />}前景</button>
              <button
                className="hv-scene-state-action"
                type="button"
                title={activeScene.titleHidden ? '显示标题' : '隐藏标题'}
                aria-label={activeScene.titleHidden ? '显示标题' : '隐藏标题'}
                disabled={busy || action.busy || isBrowserPreview}
                onClick={() => void toggle(activeScene.index, 'titleHidden', !activeScene.titleHidden)}
              >{activeScene.titleHidden ? <Eye size={12} /> : <EyeOff size={12} />}标题</button>
            </span> : null}
          </aside>
        </div>
        <aside className="hv-preview-inspector" aria-label="动画预览属性">
          {props.captionEditor}
          <section className="hv-preview-effects" data-html-video-preview-effects="true" aria-label="镜头动效与场景转场">
            <div className="panel-title-row">
              <h4>镜头与转场</h4>
              <button className="mini-button" type="button" disabled={effectsLocked} onClick={() => void saveEffects()}>
                {action.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}保存动效
              </button>
            </div>
            <div className="hv-preview-effects-controls">
              <label>
                <span>镜头动效</span>
                <select value={sceneMotion} disabled={effectsLocked} onChange={(event) => {
                  setSceneMotion(event.target.value as typeof sceneMotion);
                  setMotionDemoRevision((value) => value + 1);
                }}>
                  {HTML_VIDEO_SCENE_MOTIONS.map((motion) => <option key={motion} value={motion}>{HTML_VIDEO_SCENE_MOTION_LABELS[motion]}</option>)}
                </select>
              </label>
              <div className="hv-effect-demo-row">
                <span>镜头预览</span>
                <div className="hv-motion-demo-wrap">
                  <div key={`${sceneMotion}-${motionDemoRevision}`} className="hv-motion-demo" data-motion={sceneMotion} aria-label="镜头动效示意">
                    {motionThumbnailUrl ? <img src={motionThumbnailUrl} alt="" onError={() => motionThumbnail && onMediaElementError(motionThumbnail)} onLoad={() => motionThumbnail && onMediaElementReady(motionThumbnail)} /> : <span>预览加载中</span>}
                  </div>
                  <button type="button" title="重播镜头示意" onClick={() => setMotionDemoRevision((value) => value + 1)}><RotateCcw size={14} /></button>
                </div>
              </div>
              <label>
                <span>场景转场</span>
                <select value={transitionType} disabled={effectsLocked} onChange={(event) => {
                  setTransitionType(event.target.value as typeof transitionType);
                  setDemoRevision((value) => value + 1);
                }}>
                  {HTML_VIDEO_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{HTML_VIDEO_TRANSITION_LABELS[transition]}</option>)}
                </select>
              </label>
              <div className="hv-effect-demo-row">
                <span>转场预览</span>
                <div className="hv-transition-demo-wrap">
                  <div key={`${transitionType}-${demoRevision}`} className="hv-transition-demo" data-transition={transitionType} aria-label="场景转场示意">
                    {transitionThumbnails.map((path, index) => mediaUrls[path] ? (
                      <img
                        key={`${htmlVideoMediaElementKey(task.id, path, mediaRetryRevision)}-${index}`}
                        className={`hv-transition-demo-frame frame-${index + 1}`}
                        src={mediaUrls[path]}
                        alt=""
                        onError={() => onMediaElementError(path)}
                        onLoad={() => onMediaElementReady(path)}
                      />
                    ) : <span key={`${path}-${index}`} className={`hv-transition-demo-frame frame-${index + 1} hv-media-state`}><Loader2 className="spin" size={14} /></span>)}
                    {transitionThumbnails.length < 2 ? <span className="hv-transition-demo-empty">需要至少两个场景</span> : null}
                  </div>
                  <button type="button" title="重播转场示意" onClick={() => setDemoRevision((value) => value + 1)}><RotateCcw size={14} /></button>
                </div>
              </div>
            </div>
            {effectsMessage ? <span className="local-note" role="status">{effectsMessage}</span> : null}
          </section>
        </aside>
      </div>
      <InlineActionFeedback feedback={action.feedback} />
      {presetSceneIndex !== null ? (
        <div className="hv-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPresetSceneIndex(null)}>
          <section className="hv-template-modal" role="dialog" aria-modal="true" aria-label="选择画面版式">
            <header><div><strong>选择画面版式</strong><span>{HTML_VIDEO_SCENE_TEMPLATES.length} 种 · 场景 {presetSceneIndex}</span></div><button type="button" title="关闭" onClick={() => setPresetSceneIndex(null)}><X size={16} /></button></header>
            <div className="hv-template-grid">
              {HTML_VIDEO_SCENE_TEMPLATES.map((template) => {
                const selected = normalizeHtmlVideoSceneTemplate(data.scenes.find((scene) => scene.index === presetSceneIndex)?.sceneTemplate) === template.id;
                return (
                  <button key={template.id} type="button" className={selected ? 'selected' : ''} disabled={action.busy || busy || isBrowserPreview} onClick={() => selectTemplate(presetSceneIndex, template.id)}>
                    <PresetSwatch template={template} />
                    <span><strong>{template.label}</strong><small>{template.description}</small></span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function PresetSwatch({ template }: { template: typeof HTML_VIDEO_SCENE_TEMPLATES[number] }) {
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
        style={cueStyle(choreography.background, 2.4)}
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
          style={cueStyle(cue)}
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

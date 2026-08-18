import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  Film,
  Flag,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  ImageOff,
  LockKeyhole,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
  WandSparkles,
} from 'lucide-react';
import { Button, CheckboxField, Dialog, IconButton, Menu, Pane, SelectField, SegmentedControl, SliderField, Tabs, TextAreaField, TextField, Toolbar } from '../../ui';
import previewCity from '../../assets/director-desk/preview-city.png';
import shotAlley from '../../assets/director-desk/shot-alley.png';
import shotArchive from '../../assets/director-desk/shot-archive.png';
import shotRooftop from '../../assets/director-desk/shot-rooftop.png';
import shotTeahouse from '../../assets/director-desk/shot-teahouse.png';
import { clampPlaybackTime, formatPlaybackTime, playbackShotAt, playbackShotOffset } from './director-playback';
import '../../styles/features/director-desk.css';

export type DirectorDeskMode = 'vox' | 'motion-comic';
export type DirectorInspectorTab = 'mode' | 'generate' | 'subtitle' | 'version';
export type DirectorShotStatus = 'ready' | 'generating' | 'queued' | 'failed';
export type DirectorStageName = '剧本' | '画面拆解' | '素材一致性' | '镜头生成' | '配音字幕' | '审片' | '导出';
type DirectorAssetTab = 'narrator' | 'places' | 'history' | 'style' | 'consistency';

export interface DirectorShot {
  id: string;
  index: number;
  title: string;
  scene: string;
  durationMs: number;
  framing: string;
  characterLabel: string;
  prompt: string;
  motionPrompt: string;
  subtitle: string;
  thumbnail?: string;
  status?: DirectorShotStatus;
  provider?: string;
  cost?: number;
  voice?: string;
  voiceId?: string;
  voiceSpeed?: number;
  audioUrl?: string;
  subtitleStyle?: string;
  layoutTemplate?: DirectorLayoutTemplate;
  motionPreset?: DirectorMotionPreset;
  seed?: string;
  seedLocked?: boolean;
  linkedAssetIds?: readonly string[];
}

export interface DirectorAsset {
  id: string;
  label: string;
  type: string;
  thumbnail: string;
  locked?: boolean;
  warning?: string;
  category?: DirectorAssetTab;
  sourceVersionId?: string;
  selected?: boolean;
  selectable?: boolean;
}

export interface DirectorProjectOption {
  id: string;
  title: string;
  meta: string;
}

export interface DirectorEpisodeOption {
  id: string;
  number: number;
  title: string;
  meta: string;
}

export interface DirectorVersion {
  id: string;
  label: string;
  createdAt: string;
  provider?: string;
  thumbnail?: string;
  selected?: boolean;
}

export interface DirectorProviderOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type DirectorLayoutTemplate = '对比拼贴 · 纸张撕裂' | '纪录片 · 纯画面' | '漫画分格 · 角色优先';
export type DirectorMotionPreset = '平移 + 缓慢推进' | '轻微视差' | '固定机位';

export interface DirectorDeskWorkspaceProps {
  mode: DirectorDeskMode;
  projectTitle: string;
  projectMeta: string;
  episodeTitle: string;
  stageLabel: string;
  completedStages?: readonly string[];
  systemStatus?: string;
  systemStatusTone?: 'ok' | 'warning' | 'error';
  shots: readonly DirectorShot[];
  assets?: readonly DirectorAsset[];
  selectedShotId: string;
  dirty: boolean;
  busy?: boolean;
  feedback?: string;
  errorMessage?: string;
  estimatedCost?: number;
  providerConnected?: boolean;
  providerLabel?: string;
  providerModel?: string;
  providerResolution?: string;
  providerUnavailableReason?: string;
  providerProfileId?: string;
  providerOptions?: readonly DirectorProviderOption[];
  voiceConnected?: boolean;
  voiceProviderLabel?: string;
  voiceModel?: string;
  voiceUnavailableReason?: string;
  voiceOptions?: readonly { value: string; label: string }[];
  outputUrl?: string;
  ratio?: '9:16' | '16:9' | '1:1' | '4:3';
  projects?: readonly DirectorProjectOption[];
  activeProjectId?: string;
  episodes?: readonly DirectorEpisodeOption[];
  activeEpisodeId?: string;
  versions?: readonly DirectorVersion[];
  jobs?: readonly DirectorQueueItem[];
  onSelectShot: (id: string) => void;
  onUpdateShot: (id: string, update: Partial<Pick<DirectorShot, 'title' | 'prompt' | 'motionPrompt' | 'framing' | 'durationMs' | 'voice' | 'voiceId' | 'voiceSpeed' | 'subtitle' | 'subtitleStyle' | 'layoutTemplate' | 'motionPreset' | 'seed' | 'seedLocked'>>) => void;
  onSave: () => void;
  onNewProject?: () => void;
  onSelectProject?: (id: string) => void;
  onSelectEpisode?: (id: string) => void;
  onAddEpisode?: () => void;
  onAddScene?: () => void;
  onAddShot?: () => void;
  onRatioChange?: (ratio: NonNullable<DirectorDeskWorkspaceProps['ratio']>) => void;
  onToggleAsset?: (asset: DirectorAsset) => void;
  onRestoreVersion?: (versionId: string) => void;
  onBackToLibrary?: () => void;
  onStageChange?: (stage: string) => void;
  onGenerateShot?: (id: string) => Promise<DirectorGenerationResult>;
  onProviderProfileChange?: (profileId: string) => void | Promise<void>;
  onGenerateVoice?: (id: string) => Promise<DirectorVoiceResult>;
  onRender?: () => Promise<void>;
  onOpenOutput?: () => Promise<void>;
  onOpenSettings?: () => void;
  onConfigureProvider?: () => void;
  onModeChange?: (mode: DirectorDeskMode) => void;
}

export interface DirectorGenerationResult {
  thumbnail: string;
  provider: string;
  cost?: number;
}

export interface DirectorVoiceResult {
  audioUrl: string;
  provider: string;
}

export interface DirectorQueueItem {
  id: string;
  shotId: string;
  title: string;
  status: 'running' | 'waiting' | 'failed' | 'completed';
  progress: number;
  cost: number;
  provider: string;
  thumbnail?: string;
  error?: string;
}

const defaultAssets: DirectorAsset[] = [
  { id: 'narrator', label: '旁白 · 李立宏', type: '声音', thumbnail: shotTeahouse, locked: true },
  { id: 'city', label: '拉萨全景', type: '场景', thumbnail: previewCity, locked: true },
  { id: 'alley', label: '旧城街巷', type: '场景', thumbnail: shotAlley, locked: true },
  { id: 'archive', label: '档案证据', type: '历史影像', thumbnail: shotArchive, locked: true },
  { id: 'rooftop', label: '屋顶夜景', type: '风格参考', thumbnail: shotRooftop, locked: true },
  { id: 'tea', label: '茶馆访谈', type: '人物', thumbnail: shotTeahouse, warning: '来源待确认' },
];

const filmstripImages = [previewCity, shotAlley, shotArchive, shotTeahouse, shotRooftop];

const modeOptions = [
  { value: 'motion-comic' as const, label: 'AI 漫剧' },
  { value: 'vox' as const, label: 'VOX 视频' },
];

const tabItems = [
  { value: 'mode', label: '模式', icon: <Sparkles size={13} /> },
  { value: 'generate', label: '生成', icon: <ImageIcon size={13} /> },
  { value: 'subtitle', label: '字幕', icon: <MessageSquareText size={13} /> },
  { value: 'version', label: '版本', icon: <Save size={13} /> },
] as const;

const assetTabItems = [
  { value: 'narrator', label: '叙述者' },
  { value: 'places', label: '地点' },
  { value: 'history', label: '历史影像' },
  { value: 'style', label: '风格参考' },
  { value: 'consistency', label: '一致性设定' },
] as const;

export function DirectorDeskWorkspace({
  mode,
  projectTitle,
  projectMeta,
  episodeTitle,
  stageLabel,
  completedStages = [],
  systemStatus = '生成服务正常',
  systemStatusTone = 'ok',
  shots,
  assets = defaultAssets,
  selectedShotId,
  dirty,
  busy = false,
  feedback,
  errorMessage,
  estimatedCost = 0,
  providerConnected = false,
  providerLabel = '图片服务未配置',
  providerModel = '未配置',
  providerResolution = '2K',
  providerUnavailableReason,
  providerProfileId,
  providerOptions = [],
  voiceConnected = false,
  voiceProviderLabel = '旁白服务未配置',
  voiceModel = '未配置',
  voiceUnavailableReason,
  voiceOptions = [],
  outputUrl,
  ratio = '16:9',
  projects = [],
  activeProjectId,
  episodes = [],
  activeEpisodeId,
  versions = [],
  jobs = [],
  onSelectShot,
  onUpdateShot,
  onSave,
  onNewProject,
  onSelectProject,
  onSelectEpisode,
  onAddEpisode,
  onAddScene,
  onAddShot,
  onRatioChange,
  onToggleAsset,
  onRestoreVersion,
  onBackToLibrary,
  onStageChange,
  onGenerateShot,
  onProviderProfileChange,
  onGenerateVoice,
  onRender,
  onOpenOutput,
  onOpenSettings,
  onConfigureProvider,
  onModeChange,
}: DirectorDeskWorkspaceProps) {
  const [inspectorTab, setInspectorTab] = useState<DirectorInspectorTab>('generate');
  const [assetTab, setAssetTab] = useState<DirectorAssetTab>('narrator');
  const [seedLocked, setSeedLocked] = useState(true);
  const [safeAreaVisible, setSafeAreaVisible] = useState(true);
  const [activeStage, setActiveStage] = useState<string>(() => outputUrl ? '导出' : stageLabel);
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [voiceBusyShotId, setVoiceBusyShotId] = useState('');
  const [renderBusy, setRenderBusy] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [shotSearch, setShotSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [previewSettingsOpen, setPreviewSettingsOpen] = useState(false);
  const [localGeneration, setLocalGeneration] = useState<Record<string, 'running' | 'failed'>>({});
  const [previewImageStatus, setPreviewImageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const playbackMsRef = useRef(0);
  const playbackClockRef = useRef({ originMs: 0, originTime: 0 });
  const activePlaybackShotRef = useRef(selectedShotId);
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;
  const availableAssets = assets.length > 0 ? assets : defaultAssets;
  const visibleAssets = useMemo(() => {
    const categoryFiltered = assetTab === 'narrator'
      ? availableAssets
      : availableAssets.filter((asset) => asset.category === assetTab || (assetTab === 'places' && ['场景', '地点'].includes(asset.type)) || (assetTab === 'history' && asset.type === '历史影像') || (assetTab === 'style' && asset.type === '风格参考') || (assetTab === 'consistency' && asset.locked));
    const query = assetSearch.trim().toLocaleLowerCase();
    return query ? categoryFiltered.filter((asset) => `${asset.label} ${asset.type} ${asset.warning ?? ''}`.toLocaleLowerCase().includes(query)) : categoryFiltered;
  }, [assetSearch, assetTab, availableAssets]);
  const filteredShots = useMemo(() => {
    const query = shotSearch.trim().toLocaleLowerCase();
    return query ? shots.filter((shot) => `${shot.title} ${shot.scene} ${shot.prompt}`.toLocaleLowerCase().includes(query)) : shots;
  }, [shotSearch, shots]);
  const queue = useMemo(() => {
    const authoritative = jobs.length > 0 ? jobs : createQueue(shots);
    const known = new Set(authoritative.map((item) => item.shotId));
    const transient = Object.entries(localGeneration)
      .filter(([shotId]) => !known.has(shotId))
      .flatMap(([shotId, status]): DirectorQueueItem[] => {
        const shot = shots.find((candidate) => candidate.id === shotId);
        return shot ? [{ id: `local-${shotId}`, shotId, title: shot.title, status, progress: 0, cost: shot.cost ?? 0, provider: providerLabel, thumbnail: shot.thumbnail, error: status === 'failed' ? '本次生成失败，请查看错误并重试。' : undefined }] : [];
      });
    return [...transient, ...authoritative];
  }, [jobs, localGeneration, providerLabel, shots]);

  const totalDuration = useMemo(() => shots.reduce((total, shot) => total + shot.durationMs, 0), [shots]);
  const selectedShotOffset = useMemo(() => playbackShotOffset(shots, selectedShot?.id ?? ''), [selectedShot?.id, shots]);
  const selectedQueueItem = selectedShot ? queue.find((item) => item.shotId === selectedShot.id) : undefined;
  const showingRenderedVideo = Boolean(outputUrl && activeStage === '导出');

  useEffect(() => {
    setPreviewImageStatus('loading');
  }, [selectedShot?.id, selectedShot?.thumbnail]);

  useEffect(() => {
    if (outputUrl && activeStage === '导出') return;
    if (activeStage === '导出' && !outputUrl) setActiveStage(stageLabel);
  }, [activeStage, outputUrl, stageLabel]);

  useEffect(() => {
    playbackMsRef.current = playbackMs;
  }, [playbackMs]);

  useEffect(() => {
    const next = clampPlaybackTime(playbackMsRef.current, totalDuration);
    playbackMsRef.current = next;
    setPlaybackMs(next);
    if (next >= totalDuration && isPlaying) setIsPlaying(false);
  }, [isPlaying, totalDuration]);

  useEffect(() => {
    if (!isPlaying || totalDuration <= 0) return undefined;
    let frame = 0;
    const tick = (now: number) => {
      const next = clampPlaybackTime(playbackClockRef.current.originMs + now - playbackClockRef.current.originTime, totalDuration);
      playbackMsRef.current = next;
      setPlaybackMs(next);
      const active = playbackShotAt(shots, next);
      if (active && active.id !== activePlaybackShotRef.current) {
        activePlaybackShotRef.current = active.id;
        onSelectShot(active.id);
      }
      if (next >= totalDuration) {
        setIsPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [isPlaying, onSelectShot, shots, totalDuration]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.muted = muted;
    if (!isPlaying || !selectedShot?.audioUrl) {
      audio.pause();
      return;
    }
    audio.currentTime = Math.max(0, (playbackMsRef.current - selectedShotOffset) / 1000);
    void audio.play().catch(() => undefined);
  }, [isPlaying, muted, selectedShot?.audioUrl, selectedShotOffset]);

  function seekPlayback(value: number) {
    const next = clampPlaybackTime(value, totalDuration);
    playbackMsRef.current = next;
    playbackClockRef.current = { originMs: next, originTime: performance.now() };
    setPlaybackMs(next);
    const active = playbackShotAt(shots, next);
    if (active && active.id !== activePlaybackShotRef.current) {
      activePlaybackShotRef.current = active.id;
      onSelectShot(active.id);
    }
    const audio = previewAudioRef.current;
    if (audio && active?.id === selectedShot?.id) audio.currentTime = Math.max(0, (next - selectedShotOffset) / 1000);
    if (next >= totalDuration) setIsPlaying(false);
  }

  function selectShotAndSeek(shotId: string) {
    setIsPlaying(false);
    activePlaybackShotRef.current = shotId;
    seekPlayback(playbackShotOffset(shots, shotId));
    onSelectShot(shotId);
  }

  function togglePreview() {
    setActionError('');
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const start = playbackMs >= totalDuration || playbackMs < selectedShotOffset || playbackMs >= selectedShotOffset + (selectedShot?.durationMs ?? 0)
      ? selectedShotOffset
      : playbackMs;
    seekPlayback(start);
    playbackClockRef.current = { originMs: start, originTime: performance.now() };
    setActiveStage('审片');
    setIsPlaying(true);
  }

  async function generateVoice(shotId: string) {
    setActionError('');
    setVoiceBusyShotId(shotId);
    try {
      if (!onGenerateVoice) throw new Error('当前工作流尚未接入旁白生成。');
      await onGenerateVoice(shotId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setVoiceBusyShotId('');
    }
  }

  async function renderProject() {
    setActionError('');
    setRenderBusy(true);
    try {
      if (!onRender) throw new Error('当前工作流尚未接入成片渲染。');
      await onRender();
      setActiveStage('导出');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenderBusy(false);
    }
  }

  async function openOutput() {
    setActionError('');
    setOutputBusy(true);
    try {
      if (!outputUrl || !onOpenOutput) throw new Error('请先生成成片，再打开导出目录。');
      await onOpenOutput();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setOutputBusy(false);
    }
  }

  function activateStage(stage: string) {
    setActiveStage(stage);
    if (stage === '配音字幕') setInspectorTab('subtitle');
    if (stage === '画面拆解' || stage === '素材一致性' || stage === '镜头生成' || stage === '导出') setInspectorTab('generate');
    if (stage === '素材一致性') setAssetTab('consistency');
    if (stage === '剧本') setInspectorTab('subtitle');
    if (stage === '导出' && !outputUrl) setActionError('请先完成镜头画面与旁白，再点击“生成成片”。');
    onStageChange?.(stage);
  }

  async function startGeneration(shotId: string) {
    const shot = shots.find((item) => item.id === shotId);
    if (!shot) return;
    setLocalGeneration((current) => ({ ...current, [shotId]: 'running' }));
    try {
      if (!onGenerateShot) throw new Error('当前工作流尚未接入镜头生成。');
      await onGenerateShot(shotId);
      setLocalGeneration((current) => { const next = { ...current }; delete next[shotId]; return next; });
    } catch (error) {
      setLocalGeneration((current) => ({ ...current, [shotId]: 'failed' }));
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  function retryGeneration(item: DirectorQueueItem) {
    void startGeneration(item.shotId);
  }

  return (
    <div className="director-desk" data-director-desk-mode={mode} data-left-pane-open={leftPaneOpen} data-inspector-open={inspectorOpen}>
      <header className="director-desk-header">
        <div className="director-brandline">
          {onBackToLibrary ? <IconButton label="返回工作流列表" icon={<ArrowLeft size={15} />} variant="subtle" density="compact" onClick={onBackToLibrary} /> : null}
          <div className="director-brand-mark"><Film size={16} aria-hidden="true" /></div>
          <strong className="director-wordmark">StoryDream</strong>
          {projects.length > 0 && onSelectProject ? <Menu
            trigger={<Button density="compact" variant="subtle" className="director-project-menu"><span><strong>{projectTitle || '未命名项目'}</strong><small>{projectMeta}</small></span><ChevronDown size={12} aria-hidden="true" /></Button>}
            options={projects.map((project) => ({ id: project.id, label: `${project.title} · ${project.meta}`, disabled: project.id === activeProjectId, onSelect: () => onSelectProject(project.id) }))}
          /> : <div className="director-project-crumb"><strong>{projectTitle || '未命名项目'}</strong><span>{projectMeta}</span></div>}
        </div>
        <nav className="director-stage-rail" aria-label="制作流程">
          {(['剧本', '画面拆解', '素材一致性', '镜头生成', '配音字幕', '审片', '导出'] as const).map((stage, index) => (
            <Button density="compact" variant="subtle" className={`director-stage-step ${stage === activeStage ? 'is-active' : completedStages.includes(stage) ? 'is-complete' : ''}`} key={stage} title={completedStages.includes(stage) ? `${stage} · 已完成` : `${stage} · 待完成`} onClick={() => activateStage(stage)}>
              <span className="director-stage-index">{completedStages.includes(stage) ? <Check size={11} /> : index + 1}</span>
              <span>{stage}</span>
              {stage === activeStage ? <small>{stageLabel}</small> : null}
            </Button>
          ))}
        </nav>
        <SegmentedControl label="工作模式" value={mode} options={modeOptions} onChange={onModeChange ?? (() => undefined)} className="director-mode-switch" />
        <div className="director-header-status">
          <span className={errorMessage ? 'director-status-dot is-error' : providerConnected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} />
          <span role={errorMessage ? 'alert' : undefined}>{errorMessage ?? feedback ?? (providerConnected ? `${providerLabel} 已连接` : '等待图片服务')}</span>
          {!providerConnected && onConfigureProvider ? <Button className="director-provider-action" density="compact" variant="secondary" icon={<Settings2 size={13} />} onClick={onConfigureProvider}>配置图片服务</Button> : null}
          {onNewProject ? <IconButton label={mode === 'vox' ? '新建 VOX 项目' : '新建 AI 漫剧项目'} icon={<Plus size={15} />} variant="subtle" density="compact" onClick={onNewProject} /> : null}
          <IconButton className="director-pane-toggle director-pane-toggle--left" label="显示项目与镜头" icon={<PanelLeft size={15} />} variant="subtle" density="compact" onClick={() => setLeftPaneOpen((open) => !open)} />
          <IconButton className="director-pane-toggle director-pane-toggle--inspector" label="显示镜头检查器" icon={<PanelRight size={15} />} variant="subtle" density="compact" onClick={() => setInspectorOpen((open) => !open)} />
          <IconButton label="项目设置" icon={<Settings2 size={15} />} variant="subtle" density="compact" disabled={!onOpenSettings} onClick={onOpenSettings} />
          <IconButton label="保存版本" icon={busy ? <RefreshCw className="director-spin" size={15} /> : <Save size={15} />} variant={dirty ? 'primary' : 'subtle'} density="compact" disabled={!dirty || busy} onClick={onSave} />
          <Menu
            trigger={<IconButton label="更多操作" icon={<MoreHorizontal size={16} />} variant="subtle" density="compact" />}
            options={[
              ...(onNewProject ? [{ id: 'new-project', label: mode === 'vox' ? '新建 VOX 项目' : '新建 AI 漫剧项目', icon: <Plus size={14} />, onSelect: onNewProject }] : []),
              { id: 'save', label: dirty ? '保存当前版本' : '当前版本已保存', icon: <Save size={14} />, disabled: !dirty, onSelect: onSave },
              ...(onOpenOutput && outputUrl ? [{ id: 'output', label: '打开导出目录', icon: <Download size={14} />, disabled: outputBusy, onSelect: () => void openOutput() }] : []),
            ]}
          />
        </div>
      </header>

      <div className="director-desk-grid">
        <Pane as="aside" tone="subtle" className="director-left-pane" aria-label="项目与镜头">
          <div className="director-pane-heading"><strong>项目</strong><span>{projectMeta}</span></div>
          <div className="director-project-summary">
            <DirectorMediaImage src={previewCity} alt="项目封面" className="director-project-cover" />
            <div><strong>{projectTitle || '未命名项目'}</strong><span>{episodeTitle}</span><small>{shots.length} 镜头 · {formatDuration(totalDuration)}</small></div>
          </div>
          <div className="director-pane-heading director-pane-heading--section"><strong>集数</strong>{onAddEpisode ? <IconButton label="新增集数" icon={<Plus size={15} />} density="compact" variant="subtle" onClick={onAddEpisode} /> : null}</div>
          {episodes.length > 0 ? episodes.map((episode) => <Button key={episode.id} density="compact" variant="subtle" aria-pressed={episode.id === activeEpisodeId} className={`director-episode-row ${episode.id === activeEpisodeId ? 'is-active' : ''}`} onClick={() => onSelectEpisode?.(episode.id)}><span>{String(episode.number).padStart(2, '0')}</span><span><strong>{episode.title}</strong><small>{episode.meta}</small></span>{episode.id === activeEpisodeId ? <Check size={14} /> : null}</Button>) : <div className="director-episode-row is-active"><span>01</span><div><strong>{episodeTitle || '当前集'}</strong><small>当前工作集 · {shots.length} 镜头</small></div><Check size={14} /></div>}
          <div className="director-pane-heading director-pane-heading--section"><strong>镜头</strong><span>{filteredShots.length}/{shots.length}</span>{onAddShot ? <IconButton label="新增镜头" icon={<Plus size={15} />} density="compact" variant="subtle" onClick={onAddShot} /> : null}</div>
          <div className="director-shot-search"><TextField label="搜索镜头" value={shotSearch} onChange={(_, data) => setShotSearch(data.value)} placeholder="标题、场景或提示词" /></div>
          <div className="director-shot-list">
            {filteredShots.map((shot) => (
              <Button key={shot.id} density="compact" variant="subtle" aria-pressed={shot.id === selectedShot?.id} className={`director-shot-row ${shot.id === selectedShot?.id ? 'is-active' : ''}`} onClick={() => selectShotAndSeek(shot.id)}>
                <span className="director-shot-row__index">{String(shot.index).padStart(2, '0')}</span>
                <span className="director-shot-row__copy"><strong>{shot.title}</strong><small>{formatDuration(shot.durationMs)} · {shot.framing} · {directorShotStatusLabel(shot.status)}</small></span>
                <span className={`director-mini-status is-${shot.status ?? 'ready'}`} aria-label={directorShotStatusLabel(shot.status)} />
              </Button>
            ))}
          </div>
          <div className="director-left-footer"><span><ShieldCheck size={13} />一致性规则已启用</span><small>角色、场景、光线跨镜头锁定</small>{onAddScene ? <Button density="compact" variant="subtle" onClick={onAddScene}><Plus size={12} />新增场景</Button> : null}</div>
        </Pane>

        <main className="director-center-pane">
          {selectedShot ? (
            <>
              <div className="director-preview-toolbar">
                <div><strong>当前镜头：{String(selectedShot.index).padStart(2, '0')} {selectedShot.title}</strong><span>{selectedShot.scene} · {selectedShot.framing}</span></div>
                <Toolbar aria-label="预览工具">
                  <Menu
                    trigger={<Button density="compact" variant="subtle" className="director-preview-ratio">{ratio.split(':')[0]}:{ratio.split(':')[1]} <ChevronDown size={12} /></Button>}
                    options={(['9:16', '16:9', '1:1', '4:3'] as const).map((option) => ({ id: option, label: option, onSelect: () => onRatioChange?.(option) }))}
                  />
                  <Button aria-label={safeAreaVisible ? '隐藏安全区' : '显示安全区'} density="compact" variant={safeAreaVisible ? 'secondary' : 'subtle'} className="director-preview-safe" onClick={() => setSafeAreaVisible((value) => !value)}><ShieldCheck size={13} />安全区</Button>
                  <IconButton label="预览设置" icon={<Settings2 size={14} />} density="compact" variant="subtle" onClick={() => setPreviewSettingsOpen(true)} />
                </Toolbar>
              </div>
              <section ref={previewRef} className="director-media-preview" aria-label="镜头预览">
                {showingRenderedVideo ? <video key={outputUrl} controls playsInline preload="metadata" src={outputUrl} aria-label={`${projectTitle}成片预览`} onError={() => setActionError('成片无法播放，请重新生成或检查导出文件。')} /> : (
                  <>
                    <DirectorMediaImage src={selectedShot.thumbnail ?? previewCity} alt={`${selectedShot.title}预览`} className={isPlaying ? 'is-playing' : undefined} showStatus={false} onStatusChange={setPreviewImageStatus} loadingLabel="正在恢复镜头画面" errorLabel="画面加载失败" />
                    {previewImageStatus !== 'ready' ? <div className={`director-media-state is-${previewImageStatus}`} role={previewImageStatus === 'error' ? 'alert' : 'status'}>{previewImageStatus === 'error' ? <ImageOff size={18} /> : <RefreshCw className="director-spin" size={18} />}{previewImageStatus === 'error' ? '画面加载失败' : '正在恢复镜头画面'}</div> : null}
                    {safeAreaVisible ? <div className="director-safe-area" aria-hidden="true" /> : null}
                    <div className="director-preview-kicker"><span>{mode === 'vox' ? 'VOX' : 'AI 漫剧'} / {String(selectedShot.index).padStart(2, '0')}</span><span>{ratioLabel(ratio)}</span></div>
                    <div className="director-preview-copy"><div className="director-preview-title">{projectTitle}</div><div className="director-preview-caption">{selectedShot.subtitle || '从信仰之城到现代化都市，变化正在发生。'}</div></div>
                    {activeStage !== '导出' ? <div className="director-preview-transport"><IconButton label={isPlaying ? '暂停' : '播放'} icon={isPlaying ? <Pause size={15} /> : <Play size={15} />} density="compact" variant="subtle" onClick={togglePreview} /><span className="director-timecode">{formatPlaybackTime(playbackMs)} / {formatPlaybackTime(totalDuration)}</span><SliderField fieldClassName="director-scrub-field" label="播放进度" min={0} max={Math.max(1, totalDuration)} step={100} value={Math.min(playbackMs, Math.max(1, totalDuration))} onChange={(_, data) => seekPlayback(Number(data.value))} /><IconButton label={muted ? '打开声音' : '静音'} icon={<Volume2 size={14} />} density="compact" variant="subtle" onClick={() => setMuted((value) => !value)} /><IconButton label="全屏" icon={<MoreHorizontal size={14} />} density="compact" variant="subtle" onClick={() => void previewRef.current?.requestFullscreen?.()} /></div> : null}
                    {selectedShot.audioUrl ? <audio ref={previewAudioRef} key={selectedShot.audioUrl} src={selectedShot.audioUrl} preload="metadata" /> : null}
                  </>
                )}
              </section>
              <section className="director-filmstrip-section" aria-label="分镜胶片条">
                <div className="director-section-bar"><strong>分镜胶片</strong><span>{shots.length} 个镜头 · {formatDuration(totalDuration)}</span>{shotSearch ? <IconButton label="清除镜头搜索" icon={<Search size={14} />} density="compact" variant="subtle" onClick={() => setShotSearch('')} /> : null}</div>
                <div className="director-filmstrip">
                  {filteredShots.map((shot, index) => (
                    <Button key={shot.id} aria-label={`选择镜头 ${String(shot.index).padStart(2, '0')} ${shot.title}`} density="compact" variant="subtle" aria-pressed={shot.id === selectedShot.id} className={`director-filmstrip-card ${shot.id === selectedShot.id ? 'is-active' : ''}`} onClick={() => selectShotAndSeek(shot.id)}>
                       <span className="director-filmstrip-image"><DirectorMediaImage src={shot.thumbnail ?? filmstripImages[index % filmstripImages.length]} alt="" /><small>{String(shot.index).padStart(2, '0')}</small></span>
                       <span className="director-filmstrip-meta"><small><Clock3 size={11} />{formatDuration(shot.durationMs)} <span className="director-mini-status-label">{directorShotStatusLabel(shot.status)}</span></small></span>
                    </Button>
                  ))}
                </div>
              </section>
              <section className="director-assets-section" aria-label="素材架">
                  <div className="director-assets-heading">
                    <Tabs label="素材分类" items={assetTabItems} value={assetTab} onChange={(value) => setAssetTab(value as DirectorAssetTab)} className="director-asset-tabs" />
                    <div className="director-asset-search"><TextField label="搜索素材" value={assetSearch} onChange={(_, data) => setAssetSearch(data.value)} placeholder="名称或类型" /></div>
                </div>
                <div className={`director-asset-workspace ${assetTab === 'narrator' ? '' : 'is-filtered'}`}>
                  {assetTab === 'narrator' ? (
                    <div className="director-narrator-card">
                      <div className="director-narrator-profile">
                        <img src={shotTeahouse} alt="当前旁白角色" />
                        <div><strong>{selectedShot.voice || '李立宏（男声）'}</strong><span>{voiceConnected ? '已连接' : '待配置'}</span><small>语言：中文　音色：沉稳</small></div>
                      </div>
                      <div className="director-narrator-transport">
                        <IconButton label={selectedShot.audioUrl ? '播放旁白' : '生成旁白'} icon={voiceBusyShotId === selectedShot.id ? <RefreshCw className="director-spin" size={14} /> : <Play size={14} />} density="compact" variant="subtle" disabled={voiceBusyShotId === selectedShot.id || (!selectedShot.audioUrl && !voiceConnected)} onClick={() => selectedShot.audioUrl ? void togglePreview() : void generateVoice(selectedShot.id)} />
                        <div className="director-waveform" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
                        <small>{selectedShot.audioUrl ? '旁白已生成' : '等待生成'}</small>
                      </div>
                    </div>
                  ) : null}
                  <div className="director-asset-grid director-asset-gallery">
                    {visibleAssets.slice(0, 9).map((asset) => (
                      <Button key={asset.id} density="compact" variant="subtle" aria-pressed={asset.selected} className={`director-asset-tile ${asset.selected ? 'is-selected' : ''}`} disabled={asset.selectable === false} onClick={() => onToggleAsset?.(asset)}>
                        <span className="director-asset-thumb"><DirectorMediaImage src={asset.thumbnail} alt="" />{asset.locked ? <LockKeyhole size={12} /> : null}</span>
                        <span><strong>{asset.label}</strong><small>{asset.warning ?? asset.type}</small></span>
                      </Button>
                    ))}
                    {visibleAssets.length === 0 ? <div className="director-assets-empty">当前分类暂无素材</div> : null}
                  </div>
                </div>
                <div className="director-source-warning"><CircleAlert size={14} /><span>部分素材来源版权未确认，请在发布前完成版权核查。</span><Button density="compact" variant="subtle" onClick={() => setAssetTab('consistency')}>查看详情</Button></div>
              </section>
            </>
          ) : <div className="director-empty-state"><Film size={32} /><strong>还没有镜头</strong><span>先从剧本或分集结构生成镜头板。</span></div>}
        </main>

        <Pane as="aside" tone="base" className="director-inspector-pane" aria-label="镜头检查器">
          {selectedShot ? (
            <>
              <Tabs label="镜头设置" items={tabItems} value={inspectorTab} onChange={(value) => setInspectorTab(value as DirectorInspectorTab)} />
              <div className="director-inspector-scroll">
                {inspectorTab === 'mode' ? <MotionInspector shot={selectedShot} onUpdate={onUpdateShot} /> : null}
                {inspectorTab === 'generate' ? (
                  <>
                    <FrameInspector shot={selectedShot} onUpdate={onUpdateShot} />
                    <div className="director-inspector-actions">
                      <div className="director-provider-line"><span className={providerConnected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} />{providerConnected ? `${providerLabel} 已连接` : '图片服务未连接'}<span className="director-cost">{(selectedShot.cost ?? estimatedCost) > 0 ? `约 ¥ ${(selectedShot.cost ?? estimatedCost).toFixed(2)}` : '以接口账单为准'}</span></div>
                      <SelectField label="生成服务" value={providerProfileId ?? providerLabel} options={providerOptions.length > 0 ? providerOptions : [{ value: providerLabel, label: `${providerLabel} · ${providerModel} · ${providerResolution}` }]} disabled={busy || !onProviderProfileChange} onChange={(event) => void onProviderProfileChange?.(event.target.value)} />
                      <GenerationDetails shot={selectedShot} ratio={ratio} onUpdate={onUpdateShot} onRatioChange={onRatioChange} />
                       {!providerConnected && providerUnavailableReason ? <div className="director-inspector-note is-warning"><CircleAlert size={14} /><span>{providerUnavailableReason}</span>{onConfigureProvider ? <Button density="compact" variant="secondary" onClick={onConfigureProvider}>配置图片服务</Button> : null}</div> : null}
                      {actionError ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>{actionError}</span></div> : null}
                      <div className="director-action-footer">
                        <div className="director-seed-row"><TextField label="Seed 锁定" value={selectedShot.seed ?? '24681357'} readOnly={selectedShot.seedLocked ?? seedLocked} onChange={(_, data) => onUpdateShot(selectedShot.id, { seed: data.value })} /><Button density="compact" variant={(selectedShot.seedLocked ?? seedLocked) ? 'secondary' : 'subtle'} onClick={() => { const next = !(selectedShot.seedLocked ?? seedLocked); setSeedLocked(next); onUpdateShot(selectedShot.id, { seedLocked: next }); }}><LockKeyhole size={13} />{(selectedShot.seedLocked ?? seedLocked) ? '已锁定' : '未锁定'}</Button></div>
                        <Button className="director-primary-action" variant="primary" density="comfortable" onClick={() => void startGeneration(selectedShot.id)} disabled={busy || !providerConnected || selectedQueueItem?.status === 'running'}><WandSparkles size={15} />生成当前镜头</Button>
                        <div className="director-secondary-actions"><Button density="compact" variant="subtle" onClick={togglePreview}>{isPlaying ? <Pause size={13} /> : <Play size={13} />}{isPlaying ? '暂停' : '预览'}</Button><Button density="compact" variant="subtle" onClick={() => onSave()}><Save size={13} />保存版本</Button><Button density="compact" variant="secondary" disabled={renderBusy} onClick={() => void renderProject()}>{renderBusy ? <RefreshCw className="director-spin" size={13} /> : <Film size={13} />}生成成片</Button>{onOpenOutput ? <IconButton label="打开导出目录" icon={outputBusy ? <RefreshCw className="director-spin" size={14} /> : <Download size={14} />} density="compact" variant="subtle" disabled={!outputUrl || outputBusy} onClick={() => void openOutput()} /> : null}</div>
                      </div>
                    </div>
                  </>
                ) : null}
                {inspectorTab === 'subtitle' ? <div className="director-subtitle-workspace"><VoiceInspector shot={selectedShot} onUpdate={onUpdateShot} connected={voiceConnected} providerLabel={voiceProviderLabel} model={voiceModel} unavailableReason={voiceUnavailableReason} voiceOptions={voiceOptions} busy={voiceBusyShotId === selectedShot.id} onGenerate={() => void generateVoice(selectedShot.id)} /><SubtitleInspector shot={selectedShot} onUpdate={onUpdateShot} safeAreaVisible={safeAreaVisible} onSafeAreaChange={setSafeAreaVisible} /></div> : null}
                {inspectorTab === 'version' ? <VersionInspector shot={selectedShot} versions={versions} dirty={dirty} onSave={onSave} onRestoreVersion={onRestoreVersion} /> : null}
              </div>
              <QueuePanel queue={queue} onRetry={retryGeneration} />
            </>
          ) : <div className="director-empty-state"><ImageIcon size={28} /><strong>选择一个镜头</strong><span>右侧会显示画面、动效、旁白和字幕参数。</span></div>}
        </Pane>
      </div>
      <footer className="director-status-footer" aria-label="项目状态">
        <span><span className={`director-status-dot is-${systemStatusTone}`} />{systemStatus}</span>
        <span><HardDrive size={12} />本地项目 · {dirty ? '有未保存改动' : '已保存'}</span>
        <span>今日日期：{formatLocalDate(new Date())}</span>
        <span>版本：1.0.0</span>
      </footer>
      <Dialog
        open={previewSettingsOpen}
        title="预览设置"
        onOpenChange={setPreviewSettingsOpen}
        actions={<Button variant="primary" onClick={() => setPreviewSettingsOpen(false)}>完成</Button>}
      >
        <div className="director-dialog-stack">
          <CheckboxField label="显示安全区" checked={safeAreaVisible} onChange={(_, data) => setSafeAreaVisible(Boolean(data.checked))} />
          <SelectField label="预览画幅" value={ratio} options={(['9:16', '16:9', '1:1', '4:3'] as const).map((option) => ({ value: option, label: option }))} onChange={(event) => onRatioChange?.(event.target.value as NonNullable<DirectorDeskWorkspaceProps['ratio']>)} />
          <div className="director-inspector-note"><BookOpenText size={14} /><span>预览比例会同步到项目并影响下一次成片画布。</span></div>
        </div>
      </Dialog>
    </div>
  );
}

function DirectorMediaImage({ src, alt, className, showStatus = true, loadingLabel = '正在加载素材', errorLabel = '素材加载失败', onStatusChange }: { src: string; alt: string; className?: string; showStatus?: boolean; loadingLabel?: string; errorLabel?: string; onStatusChange?: (status: 'loading' | 'ready' | 'error') => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    setStatus('loading');
    onStatusChange?.('loading');
  }, [onStatusChange, src]);
  const updateStatus = (next: 'ready' | 'error') => {
    setStatus(next);
    onStatusChange?.(next);
  };
  return <span className={`director-media-image is-${status}`}>
    <img className={className} src={src} alt={alt} onLoad={() => updateStatus('ready')} onError={() => updateStatus('error')} />
    {showStatus && status !== 'ready' ? <span className="director-media-image__state" role={status === 'error' ? 'alert' : 'status'}>{status === 'error' ? <ImageOff size={13} /> : <RefreshCw className="director-spin" size={13} />}{status === 'error' ? errorLabel : loadingLabel}</span> : null}
  </span>;
}

function directorShotStatusLabel(status: DirectorShotStatus = 'ready'): string {
  if (status === 'generating') return '生成中';
  if (status === 'queued') return '排队中';
  if (status === 'failed') return '失败';
  return '已生成';
}

function FrameInspector({ shot, onUpdate }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'] }) {
  return <div className="director-form-stack"><TextAreaField fieldClassName="director-prompt-field" label="编辑提示词" value={shot.prompt} onChange={(_, data) => onUpdate(shot.id, { prompt: data.value })} resize="vertical" hint={`${shot.prompt.length} / 1000`} /><SelectField label="版式模板" value={shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂'} options={[{ value: '对比拼贴 · 纸张撕裂', label: '对比拼贴 · 纸张撕裂' }, { value: '纪录片 · 纯画面', label: '纪录片 · 纯画面' }, { value: '漫画分格 · 角色优先', label: '漫画分格 · 角色优先' }]} onChange={(event) => onUpdate(shot.id, { layoutTemplate: event.target.value as DirectorLayoutTemplate })} /><SelectField label="运动控制" value={shot.motionPreset ?? '平移 + 缓慢推进'} options={[{ value: '平移 + 缓慢推进', label: '平移 + 缓慢推进' }, { value: '轻微视差', label: '轻微视差' }, { value: '固定机位', label: '固定机位' }]} onChange={(event) => onUpdate(shot.id, { motionPreset: event.target.value as DirectorMotionPreset })} /></div>;
}

function GenerationDetails({ shot, ratio, onUpdate, onRatioChange }: { shot: DirectorShot; ratio: DirectorDeskWorkspaceProps['ratio']; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot']; onRatioChange?: DirectorDeskWorkspaceProps['onRatioChange'] }) {
  const voice = shot.voice || '李立宏（男声）';
  const subtitleStyle = shot.subtitleStyle ?? '简体中文 · 白色描边';
  return <div className="director-form-stack director-generation-details"><SelectField label="画面比例" value={ratio ?? '16:9'} options={(['9:16', '16:9', '1:1', '4:3'] as const).map((option) => ({ value: option, label: ratioLabel(option) }))} onChange={(event) => onRatioChange?.(event.target.value as NonNullable<DirectorDeskWorkspaceProps['ratio']>)} /><div className="director-two-col"><TextField label="时长" value={formatDuration(shot.durationMs)} readOnly /><TextField label="帧率" value="24 fps" readOnly /></div><SelectField label="配音" value={voice} options={[{ value: voice, label: voice }]} onChange={(event) => onUpdate(shot.id, { voice: event.target.value })} /><SelectField label="字幕样式" value={subtitleStyle} options={[{ value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' }, { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' }]} onChange={(event) => onUpdate(shot.id, { subtitleStyle: event.target.value })} /></div>;
}

function MotionInspector({ shot, onUpdate }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'] }) {
  return <div className="director-form-stack"><TextAreaField fieldClassName="director-prompt-field" label="运动提示词" value={shot.motionPrompt} onChange={(_, data) => onUpdate(shot.id, { motionPrompt: data.value })} resize="vertical" /><SelectField label="运动控制" value={shot.motionPreset ?? '平移 + 缓慢推进'} options={[{ value: '平移 + 缓慢推进', label: '平移 + 缓慢推进' }, { value: '轻微视差', label: '轻微视差' }, { value: '固定机位', label: '固定机位' }]} onChange={(event) => onUpdate(shot.id, { motionPreset: event.target.value as DirectorMotionPreset })} /><div className="director-two-col"><TextField label="起始缩放" value={shot.motionPreset === '固定机位' ? '100%' : '100%'} readOnly /><TextField label="结束缩放" value={shot.motionPreset === '轻微视差' ? '103%' : shot.motionPreset === '固定机位' ? '100%' : '106%'} readOnly /></div><div className="director-inspector-note"><Gauge size={14} /><span>建议保持运动幅度克制，避免文字和主体离开安全区。</span></div></div>;
}

function VoiceInspector({
  shot,
  onUpdate,
  connected,
  providerLabel,
  model,
  unavailableReason,
  voiceOptions,
  busy,
  onGenerate,
}: {
  shot: DirectorShot;
  onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'];
  connected: boolean;
  providerLabel: string;
  model: string;
  unavailableReason?: string;
  voiceOptions: readonly { value: string; label: string }[];
  busy: boolean;
  onGenerate: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selectedVoiceId = shot.voiceId || voiceOptions[0]?.value || '';
  const selectedVoiceLabel = voiceOptions.find((voice) => voice.value === selectedVoiceId)?.label ?? shot.voice ?? selectedVoiceId;
  const speed = shot.voiceSpeed ?? 1;
  const play = () => {
    if (shot.audioUrl && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play();
      return;
    }
    onGenerate();
  };
  return <div className="director-form-stack"><div className="director-provider-line"><span className={connected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} />{connected ? `${providerLabel} · ${model}` : '旁白服务未连接'}</div><SelectField label="配音角色" value={selectedVoiceId} options={voiceOptions.length ? [...voiceOptions] : [{ value: selectedVoiceId, label: selectedVoiceLabel || '未配置音色' }]} disabled={!connected || busy} onChange={(event) => { const option = voiceOptions.find((voice) => voice.value === event.target.value); onUpdate(shot.id, { voiceId: event.target.value, voice: option?.label ?? event.target.value }); }} /><div className="director-voice-preview"><IconButton label={shot.audioUrl ? '播放旁白' : '生成旁白'} icon={busy ? <RefreshCw className="director-spin" size={13} /> : <Play size={13} />} density="compact" variant="subtle" disabled={!connected || busy} onClick={play} /><div className="director-waveform"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><small>{shot.audioUrl ? '旁白已生成' : '等待生成'}</small>{shot.audioUrl ? <audio ref={audioRef} src={shot.audioUrl} preload="metadata" /> : null}</div><SelectField label="语速" value={String(speed)} options={[{ value: '0.98', label: '0.98x' }, { value: '1', label: '1.00x' }, { value: '1.05', label: '1.05x' }]} disabled={!connected || busy} onChange={(event) => onUpdate(shot.id, { voiceSpeed: Number(event.target.value) })} />{!connected && unavailableReason ? <div className="director-inspector-note is-warning"><CircleAlert size={14} /><span>{unavailableReason}</span></div> : null}<Button density="compact" variant={shot.audioUrl ? 'subtle' : 'secondary'} disabled={!connected || busy || !shot.subtitle.trim()} onClick={shot.audioUrl ? play : onGenerate}>{busy ? <RefreshCw className="director-spin" size={13} /> : <Volume2 size={13} />}{shot.audioUrl ? '试听旁白' : '生成并试听旁白'}</Button></div>;
}

function SubtitleInspector({ shot, onUpdate, safeAreaVisible, onSafeAreaChange }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot']; safeAreaVisible: boolean; onSafeAreaChange: (value: boolean) => void }) {
  return <div className="director-form-stack"><TextAreaField fieldClassName="director-prompt-field" label="字幕内容" value={shot.subtitle} onChange={(_, data) => onUpdate(shot.id, { subtitle: data.value })} resize="vertical" /><SelectField label="字幕样式" value={shot.subtitleStyle ?? '简体中文 · 白色描边'} options={[{ value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' }, { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' }]} onChange={(event) => onUpdate(shot.id, { subtitleStyle: event.target.value })} /><CheckboxField label="显示安全区提示" checked={safeAreaVisible} onChange={(_, data) => onSafeAreaChange(Boolean(data.checked))} /><div className="director-inspector-note"><Flag size={14} /><span>字幕 cue 与视觉镜头独立保存，不会增加镜头数量。</span></div></div>;
}

function VersionInspector({ shot, versions, dirty, onSave, onRestoreVersion }: { shot: DirectorShot; versions: readonly DirectorVersion[]; dirty: boolean; onSave: () => void; onRestoreVersion?: (versionId: string) => void }) {
  return <div className="director-version-panel"><div><strong>当前镜头版本</strong><span>镜头 {String(shot.index).padStart(2, '0')} · {shot.provider || '本地草稿'}</span></div><div className="director-inspector-note"><HardDrive size={14} /><span>生成记录会保留在项目中，可恢复任意已生成画面。</span></div><Button density="compact" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={onSave}><Save size={13} />{dirty ? '保存当前版本' : '版本已保存'}</Button><div className="director-version-list">{versions.length === 0 ? <span>当前镜头还没有历史版本。</span> : versions.map((version) => <Button key={version.id} density="compact" variant={version.selected ? 'secondary' : 'subtle'} aria-pressed={version.selected} onClick={() => onRestoreVersion?.(version.id)}><span>{version.label}</span><small>{version.provider ?? '本地'} · {formatVersionDate(version.createdAt)}</small></Button>)}</div></div>;
}

function QueuePanel({ queue, onRetry }: { queue: readonly DirectorQueueItem[]; onRetry: (item: DirectorQueueItem) => void }) {
  return <section className="director-queue-panel" aria-label="生成队列"><div className="director-queue-heading"><strong>生成队列 ({queue.length})</strong><div><span>进行中 {queue.filter((item) => item.status === 'running').length}</span><span>失败 {queue.filter((item) => item.status === 'failed').length}</span></div></div>{queue.map((item) => <div className={`director-queue-item is-${item.status}`} key={item.id}><img src={item.thumbnail ?? imageForShot(item.shotId)} alt="" /><div className="director-queue-copy"><strong>{item.title}</strong><span title={item.error}>{item.status === 'failed' ? item.error : item.status === 'completed' ? `已完成 · ${item.provider}` : item.status === 'waiting' ? '等待生成' : '生成中 · 以接口状态为准'}</span><div className="director-progress"><i className={item.status === 'running' ? 'is-indeterminate' : undefined} style={item.status === 'running' ? undefined : { width: `${item.progress}%` }} /></div></div>{item.status === 'failed' ? <Button density="compact" variant="danger" onClick={() => onRetry(item)}><RotateCcw size={12} />重试</Button> : item.status === 'running' ? <RefreshCw className="director-spin" size={13} /> : item.status === 'completed' ? <Check size={15} className="director-queue-ok" /> : <Clock3 size={15} />}</div>)}</section>;
}

function createQueue(shots: readonly DirectorShot[]): DirectorQueueItem[] {
  return shots.slice(0, 3).map((shot) => ({
    id: `queue-${shot.id}`,
    shotId: shot.id,
    title: shot.title,
    status: shot.status === 'ready' ? 'completed' : shot.status === 'generating' ? 'running' : shot.status === 'failed' ? 'failed' : 'waiting',
    progress: shot.status === 'ready' ? 100 : 0,
    cost: shot.cost ?? 0,
    provider: shot.provider ?? '尚未生成',
    thumbnail: shot.thumbnail,
    error: shot.status === 'failed' ? '上一次生成失败，请重试并查看接口返回。' : undefined,
  }));
}

function imageForShot(id: string): string {
  const hash = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return filmstripImages[hash % filmstripImages.length];
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs / 100) / 10}s`;
}

function formatLocalDate(value: Date): string {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-');
}

function formatVersionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知时间' : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function ratioLabel(ratio: NonNullable<DirectorDeskWorkspaceProps['ratio']>): string {
  if (ratio === '9:16') return '9:16 (1080x1920)';
  if (ratio === '1:1') return '1:1 (2048x2048)';
  if (ratio === '4:3') return '4:3 (2048x1536)';
  return '16:9 (1920x1080)';
}

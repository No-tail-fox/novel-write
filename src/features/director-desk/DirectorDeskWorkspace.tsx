import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { formatAppErrorMessage, normalizeAppError, type AppError } from '../../shared/app-error';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
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
  History,
  Image as ImageIcon,
  ImageOff,
  LocateFixed,
  Layers3,
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
  Trash2,
  Save,
  Search,
  Scissors,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
  Video,
  WandSparkles,
  X,
  Maximize2,
} from 'lucide-react';
import { directorPhases, directorPhaseForStage, directorPhaseComplete } from './director-workspace-navigation';
import { Button, CheckboxField, Dialog, IconButton, Menu, Pane, SegmentedControl, SelectField, SliderField, Tabs, TextAreaField, TextField, Toolbar } from '../../ui';
import { clampPlaybackTime, formatPlaybackTime, playbackShotAt, playbackShotOffset } from './director-playback';
import { canConfirmDirectorQualityReport, directorCanvasForRatio } from '../../shared/director-render';
import { DirectorSubtitleInspector, DirectorSubtitlePreview, type DirectorSubtitleCue, type DirectorSubtitlePatch } from './DirectorSubtitleInspector';
import { DirectorAudioPreview, type DirectorPreviewAudioClip } from './DirectorAudioPreview';
import { DirectorSoundInspector } from './DirectorSoundInspector';
import { DirectorMotionInspector } from './DirectorMotionInspector';
import { DirectorVisualEvidence } from './DirectorVisualEvidence';
import { DirectorHistoryPager, useDirectorHistoryPage } from './DirectorHistoryPager';
import type { EditorialMotionEdit } from '../../shared/editorial-collage';
import type { DirectorSoundInspectorProps } from './DirectorSoundInspector';
import type { DirectorSoundClip } from './director-sound';
import {
  createDirectorBatchController,
  createDirectorBatchPlan,
  directorBatchCapabilityLabel,
  directorBatchHistoryDemand,
  directorBatchStatusLabel,
  runDirectorBatchPlan,
  type DirectorBatchCapability,
  type DirectorBatchController,
  type DirectorBatchNode,
  type DirectorBatchScope,
} from './director-batch';
import '../../styles/features/director-desk.css';
import { createDirectorRequestGate } from './director-request-gate';
import type { CreateDirectorBatchInput, DirectorBatchRecord, UpdateDirectorBatchInput } from '../../shared/director-batch-persistence';
import type { ProductionQualityManualReview, ProductionQualityRecheckScope } from '../../shared/production-workflow';
import type { DirectorSubtitleRecheckRequest, DirectorMediaRecheckRequest } from '../../shared/director-render';
import type { DirectorQualityReview } from '../../shared/director-render';
import { resolveProductionQualityRecheckScope } from '../../shared/production-quality-recheck';
import { MAX_PRODUCTION_HISTORY_ITEMS, productionHistoryCapacityError, type ProductionHistoryUsage } from '../../shared/production-history';
import { directorSceneLayoutClass, directorSceneSubtitleClass } from '../../shared/director-scene-layout';

export type DirectorDeskMode = 'vox' | 'motion-comic';
export type DirectorInspectorTab = 'mode' | 'generate' | 'subtitle' | 'sound' | 'version' | 'quality';
export type DirectorShotStatus = 'ready' | 'generating' | 'queued' | 'failed';
export const DIRECTOR_RENDER_STRATEGIES = ['deterministic-layers', 'living-poster'] as const;
export type DirectorRenderStrategy = (typeof DIRECTOR_RENDER_STRATEGIES)[number];
export type DirectorVideoJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type DirectorStageName = '剧本' | '画面拆解' | '素材一致性' | '镜头生成' | '配音字幕' | '审片' | '导出';
type DirectorAssetTab = 'narrator' | 'places' | 'history' | 'style' | 'consistency';
type DirectorBatchRunState = 'idle' | 'starting' | 'running' | 'paused' | 'cancelling' | 'finished';

export interface DirectorLayerKeyframe {
  atMs: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface DirectorCameraKeyframe {
  atMs: number;
  x: number;
  y: number;
  zoom: number;
}

export interface DirectorPreviewLayer {
  id: string;
  label: string;
  src: string;
  zIndex: number;
  visible?: boolean;
  depth: number;
  motion: readonly DirectorLayerKeyframe[];
}

export interface DirectorShot {
  id: string;
  index: number;
  beatIndex?: number;
  title: string;
  scene: string;
  durationMs: number;
  framing: string;
  characterLabel: string;
  prompt: string;
  motionPrompt: string;
  subtitle: string;
  subtitleCues?: readonly DirectorSubtitleCue[];
  dialogueCharacters?: readonly { value: string; label: string }[];
  thumbnail?: string;
  status?: DirectorShotStatus;
  provider?: string;
  cost?: number;
  voice?: string;
  voiceId?: string;
  voiceSpeed?: number;
  audioUrl?: string;
  audioClips?: readonly DirectorPreviewAudioClip[];
  soundClips?: readonly DirectorSoundClip[];
  imageReady?: boolean;
  voiceReady?: boolean;
  voiceGenerationCount?: number;
  imageFailed?: boolean;
  voiceFailed?: boolean;
  subtitleStyle?: string;
  layoutTemplate?: DirectorLayoutTemplate;
  motionPreset?: DirectorMotionPreset;
  seed?: string;
  seedLocked?: boolean;
  linkedAssetIds?: readonly string[];
  assetVersionIds?: readonly string[];
  renderStrategy?: DirectorRenderStrategy;
  previewLayers?: readonly DirectorPreviewLayer[];
  cameraKeyframes?: readonly DirectorCameraKeyframe[];
  videoInputReady?: boolean;
  videoInputUnavailableReason?: string;
  videoUrl?: string;
  videoJobId?: string;
  videoJobStatus?: DirectorVideoJobStatus;
  videoJobError?: string;
  videoEstimatedCost?: number;
}

export interface DirectorAsset {
  id: string;
  label: string;
  type: string;
  thumbnail?: string;
  locked?: boolean;
  warning?: string;
  category?: DirectorAssetTab;
  sourceVersionId?: string;
  selected?: boolean;
  selectable?: boolean;
}

export interface DirectorStyleCandidate {
  id: string;
  label: string;
  prompt: string;
  assetVersionId?: string;
  thumbnail?: string;
  selected: boolean;
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
  beatCount?: number;
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
  videoProviderConnected?: boolean;
  videoProviderLabel?: string;
  videoProviderModel?: string;
  videoProviderUnavailableReason?: string;
  videoProviderId?: string;
  videoProviderOptions?: readonly DirectorProviderOption[];
  outputUrl?: string;
  outputHistory?: Array<{ id: string; url?: string; createdAt: string; current: boolean }>;
  qualityReview?: DirectorQualityReview;
  projectId?: string;
  expectedUpdatedAt?: string;
  styleCandidates?: readonly DirectorStyleCandidate[];
  selectedStyleId?: string;
  ratio?: '9:16' | '16:9' | '1:1' | '4:3';
  projects?: readonly DirectorProjectOption[];
  activeProjectId?: string;
  episodes?: readonly DirectorEpisodeOption[];
  activeEpisodeId?: string;
  versions?: readonly DirectorVersion[];
  jobs?: readonly DirectorQueueItem[];
  batchPersistence?: {
    list: (options?: { projectId?: string; episodeId?: string | null; statuses?: readonly DirectorBatchRecord['status'][] }) => Promise<DirectorBatchRecord[]>;
    create: (input: CreateDirectorBatchInput) => Promise<DirectorBatchRecord>;
    update: (id: string, patch: UpdateDirectorBatchInput) => Promise<DirectorBatchRecord>;
  };
  historyUsage?: ProductionHistoryUsage;
  onSelectShot: (id: string) => void;
  onUpdateShot: (id: string, update: Partial<Pick<DirectorShot, 'title' | 'prompt' | 'motionPrompt' | 'framing' | 'durationMs' | 'voice' | 'voiceId' | 'voiceSpeed' | 'subtitle' | 'subtitleStyle' | 'layoutTemplate' | 'motionPreset' | 'seed' | 'seedLocked' | 'renderStrategy'>>) => void;
  onUpdateShotMotion?: (id: string, edit: EditorialMotionEdit) => void;
  onUpdateSubtitleCue?: (shotId: string, cueId: string, patch: DirectorSubtitlePatch) => void;
  onAddSubtitleCue?: (shotId: string) => void;
  onRemoveSubtitleCue?: (shotId: string, cueId: string) => void;
  onAlignSubtitleCue?: (shotId: string, cueId: string) => void;
  onImportSubtitleTimestamps?: (shotId: string, cueId: string) => void;
  onUpdateSoundClip?: (shotId: string, ...args: Parameters<DirectorSoundInspectorProps['onUpdate']>) => void;
  onRemoveSoundClip?: (shotId: string, clipId: string) => void;
  onImportSound?: (shotId: string, track: Parameters<DirectorSoundInspectorProps['onImport']>[0]) => Promise<void>;
  onSave: () => void;
  onNewProject?: () => void;
  onSelectProject?: (id: string) => void;
  onSelectEpisode?: (id: string) => void;
  onAddEpisode?: () => void;
  onAddScene?: () => void;
  onAddShot?: () => void;
  onRemoveShot?: (shotId: string) => void;
  onMoveShot?: (direction: 'up' | 'down') => void;
  onSplitShot?: () => void;
  onMergeShot?: () => void;
  onAddBeat?: () => void;
  onRemoveBeat?: () => void;
  onMoveBeat?: (direction: 'up' | 'down') => void;
  onRatioChange?: (ratio: NonNullable<DirectorDeskWorkspaceProps['ratio']>) => void;
  onToggleAsset?: (asset: DirectorAsset) => void;
  onSelectStyle?: (styleId: string) => void;
  onRestoreVersion?: (versionId: string) => void;
  onBackToTasks?: () => void;
  backToTasksLabel?: string;
  onStageChange?: (stage: string) => void;
  onGenerateShot?: (id: string) => Promise<DirectorGenerationResult>;
  onGenerateStyleCandidate?: (styleId: string) => Promise<DirectorGenerationResult>;
  onProviderProfileChange?: (profileId: string) => void | Promise<void>;
  onGenerateVoice?: (id: string) => Promise<DirectorVoiceResult>;
  onGenerateDialogueVoice?: (id: string, cueId: string) => Promise<DirectorVoiceResult>;
  onGenerateVideo?: (id: string) => Promise<DirectorVideoResult>;
  onRetryVideo?: (id: string) => Promise<DirectorVideoResult>;
  onVideoProviderChange?: (providerId: string) => void | Promise<void>;
  onRender?: () => Promise<void>;
  onRecheckSubtitles?: (input: DirectorSubtitleRecheckRequest) => Promise<void>;
  onRecheckMedia?: (input: DirectorMediaRecheckRequest) => Promise<void>;
  onConfirmQualityReview?: (input: ProductionQualityManualReview) => Promise<void> | void;
  onOpenOutput?: () => Promise<void>;
  onOpenSettings?: () => void;
  onConfigureProvider?: () => void;
  onConfigureVideoProvider?: () => void;
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

export interface DirectorVideoResult {
  videoUrl: string;
  provider: string;
  model?: string;
  estimatedCost?: number;
  jobId?: string;
}

export interface DirectorQueueItem {
  id: string;
  shotId: string;
  kind?: 'shot-image' | 'shot-video' | 'style-sample';
  title: string;
  status: 'running' | 'waiting' | 'failed' | 'completed';
  progress: number;
  cost: number;
  provider: string;
  thumbnail?: string;
  error?: string;
}


const tabItems = [
  { value: 'generate', label: '画面', icon: <ImageIcon size={13} /> },
  { value: 'mode', label: '动效', icon: <Sparkles size={13} /> },
  { value: 'subtitle', label: '字幕', icon: <MessageSquareText size={13} /> },
  { value: 'sound', label: '声音', icon: <Volume2 size={13} /> },
  { value: 'version', label: '版本', icon: <Save size={13} /> },
  { value: 'quality', label: '审片', icon: <Gauge size={13} /> },
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
  beatCount = 0,
  assets = [],
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
  videoProviderConnected = false,
  videoProviderLabel = '视频服务未配置',
  videoProviderModel = '未配置',
  videoProviderUnavailableReason,
  videoProviderId,
  videoProviderOptions = [],
  outputUrl,
  outputHistory = [],
  qualityReview,
  styleCandidates = [],
  selectedStyleId,
  ratio = '16:9',
  projects = [],
  activeProjectId,
  episodes = [],
  activeEpisodeId,
  versions = [],
  jobs = [],
  batchPersistence,
  historyUsage,
  onSelectShot,
  onUpdateShot,
  onUpdateShotMotion,
  onUpdateSubtitleCue,
  onAddSubtitleCue,
  onRemoveSubtitleCue,
  onAlignSubtitleCue,
  onImportSubtitleTimestamps,
  onUpdateSoundClip,
  onRemoveSoundClip,
  onImportSound,
  onSave,
  onNewProject,
  onSelectProject,
  onSelectEpisode,
  onAddEpisode,
  onAddScene,
  onAddShot,
  onRemoveShot,
  onMoveShot,
  onSplitShot,
  onMergeShot,
  onAddBeat,
  onRemoveBeat,
  onMoveBeat,
  onRatioChange,
  onToggleAsset,
  onSelectStyle,
  onRestoreVersion,
  onBackToTasks,
  backToTasksLabel = '返回全部任务',
  onStageChange,
  onGenerateShot,
  onGenerateStyleCandidate,
  onProviderProfileChange,
  onGenerateVoice,
  onGenerateDialogueVoice,
  onGenerateVideo,
  onRetryVideo,
  onVideoProviderChange,
  onRender,
  projectId,
  expectedUpdatedAt,
  onRecheckSubtitles,
  onRecheckMedia,
  onConfirmQualityReview,
  onOpenOutput,
  onOpenSettings,
  onConfigureProvider,
  onConfigureVideoProvider,
}: DirectorDeskWorkspaceProps) {
  const [inspectorTab, setInspectorTab] = useState<DirectorInspectorTab>('generate');
  const [assetTab, setAssetTab] = useState<DirectorAssetTab>('narrator');
  const [seedLocked, setSeedLocked] = useState(true);
  const [safeAreaVisible, setSafeAreaVisible] = useState(true);
  const [activeStage, setActiveStage] = useState<string>(() => outputUrl ? '导出' : stageLabel);
  const [leftPaneOpen, setLeftPaneOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const activePhase = directorPhaseForStage(activeStage);
  function closePane(pane: 'left' | 'inspector') {
    if (pane === 'left') setLeftPaneOpen(false);
    else setInspectorOpen(false);
    workspaceRef.current?.querySelector<HTMLButtonElement>(`.director-pane-toggle--${pane}`)?.focus();
  }
  function togglePane(pane: 'left' | 'inspector') {
    if (pane === 'left') {
      if (leftPaneOpen) { closePane('left'); return; }
      setInspectorOpen(false);
      setLeftPaneOpen(true);
    } else {
      if (inspectorOpen) { closePane('inspector'); return; }
      setLeftPaneOpen(false);
      setInspectorOpen(true);
    }
  }
  useEffect(() => {
    const pane = leftPaneOpen ? '.director-left-pane' : inspectorOpen ? '.director-inspector-pane' : null;
    if (pane) workspaceRef.current?.querySelector<HTMLElement>(pane)?.focus({ preventScroll: true });
  }, [leftPaneOpen, inspectorOpen]);
  const [statusDetailOpen, setStatusDetailOpen] = useState(false);
  const [removingBeatOpen, setRemovingBeatOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackMs, setPlaybackMs] = useState(0);
  const [voiceBusyShotId, setVoiceBusyShotId] = useState('');
  const [videoBusyShotId, setVideoBusyShotId] = useState('');
  const [renderBusy, setRenderBusy] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const [actionError, setActionError] = useState<string | AppError>('');
  const statusError = useMemo(() => actionError ? formatAppErrorMessage(normalizeAppError(typeof actionError === 'string' ? new Error(actionError) : actionError)) : errorMessage, [actionError, errorMessage]);
  useEffect(() => setStatusDetailOpen(false), [statusError]);
  const [shotSearch, setShotSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [previewSettingsOpen, setPreviewSettingsOpen] = useState(false);
  const [batchPlanOpen, setBatchPlanOpen] = useState(false);
  const [removingShotId, setRemovingShotId] = useState('');
  const [historyOutputId, setHistoryOutputId] = useState('');
  const [focusedCueId, setFocusedCueId] = useState('');
  const [recheckNotice, setRecheckNotice] = useState('');
  const [qualityConfirmBusy, setQualityConfirmBusy] = useState(false);
  const [qualityRecheckBusy, setQualityRecheckBusy] = useState(false);
  const [batchScope, setBatchScope] = useState<DirectorBatchScope>('missing');
  const [batchCapabilities, setBatchCapabilities] = useState<Record<DirectorBatchCapability, boolean>>({ image: true, video: true, voice: true, render: true });
  const [batchConcurrency, setBatchConcurrency] = useState(2);
  const [batchNodes, setBatchNodes] = useState<DirectorBatchNode[]>([]);
  const [batchRunState, setBatchRunState] = useState<DirectorBatchRunState>('idle');
  const [batchRecordId, setBatchRecordId] = useState('');
  const batchNodesRef = useRef<DirectorBatchNode[]>([]);
  const batchRecordRef = useRef<DirectorBatchRecord | null>(null);
  const batchPersistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const [localGeneration, setLocalGeneration] = useState<Record<string, 'running' | 'failed'>>({});
  const [styleBusyId, setStyleBusyId] = useState('');
  const [previewImageStatus, setPreviewImageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [previewVideoState, setPreviewVideoState] = useState<{ src: string; status: 'loading' | 'ready' | 'error' }>({ src: '', status: 'loading' });
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const shotListRef = useRef<HTMLDivElement | null>(null);
  const filmstripRef = useRef<HTMLDivElement | null>(null);
  const playbackMsRef = useRef(0);
  const playbackClockRef = useRef({ originMs: 0, originTime: 0 });
  const motionPreviewRangeRef = useRef<{ shotId: string; endMs: number } | null>(null);
  const activePlaybackShotRef = useRef(selectedShotId);
  const batchControllerRef = useRef<DirectorBatchController | null>(null);
  const generationPendingRef = useRef(createDirectorRequestGate());
  const voicePendingRef = useRef(createDirectorRequestGate());
  const videoPendingRef = useRef(createDirectorRequestGate());
  const selectedShot = shots.find((shot) => shot.id === selectedShotId) ?? shots[0] ?? null;
  const projectCover = useMemo(
    () => assets?.find((asset) => asset.thumbnail?.trim())?.thumbnail
      ?? shots.find((shot) => shot.thumbnail?.trim())?.thumbnail,
    [assets, shots],
  );
  const recheckShots = useMemo(() => shots.map((shot) => ({ id: shot.id, startMs: playbackShotOffset(shots, shot.id), durationMs: shot.durationMs,
    subtitleCues: shot.subtitleCues, assetVersionIds: shot.assetVersionIds })), [shots]);
  useLayoutEffect(() => {
    const containers = [shotListRef.current, filmstripRef.current];
    const reveal = () => {
      for (const container of containers) {
        const element = container?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
        if (!container || !element?.getClientRects().length) continue;
        if (container === filmstripRef.current) {
          // Reveal the selected thumbnail without scrolling the preview above it.
          const bounds = container.getBoundingClientRect();
          const item = element.getBoundingClientRect();
          if (item.left < bounds.left) container.scrollLeft += item.left - bounds.left;
          else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
        } else element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    reveal();
    let frame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(reveal); });
    containers.forEach((container) => { if (container) observer.observe(container); });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [selectedShot?.id, selectedShot?.index, shotSearch, leftPaneOpen]);
  const latestQualityReport = qualityReview?.report;
  const qualityFreshness = qualityReview?.freshness ?? 'missing';
  const qualityFailedCount = latestQualityReport?.checks.filter((check) => check.status === 'failed' && (check.severity ?? 'blocking') === 'blocking').length ?? 0;
  const qualityWarningCount = latestQualityReport?.checks.filter((check) => check.status === 'failed' && check.severity === 'warning').length ?? 0;
  const qualityPassedCount = latestQualityReport?.checks.filter((check) => check.status === 'passed').length ?? 0;
  const qualityAttentionCount = latestQualityReport?.checks.filter((check) => check.status === 'pending' || (check.status === 'failed' && check.severity === 'manual')).length ?? 0;
  const qualityBadgeStatus = qualityFreshness === 'stale' || qualityFreshness === 'unverified' ? 'warning'
    : latestQualityReport?.status === 'passed' && (qualityWarningCount || qualityAttentionCount) ? 'warning' : latestQualityReport?.status ?? 'pending';
  const qualityBadgeLabel = qualityFreshness === 'stale' ? '报告已过期' : qualityFreshness === 'unverified' ? '版本待核对'
    : qualityBadgeStatus === 'warning' ? '可导出 · 待复核' : latestQualityReport?.status === 'passed' ? '已通过' : latestQualityReport?.status === 'failed' ? '已阻断' : '待审片';
  const qualityCanConfirm = qualityFreshness === 'current' && Boolean(latestQualityReport?.renderFingerprint)
    && Boolean(latestQualityReport && canConfirmDirectorQualityReport(latestQualityReport));
  const qualityConfirmed = Boolean(!qualityConfirmBusy && qualityCanConfirm && latestQualityReport && latestQualityReport.manualReview
    && latestQualityReport.manualReview.scope.kind === 'project'
    && latestQualityReport.manualReview.reportId === latestQualityReport.id
    && latestQualityReport.manualReview.renderFingerprint === latestQualityReport.renderFingerprint);
  const subtitleGlyphCues = latestQualityReport?.evidence?.subtitleLayout?.scenes.flatMap((scene) => scene.status === 'ok' ? scene.cues : []) ?? [];
  const verifiedSubtitleGlyphCues = subtitleGlyphCues.filter((cue) => cue.glyphCoverage?.verification === 'font-engine'
    && cue.glyphCoverage.status === 'ok'
    && cue.glyphCoverage.renderedCodePointCount >= cue.glyphCoverage.codePointCount
    && cue.glyphCoverage.missingCodePoints.length === 0).length;
  const subtitleGlyphEvidenceLabel = !latestQualityReport?.evidence?.subtitleLayout ? '未取得'
    : subtitleGlyphCues.length === 0 ? '无字幕'
    : verifiedSubtitleGlyphCues === subtitleGlyphCues.length ? `${verifiedSubtitleGlyphCues} 句 · 字体引擎已验证`
    : `${verifiedSubtitleGlyphCues}/${subtitleGlyphCues.length} 句 · 其余待复核`;
  const previewCanvas = directorCanvasForRatio(ratio);
  const previewUnit = 100 / previewCanvas.width;
  const previewStyle = {
    '--director-preview-ratio': previewCanvas.width / previewCanvas.height,
    '--director-title-size': `${Math.min(76, Math.max(36, previewCanvas.width * .0396)) * previewUnit}cqw`,
    '--director-documentary-title-size': `${Math.min(58, Math.max(30, previewCanvas.width * .0302)) * previewUnit}cqw`,
    '--director-caption-size': `${Math.min(48, Math.max(28, previewCanvas.width * .025)) * previewUnit}cqw`,
    '--director-scene-unit': `${previewUnit}cqw`,
  } as CSSProperties;
  const availableAssets = assets;
  const visibleAssets = useMemo(() => {
    const categoryFiltered = assetTab === 'narrator'
      ? availableAssets
      : availableAssets.filter((asset) => asset.category === assetTab || (assetTab === 'places' && ['场景', '地点'].includes(asset.type)) || (assetTab === 'history' && asset.type === '历史影像') || (assetTab === 'style' && asset.type === '风格参考') || (assetTab === 'consistency' && asset.locked));
    const query = assetSearch.trim().toLocaleLowerCase();
    return query ? categoryFiltered.filter((asset) => `${asset.label} ${asset.type} ${asset.warning ?? ''}`.toLocaleLowerCase().includes(query)) : categoryFiltered;
  }, [assetSearch, assetTab, availableAssets]);
  const assetPage = useDirectorHistoryPage(visibleAssets, `${assetTab}:${assetSearch}:${showAllAssets}`, 36);
  const renderedAssets = showAllAssets ? assetPage.items : visibleAssets.slice(0, 9);
  const filteredShots = useMemo(() => {
    const query = shotSearch.trim().toLocaleLowerCase();
    return query ? shots.filter((shot) => `${shot.title} ${shot.scene} ${shot.prompt}`.toLocaleLowerCase().includes(query)) : shots;
  }, [shotSearch, shots]);
  const queue = useMemo(() => {
    // A queue item is evidence of a persisted provider job. Do not synthesize
    // waiting/completed work from shot structure; empty projects must remain empty.
    const seenImageShots = new Set<string>();
    const seenVideoShots = new Set<string>();
    const authoritative = jobs.map((item) => {
      if (item.kind === 'style-sample') return item;
      const isVideo = item.id.includes('image-to-video') || item.title.includes('动态海报');
      const seen = isVideo ? seenVideoShots : seenImageShots;
      const localStatus = !isVideo ? localGeneration[item.shotId] : videoBusyShotId === item.shotId ? 'running' : undefined;
      if (!seen.has(item.shotId)) {
        seen.add(item.shotId);
        if (localStatus) return { ...item, status: localStatus, progress: 0 };
      }
      return item;
    });
    const known = new Set(authoritative.filter((item) => item.kind !== 'style-sample').map((item) => item.shotId));
    const transient = Object.entries(localGeneration)
      .filter(([shotId]) => !known.has(shotId))
      .flatMap(([shotId, status]): DirectorQueueItem[] => {
        const shot = shots.find((candidate) => candidate.id === shotId);
        return shot ? [{ id: `local-${shotId}`, shotId, title: shot.title, status, progress: 0, cost: shot.cost ?? 0, provider: providerLabel, thumbnail: shot.thumbnail, error: status === 'failed' ? '本次生成失败，请查看错误并重试。' : undefined }] : [];
      });
    return [...transient, ...authoritative];
  }, [jobs, localGeneration, providerLabel, shots, videoBusyShotId]);
  const batchPlan = useMemo(() => createDirectorBatchPlan({
    scope: batchScope,
    capabilities: batchCapabilities,
    shots: shots.map((shot) => ({
      id: shot.id,
      title: shot.title,
      imageReady: shot.imageReady ?? false,
      videoReady: Boolean(shot.videoUrl) || shot.videoJobStatus === 'completed',
      voiceReady: shot.voiceReady ?? false,
      imageFailed: shot.imageFailed ?? false,
      videoFailed: shot.videoJobStatus === 'failed' || shot.videoJobStatus === 'cancelled',
      voiceFailed: shot.voiceFailed ?? false,
      renderStrategy: shot.renderStrategy ?? 'deterministic-layers',
      estimatedImageCost: shot.cost ?? (shots.length > 0 ? estimatedCost / shots.length : 0),
      estimatedVideoCost: shot.videoEstimatedCost ?? 0,
      estimatedVoiceCost: 0,
    })),
    outputReady: Boolean(outputUrl),
  }), [batchCapabilities, batchScope, estimatedCost, outputUrl, shots]);
  const batchHistoryDemand = useMemo(() => directorBatchHistoryDemand(batchPlan.nodes, shots), [batchPlan.nodes, shots]);
  const batchHistoryError = historyUsage ? productionHistoryCapacityError(historyUsage, batchHistoryDemand) : undefined;
  const batchUnavailableReasons = useMemo(() => [
    batchCapabilities.image && !providerConnected ? (providerUnavailableReason ?? '图片服务未连接。') : '',
    batchPlan.videoCount > 0 && !videoProviderConnected ? (videoProviderUnavailableReason ?? '视频服务未连接。') : '',
    batchPlan.videoCount > 0 && !onGenerateVideo ? 'AI 动态海报生成尚未接入。' : '',
    batchCapabilities.voice && !voiceConnected ? (voiceUnavailableReason ?? '旁白服务未连接。') : '',
    batchCapabilities.render && !onRender ? '成片渲染尚未接入。' : '',
  ].filter(Boolean), [batchCapabilities, batchPlan.videoCount, onGenerateVideo, onRender, providerConnected, providerUnavailableReason, videoProviderConnected, videoProviderUnavailableReason, voiceConnected, voiceUnavailableReason]);
  const batchActive = batchRunState === 'starting' || batchRunState === 'running' || batchRunState === 'paused' || batchRunState === 'cancelling';
  const structureBusy = Boolean(busy || batchActive || renderBusy || voiceBusyShotId || videoBusyShotId || styleBusyId || Object.values(localGeneration).includes('running'));
  const selectedShotIndex = shots.findIndex((shot) => shot.id === selectedShot?.id);
  const selectedBeatIndex = selectedShot?.beatIndex ?? 1;
  const beatTotal = beatCount ?? 0;
  const removingShot = shots.find((shot) => shot.id === removingShotId);
  const historyOutput = outputHistory.find((output) => output.id === historyOutputId);

  const totalDuration = useMemo(() => shots.reduce((total, shot) => total + shot.durationMs, 0), [shots]);
  const selectedShotOffset = useMemo(() => playbackShotOffset(shots, selectedShot?.id ?? ''), [selectedShot?.id, shots]);
  const selectedQueueItem = selectedShot ? queue.find((item) => item.shotId === selectedShot.id) : undefined;
  const showingRenderedVideo = Boolean(outputUrl && activeStage === '导出');

  useEffect(() => () => {
    generationPendingRef.current.clear();
    voicePendingRef.current.clear();
    videoPendingRef.current.clear();
  }, []);
  useEffect(() => {
    generationPendingRef.current.clear();
    voicePendingRef.current.clear();
    videoPendingRef.current.clear();
    setLocalGeneration({});
    setActionError('');
    setVoiceBusyShotId('');
    setVideoBusyShotId('');
    batchNodesRef.current = [];
    setBatchNodes([]);
    setBatchRunState('idle');
    setBatchRecordId('');
    batchRecordRef.current = null;
    return () => {
      batchControllerRef.current?.cancel();
      batchControllerRef.current = null;
    };
  }, [activeEpisodeId, activeProjectId]);
  useEffect(() => {
    let cancelled = false;
    if (!batchPersistence || !activeProjectId || batchControllerRef.current || batchRecordRef.current) return undefined;
    void batchPersistence.list({ projectId: activeProjectId, episodeId: activeEpisodeId ?? null, statuses: ['queued', 'running', 'paused', 'cancelling'] }).then((records) => {
      if (cancelled || records.length === 0 || batchControllerRef.current || batchRecordRef.current) return;
      const record = records[0];
      const recoveryRequired = record.recoveryRequired || record.status !== 'paused' || record.nodes.some((node) => node.status === 'running');
      batchRecordRef.current = { ...record, status: 'paused', recoveryRequired };
      setBatchRecordId(record.id);
      const restoredNodes = record.nodes.map((node) => ({ ...node, dependencies: [...node.dependencies] }));
      batchNodesRef.current = restoredNodes;
      setBatchNodes(restoredNodes);
      // A renderer restart may leave remote work in an unknown state. Keep the
      // batch visibly paused until the user verifies that state; never submit
      // those nodes automatically on page re-entry.
      setBatchRunState('paused');
      if (recoveryRequired) setActionError(record.recoveryReason || '批次需要重新确认远端任务状态后才能继续。');
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeEpisodeId, activeProjectId, batchPersistence]);

  function updateBatchNodes(updater: DirectorBatchNode[] | ((current: DirectorBatchNode[]) => DirectorBatchNode[])) {
    const current = batchNodesRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    batchNodesRef.current = next;
    setBatchNodes(next);
    return next;
  }

  function enqueueBatchPersistence(update: UpdateDirectorBatchInput | ((record: DirectorBatchRecord) => UpdateDirectorBatchInput)) {
    if (!batchPersistence) return Promise.resolve();
    const batchId = batchRecordRef.current?.id;
    // SQLite and the browser fallback both use updatedAt as a CAS token. Keep
    // writes in one promise chain so rapid node transitions cannot race each
    // other with the same token.
    const pending = batchPersistenceTailRef.current
      .then(async () => {
        const record = batchRecordRef.current;
        if (!record || record.id !== batchId) throw new Error('批次已切换，未写入过期状态。');
        const patch = typeof update === 'function' ? update(record) : update;
        const next = await batchPersistence.update(record.id, { ...patch, expectedUpdatedAt: record.updatedAt });
        if (batchRecordRef.current?.id !== batchId) throw new Error('批次已切换，未应用过期状态。');
        batchRecordRef.current = next;
      });
    batchPersistenceTailRef.current = pending.catch(() => undefined);
    return pending;
  }

  function reportBatchPersistenceFailure(error: unknown) {
    batchControllerRef.current?.pause();
    const reason = `批次状态未保存，已停止派发新任务：${error instanceof Error ? error.message : String(error)}`;
    const record = batchRecordRef.current;
    if (record) {
      const nodes = record.nodes.map((node) => ({ ...node, dependencies: [...node.dependencies] }));
      updateBatchNodes(nodes);
      batchRecordRef.current = { ...record, status: 'paused', recoveryRequired: true, recoveryReason: reason, nodes };
      setBatchRunState('paused');
    } else setBatchRunState('finished');
    setActionError(reason);
  }
  const selectedRenderStrategy = selectedShot?.renderStrategy ?? 'deterministic-layers';
  const selectedShotPlaybackMs = selectedShot
    ? clampPlaybackTime(playbackMs - selectedShotOffset, selectedShot.durationMs)
    : 0;
  const selectedPreviewLayers = selectedShot?.previewLayers?.filter((layer) => Boolean(layer.src) && layer.visible !== false) ?? [];
  const authoredLayersEmpty = Boolean(selectedShot?.previewLayers?.length && selectedPreviewLayers.length === 0);
  const previewCameraStyle = directorCameraStyle(selectedShot?.cameraKeyframes ?? [], selectedShotPlaybackMs, selectedShot?.durationMs ?? 0, selectedShot?.motionPreset);
  const selectedVideoStatus = videoBusyShotId === selectedShot?.id
    ? 'running'
    : selectedShot?.videoUrl
      ? 'completed'
      : selectedShot?.videoJobStatus ?? 'idle';
  const selectedVideoState = previewVideoState.src === selectedShot?.videoUrl ? previewVideoState.status : 'loading';
  const videoGenerationDisabledReason = selectedRenderStrategy !== 'living-poster'
    ? ''
    : !videoProviderConnected
      ? videoProviderUnavailableReason ?? '请先在系统设置中配置并启用视频生成服务。'
      : !selectedShot?.videoInputReady
        ? selectedShot?.videoInputUnavailableReason ?? '请先生成或选择一张可读取的首帧图片。'
        : !onGenerateVideo
          ? '当前工作流尚未接入 AI 动态海报生成。'
          : '';

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
      const range = motionPreviewRangeRef.current;
      const next = clampPlaybackTime(playbackClockRef.current.originMs + now - playbackClockRef.current.originTime, range?.endMs ?? totalDuration);
      playbackMsRef.current = next;
      setPlaybackMs(next);
      const active = range ? shots.find((shot) => shot.id === range.shotId) : playbackShotAt(shots, next);
      if (active && active.id !== activePlaybackShotRef.current) {
        activePlaybackShotRef.current = active.id;
        onSelectShot(active.id);
      }
      if (next >= (range?.endMs ?? totalDuration)) {
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

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !selectedShot?.videoUrl || selectedRenderStrategy !== 'living-poster') return;
    video.muted = muted;
    const requestedSeconds = Math.max(0, (playbackMs - selectedShotOffset) / 1000);
    const availableSeconds = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(requestedSeconds, Math.max(0, video.duration - 0.01))
      : requestedSeconds;
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA && (!isPlaying || Math.abs(video.currentTime - availableSeconds) > 0.12)) {
      video.currentTime = availableSeconds;
    }
    if (!isPlaying) {
      video.pause();
      return;
    }
    if (video.paused) void video.play().catch(() => undefined);
  }, [isPlaying, muted, playbackMs, selectedRenderStrategy, selectedShot?.videoUrl, selectedShotOffset]);

  function seekPlayback(value: number) {
    motionPreviewRangeRef.current = null;
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

  function seekMotionPreview(timeMs: number) {
    if (!selectedShot) return;
    setIsPlaying(false);
    motionPreviewRangeRef.current = null;
    const next = selectedShotOffset + clampPlaybackTime(timeMs, selectedShot.durationMs);
    playbackMsRef.current = next;
    setPlaybackMs(next);
    activePlaybackShotRef.current = selectedShot.id;
  }

  function playMotionPreview(startMs: number, endMs: number) {
    if (!selectedShot) return;
    if (isPlaying) { setIsPlaying(false); return; }
    seekMotionPreview(startMs);
    motionPreviewRangeRef.current = { shotId: selectedShot.id, endMs: selectedShotOffset + clampPlaybackTime(endMs, selectedShot.durationMs) };
    playbackClockRef.current = { originMs: playbackMsRef.current, originTime: performance.now() };
    setIsPlaying(true);
  }

  function selectShotAndSeek(shotId: string) {
    setIsPlaying(false);
    activePlaybackShotRef.current = shotId;
    seekPlayback(playbackShotOffset(shots, shotId));
    onSelectShot(shotId);
  }

  function locateRecheckScope(scope: ProductionQualityRecheckScope) {
    const plan = resolveProductionQualityRecheckScope(scope, recheckShots);
    setIsPlaying(false);
    motionPreviewRangeRef.current = null;
    setRecheckNotice('');
    setFocusedCueId(plan.cueIds[0] ?? '');
    setInspectorTab(plan.inspectorTab === 'sound' && !onImportSound ? 'quality' : plan.inspectorTab ?? 'quality');
    setActiveStage('审片');
    if (plan.primaryShotId) {
      setShotSearch('');
      setLeftPaneOpen(true);
      activePlaybackShotRef.current = plan.primaryShotId;
      onSelectShot(plan.primaryShotId);
      seekPlayback(plan.seekMs ?? playbackShotOffset(shots, plan.primaryShotId));
      const target = shots.find((shot) => shot.id === plan.primaryShotId)!;
      setRecheckNotice(`已定位到镜头 ${target.index}${plan.cueIds.length ? '的受影响字幕' : ''}${plan.shotIds.length > 1 ? `，范围共 ${plan.shotIds.length} 个镜头` : ''}。`);
    } else if (plan.requiresFullRender) {
      setRecheckNotice('此项需要重新生成整片后再审片。');
    } else {
      setRecheckNotice('报告中的复检对象已不存在，请重新生成整片后再审片。');
    }
  }

  async function recheckSubtitles(scope: ProductionQualityRecheckScope) {
    if (!onRecheckSubtitles || !projectId || !latestQualityReport?.renderFingerprint || qualityRecheckBusy) return;
    const shotIds = [...new Set(scope.shotIds ?? [])];
    const cueIds = [...new Set(scope.cueIds ?? [])];
    if (shotIds.length === 0) return;
    setQualityRecheckBusy(true);
    setActionError('');
    try {
      await onRecheckSubtitles({
        id: projectId,
        reportId: latestQualityReport.id,
        renderFingerprint: latestQualityReport.renderFingerprint,
        ...(activeEpisodeId ? { episodeId: activeEpisodeId } : {}),
        shotIds,
        cueIds,
        expectedUpdatedAt: expectedUpdatedAt ?? '',
      });
      setRecheckNotice(`已完成 ${shotIds.length} 个镜头的字幕局部复检。`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setQualityRecheckBusy(false);
    }
  }

  async function recheckMedia(scope: ProductionQualityRecheckScope) {
    if (!onRecheckMedia || !projectId || !latestQualityReport?.renderFingerprint || qualityRecheckBusy) return;
    const shotIds = [...new Set(scope.shotIds ?? [])];
    if (shotIds.length === 0) return;
    setQualityRecheckBusy(true);
    setActionError('');
    try {
      await onRecheckMedia({ id: projectId, reportId: latestQualityReport.id, renderFingerprint: latestQualityReport.renderFingerprint, ...(activeEpisodeId ? { episodeId: activeEpisodeId } : {}), shotIds, ...(scope.startMs !== undefined ? { startMs: scope.startMs } : {}), ...(scope.endMs !== undefined ? { endMs: scope.endMs } : {}), expectedUpdatedAt: expectedUpdatedAt ?? '' });
      setRecheckNotice(`已完成 ${shotIds.length} 个镜头的媒体局部复检。`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setQualityRecheckBusy(false);
    }
  }

  async function confirmQualityReview() {
    if (!onConfirmQualityReview || !latestQualityReport?.renderFingerprint || !qualityCanConfirm) return;
    setQualityConfirmBusy(true);
    setActionError('');
    try {
      await onConfirmQualityReview({
        reportId: latestQualityReport.id,
        renderFingerprint: latestQualityReport.renderFingerprint,
        scope: { kind: 'project' },
        confirmedAt: new Date().toISOString(),
      });
      setRecheckNotice('已记录当前版本的人工复核。');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setQualityConfirmBusy(false);
    }
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

  async function generateVoice(shotId: string, cueId?: string) {
    const requestKey = `${shotId}:${cueId ?? 'shot'}`;
    if (!voicePendingRef.current.begin(requestKey)) return;
    setActionError('');
    setVoiceBusyShotId(shotId);
    try {
      if (!onGenerateVoice) throw new Error('当前工作流尚未接入旁白生成。');
      if (cueId && onGenerateDialogueVoice) await onGenerateDialogueVoice(shotId, cueId);
      else await onGenerateVoice(shotId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      voicePendingRef.current.end(requestKey);
      setVoiceBusyShotId('');
    }
  }

  async function generateVideo(shotId: string, retry = false) {
    const shot = shots.find((candidate) => candidate.id === shotId);
    if (!shot) return;
    const unavailableReason = !videoProviderConnected
      ? videoProviderUnavailableReason ?? '请先在系统设置中配置并启用视频生成服务。'
      : !shot.videoInputReady
        ? shot.videoInputUnavailableReason ?? '请先生成或选择一张可读取的首帧图片。'
        : !onGenerateVideo
          ? '当前工作流尚未接入 AI 动态海报生成。'
          : '';
    if (unavailableReason) {
      setActionError(unavailableReason);
      return;
    }
    const requestKey = `${shotId}:${retry ? 'retry' : 'new'}`;
    if (!videoPendingRef.current.begin(requestKey)) return;
    setActionError('');
    setVideoBusyShotId(shotId);
    try {
      const action = retry ? onRetryVideo ?? onGenerateVideo : onGenerateVideo;
      if (!action) throw new Error('当前工作流尚未接入 AI 动态海报生成。');
      await action(shotId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      videoPendingRef.current.end(requestKey);
      setVideoBusyShotId('');
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
      setActionError(normalizeAppError(error));
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
    if (stage !== '剧本' && window.matchMedia('(max-width: 900px)').matches) {
      setLeftPaneOpen(false);
      setInspectorOpen(true);
    }
    if (stage === '配音字幕') setInspectorTab('subtitle');
    if (stage === '审片') setInspectorTab('quality');
    if (stage === '画面拆解' || stage === '素材一致性' || stage === '镜头生成' || stage === '导出') setInspectorTab('generate');
    if (stage === '素材一致性') setAssetTab('consistency');
    if (stage === '剧本') setInspectorTab('subtitle');
    if (stage === '导出' && !outputUrl) setActionError('请先完成镜头画面与旁白，再点击“生成成片”。');
    onStageChange?.(stage);
  }

  async function startGeneration(shotId: string) {
    const shot = shots.find((item) => item.id === shotId);
    if (!shot) return;
    if (!generationPendingRef.current.begin(shotId)) return;
    setActionError('');
    setLocalGeneration((current) => ({ ...current, [shotId]: 'running' }));
    try {
      if (!onGenerateShot) throw new Error('当前工作流尚未接入镜头生成。');
      await onGenerateShot(shotId);
      setLocalGeneration((current) => { const next = { ...current }; delete next[shotId]; return next; });
    } catch (error) {
      setLocalGeneration((current) => {
        if (normalizeAppError(error).code !== 'PRODUCTION_HISTORY_CAPACITY') return { ...current, [shotId]: 'failed' };
        const next = { ...current };
        delete next[shotId];
        return next;
      });
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      generationPendingRef.current.end(shotId);
    }
  }

  async function generateStyleCandidate(styleId: string) {
    if (!onGenerateStyleCandidate || styleBusyId) return;
    setActionError('');
    setStyleBusyId(styleId);
    try {
      await onGenerateStyleCandidate(styleId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setStyleBusyId('');
    }
  }

  function retryGeneration(item: DirectorQueueItem) {
    if (item.kind === 'style-sample') {
      void generateStyleCandidate(item.shotId.replace(/^style-candidate:/, ''));
      return;
    }
    void startGeneration(item.shotId);
  }

  function updateBatchCapability(capability: DirectorBatchCapability, checked: boolean) {
    setBatchCapabilities((current) => ({ ...current, [capability]: checked }));
  }

  async function runBatch(nodes: readonly DirectorBatchNode[], recoveredRecord?: DirectorBatchRecord) {
    if (batchControllerRef.current || (batchActive && !recoveredRecord) || nodes.length === 0 || batchUnavailableReasons.length > 0) return;
    const remaining = recoveredRecord ? nodes.filter((node) => !['completed', 'failed', 'cancelled', 'skipped'].includes(node.status)) : nodes;
    const capacityError = historyUsage ? productionHistoryCapacityError(historyUsage, directorBatchHistoryDemand(remaining, shots)) : undefined;
    if (capacityError) { setActionError(capacityError); return; }
    const controller = createDirectorBatchController();
    batchControllerRef.current = controller;
    setActionError('');
    const initialNodes = nodes.map((node) => {
      const persisted = recoveredRecord?.nodes.find((candidate) => candidate.id === node.id);
      const preservedStatus = persisted && ['completed', 'failed', 'cancelled', 'skipped'].includes(persisted.status)
        ? persisted.status
        : 'pending';
      return { ...node, status: preservedStatus as DirectorBatchNode['status'], error: preservedStatus === 'pending' ? undefined : persisted?.error };
    });
    updateBatchNodes(initialNodes);
    setBatchRunState('starting');
    setBatchPlanOpen(false);
    try {
      await batchPersistenceTailRef.current;
      if (batchControllerRef.current !== controller) return;
      if (!recoveredRecord) { batchRecordRef.current = null; setBatchRecordId(''); }
      const persisted = recoveredRecord ?? (batchPersistence ? await batchPersistence.create({
        workflowKind: 'director', projectId: activeProjectId ?? projectTitle, episodeId: activeEpisodeId ?? null,
        status: 'running', concurrency: batchConcurrency, plan: {
          scope: batchScope, capabilities: batchCapabilities, outputReady: Boolean(outputUrl), renderFailed: false,
          shots: shots.map((shot) => ({ id: shot.id, title: shot.title, imageReady: shot.imageReady, videoReady: Boolean(shot.videoUrl) || shot.videoJobStatus === 'completed', voiceReady: shot.voiceReady })),
        }, nodes,
      }) : null);
      if (batchControllerRef.current !== controller) return;
      if (persisted) { batchRecordRef.current = persisted; setBatchRecordId(persisted.id); }
      if (recoveredRecord && batchPersistence) {
        const acknowledged = await batchPersistence.update(recoveredRecord.id, {
          expectedUpdatedAt: recoveredRecord.updatedAt,
          status: 'running',
          pauseRequested: false,
          recoveryRequired: false,
          recoveryReason: '',
          nodes: initialNodes,
        });
        if (batchControllerRef.current !== controller) return;
        batchRecordRef.current = acknowledged;
      }
      setBatchRunState('running');
      const summary = await runDirectorBatchPlan(nodes, {
        image: async (node) => {
          if (!node.shotId || !onGenerateShot) throw new Error('当前工作流尚未接入镜头生成。');
          await onGenerateShot(node.shotId);
        },
        video: async (node) => {
          if (!node.shotId || !onGenerateVideo) throw new Error('当前工作流尚未接入 AI 动态海报生成。');
          const shot = shots.find((candidate) => candidate.id === node.shotId);
          const action = shot?.videoJobStatus === 'failed' || shot?.videoJobStatus === 'cancelled' ? onRetryVideo ?? onGenerateVideo : onGenerateVideo;
          await action(node.shotId);
        },
        voice: async (node) => {
          if (!node.shotId || !onGenerateVoice) throw new Error('当前工作流尚未接入旁白生成。');
          await onGenerateVoice(node.shotId);
        },
        render: async () => {
          if (!onRender) throw new Error('当前工作流尚未接入成片渲染。');
          await onRender();
          setActiveStage('导出');
        },
      }, {
        concurrency: batchConcurrency,
        controller,
        initialNodes: recoveredRecord?.nodes,
        onUpdate: (updated) => {
          if (batchControllerRef.current !== controller) return;
          updateBatchNodes((current) => current.map((node) => node.id === updated.id ? updated : node));
        },
        onStateChange: (nextNodes) => {
          if (batchControllerRef.current !== controller) throw new Error('批次工作区已切换，已停止派发。');
          return enqueueBatchPersistence({ nodes: [...nextNodes] });
        },
      });
      if (batchControllerRef.current !== controller) return;
      updateBatchNodes(summary.nodes);
      if (summary.failed > 0) setActionError(`批量生成有 ${summary.failed} 个节点失败，请查看队列并重试。`);
      await enqueueBatchPersistence({ status: controller.isCancelled() || summary.cancelled > 0 ? 'cancelled' : summary.failed > 0 ? 'failed' : 'completed', nodes: summary.nodes });
      setBatchRunState('finished');
    } catch (error) {
      if (batchControllerRef.current === controller) reportBatchPersistenceFailure(error);
    } finally {
      if (batchControllerRef.current === controller) batchControllerRef.current = null;
    }
  }

  function pauseBatch() {
    batchControllerRef.current?.pause();
    setBatchRunState('paused');
    void enqueueBatchPersistence({ status: 'paused', pauseRequested: true }).catch(reportBatchPersistenceFailure);
  }

  async function resumeBatch() {
    if (!batchControllerRef.current) {
      if (batchRecordRef.current && (batchRecordRef.current.recoveryRequired || batchRecordRef.current.status === 'paused')) {
        setActionError('请确认已核对远端任务状态；点击后仅会继续未完成节点，不会重复执行已完成节点。');
        const record = batchRecordRef.current;
        try {
          const refreshed = batchPersistence ? (await batchPersistence.list({ projectId: record.projectId, episodeId: record.episodeId })).find((item) => item.id === record.id) : record;
          if (!refreshed) throw new Error('批次记录不存在，无法恢复。');
          if (batchRecordRef.current?.id !== record.id) return;
          await runBatch(refreshed.nodes as DirectorBatchNode[], refreshed);
        } catch (error) { reportBatchPersistenceFailure(error); }
      }
      return;
    }
    try {
      await enqueueBatchPersistence({ status: 'running', pauseRequested: false });
      batchControllerRef.current?.resume();
      setBatchRunState('running');
    } catch (error) { reportBatchPersistenceFailure(error); }
  }

  async function cancelBatch() {
    const controller = batchControllerRef.current;
    controller?.cancel();
    setBatchRunState('cancelling');
    try {
      if (controller) await enqueueBatchPersistence({ status: 'cancelling', cancelRequested: true });
      else {
        const record = batchRecordRef.current;
        if (!record) throw new Error('批次记录不存在，无法取消。');
        const refreshed = batchPersistence ? (await batchPersistence.list({ projectId: record.projectId, episodeId: record.episodeId })).find((item) => item.id === record.id) : record;
        if (!refreshed) throw new Error('批次记录不存在，无法取消。');
        if (batchRecordRef.current?.id !== record.id) return;
        batchRecordRef.current = refreshed;
        const nodes = refreshed.nodes.map((node) => node.status === 'pending' ? { ...node, status: 'cancelled' as const } : node);
        await enqueueBatchPersistence({ status: 'cancelled', cancelRequested: true, nodes });
        updateBatchNodes(nodes);
        setBatchRunState('finished');
      }
    } catch (error) { reportBatchPersistenceFailure(error); }
  }

  function retryFailedBatch() {
    const retryable = batchNodes.filter((node) => node.status === 'failed' || node.status === 'skipped');
    void runBatch(retryable);
  }

  return (
    <div ref={workspaceRef} className="director-desk" data-workspace-layout="preview-first" data-director-desk-mode={mode} data-left-pane-open={leftPaneOpen} data-inspector-open={inspectorOpen} onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (leftPaneOpen) closePane('left');
        else if (inspectorOpen) closePane('inspector');
      }
    }}>
      <header className="director-desk-header">
        <div className="director-brandline">
          {onBackToTasks ? <IconButton label={backToTasksLabel} icon={<ArrowLeft size={15} />} variant="subtle" density="compact" onClick={onBackToTasks} /> : null}
          <div className="director-brand-mark"><Film size={16} aria-hidden="true" /></div>
          <strong className="director-wordmark">StoryDream</strong>
          {projects.length > 0 && onSelectProject ? <Menu
            trigger={<Button density="compact" variant="subtle" className="director-project-menu"><span><strong>{projectTitle || '未命名项目'}</strong><small>{projectMeta}</small></span><ChevronDown size={12} aria-hidden="true" /></Button>}
            options={projects.map((project) => ({ id: project.id, label: `${project.title} · ${project.meta}`, disabled: batchActive || project.id === activeProjectId, onSelect: () => onSelectProject(project.id) }))}
          /> : <div className="director-project-crumb"><strong>{projectTitle || '未命名项目'}</strong><span>{projectMeta}</span></div>}
        </div>
        <div className="director-header-status">
          <span className="director-save-state" data-dirty={dirty}>{dirty ? '未保存' : '已保存'}</span>
          <span className={statusError ? 'director-status-dot is-error' : providerConnected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} />
          <span className="director-header-message" role={statusError ? 'alert' : undefined} title={statusError ?? feedback ?? providerLabel}>{statusError ?? feedback ?? (providerConnected ? `${providerLabel} 已连接` : '等待图片服务')}</span>
          {statusError ? <Dialog title="操作未完成" trigger={<IconButton label="查看错误详情" icon={<CircleAlert size={15} />} variant="subtle" density="compact" />} actions={<Button onClick={() => setStatusDetailOpen(false)}>关闭</Button>} open={statusDetailOpen} onOpenChange={setStatusDetailOpen}><p className="director-error-detail">{statusError}</p></Dialog> : null}
          {!providerConnected && onConfigureProvider ? <Button className="director-provider-action" density="compact" variant="secondary" icon={<Settings2 size={13} />} onClick={onConfigureProvider}>配置图片服务</Button> : null}
          {onNewProject ? <IconButton label={mode === 'vox' ? '新建 VOX 项目' : '新建 AI 漫剧项目'} icon={<Plus size={15} />} variant="subtle" density="compact" disabled={batchActive} onClick={onNewProject} /> : null}
          <IconButton className="director-pane-toggle director-pane-toggle--left" label="显示项目与镜头" aria-controls="director-objects" aria-expanded={leftPaneOpen} icon={<PanelLeft size={15} />} variant={leftPaneOpen ? 'secondary' : 'subtle'} density="compact" onClick={() => togglePane('left')} />
          <IconButton className="director-pane-toggle director-pane-toggle--inspector" label="显示镜头检查器" aria-controls="director-inspector" aria-expanded={inspectorOpen} icon={<PanelRight size={15} />} variant={inspectorOpen ? 'secondary' : 'subtle'} density="compact" onClick={() => togglePane('inspector')} />
          <IconButton label="项目设置" icon={<Settings2 size={15} />} variant="subtle" density="compact" disabled={!onOpenSettings} onClick={onOpenSettings} />
          <IconButton label="保存版本" icon={busy ? <RefreshCw className="director-spin" size={15} /> : <Save size={15} />} variant={dirty ? 'primary' : 'subtle'} density="compact" disabled={!dirty || busy || batchActive} onClick={onSave} />
          <Menu
            trigger={<IconButton label="更多操作" icon={<MoreHorizontal size={16} />} variant="subtle" density="compact" />}
            options={[
              ...(onNewProject ? [{ id: 'new-project', label: mode === 'vox' ? '新建 VOX 项目' : '新建 AI 漫剧项目', icon: <Plus size={14} />, disabled: batchActive, onSelect: onNewProject }] : []),
              { id: 'save', label: dirty ? '保存当前版本' : '当前版本已保存', icon: <Save size={14} />, disabled: !dirty || batchActive, onSelect: onSave },
              ...(onOpenOutput && outputUrl ? [{ id: 'output', label: '打开导出目录', icon: <Download size={14} />, disabled: outputBusy, onSelect: () => void openOutput() }] : []),
            ]}
          />
        </div>
      </header>

      <div className="director-phase-bar">
        <nav className="director-stage-rail" aria-label="制作流程">
          {directorPhases.map((phase, index) => (
            <Button density="compact" variant="subtle" key={phase.id} aria-current={activePhase.id === phase.id ? 'step' : undefined} className={`director-stage-step ${activePhase.id === phase.id ? 'is-active' : ''}`} title={`${phase.label} · ${directorPhaseComplete(phase, completedStages) ? '已完成' : '待完成'}`} onClick={() => activateStage(phase.entry)}>
              {index === 0 ? <BookOpenText size={16} /> : index === 1 ? <Film size={16} /> : index === 2 ? <Volume2 size={16} /> : <Send size={16} />}
              <span>{phase.label}</span>
              {directorPhaseComplete(phase, completedStages) ? <Check size={12} /> : null}
            </Button>
          ))}
        </nav>
        <Menu trigger={<Button className="director-stage-menu" density="compact" variant="subtle" aria-label="制作步骤">{activeStage}<ChevronDown size={13} /></Button>} options={activePhase.stages.map((stage) => ({ id: stage, label: stage, icon: completedStages.includes(stage) ? <Check size={13} /> : undefined, onSelect: () => activateStage(stage) }))} />
      </div>

      <div className="director-desk-grid">
          <Pane as="aside" tone="subtle" className="director-left-pane" id="director-objects" tabIndex={-1} aria-label="项目与镜头">
          <div className="director-pane-heading"><strong>项目与镜头</strong><IconButton className="director-pane-close director-pane-close--left" label="关闭项目与镜头" icon={<X size={16} />} density="compact" variant="subtle" onClick={() => closePane('left')} /></div>
          <div className="director-project-summary">
            {projectCover ? <DirectorMediaImage src={projectCover} alt="项目封面" className="director-project-cover" /> : <div className="director-project-cover director-project-cover--empty" role="img" aria-label="尚未生成项目封面"><ImageOff size={15} aria-hidden="true" /><span>未生成</span></div>}
            <div><strong>{projectTitle || '未命名项目'}</strong><span>{episodeTitle}</span><small>{shots.length} 镜头 · {formatDuration(totalDuration)}</small></div>
          </div>
          <div className="director-pane-heading director-pane-heading--section"><strong>集数</strong>{onAddEpisode ? <IconButton label="新增集数" icon={<Plus size={15} />} density="compact" variant="subtle" disabled={structureBusy} onClick={onAddEpisode} /> : null}</div>
          {episodes.length > 0 ? episodes.map((episode) => <Button key={episode.id} density="compact" variant="subtle" disabled={structureBusy} aria-pressed={episode.id === activeEpisodeId} className={`director-episode-row ${episode.id === activeEpisodeId ? 'is-active' : ''}`} onClick={() => onSelectEpisode?.(episode.id)}><span>{String(episode.number).padStart(2, '0')}</span><span><strong>{episode.title}</strong><small>{episode.meta}</small></span>{episode.id === activeEpisodeId ? <Check size={14} /> : null}</Button>) : <div className="director-episode-row is-active"><span>01</span><div><strong>{episodeTitle || '当前集'}</strong><small>当前工作集 · {shots.length} 镜头</small></div><Check size={14} /></div>}
          <div className="director-pane-heading director-pane-heading--section"><strong>镜头</strong><span>{filteredShots.length}/{shots.length}</span></div>
          {onAddShot || onMoveShot || onRemoveShot || onSplitShot || onMergeShot || onAddBeat || onRemoveBeat || onMoveBeat ? <details className="director-structure-disclosure"><summary>结构操作</summary><div className="director-structure-controls">
            {onAddShot || onMoveShot || onRemoveShot || onSplitShot || onMergeShot ? <div className="director-structure-group">
              <span className="director-structure-group__label">镜头</span>
              <Toolbar aria-label="镜头结构操作">
                {onMoveShot ? <><IconButton label="上移当前镜头" icon={<ArrowUp size={14} />} density="compact" variant="subtle" disabled={structureBusy || selectedShotIndex <= 0} onClick={() => onMoveShot('up')} /><IconButton label="下移当前镜头" icon={<ArrowDown size={14} />} density="compact" variant="subtle" disabled={structureBusy || selectedShotIndex < 0 || selectedShotIndex >= shots.length - 1} onClick={() => onMoveShot('down')} /></> : null}
                {onRemoveShot ? <IconButton label="删除当前镜头" icon={<Trash2 size={14} />} density="compact" variant="subtle" disabled={structureBusy || !selectedShot || shots.length <= 1} onClick={() => setRemovingShotId(selectedShot?.id ?? '')} /> : null}
                {onAddShot ? <IconButton label="新增镜头" icon={<Plus size={15} />} density="compact" variant="subtle" disabled={structureBusy} onClick={onAddShot} /> : null}
                {onSplitShot ? <IconButton label="拆分当前镜头" icon={<Scissors size={14} />} density="compact" variant="subtle" disabled={structureBusy || !selectedShot || selectedShot.durationMs <= 2} onClick={onSplitShot} /> : null}
                {onMergeShot ? <IconButton label="合并当前镜头与下一镜头" icon={<Layers3 size={14} />} density="compact" variant="subtle" disabled={structureBusy || !selectedShot} onClick={onMergeShot} /> : null}
              </Toolbar>
            </div> : null}
            {onAddBeat || onRemoveBeat || onMoveBeat ? <div className="director-structure-group director-structure-group--beat">
              <span className="director-structure-group__label">节拍 · {beatTotal > 0 ? `${selectedBeatIndex} / ${beatTotal}` : '未选择'}</span>
              <Toolbar aria-label="节拍结构操作">
                {onMoveBeat ? <><IconButton label="上移当前节拍" icon={<ArrowUp size={14} />} density="compact" variant="subtle" disabled={structureBusy || selectedBeatIndex <= 1} onClick={() => onMoveBeat('up')} /><IconButton label="下移当前节拍" icon={<ArrowDown size={14} />} density="compact" variant="subtle" disabled={structureBusy || selectedBeatIndex >= beatTotal} onClick={() => onMoveBeat('down')} /></> : null}
                {onRemoveBeat ? <IconButton label="删除当前节拍" icon={<Trash2 size={14} />} density="compact" variant="subtle" disabled={structureBusy || !selectedShot || beatTotal <= 1} onClick={() => setRemovingBeatOpen(true)} /> : null}
                {onAddBeat ? <IconButton label="新增节拍" icon={<Plus size={15} />} density="compact" variant="subtle" disabled={structureBusy} onClick={onAddBeat} /> : null}
              </Toolbar>
            </div> : null}
          </div></details> : null}
          <div className="director-shot-search"><TextField label="搜索镜头" value={shotSearch} onChange={(_, data) => setShotSearch(data.value)} placeholder="标题、场景或提示词" /></div>
          <div ref={shotListRef} className="director-shot-list">
            {filteredShots.map((shot) => (
              <Button key={shot.id} density="compact" variant="subtle" aria-pressed={shot.id === selectedShot?.id} className={`director-shot-row ${shot.id === selectedShot?.id ? 'is-active' : ''}`} onClick={() => selectShotAndSeek(shot.id)}>
                <span className="director-shot-row__index">{String(shot.index).padStart(2, '0')}</span>
                <span className="director-shot-thumbnail">{shot.thumbnail ? <DirectorMediaImage src={shot.thumbnail} alt="" /> : <ImageOff size={16} aria-hidden="true" />}</span>
                <span className="director-shot-row__copy"><strong>{shot.title}</strong><small>{formatDuration(shot.durationMs)} · {shot.framing} · {directorShotStatusLabel(shot.status)}</small></span>
                <span className={`director-mini-status is-${shot.status ?? 'ready'}`} aria-label={directorShotStatusLabel(shot.status)} />
              </Button>
            ))}
          </div>
          <div className="director-left-footer"><span><ShieldCheck size={13} />一致性规则已启用</span><small>角色、场景、光线跨镜头锁定</small>{onAddScene ? <Button density="compact" variant="subtle" disabled={structureBusy} onClick={onAddScene}><Plus size={12} />新增场景</Button> : null}</div>
        </Pane>

        <main className="director-center-pane">
          {selectedShot ? (
            <>
              <div className="director-preview-toolbar">
                <div><strong>当前镜头：{String(selectedShot.index).padStart(2, '0')} {selectedShot.title}</strong><span>{selectedShot.scene} · {selectedShot.framing}{outputHistory.length ? outputUrl ? ' · 成片已同步' : ' · 成片已过期' : ''}</span></div>
                <Toolbar aria-label="预览工具">
                  {outputHistory.length ? <IconButton label="成片历史" icon={<History size={14} />} density="compact" variant="subtle" onClick={() => setHistoryOutputId(outputHistory[0].id)} /> : null}
                  <Menu
                    trigger={<Button density="compact" variant="subtle" className="director-preview-ratio">{ratio.split(':')[0]}:{ratio.split(':')[1]} <ChevronDown size={12} /></Button>}
                    options={(['9:16', '16:9', '1:1', '4:3'] as const).map((option) => ({ id: option, label: option, onSelect: () => onRatioChange?.(option) }))}
                  />
                  <Button aria-label={safeAreaVisible ? '隐藏安全区' : '显示安全区'} density="compact" variant={safeAreaVisible ? 'secondary' : 'subtle'} className="director-preview-safe" onClick={() => setSafeAreaVisible((value) => !value)}><ShieldCheck size={13} />安全区</Button>
                  <IconButton label="预览设置" icon={<Settings2 size={14} />} density="compact" variant="subtle" onClick={() => setPreviewSettingsOpen(true)} />
                </Toolbar>
              </div>
              <div className="director-preview-surface" style={previewStyle}
                ref={previewRef}
              >
              <section
                className={`director-media-preview director-layout-${directorSceneLayoutClass(selectedShot.layoutTemplate)}`}
                data-render-strategy={selectedRenderStrategy}
                data-preview-ratio={ratio}
                style={{ aspectRatio: ratio.replace(':', ' / ') }}
                aria-label="镜头预览"
              >
                {showingRenderedVideo ? <video key={outputUrl} controls playsInline preload="metadata" src={outputUrl} aria-label={`${projectTitle}成片预览`} onError={() => setActionError('成片无法播放，请重新生成或检查导出文件。')} /> : (
                  <>
                    <div className="director-preview-frame">
                    {selectedRenderStrategy === 'living-poster' ? (
                      selectedShot.videoUrl ? (
                        <div className="director-deterministic-stage">
                          <video
                            ref={previewVideoRef}
                            key={selectedShot.videoUrl}
                            className="director-shot-video"
                            playsInline
                            preload="auto"
                            src={selectedShot.videoUrl}
                            aria-label={`${selectedShot.title} AI 动态海报预览`}
                            onLoadedMetadata={(event) => {
                              const targetSeconds = Math.max(0, selectedShotPlaybackMs / 1000);
                              event.currentTarget.currentTime = Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0
                                ? Math.min(targetSeconds, Math.max(0, event.currentTarget.duration - 0.01))
                                : targetSeconds;
                            }}
                            onCanPlay={() => setPreviewVideoState({ src: selectedShot.videoUrl ?? '', status: 'ready' })}
                            onError={() => {
                              setPreviewVideoState({ src: selectedShot.videoUrl ?? '', status: 'error' });
                              setActionError('AI 动态海报无法播放，请检查生成文件或重新生成。');
                            }}
                          />
                          {selectedVideoState !== 'ready' ? <div className={`director-media-state is-${selectedVideoState}`} role={selectedVideoState === 'error' ? 'alert' : 'status'}>{selectedVideoState === 'error' ? <CircleAlert size={18} /> : <RefreshCw className="director-spin" size={18} />}{selectedVideoState === 'error' ? '动态海报无法播放' : '正在载入动态海报'}</div> : null}
                        </div>
                      ) : (
                        <div className={`director-video-empty is-${selectedVideoStatus}`} role={selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled' ? 'alert' : 'status'}>
                          {selectedShot.videoInputReady && selectedShot.thumbnail ? <DirectorMediaImage src={selectedShot.thumbnail} alt="AI 动态海报首帧" showStatus={false} /> : null}
                          <span className="director-video-empty__scrim" aria-hidden="true" />
                          <span className="director-video-empty__copy">
                            {selectedVideoStatus === 'running' || selectedVideoStatus === 'queued' ? <RefreshCw className="director-spin" size={20} /> : selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled' ? <CircleAlert size={20} /> : <Video size={20} />}
                            <strong>{selectedVideoStatus === 'running' ? 'AI 动态海报生成中' : selectedVideoStatus === 'queued' ? 'AI 动态海报等待生成' : selectedVideoStatus === 'failed' ? 'AI 动态海报生成失败' : selectedVideoStatus === 'cancelled' ? 'AI 动态海报任务已取消' : '等待生成 AI 动态海报'}</strong>
                            <small>{selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled' ? selectedShot.videoJobError ?? '生成任务未完成，请查看服务返回并重试。' : videoGenerationDisabledReason || `${videoProviderLabel} · ${videoProviderModel}`}</small>
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="director-deterministic-stage" style={previewCameraStyle}>
                        {selectedPreviewLayers.length > 0 ? selectedPreviewLayers.map((layer, index) => (
                          <div className="director-preview-layer" key={layer.id} data-preview-layer-id={layer.id} style={directorLayerStyle(layer, selectedShotPlaybackMs)}>
                            <DirectorMediaImage src={layer.src} alt={layer.label} showStatus={false} onStatusChange={index === 0 ? setPreviewImageStatus : undefined} loadingLabel="正在恢复镜头画面" errorLabel="画面加载失败" />
                          </div>
                        )) : authoredLayersEmpty ? <div className="director-media-state" role="status"><ImageOff size={18} />没有可见的图片图层，请显示图层或补齐图片素材。</div> : selectedShot.thumbnail ? (
                          <div className="director-preview-layer" style={{ zIndex: 0 }}>
                            <DirectorMediaImage src={selectedShot.thumbnail} alt={`${selectedShot.title}预览`} showStatus={false} onStatusChange={setPreviewImageStatus} loadingLabel="正在恢复镜头画面" errorLabel="画面加载失败" />
                          </div>
                        ) : <div className="director-media-state" role="status"><ImageOff size={18} />尚未生成镜头画面</div>}
                      </div>
                    )}
                    {selectedRenderStrategy === 'deterministic-layers' && !authoredLayersEmpty && previewImageStatus !== 'ready' ? <div className={`director-media-state is-${previewImageStatus}`} role={previewImageStatus === 'error' ? 'alert' : 'status'}>{previewImageStatus === 'error' ? <ImageOff size={18} /> : <RefreshCw className="director-spin" size={18} />}{previewImageStatus === 'error' ? '画面加载失败' : '正在恢复镜头画面'}</div> : null}
                    <div className="director-preview-shade" />
                    <div className="director-preview-kicker"><b>{mode === 'vox' ? 'VOX' : 'AI 漫剧'}</b><span>SHOT {String(selectedShot.index).padStart(2, '0')}</span></div>
                    <div className="director-preview-copy">
                      <div className="director-preview-title">{selectedShot.title}</div>
                      {selectedShot.subtitleCues === undefined ? selectedShot.subtitle ? <div className={`director-preview-caption ${directorSceneSubtitleClass(selectedShot.subtitleStyle)}`}>{selectedShot.subtitle}</div> : null : selectedShot.subtitleCues.map((cue) => {
                        const active = playbackMs >= cue.startMs && playbackMs < cue.endMs;
                        return <div key={cue.id} className={`director-preview-caption ${directorSceneSubtitleClass(selectedShot.subtitleStyle)}`} hidden={!active} data-preview-subtitle-cue={cue.id} data-active-subtitle-cue={active ? cue.id : undefined}><DirectorSubtitlePreview cue={cue} timeMs={playbackMs} /></div>;
                      })}
                    </div>
                    </div>
                    {safeAreaVisible ? <div className="director-safe-area" aria-hidden="true" /> : null}
                    {selectedShot.audioClips?.length ? <DirectorAudioPreview clips={selectedShot.audioClips} timeMs={playbackMs} playing={isPlaying} muted={muted} onError={setActionError} /> : selectedShot.audioUrl ? <audio ref={previewAudioRef} key={selectedShot.audioUrl} src={selectedShot.audioUrl} preload="metadata" /> : null}
                  </>
                )}
              </section>
              {!showingRenderedVideo ? <div className="director-preview-transport"><IconButton label={isPlaying ? '暂停' : '播放'} icon={isPlaying ? <Pause size={15} /> : <Play size={15} />} density="compact" variant="subtle" onClick={togglePreview} /><span className="director-timecode">{formatPlaybackTime(playbackMs)} / {formatPlaybackTime(totalDuration)}</span><SliderField fieldClassName="director-scrub-field" label="播放进度" min={0} max={Math.max(1, totalDuration)} step={100} value={Math.min(playbackMs, Math.max(1, totalDuration))} onChange={(_, data) => seekPlayback(Number(data.value))} /><IconButton label={muted ? '打开声音' : '静音'} aria-pressed={muted} icon={<Volume2 size={14} />} density="compact" variant="subtle" onClick={() => setMuted((value) => !value)} /><IconButton label="全屏" icon={<Maximize2 size={14} />} density="compact" variant="subtle" onClick={() => void previewRef.current?.requestFullscreen?.()} /></div> : null}
              </div>
              <section className="director-filmstrip-section" aria-label="分镜胶片条">
                <div className="director-section-bar"><strong>分镜胶片</strong><span>{shots.length} 个镜头 · {formatDuration(totalDuration)}</span>{shotSearch ? <IconButton label="清除镜头搜索" icon={<Search size={14} />} density="compact" variant="subtle" onClick={() => setShotSearch('')} /> : null}</div>
                <div ref={filmstripRef} className="director-filmstrip">
                  {filteredShots.map((shot) => (
                    <Button key={shot.id} aria-label={`选择镜头 ${String(shot.index).padStart(2, '0')} ${shot.title}`} density="compact" variant="subtle" aria-pressed={shot.id === selectedShot.id} className={`director-filmstrip-card ${shot.id === selectedShot.id ? 'is-active' : ''}`} onClick={() => selectShotAndSeek(shot.id)}>
                       <span className="director-filmstrip-image">{shot.thumbnail ? <DirectorMediaImage src={shot.thumbnail} alt="" /> : <span className="director-filmstrip-empty"><ImageIcon size={18} aria-label="暂无画面" /></span>}<small>{String(shot.index).padStart(2, '0')}</small></span>
                       <span className="director-filmstrip-meta"><strong>{shot.title}</strong><small><Clock3 size={11} />{formatDuration(shot.durationMs)} <span className="director-mini-status-label">{directorShotStatusLabel(shot.status)}</span></small></span>
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
                        <div><strong>{selectedShot.voice || '未选择音色'}</strong><span>{voiceConnected ? '已连接' : '待配置'}</span><small>音色头像未提供 · 以试听为准</small></div>
                      </div>
                      <div className="director-narrator-transport">
                        <IconButton label={selectedShot.audioUrl ? '播放旁白' : '生成旁白'} icon={voiceBusyShotId === selectedShot.id ? <RefreshCw className="director-spin" size={14} /> : <Play size={14} />} density="compact" variant="subtle" disabled={voiceBusyShotId === selectedShot.id || (!selectedShot.audioUrl && !voiceConnected)} onClick={() => selectedShot.audioUrl ? void togglePreview() : void generateVoice(selectedShot.id)} />
                        <div className="director-waveform" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
                        <small>{selectedShot.audioUrl ? '旁白已生成' : '等待生成'}</small>
                      </div>
                    </div>
                  ) : null}
                  <div className="director-asset-grid director-asset-gallery">
                    {renderedAssets.map((asset) => (
                      <Button key={asset.id} density="compact" variant="subtle" aria-pressed={asset.selected} className={`director-asset-tile ${asset.selected ? 'is-selected' : ''}`} disabled={asset.selectable === false} onClick={() => onToggleAsset?.(asset)}>
                        <span className="director-asset-thumb">
                          {asset.thumbnail
                            ? <DirectorMediaImage src={asset.thumbnail} alt="" />
                            : <span className="director-asset-missing" role="img" aria-label="缺少参考图"><ImageOff size={16} /><small>缺少参考图</small></span>}
                          {asset.locked ? <LockKeyhole className="director-asset-lock" size={12} /> : null}
                        </span>
                        <span><strong>{asset.label}</strong><small>{asset.warning ?? asset.type}</small></span>
                      </Button>
                    ))}
                    {visibleAssets.length === 0 ? <div className="director-assets-empty">当前分类暂无素材</div> : null}
                  </div>
                  {visibleAssets.length > 9 ? (
                    <div className="director-assets-grid-footer">
                      {showAllAssets ? <DirectorHistoryPager label="素材" {...assetPage} /> : null}
                      <Button
                        density="compact"
                        variant="subtle"
                        aria-expanded={showAllAssets}
                        onClick={() => setShowAllAssets((value) => !value)}
                      >
                        {showAllAssets ? '收起素材' : `显示全部素材（${visibleAssets.length}）`}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="director-source-warning"><CircleAlert size={14} /><span>部分素材来源版权未确认，请在发布前完成版权核查。</span><Button density="compact" variant="subtle" onClick={() => setAssetTab('consistency')}>查看详情</Button></div>
              </section>
            </>
          ) : <div className="director-empty-state"><Film size={32} /><strong>还没有镜头</strong><span>先从剧本或分集结构生成镜头板。</span></div>}
        </main>

        <Pane as="aside" tone="base" className="director-inspector-pane" id="director-inspector" tabIndex={-1} aria-label="镜头检查器">
          <div className="director-inspector-heading"><strong>{selectedShot ? `镜头 ${String(selectedShot.index).padStart(2, '0')}` : '镜头属性'}</strong><Toolbar aria-label="镜头记录"><IconButton label="版本记录" icon={<History size={15} />} variant={inspectorTab === 'version' ? 'secondary' : 'subtle'} density="compact" onClick={() => setInspectorTab('version')} /><IconButton label="审片报告" icon={<ShieldCheck size={15} />} variant={inspectorTab === 'quality' ? 'secondary' : 'subtle'} density="compact" onClick={() => activateStage('审片')} /><IconButton className="director-pane-close director-pane-close--inspector" label="关闭镜头检查器" icon={<X size={16} />} variant="subtle" density="compact" onClick={() => closePane('inspector')} /></Toolbar></div>
          {selectedShot ? (
            <>
              <Tabs label="镜头设置" items={tabItems.filter((item) => (item.value !== 'sound' || onImportSound) && (!['version', 'quality'].includes(item.value) || item.value === inspectorTab))} value={inspectorTab} onChange={(value) => { const next = value as DirectorInspectorTab; setInspectorTab(next); if (next === 'quality') setActiveStage('审片'); else if (next === 'generate' || next === 'mode') setActiveStage('镜头生成'); else if (next === 'sound' || next === 'subtitle') setActiveStage('配音字幕'); }} />
              <div className="director-inspector-scroll">
              {actionError ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>{statusError}</span></div> : null}
              {recheckNotice ? <p className="director-quality-context" role="status" data-quality-recheck-notice>{recheckNotice}</p> : null}
              {inspectorTab === 'quality' ? <section className="director-quality-review" aria-label="审片质量报告" data-quality-freshness={qualityFreshness} data-quality-report-id={latestQualityReport?.id} data-quality-confirmed={qualityConfirmed ? 'true' : 'false'}>
                <div className="director-quality-review__heading"><div><strong>审片质量门</strong><small>{latestQualityReport ? new Date(latestQualityReport.createdAt).toLocaleString('zh-CN') : '尚未生成审片报告'}</small></div><span className={`director-quality-badge is-${qualityBadgeStatus}`}>{qualityBadgeLabel}</span></div>
                {qualityFreshness === 'stale' ? <p className="director-quality-context" role="status">当前内容已变更，以下为历史成片的审片结果。</p> : qualityFreshness === 'unverified' ? <p className="director-quality-context" role="status">该历史报告缺少可核对的生成记录或版本信息。</p> : null}
                {qualityReview?.unassignedCount ? <p className="director-quality-context">{qualityReview.unassignedCount} 份历史报告的分集或版本归属无法核对</p> : null}
                {latestQualityReport ? <>
                  <div className="director-quality-summary" role="status"><span>{qualityFreshness !== 'current' ? '历史报告：' : ''}{qualityPassedCount}/{latestQualityReport.checks.length} 项通过</span><span>{[qualityFailedCount ? `${qualityFailedCount} 项阻断` : '', qualityWarningCount ? `${qualityWarningCount} 项警告` : '', qualityAttentionCount ? `${qualityAttentionCount} 项待处理` : ''].filter(Boolean).join('、') || '未发现阻断项'}</span></div>
                  {qualityConfirmed ? <p className="director-quality-context" role="status">已确认当前版本人工复核 · {new Date(latestQualityReport.manualReview!.confirmedAt).toLocaleString('zh-CN')}</p> : onConfirmQualityReview ? <Button density="compact" variant="secondary" disabled={!qualityCanConfirm || qualityConfirmBusy} onClick={() => void confirmQualityReview()}>{qualityConfirmBusy ? <RefreshCw className="director-spin" size={13} /> : <ShieldCheck size={13} />}{qualityCanConfirm ? '确认已复核当前版本' : '修复阻断项后再确认'}</Button> : null}
                  {latestQualityReport.evidence ? <dl className="director-quality-evidence" aria-label="成片媒体证据">
                    <div><dt>字幕排版测量</dt><dd>{latestQualityReport.evidence.subtitleLayout ? `${latestQualityReport.evidence.subtitleLayout.scenes.filter(scene => scene.status === 'ok').length}/${latestQualityReport.evidence.subtitleLayout.scenes.length} 镜头` : '未取得'}</dd></div>
                    {latestQualityReport.evidence.subtitleLayout ? <div><dt>字幕最多行数</dt><dd>{latestQualityReport.evidence.subtitleLayout.scenes.reduce((maximum, scene) => scene.status === 'ok' ? scene.cues.reduce((value, cue) => Math.max(value, cue.lineCount), maximum) : maximum, 0)} 行</dd></div> : null}
                    <div><dt>平均电平</dt><dd>{latestQualityReport.evidence.audioQualityStatus === 'ok' && Number.isFinite(latestQualityReport.evidence.audioMeanVolumeDb) ? `${latestQualityReport.evidence.audioMeanVolumeDb!.toFixed(1)} dBFS` : '未取得'}</dd></div>
                    <div><dt>音频峰值</dt><dd>{latestQualityReport.evidence.audioQualityStatus === 'ok' && Number.isFinite(latestQualityReport.evidence.audioPeakDb) ? `${latestQualityReport.evidence.audioPeakDb!.toFixed(1)} dBFS` : '未取得'}</dd></div>
                    <div><dt>整合响度</dt><dd>{latestQualityReport.evidence.audioQualityStatus === 'ok' && latestQualityReport.evidence.audioIsSilent ? '全静音，不适用' : latestQualityReport.evidence.audioQualityStatus === 'ok' && Number.isFinite(latestQualityReport.evidence.audioLufs) ? `${latestQualityReport.evidence.audioLufs!.toFixed(1)} LUFS` : '未取得'}</dd></div>
                    <div><dt>真峰值</dt><dd>{latestQualityReport.evidence.audioQualityStatus === 'ok' && latestQualityReport.evidence.audioIsSilent ? '全静音，不适用' : latestQualityReport.evidence.audioQualityStatus === 'ok' && Number.isFinite(latestQualityReport.evidence.audioTruePeakDb) ? `${latestQualityReport.evidence.audioTruePeakDb!.toFixed(1)} dBTP` : '未取得'}</dd></div>
                    <div><dt>黑帧区间</dt><dd>{latestQualityReport.evidence.blackDetectionStatus === 'ok' && latestQualityReport.evidence.blackIntervalsMs ? latestQualityReport.evidence.blackIntervalsMs.length ? latestQualityReport.evidence.blackIntervalsMs.map((interval) => `${(interval.startMs / 1000).toFixed(2)}-${(interval.endMs / 1000).toFixed(2)} 秒`).join('、') : '未检出' : '未取得'}</dd></div>
                    <div><dt>切点帧采样</dt><dd>{latestQualityReport.evidence.visualContinuity?.status === 'ok' ? `${latestQualityReport.evidence.visualContinuity.cuts.length} 个切点 · ${latestQualityReport.evidence.visualContinuity.cuts.length * 4} 帧次` : '未取得'}</dd></div>
                    <div><dt>旁白时长对齐</dt><dd>{latestQualityReport.evidence.narrationAlignment ? `${latestQualityReport.evidence.narrationAlignment.samples.filter((sample) => sample.status === 'aligned').length}/${latestQualityReport.evidence.narrationAlignment.samples.filter((sample) => sample.status !== 'not-applicable').length} 镜头 · ${latestQualityReport.evidence.narrationAlignment.status === 'passed' ? '已测' : latestQualityReport.evidence.narrationAlignment.status === 'failed' ? '需复核' : '待补时长'}` : '未取得'}</dd></div>
                    <div><dt>逐字排版记录</dt><dd>{subtitleGlyphEvidenceLabel}</dd></div>
                  </dl> : null}
                  {latestQualityReport.evidence?.visualContinuity ? <DirectorVisualEvidence key={latestQualityReport.id} evidence={latestQualityReport.evidence.visualContinuity} onLocate={locateRecheckScope} /> : null}
                  <div className="director-quality-checks">{latestQualityReport.checks.map((check) => <div className={`director-quality-check is-${check.status}`} key={check.id}><div><span className="director-quality-check__icon" aria-hidden="true">{check.status === 'passed' ? <Check size={13} /> : check.status === 'failed' ? <CircleAlert size={13} /> : <MoreHorizontal size={13} />}</span><strong>{check.label}</strong><small>{check.severity === 'manual' ? '需人工检查' : check.severity === 'warning' ? '警告' : '阻断检查'}</small></div>{check.detail ? <p>{check.detail}</p> : null}{check.recheckScope ? <><small className="director-quality-check__scope">修复后重检：{formatQualityRecheckScope(check.recheckScope)}</small><Button density="compact" variant="subtle" onClick={() => locateRecheckScope(check.recheckScope!)}><LocateFixed size={13} />定位复检范围</Button>{check.recheckScope.kind === 'subtitle' && onRecheckSubtitles ? <Button density="compact" variant="secondary" disabled={qualityRecheckBusy || busy || qualityFreshness !== 'current'} onClick={() => void recheckSubtitles(check.recheckScope!)}><RefreshCw size={13} className={qualityRecheckBusy ? 'director-spin' : undefined} />局部复检</Button> : check.recheckScope.kind === 'media' && onRecheckMedia ? <Button density="compact" variant="secondary" disabled={qualityRecheckBusy || busy || qualityFreshness !== 'current'} onClick={() => void recheckMedia(check.recheckScope!)}><RefreshCw size={13} className={qualityRecheckBusy ? 'director-spin' : undefined} />媒体局部复检</Button> : null}</> : null}</div>)}</div>
                </> : <div className="director-quality-empty">{mode === 'motion-comic' ? '当前分集暂无审片报告' : '暂无审片报告'}</div>}
                <Button density="compact" variant="secondary" disabled={renderBusy || batchActive || !onRender} onClick={() => void renderProject()}>{renderBusy ? <RefreshCw className="director-spin" size={13} /> : <RefreshCw size={13} />}重新生成并审片</Button>
              </section> : null}
                {inspectorTab === 'mode' ? <>
                  {mode === 'vox' ? <RenderStrategyInspector
                    shot={selectedShot}
                    providerConnected={videoProviderConnected}
                    providerLabel={videoProviderLabel}
                    providerModel={videoProviderModel}
                    providerId={videoProviderId}
                    providerOptions={videoProviderOptions}
                    unavailableReason={videoGenerationDisabledReason}
                    busy={videoBusyShotId === selectedShot.id}
                    onProviderChange={onVideoProviderChange}
                    onConfigureProvider={onConfigureVideoProvider}
                    onUpdate={onUpdateShot}
                  /> : null}
                  <DirectorMotionInspector key={selectedShot.id} shot={selectedShot} onUpdate={onUpdateShot} onEdit={onUpdateShotMotion} busy={structureBusy} timeMs={selectedShotPlaybackMs} playing={isPlaying} onSeek={seekMotionPreview} onPreview={playMotionPreview} />
                  {mode === 'vox' && styleCandidates.length > 0 ? <section className="director-style-candidates" aria-label="风格试片"><div className="director-style-candidates__heading"><strong>风格试片</strong><small>选择后会作为后续镜头生成的风格基准；样片会保留在项目资产历史中</small></div><div className="director-style-candidates__list">{styleCandidates.map((style) => { const selected = style.id === selectedStyleId || style.selected; const generating = styleBusyId === style.id; return <div className={`director-style-candidate-row ${selected ? 'is-selected' : ''}`} key={style.id}><Button density="compact" variant={selected ? 'secondary' : 'subtle'} disabled={structureBusy} aria-pressed={selected} className="director-style-candidate-select" onClick={() => onSelectStyle?.(style.id)}>{style.thumbnail ? <img className="director-style-candidate-thumb" src={style.thumbnail} alt="" /> : <span className="director-style-candidate-placeholder" aria-hidden="true"><ImageIcon size={14} /></span>}<span className="director-style-candidate-copy"><strong>{style.label}</strong><small>{style.prompt}</small></span><span className="director-style-candidates__asset">{style.assetVersionId ? '已有样片' : '待试片'}</span></Button>{onGenerateStyleCandidate ? <IconButton label={`${generating ? '正在生成' : '生成'}${style.label}试片`} icon={generating ? <RefreshCw className="director-spin" size={13} /> : <WandSparkles size={13} />} density="compact" variant="subtle" disabled={structureBusy || generating} onClick={() => void generateStyleCandidate(style.id)} /> : null}</div>; })}</div></section> : null}
                </> : null}
                {inspectorTab === 'generate' ? (
                  <>
                    {mode === 'vox' ? <RenderStrategyInspector
                      compact
                      shot={selectedShot}
                      providerConnected={videoProviderConnected}
                      providerLabel={videoProviderLabel}
                      providerModel={videoProviderModel}
                      providerId={videoProviderId}
                      providerOptions={videoProviderOptions}
                      unavailableReason={videoGenerationDisabledReason}
                      busy={videoBusyShotId === selectedShot.id}
                      onProviderChange={onVideoProviderChange}
                      onConfigureProvider={onConfigureVideoProvider}
                      onUpdate={onUpdateShot}
                    /> : null}
                    <FrameInspector shot={selectedShot} onUpdate={onUpdateShot} />
                    <div className="director-inspector-actions">
                      <div className="director-provider-line"><span className={providerConnected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} /><span className="director-provider-name" title={providerConnected ? `${providerLabel} 已连接` : '图片服务未连接'}>{providerConnected ? `${providerLabel} 已连接` : '图片服务未连接'}</span><span className="director-cost">{(selectedShot.cost ?? estimatedCost) > 0 ? `约 ¥ ${(selectedShot.cost ?? estimatedCost).toFixed(2)}` : '以接口账单为准'}</span></div>
                      <SelectField label="图片生成服务" value={providerProfileId ?? providerLabel} options={providerOptions.length > 0 ? providerOptions : [{ value: providerLabel, label: `${providerLabel} · ${providerModel} · ${providerResolution}` }]} disabled={busy || batchActive || !onProviderProfileChange} onChange={(event) => void onProviderProfileChange?.(event.target.value)} />
                      <GenerationDetails shot={selectedShot} ratio={ratio} onUpdate={onUpdateShot} onRatioChange={onRatioChange} durationEditable={Boolean(onMoveShot)} busy={structureBusy} />
                       {!providerConnected && providerUnavailableReason ? <div className="director-inspector-note is-warning"><CircleAlert size={14} /><span>{providerUnavailableReason}</span>{onConfigureProvider ? <Button density="compact" variant="secondary" onClick={onConfigureProvider}>配置图片服务</Button> : null}</div> : null}
                    </div>
                  </>
                ) : null}
                {inspectorTab === 'subtitle' ? <div className="director-subtitle-workspace"><VoiceInspector shot={selectedShot} onUpdate={onUpdateShot} connected={voiceConnected} providerLabel={voiceProviderLabel} model={voiceModel} unavailableReason={voiceUnavailableReason} voiceOptions={voiceOptions} busy={batchActive || voiceBusyShotId === selectedShot.id} onGenerate={() => void generateVoice(selectedShot.id)} onPreview={() => void togglePreview()} />{onUpdateSubtitleCue && onAddSubtitleCue && onRemoveSubtitleCue && onAlignSubtitleCue ? <DirectorSubtitleInspector key={selectedShot.id} cues={selectedShot.subtitleCues ?? []} focusCueId={focusedCueId} characters={selectedShot.dialogueCharacters} voiceConnected={voiceConnected} onGenerateVoice={onGenerateDialogueVoice ? (cueId) => void generateVoice(selectedShot.id, cueId) : undefined} onImportTimestamps={onImportSubtitleTimestamps ? (cueId) => onImportSubtitleTimestamps(selectedShot.id, cueId) : undefined} shotStartMs={selectedShotOffset} durationMs={selectedShot.durationMs} busy={batchActive || voiceBusyShotId === selectedShot.id} style={selectedShot.subtitleStyle ?? '简体中文 · 白色描边'} safeAreaVisible={safeAreaVisible} onUpdate={(cueId, patch) => onUpdateSubtitleCue(selectedShot.id, cueId, patch)} onAdd={() => onAddSubtitleCue(selectedShot.id)} onRemove={(cueId) => onRemoveSubtitleCue(selectedShot.id, cueId)} onAlign={(cueId) => onAlignSubtitleCue(selectedShot.id, cueId)} onSeek={(timeMs) => { setIsPlaying(false); seekPlayback(timeMs); }} onStyleChange={(style) => onUpdateShot(selectedShot.id, { subtitleStyle: style })} onSafeAreaChange={setSafeAreaVisible} /> : <SubtitleInspector shot={selectedShot} onUpdate={onUpdateShot} safeAreaVisible={safeAreaVisible} onSafeAreaChange={setSafeAreaVisible} />}</div> : null}
                {inspectorTab === 'version' ? <VersionInspector shot={selectedShot} versions={versions} dirty={dirty} onSave={onSave} onRestoreVersion={onRestoreVersion} /> : null}
                {inspectorTab === 'sound' && onUpdateSoundClip && onRemoveSoundClip && onImportSound ? <DirectorSoundInspector key={selectedShot.id} clips={selectedShot.soundClips ?? []} shotStartMs={selectedShotOffset} durationMs={selectedShot.durationMs} busy={busy || renderBusy || batchActive || Boolean(voiceBusyShotId)} onUpdate={(id, patch) => onUpdateSoundClip(selectedShot.id, id, patch)} onRemove={(id) => onRemoveSoundClip(selectedShot.id, id)} onImport={(track) => onImportSound(selectedShot.id, track)} onSeek={(timeMs) => { setIsPlaying(false); seekPlayback(timeMs); }} /> : null}
              </div>
              {inspectorTab === 'generate' ? <div className="director-action-footer" aria-label="镜头生成操作">
                <div className="director-seed-row"><TextField label="Seed 锁定" value={selectedShot.seed ?? '24681357'} readOnly={selectedShot.seedLocked ?? seedLocked} onChange={(_, data) => onUpdateShot(selectedShot.id, { seed: data.value })} /><Button density="compact" variant={(selectedShot.seedLocked ?? seedLocked) ? 'secondary' : 'subtle'} onClick={() => { const next = !(selectedShot.seedLocked ?? seedLocked); setSeedLocked(next); onUpdateShot(selectedShot.id, { seedLocked: next }); }}><LockKeyhole size={13} />{(selectedShot.seedLocked ?? seedLocked) ? '已锁定' : '未锁定'}</Button></div>
                {selectedRenderStrategy === 'living-poster' ? <div className="director-primary-stack">
                  <Button variant="secondary" density="compact" title={!providerConnected ? providerUnavailableReason || '图片生成服务未配置' : undefined} onClick={() => void startGeneration(selectedShot.id)} disabled={busy || batchActive || !providerConnected || selectedQueueItem?.status === 'running'}><ImageIcon size={14} />{selectedShot.videoInputReady ? '更新首帧' : '生成首帧'}</Button>
                  <Button className="director-primary-action" variant="primary" density="comfortable" title={videoGenerationDisabledReason || undefined} onClick={() => void generateVideo(selectedShot.id, selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled')} disabled={busy || batchActive || Boolean(videoGenerationDisabledReason) || selectedVideoStatus === 'running' || selectedVideoStatus === 'queued'}>{videoBusyShotId === selectedShot.id || selectedVideoStatus === 'running' ? <RefreshCw className="director-spin" size={15} /> : selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled' ? <RotateCcw size={15} /> : <Video size={15} />}{selectedVideoStatus === 'failed' || selectedVideoStatus === 'cancelled' ? '重试 AI 动态海报' : selectedShot.videoUrl ? '重新生成 AI 动态海报' : '生成 AI 动态海报'}</Button>
                </div> : <Button className="director-primary-action" variant="primary" density="comfortable" onClick={() => void startGeneration(selectedShot.id)} disabled={busy || batchActive || !providerConnected || selectedQueueItem?.status === 'running'}><WandSparkles size={15} />生成当前镜头</Button>}
                <div className="director-secondary-actions"><Button density="compact" variant="subtle" onClick={togglePreview}>{isPlaying ? <Pause size={13} /> : <Play size={13} />}{isPlaying ? '暂停' : '预览'}</Button><Button density="compact" variant="subtle" disabled={batchActive} onClick={() => onSave()}><Save size={13} />保存版本</Button><Button density="compact" variant="secondary" disabled={renderBusy || batchActive} onClick={() => void renderProject()}>{renderBusy ? <RefreshCw className="director-spin" size={13} /> : <Film size={13} />}生成成片</Button>{onOpenOutput ? <IconButton label="打开导出目录" icon={outputBusy ? <RefreshCw className="director-spin" size={14} /> : <Download size={14} />} density="compact" variant="subtle" disabled={!outputUrl || outputBusy} onClick={() => void openOutput()} /> : null}</div>
              </div> : null}
              <QueuePanel
                queue={queue}
                batchNodes={batchNodes}
                batchRunState={batchRunState}
                recoveryRequired={Boolean(batchRecordRef.current?.recoveryRequired)}
                onOpenBatch={() => setBatchPlanOpen(true)}
                onPauseBatch={pauseBatch}
                onResumeBatch={resumeBatch}
                onCancelBatch={cancelBatch}
                onRetryBatch={retryFailedBatch}
                onRetry={retryGeneration}
              />
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
        open={batchPlanOpen}
        title="批量生成计划"
        onOpenChange={setBatchPlanOpen}
        actions={<><Button variant="subtle" onClick={() => setBatchPlanOpen(false)}>取消</Button><Button variant="primary" disabled={batchActive || batchPlan.nodes.length === 0 || batchUnavailableReasons.length > 0 || Boolean(batchHistoryError)} onClick={() => void runBatch(batchPlan.nodes)}><WandSparkles size={14} />开始批量生成</Button></>}
      >
        <div className="director-batch-dialog">
          <section className="director-batch-section">
            <div className="director-batch-section-heading"><strong>生成范围</strong><span>{shots.length} 个镜头</span></div>
            <SegmentedControl
              label="批量生成范围"
              value={batchScope}
              options={[
                { value: 'missing', label: '仅缺失/失败' },
                { value: 'failed', label: '仅上次失败' },
                { value: 'all', label: '全部重做' },
              ]}
              onChange={setBatchScope}
            />
          </section>
          <section className="director-batch-section">
            <div className="director-batch-section-heading"><strong>生成内容</strong><span>可组合执行</span></div>
            <div className="director-batch-capabilities">
              <CheckboxField label="镜头画面" checked={batchCapabilities.image} disabled={!onGenerateShot} onChange={(_, data) => updateBatchCapability('image', Boolean(data.checked))} />
              <CheckboxField label="AI 动态海报" checked={batchCapabilities.video} disabled={!onGenerateVideo} onChange={(_, data) => updateBatchCapability('video', Boolean(data.checked))} />
              <CheckboxField label="旁白音频" checked={batchCapabilities.voice} disabled={!onGenerateVoice} onChange={(_, data) => updateBatchCapability('voice', Boolean(data.checked))} />
              <CheckboxField label="最终成片" checked={batchCapabilities.render} disabled={!onRender} onChange={(_, data) => updateBatchCapability('render', Boolean(data.checked))} />
            </div>
          </section>
          <div className="director-batch-settings">
            <SelectField label="并发任务" value={String(batchConcurrency)} options={[1, 2, 3, 4].map((value) => ({ value: String(value), label: `${value} 个并发` }))} onChange={(event) => setBatchConcurrency(Number(event.target.value))} />
            <div className="director-batch-cost"><small>预估费用</small><strong>{batchPlan.estimatedCost > 0 ? `¥ ${batchPlan.estimatedCost.toFixed(2)}` : '以接口账单为准'}</strong></div>
          </div>
          <div className="director-batch-summary" aria-label="批量节点摘要">
            <span><ImageIcon size={14} /><strong>{batchPlan.imageCount}</strong><small>画面</small></span>
            <span><Video size={14} /><strong>{batchPlan.videoCount}</strong><small>动态海报</small></span>
            <span><Volume2 size={14} /><strong>{batchPlan.voiceCount}</strong><small>配音</small></span>
            <span><Film size={14} /><strong>{batchPlan.renderCount}</strong><small>成片</small></span>
            <span><Clock3 size={14} /><strong>{batchPlan.nodes.length}</strong><small>总节点</small></span>
          </div>
          {batchUnavailableReasons.length > 0 ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>{batchUnavailableReasons.join(' ')}</span></div> : null}
          {historyUsage ? <div className="director-batch-history" aria-label="项目历史容量">
            <span>素材版本 {historyUsage.assets} + {batchHistoryDemand.assets} / {MAX_PRODUCTION_HISTORY_ITEMS}</span>
            <span>生成记录 {historyUsage.providerJobs} + {batchHistoryDemand.providerJobs} / {MAX_PRODUCTION_HISTORY_ITEMS}</span>
            {batchHistoryDemand.qualityReports > 0 ? <span>审片记录 {historyUsage.qualityReports} + {batchHistoryDemand.qualityReports} / {MAX_PRODUCTION_HISTORY_ITEMS}</span> : null}
          </div> : null}
          {batchHistoryError ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>{batchHistoryError}</span></div> : null}
          {batchPlan.nodes.length === 0 ? <div className="director-batch-empty"><Check size={16} /><span>当前范围没有需要执行的生成节点。</span></div> : <div className="director-batch-preview-list">{batchPlan.nodes.slice(0, 8).map((node) => <div key={node.id}><span className={`director-batch-capability is-${node.capability}`}>{directorBatchCapabilityLabel(node.capability)}</span><strong>{node.title}</strong><small>{node.estimatedCost > 0 ? `约 ¥ ${node.estimatedCost.toFixed(2)}` : '费用待接口结算'}</small></div>)}{batchPlan.nodes.length > 8 ? <span>另有 {batchPlan.nodes.length - 8} 个节点</span> : null}</div>}
        </div>
      </Dialog>
      <Dialog open={Boolean(removingShot)} title="删除当前镜头" onOpenChange={(open) => { if (!open) setRemovingShotId(''); }} actions={<>
        <Button variant="subtle" onClick={() => setRemovingShotId('')}>取消</Button>
        <Button variant="primary" icon={<Trash2 size={14} />} disabled={structureBusy || !removingShot || shots.length <= 1} onClick={() => { if (removingShot && !structureBusy && shots.length > 1) onRemoveShot?.(removingShot.id); setRemovingShotId(''); }}>删除镜头</Button>
      </>}><p>删除“{removingShot?.title}”及其字幕、声音片段？素材历史仍会保留。</p></Dialog>
      <Dialog open={removingBeatOpen} title="删除当前节拍" onOpenChange={(open) => { if (!open) setRemovingBeatOpen(false); }} actions={<>
        <Button variant="subtle" onClick={() => setRemovingBeatOpen(false)}>取消</Button>
        <Button variant="primary" icon={<Trash2 size={14} />} disabled={structureBusy || !selectedShot || beatTotal <= 1} onClick={() => { if (!structureBusy && selectedShot && beatTotal > 1) onRemoveBeat?.(); setRemovingBeatOpen(false); }}>删除节拍</Button>
      </>}><p>删除第 {selectedBeatIndex} 节拍及其中的镜头、字幕和声音片段？素材历史仍会保留。</p></Dialog>
      <Dialog open={Boolean(historyOutput)} title="成片历史" onOpenChange={(open) => { if (!open) setHistoryOutputId(''); }} actions={<Button variant="primary" onClick={() => setHistoryOutputId('')}>关闭</Button>}>
        <div className="director-dialog-stack">
          <SelectField label="成片版本" value={historyOutputId} options={outputHistory.map((output) => ({ value: output.id, label: `${new Date(output.createdAt).toLocaleString('zh-CN')} · ${output.current ? '当前版本' : '历史版本'}` }))} onChange={(event) => setHistoryOutputId(event.target.value)} />
          <span role="status">{historyOutput?.current ? '与当前编辑一致' : '历史成片，与当前编辑不一致'}</span>
          {historyOutput?.url ? <video key={historyOutput.id} src={historyOutput.url} controls preload="metadata" aria-label="历史成片预览" style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'contain' }} /> : <span>成片文件路径缺失</span>}
        </div>
      </Dialog>
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
  const [loadState, setLoadState] = useState<{ src: string; status: 'loading' | 'ready' | 'error' }>(() => ({ src, status: 'loading' }));
  const status = loadState.src === src ? loadState.status : 'loading';
  useLayoutEffect(() => {
    onStatusChange?.('loading');
  }, [onStatusChange, src]);
  const updateStatus = (next: 'ready' | 'error') => {
    setLoadState({ src, status: next });
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

function RenderStrategyInspector({
  compact = false,
  shot,
  providerConnected,
  providerLabel,
  providerModel,
  providerId,
  providerOptions,
  unavailableReason,
  busy,
  onProviderChange,
  onConfigureProvider,
  onUpdate,
}: {
  compact?: boolean;
  shot: DirectorShot;
  providerConnected: boolean;
  providerLabel: string;
  providerModel: string;
  providerId?: string;
  providerOptions: readonly DirectorProviderOption[];
  unavailableReason: string;
  busy: boolean;
  onProviderChange?: (providerId: string) => void | Promise<void>;
  onConfigureProvider?: () => void;
  onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'];
}) {
  const rawStrategy = shot.renderStrategy as string | undefined;
  const strategy: DirectorRenderStrategy = rawStrategy === 'living-poster' ? 'living-poster' : 'deterministic-layers';
  const legacyStrategyBlocked = Boolean(rawStrategy && !DIRECTOR_RENDER_STRATEGIES.includes(rawStrategy as DirectorRenderStrategy));
  const status = busy ? 'running' : shot.videoUrl ? 'completed' : shot.videoJobStatus ?? 'idle';
  const statusLabel = directorVideoStatusLabel(status);
  return <section className="director-render-strategy" aria-label="镜头渲染策略">
    {!compact ? <div className="director-render-strategy__heading">
      <span><strong>渲染引擎</strong><small>每个镜头独立选择</small></span>
      <span className={`director-engine-state is-${strategy === 'living-poster' ? status : 'local'}`}>{strategy === 'living-poster' ? statusLabel : '本地实时'}</span>
    </div> : null}
    <SegmentedControl
      label="镜头渲染策略"
      value={strategy}
      options={[
        { value: 'deterministic-layers', label: <span className="director-engine-option"><Layers3 size={13} />本地关键帧</span> },
        { value: 'living-poster', label: <span className="director-engine-option"><Video size={13} />AI 动态海报</span> },
      ]}
      onChange={(value) => onUpdate(shot.id, { renderStrategy: value })}
    />
    {legacyStrategyBlocked ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>旧版混合渲染模式已停用，请选择本地关键帧或 AI 动态海报。</span></div> : null}
    {strategy === 'deterministic-layers' ? (compact ? null : <div className="director-engine-summary"><Layers3 size={15} /><span><strong>确定性图层合成</strong><small>图层和相机关键帧直接跟随时间线播放，不产生额外视频费用。</small></span></div>) : <div className="director-video-job" aria-live="polite">
      {providerOptions.length > 0 ? <SelectField label="视频生成服务" value={providerId ?? ''} options={providerOptions} disabled={busy || !onProviderChange} onChange={(event) => void onProviderChange?.(event.target.value)} /> : null}
      <div className="director-provider-line"><span className={providerConnected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} /><span className="director-provider-name" title={providerConnected ? `${providerLabel} · ${providerModel}` : '视频服务未连接'}>{providerConnected ? `${providerLabel} · ${providerModel}` : '视频服务未连接'}</span><span className="director-cost">{(shot.videoEstimatedCost ?? 0) > 0 ? `约 ¥ ${shot.videoEstimatedCost?.toFixed(2)}` : '以接口账单为准'}</span></div>
      <div className="director-video-readiness">
        <span className={shot.videoInputReady ? 'is-ready' : 'is-blocked'}>{shot.videoInputReady ? <Check size={13} /> : <CircleAlert size={13} />}{shot.videoInputReady ? '首帧可用' : '缺少可读首帧'}</span>
        <span className={`is-${status}`}>{status === 'completed' ? <Check size={13} /> : status === 'failed' || status === 'cancelled' ? <CircleAlert size={13} /> : status === 'running' || status === 'queued' ? <RefreshCw className={status === 'running' ? 'director-spin' : undefined} size={13} /> : <Clock3 size={13} />}{statusLabel}</span>
      </div>
      {shot.videoJobId ? <small className="director-video-job-id" title={shot.videoJobId}>任务 {shot.videoJobId}</small> : null}
      {shot.videoJobError ? <div className="director-inspector-note is-warning" role="alert"><CircleAlert size={14} /><span>{shot.videoJobError}</span></div> : null}
      {unavailableReason ? <div className="director-inspector-note is-warning"><CircleAlert size={14} /><span>{unavailableReason}</span>{onConfigureProvider ? <Button density="compact" variant="secondary" onClick={onConfigureProvider}>配置视频服务</Button> : null}</div> : null}
    </div>}
  </section>;
}

function FrameInspector({ shot, onUpdate }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'] }) {
  return <div className="director-form-stack"><TextAreaField fieldClassName="director-prompt-field" label="编辑提示词" value={shot.prompt} onChange={(_, data) => onUpdate(shot.id, { prompt: data.value })} resize="vertical" hint={`${shot.prompt.length} / 1000`} /><SelectField label="版式模板" value={shot.layoutTemplate ?? '对比拼贴 · 纸张撕裂'} options={[{ value: '对比拼贴 · 纸张撕裂', label: '对比拼贴 · 纸张撕裂' }, { value: '纪录片 · 纯画面', label: '纪录片 · 纯画面' }, { value: '漫画分格 · 角色优先', label: '漫画分格 · 角色优先' }]} onChange={(event) => onUpdate(shot.id, { layoutTemplate: event.target.value as DirectorLayoutTemplate })} /><SelectField label="运动控制" hint="套用预设会替换相机关键帧" value={shot.motionPreset ?? '平移 + 缓慢推进'} options={[{ value: '平移 + 缓慢推进', label: '平移 + 缓慢推进' }, { value: '轻微视差', label: '轻微视差' }, { value: '固定机位', label: '固定机位' }]} onChange={(event) => onUpdate(shot.id, { motionPreset: event.target.value as DirectorMotionPreset })} /></div>;
}

function GenerationDetails({ shot, ratio, onUpdate, onRatioChange, durationEditable, busy }: { shot: DirectorShot; ratio: DirectorDeskWorkspaceProps['ratio']; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot']; onRatioChange?: DirectorDeskWorkspaceProps['onRatioChange']; durationEditable?: boolean; busy?: boolean }) {
  // Voice selection is owned by the subtitle/voice inspector. A single-option
  // dropdown here looked editable while silently writing a hard-coded speaker.
  // Keep this panel descriptive and point authors to the real voice control.
  const voice = shot.voice || '跟随旁白设置';
  const subtitleStyle = shot.subtitleStyle ?? '简体中文 · 白色描边';
  return <div className="director-form-stack director-generation-details"><SelectField label="画面比例" value={ratio ?? '16:9'} options={(['9:16', '16:9', '1:1', '4:3'] as const).map((option) => ({ value: option, label: ratioLabel(option) }))} onChange={(event) => onRatioChange?.(event.target.value as NonNullable<DirectorDeskWorkspaceProps['ratio']>)} /><div className="director-two-col">{durationEditable ? <ShotDurationField key={shot.id} shot={shot} disabled={busy} onUpdate={onUpdate} /> : <TextField label="时长" value={formatDuration(shot.durationMs)} readOnly />}<TextField label="帧率" value="24 fps" readOnly /></div><TextField label="音色" value={voice} readOnly hint="请在“旁白与字幕”中选择真实音色" /><SelectField label="字幕样式" value={subtitleStyle} options={[{ value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' }, { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' }]} onChange={(event) => onUpdate(shot.id, { subtitleStyle: event.target.value })} /></div>;
}

function ShotDurationField({ shot, disabled, onUpdate }: { shot: DirectorShot; disabled?: boolean; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'] }) {
  const [value, setValue] = useState(String(shot.durationMs / 1000));
  const [error, setError] = useState('');
  useEffect(() => { setValue(String(shot.durationMs / 1000)); setError(''); }, [shot.durationMs]);
  function commit() {
    const durationMs = Math.round(Number(value) * 1000);
    if (!value.trim() || !Number.isFinite(durationMs) || durationMs < 1 || durationMs > 60_000) { setError('请输入 0.001 至 60 秒。'); return; }
    if (disabled) return;
    try { if (durationMs !== shot.durationMs) onUpdate(shot.id, { durationMs }); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '时长更新失败。'); }
  }
  return <TextField label="时长（秒）" type="number" min={0.001} max={60} step={0.1} value={value} disabled={disabled} validationMessage={error || undefined} onChange={(_, data) => { setValue(data.value); setError(''); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setValue(String(shot.durationMs / 1000)); setError(''); } }} />;
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
  onPreview,
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
  onPreview: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playError, setPlayError] = useState('');
  useEffect(() => {
    setPlayError('');
    const audio = audioRef.current;
    return () => audio?.pause();
  }, [shot.id, shot.audioUrl]);
  const selectedVoiceId = shot.voiceId || voiceOptions[0]?.value || '';
  const selectedVoiceLabel = voiceOptions.find((voice) => voice.value === selectedVoiceId)?.label ?? shot.voice ?? selectedVoiceId;
  const speed = shot.voiceSpeed ?? 1;
  const play = () => {
    setPlayError('');
    if (shot.audioClips?.length) { onPreview(); return; }
    if (shot.audioUrl && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => setPlayError('音频无法播放，请检查文件或重新生成旁白。'));
      return;
    }
    onGenerate();
  };
  return <div className="director-form-stack"><div className="director-provider-line"><span className={connected ? 'director-status-dot is-ok' : 'director-status-dot is-warn'} /><span className="director-provider-name" title={connected ? `${providerLabel} · ${model}` : '旁白服务未连接'}>{connected ? `${providerLabel} · ${model}` : '旁白服务未连接'}</span></div><SelectField label={shot.dialogueCharacters ? "镜头默认音色" : "音色"} value={selectedVoiceId} options={voiceOptions.length ? [...voiceOptions] : [{ value: selectedVoiceId, label: selectedVoiceLabel || '未配置音色（请先配置旁白服务）' }]} disabled={!connected || busy} onChange={(event) => { const option = voiceOptions.find((voice) => voice.value === event.target.value); onUpdate(shot.id, { voiceId: event.target.value, voice: option?.label ?? event.target.value }); }} /><div className="director-voice-preview"><IconButton label={shot.audioUrl ? '播放旁白' : '生成旁白'} icon={busy ? <RefreshCw className="director-spin" size={13} /> : <Play size={13} />} density="compact" variant="subtle" disabled={busy || (!shot.audioUrl && !connected)} onClick={play} /><div className="director-waveform"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div><small>{shot.audioUrl ? '旁白已生成' : '等待生成'}</small>{shot.audioUrl ? <audio ref={audioRef} src={shot.audioUrl} preload="metadata" /> : null}</div><SelectField label="语速" value={String(speed)} options={[{ value: '0.98', label: '0.98x' }, { value: '1', label: '1.00x' }, { value: '1.05', label: '1.05x' }]} disabled={!connected || busy} onChange={(event) => onUpdate(shot.id, { voiceSpeed: Number(event.target.value) })} />{!connected && unavailableReason ? <div className="director-inspector-note is-warning"><CircleAlert size={14} /><span>{unavailableReason}</span></div> : null}<Button density="compact" variant="secondary" disabled={!connected || busy || !shot.subtitle.trim()} onClick={onGenerate}>{busy ? <RefreshCw className="director-spin" size={13} /> : <Volume2 size={13} />}{shot.audioUrl ? '重新生成旁白' : '生成旁白'}</Button>{playError ? <div role="alert" className="director-inspector-note is-warning">{playError}</div> : null}</div>;
}

function SubtitleInspector({ shot, onUpdate, safeAreaVisible, onSafeAreaChange }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot']; safeAreaVisible: boolean; onSafeAreaChange: (value: boolean) => void }) {
  return <div className="director-form-stack"><TextAreaField fieldClassName="director-prompt-field" label="字幕内容" value={shot.subtitle} onChange={(_, data) => onUpdate(shot.id, { subtitle: data.value })} resize="vertical" /><SelectField label="字幕样式" value={shot.subtitleStyle ?? '简体中文 · 白色描边'} options={[{ value: '简体中文 · 白色描边', label: '简体中文 · 白色描边' }, { value: '简体中文 · 下方黑底', label: '简体中文 · 下方黑底' }]} onChange={(event) => onUpdate(shot.id, { subtitleStyle: event.target.value })} /><CheckboxField label="显示安全区提示" checked={safeAreaVisible} onChange={(_, data) => onSafeAreaChange(Boolean(data.checked))} /><div className="director-inspector-note"><Flag size={14} /><span>字幕 cue 与视觉镜头独立保存，不会增加镜头数量。</span></div></div>;
}

function VersionInspector({ shot, versions, dirty, onSave, onRestoreVersion }: { shot: DirectorShot; versions: readonly DirectorVersion[]; dirty: boolean; onSave: () => void; onRestoreVersion?: (versionId: string) => void }) {
  const versionPage = useDirectorHistoryPage(versions, shot.id);
  return <div className="director-version-panel"><div><strong>当前镜头版本</strong><span>镜头 {String(shot.index).padStart(2, '0')} · {shot.provider || '本地草稿'}</span></div><div className="director-inspector-note"><HardDrive size={14} /><span>生成记录会保留在项目中，可恢复任意已生成画面。</span></div><Button density="compact" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={onSave}><Save size={13} />{dirty ? '保存当前版本' : '版本已保存'}</Button><DirectorHistoryPager label="镜头版本" {...versionPage} /><div className="director-version-list">{versions.length === 0 ? <span>当前镜头还没有历史版本。</span> : versionPage.items.map((version) => <Button key={version.id} density="compact" variant={version.selected ? 'secondary' : 'subtle'} aria-pressed={version.selected} onClick={() => onRestoreVersion?.(version.id)}><span>{version.label}</span><small>{version.provider ?? '本地'} · {formatVersionDate(version.createdAt)}</small></Button>)}</div></div>;
}

function QueuePanel({
  queue,
  batchNodes,
  batchRunState,
  recoveryRequired,
  onOpenBatch,
  onPauseBatch,
  onResumeBatch,
  onCancelBatch,
  onRetryBatch,
  onRetry,
}: {
  queue: readonly DirectorQueueItem[];
  batchNodes: readonly DirectorBatchNode[];
  batchRunState: DirectorBatchRunState;
  recoveryRequired: boolean;
  onOpenBatch: () => void;
  onPauseBatch: () => void;
  onResumeBatch: () => void;
  onCancelBatch: () => void;
  onRetryBatch: () => void;
  onRetry: (item: DirectorQueueItem) => void;
}) {
  const [status, setStatus] = useState('all');
  const filteredQueue = queue.filter((item) => status === 'all' || (status === 'active' ? item.status === 'running' || item.status === 'waiting' : item.status === status));
  const queuePage = useDirectorHistoryPage(filteredQueue, status);
  const batchPage = useDirectorHistoryPage(batchNodes, batchNodes[0]?.id ?? 'empty');
  const retryable = batchNodes.some((node) => node.status === 'failed' || node.status === 'skipped');
  const batchStatus = batchRunState === 'starting' ? '正在保存批次' : batchRunState === 'running' ? '批量生成中' : batchRunState === 'paused' ? '批量生成已暂停' : batchRunState === 'cancelling' ? '正在结束运行中节点' : batchRunState === 'finished' ? '最近一次批量任务已结束' : '尚未开始批量生成';
  return <section className="director-queue-panel" aria-label="生成队列">
    <div className="director-queue-heading">
      <div><strong>生成队列 ({queue.length})</strong><span>进行中 {queue.filter((item) => item.status === 'running').length} · 失败 {queue.filter((item) => item.status === 'failed').length}</span></div>
      <Button density="compact" variant="secondary" onClick={onOpenBatch}><WandSparkles size={12} />批量生成</Button>
    </div>
    {batchNodes.length > 0 ? <div className="director-batch-run">
      <div className="director-batch-run-heading">
        <span><strong>{batchStatus}</strong><small>{batchNodes.filter((node) => node.status === 'completed').length}/{batchNodes.length} 已完成</small>{recoveryRequired ? <small className="is-warning">继续前需核对远端状态</small> : null}</span>
        <Toolbar aria-label="批量生成控制">
          {batchRunState === 'running' ? <IconButton label="暂停批量生成" icon={<Pause size={13} />} density="compact" variant="subtle" onClick={onPauseBatch} /> : null}
          {batchRunState === 'paused' ? <IconButton label={recoveryRequired ? '核对远端后继续批量生成' : '恢复批量生成'} icon={<Play size={13} />} density="compact" variant="subtle" onClick={onResumeBatch} /> : null}
          {batchRunState === 'running' || batchRunState === 'paused' ? <Button density="compact" variant="danger" onClick={onCancelBatch}>取消未开始项</Button> : null}
          {batchRunState === 'finished' && retryable ? <Button density="compact" variant="danger" onClick={onRetryBatch}><RotateCcw size={12} />重试失败项</Button> : null}
        </Toolbar>
      </div>
      <DirectorHistoryPager label="批次节点" {...batchPage} />
      <div className="director-batch-run-list">{batchPage.items.map((node) => {
        const uncertain = recoveryRequired && node.status === 'running';
        return <div className={`director-batch-node is-${node.status}`} key={node.id}><span className={`director-batch-capability is-${node.capability}`}>{directorBatchCapabilityLabel(node.capability)}</span><span><strong title={node.title}>{node.title}</strong><small title={node.error}>{uncertain ? '远端状态待核对' : node.error ?? directorBatchStatusLabel(node.status)}</small></span>{node.status === 'running' && !uncertain ? <RefreshCw className="director-spin" size={13} /> : node.status === 'completed' ? <Check className="director-queue-ok" size={14} /> : node.status === 'failed' ? <CircleAlert size={14} /> : <Clock3 size={14} />}</div>;
      })}</div>
    </div> : null}
    {queue.length > 0 ? <div className="director-queue-filters"><SegmentedControl label="生成记录状态" value={status} onChange={setStatus} options={[{ value: 'all', label: '全部' }, { value: 'active', label: '进行中' }, { value: 'failed', label: '失败' }, { value: 'completed', label: '完成' }]} /><DirectorHistoryPager label="生成记录" {...queuePage} /></div> : null}
    {filteredQueue.length === 0 ? <div className="director-queue-empty"><Clock3 size={16} /><span>{queue.length ? '当前状态暂无生成记录' : '暂无真实生成任务。开始生成镜头后，任务会出现在这里。'}</span></div> : queuePage.items.map((item) => <div className={`director-queue-item is-${item.status}`} key={item.id}>{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div className="director-queue-thumb-placeholder" aria-hidden="true"><ImageIcon size={16} /></div>}<div className="director-queue-copy"><strong>{item.title}</strong><span title={item.error}>{item.status === 'failed' ? item.error : item.status === 'completed' ? `已完成 · ${item.provider}` : item.status === 'waiting' ? '等待生成' : '生成中 · 以接口状态为准'}</span><div className="director-progress"><i className={item.status === 'running' ? 'is-indeterminate' : undefined} style={item.status === 'running' ? undefined : { width: `${item.progress}%` }} /></div></div>{item.status === 'failed' ? <Button density="compact" variant="danger" onClick={() => onRetry(item)}><RotateCcw size={12} />重试</Button> : item.status === 'running' ? <RefreshCw className="director-spin" size={13} /> : item.status === 'completed' ? <Check size={15} className="director-queue-ok" /> : <Clock3 size={15} />}</div>)}
  </section>;
}

function formatDuration(durationMs: number): string {
  return durationMs >= 60_000 ? formatPlaybackTime(durationMs) : `${Math.round(durationMs / 100) / 10}s`;
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

function formatQualityRecheckScope(scope: ProductionQualityRecheckScope): string {
  const kindLabel: Record<ProductionQualityRecheckScope['kind'], string> = {
    project: '整项目',
    shot: '受影响镜头',
    asset: '受影响资产/镜头',
    subtitle: '字幕句与时间点',
    audio: '音频片段',
    media: '成片媒体',
  };
  const details = [
    scope.shotIds?.length ? `${scope.shotIds.length} 个镜头` : '',
    scope.assetVersionIds?.length ? `${scope.assetVersionIds.length} 个资产` : '',
    scope.cueIds?.length ? `${scope.cueIds.length} 个字幕句` : '',
    scope.startMs !== undefined || scope.endMs !== undefined ? `${Math.round(scope.startMs ?? 0)}–${Math.round(scope.endMs ?? 0)}ms` : '',
  ].filter(Boolean);
  return `${kindLabel[scope.kind]}${details.length ? `（${details.join('、')}）` : ''}`;
}

function ratioLabel(ratio: NonNullable<DirectorDeskWorkspaceProps['ratio']>): string {
  if (ratio === '9:16') return '9:16 (1080x1920)';
  if (ratio === '1:1') return '1:1 (2048x2048)';
  if (ratio === '4:3') return '4:3 (2048x1536)';
  return '16:9 (1920x1080)';
}

function directorVideoStatusLabel(status: DirectorVideoJobStatus): string {
  if (status === 'queued') return '等待生成';
  if (status === 'running') return '生成中';
  if (status === 'completed') return '动态海报已生成';
  if (status === 'failed') return '生成失败';
  if (status === 'cancelled') return '任务已取消';
  return '尚未生成';
}

export function directorLayerStyle(layer: DirectorPreviewLayer, atMs: number): CSSProperties {
  const fallback: DirectorLayerKeyframe = { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
  const [from, to, progress] = directorFrameWindow(layer.motion, atMs, fallback);
  const x = interpolateDirectorValue(from.x, to.x, progress);
  const y = interpolateDirectorValue(from.y, to.y, progress);
  const scale = interpolateDirectorValue(from.scale, to.scale, progress);
  const rotation = interpolateDirectorValue(from.rotation, to.rotation, progress);
  const opacity = interpolateDirectorValue(from.opacity, to.opacity, progress);
  return {
    zIndex: layer.zIndex,
    opacity,
    transform: `translate3d(${(x - 0.5) * 100 + layer.depth * 3}%, ${(y - 0.5) * 100 + layer.depth * 1.5}%, 0) scale(${scale}) rotate(${rotation}deg)`,
    willChange: 'transform, opacity',
  };
}

export function directorCameraStyle(
  keyframes: readonly DirectorCameraKeyframe[],
  atMs: number,
  durationMs: number,
  motionPreset?: DirectorMotionPreset,
): CSSProperties {
  let fallbackStart: DirectorCameraKeyframe = { atMs: 0, x: 0.5, y: 0.5, zoom: 1 };
  let fallbackEnd: DirectorCameraKeyframe = { ...fallbackStart, atMs: Math.max(1, durationMs) };
  if (motionPreset === '平移 + 缓慢推进') fallbackEnd = { ...fallbackEnd, x: 0.49, y: 0.495, zoom: 1.06 };
  if (motionPreset === '轻微视差') fallbackEnd = { ...fallbackEnd, x: 0.505, y: 0.495, zoom: 1.03 };
  const frames = keyframes.length > 0 ? keyframes : [fallbackStart, fallbackEnd];
  const [from, to, progress] = directorFrameWindow(frames, atMs, fallbackStart);
  const x = interpolateDirectorValue(from.x, to.x, progress);
  const y = interpolateDirectorValue(from.y, to.y, progress);
  const zoom = interpolateDirectorValue(from.zoom, to.zoom, progress);
  return {
    transform: `translate3d(${(0.5 - x) * 100}%, ${(0.5 - y) * 100}%, 0) scale(${zoom})`,
    willChange: 'transform',
  };
}

function directorFrameWindow<T extends { atMs: number }>(frames: readonly T[], atMs: number, fallback: T): [T, T, number] {
  if (frames.length === 0) return [fallback, fallback, 0];
  const first = frames[0];
  if (atMs < first.atMs) return [first, first, 0];
  for (let index = 1; index < frames.length; index += 1) {
    const next = frames[index];
    if (atMs < next.atMs) {
      const previous = frames[index - 1];
      const span = next.atMs - previous.atMs;
      return [previous, next, span > 0 ? Math.min(1, Math.max(0, (atMs - previous.atMs) / span)) : 1];
    }
  }
  const last = frames[frames.length - 1];
  return [last, last, 0];
}

function interpolateDirectorValue(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

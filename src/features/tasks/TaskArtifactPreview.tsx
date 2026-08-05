import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, CheckSquare2, ChevronLeft, ChevronRight, ClipboardCopy, ClipboardPaste, Database, Eye, FolderOpen, Image as ImageIcon, Images, ImageUp, Library, Loader2, Pencil, Play, RotateCcw, Save, Scissors, Square, Upload, Wand2, Wrench, X, XCircle } from 'lucide-react';
import { ErrorDetails as ErrorSummaryButton, summarizeErrorMessage } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { EventTimeline } from '../../components/EventTimeline';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from '../../components/StatusBadge';
import type { ApplyMutationResult } from '../../app/route-types';
import { DraftTemplatePreview } from '../templates/DraftCanvas';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { buildSubtitleTrack, splitCaptionLines } from '../../shared/story';
import { ORDINARY_TASK_COVER_PAGE_DURATION_MS, resolveOrdinaryTaskCoverTitle } from '../../shared/ordinary-task-cover';
import type {
  AppConfig,
  DraftTemplate,
  ImageLabSummary,
  Task,
  TaskArtifactSnapshot,
  TaskEvent,
  TaskStepRerunMode,
  TaskSubtitleSceneLines,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';
import {
  activeImageConcurrency,
  countChars,
  formatDate,
  formatMs,
  toLocalAssetUrl,
  toLocalImageUrl,
  trimForPreview,
} from './task-formatters';
import { artifactPanelTitle, imageProgressLabel, snapshotStepStatus, type ArtifactPanelTab } from './task-pipeline';
import { indexTaskAssetsBySceneId, resolveTaskPreviewContent, taskPreviewCuesForScene } from './task-preview-model';
import { repairSubtitleProblemLines, subtitleLineIssues } from './subtitle-line-diagnostics';

export type TaskArtifactTab = ArtifactPanelTab;

export function ArtifactPreviewContent({
  api,
  task,
  config,
  draftTemplate,
  applyState,
  tab,
  snapshot,
  events,
  latestEvent,
  currentAgent,
  isBrowserPreview,
  onArtifactChanged,
}: {
  api: StoryDreamApi;
  task: Task;
  config: AppConfig;
  draftTemplate: DraftTemplate;
  applyState: ApplyMutationResult;
  tab: TaskArtifactTab;
  snapshot: TaskArtifactSnapshot | null;
  events: readonly TaskEvent[];
  latestEvent: TaskEvent | null;
  currentAgent: string;
  isBrowserPreview: boolean;
  onArtifactChanged: () => void;
}) {
  const artifact = snapshot?.artifact ?? {};
  const sourceContext = artifact.sourceContext;
  const scenes = artifact.scenes ?? [];
  const imagePrompts = artifact.imagePrompts ?? [];
  const subtitles = useMemo(
    () => artifact.subtitles ?? (scenes.length > 0
      ? buildSubtitleTrack(scenes, { maxCharsPerLine: draftTemplate.caption.maxCharsPerLine })
      : undefined),
    [artifact.subtitles, draftTemplate.caption.maxCharsPerLine, scenes],
  );
  const imageAssets = snapshot?.assets.images ?? [];
  const coverAsset = task.coverPageEnabled ? snapshot?.assets.cover[0] : undefined;
  const imageErrors = snapshot?.assets.imageErrors ?? [];
  const narrationAssets = snapshot?.assets.narration ?? [];
  const imageBySceneId = useMemo(() => indexTaskAssetsBySceneId(imageAssets), [imageAssets]);
  const generatedImageCount = imageBySceneId.size;
  const imageProgress = imageProgressLabel(scenes.length, generatedImageCount, snapshotStepStatus(snapshot, 4));
  const sceneRailItems = scenes.length
    ? scenes
    : Array.from({ length: Math.min(4, Math.max(1, imageAssets.length)) }, (_, index) => ({ id: index + 1, cap: `场景 ${index + 1}`, descPrompt: '' }));
  const [selectedSceneId, setSelectedSceneId] = useState<number | null>(null);
  const coverSelected = task.coverPageEnabled === true && (selectedSceneId === null || selectedSceneId === 0);
  const selectedScene = coverSelected ? undefined : sceneRailItems.find((scene) => scene.id === selectedSceneId) ?? sceneRailItems[0];
  const selectedSceneIndex = Math.max(0, sceneRailItems.findIndex((scene) => scene.id === selectedScene?.id));
  const selectedSceneCues = useMemo(() => taskPreviewCuesForScene(subtitles, selectedScene?.id), [selectedScene?.id, subtitles]);
  const [selectedCueIndex, setSelectedCueIndex] = useState(0);
  const activeCueIndex = Math.min(selectedCueIndex, Math.max(0, selectedSceneCues.length - 1));
  const selectedCue = selectedSceneCues[activeCueIndex];
  const selectedImageAsset = coverSelected ? coverAsset : selectedScene ? imageBySceneId.get(selectedScene.id) : undefined;
  const selectedImagePath = selectedImageAsset?.path ?? '';
  const [selectedImagePreview, setSelectedImagePreview] = useState<{ path: string; url: string; error: string }>({ path: '', url: '', error: '' });
  const previewContent = resolveTaskPreviewContent({ task, cover: artifact.cover, sourceText: artifact.rewrittenCopy, sceneCap: selectedScene?.cap, sceneCue: selectedCue?.text, template: draftTemplate });
  const coverPreviewTemplate = useMemo(() => ({
    ...draftTemplate,
    image: { ...draftTemplate.image, visible: true, ratio: task.ratio, top: 0, height: 1, fit: 'cover' as const },
    title: resolveOrdinaryTaskCoverTitle(draftTemplate, task.coverPageText ?? ''),
    subtitle: { ...draftTemplate.subtitle, visible: false },
    caption: { ...draftTemplate.caption, visible: false },
    disclaimer: { ...draftTemplate.disclaimer, visible: false },
  }), [draftTemplate, task.coverPageText, task.ratio]);
  const selectedImageUrl = selectedImagePreview.path === selectedImagePath ? selectedImagePreview.url : '';
  const selectedImageError = selectedImagePreview.path === selectedImagePath ? selectedImagePreview.error : '';
  const nextPendingSceneId = sceneRailItems.find((scene) => !imageBySceneId.has(scene.id))?.id;
  const [rerunningStepAction, setRerunningStepAction] = useState<string | null>(null);
  const artifactAction = useAsyncAction();
  const canRerunStep = !isBrowserPreview && task.status !== 'running' && task.status !== 'pending' && Boolean(task.artifactStatePath);

  useEffect(() => {
    setSelectedSceneId(null);
  }, [task.id]);

  useEffect(() => {
    setSelectedCueIndex(0);
  }, [selectedScene?.id, selectedSceneCues.length]);

  useEffect(() => {
    if (!selectedImagePath || isBrowserPreview) {
      setSelectedImagePreview({ path: selectedImagePath, url: '', error: '' });
      return undefined;
    }
    let cancelled = false;
    setSelectedImagePreview({ path: selectedImagePath, url: '', error: '' });
    api.readAssetDataUrl(selectedImagePath)
      .then((url) => {
        if (!cancelled) setSelectedImagePreview({ path: selectedImagePath, url, error: '' });
      })
      .catch((error) => {
        if (!cancelled) setSelectedImagePreview({ path: selectedImagePath, url: '', error: summarizeErrorMessage(error instanceof Error ? error.message : String(error)) });
      });
    return () => {
      cancelled = true;
    };
  }, [api, isBrowserPreview, selectedImagePath]);

  async function rerunArtifactStep(step: number, mode: TaskStepRerunMode) {
    const key = `${step}:${mode}`;
    await artifactAction.run(async () => {
      setRerunningStepAction(key);
      try {
        applyState(await api.rerunTaskStep(task.id, step, mode));
      } finally {
        setRerunningStepAction(null);
      }
    });
  }

  async function openArtifactOutput() {
    await artifactAction.run(() => api.openTaskOutputDirectory(task.id));
  }

  const artifactStepActions = (step: number) => (
    <ArtifactStepActions
      step={step}
      disabled={!canRerunStep}
      regenerating={rerunningStepAction === `${step}:regenerate`}
      rewriting={rerunningStepAction === `${step}:rewrite`}
      onAction={rerunArtifactStep}
    />
  );

  return (
    <div className="artifact-preview">
      <div className="task-media-workspace">
        <section className="task-media-canvas" data-media-canvas="task-artifact">
          <div className="task-media-frame" data-draft-template-id={draftTemplate.id} data-preview-scene-id={coverSelected ? 0 : selectedScene?.id ?? 0} data-preview-kind={coverSelected ? 'cover' : 'scene'}>
            <DraftTemplatePreview
              template={coverSelected ? coverPreviewTemplate : draftTemplate}
              imageUrl={selectedImageUrl}
              titleText={coverSelected ? task.coverPageText ?? '' : previewContent.title}
              subtitleText={previewContent.subtitle}
              captionText={previewContent.caption}
              disclaimerText={previewContent.disclaimer}
            />
            {!selectedImageAsset ? <div className="task-media-asset-state"><ImageIcon size={22} /><span>{coverSelected ? '等待封面图片' : '等待场景图片'}</span></div> : null}
            {selectedImageAsset && !selectedImageUrl && !selectedImageError ? <div className="task-media-asset-state"><Loader2 className="spin" size={22} /><span>正在读取图片</span></div> : null}
            {selectedImageError ? <div className="task-media-asset-state danger"><XCircle size={22} /><span>图片读取失败</span></div> : null}
          </div>
          <div className="task-media-progress">
            <ImageIcon size={15} />
            <span><i style={{ width: `${Math.round((generatedImageCount / Math.max(1, scenes.length || generatedImageCount)) * 100)}%` }} /></span>
            {coverSelected ? <small className="task-media-cue-empty">封面页 {ORDINARY_TASK_COVER_PAGE_DURATION_MS / 1000} 秒</small> : selectedSceneCues.length > 0 ? (
              <div className="task-media-cue-control" aria-label="当前场景字幕">
                <button type="button" title="上一条字幕" aria-label="上一条字幕" disabled={activeCueIndex === 0} onClick={() => setSelectedCueIndex((current) => Math.max(0, current - 1))}><ChevronLeft size={14} /></button>
                <small>字幕 {activeCueIndex + 1} / {selectedSceneCues.length}</small>
                <button type="button" title="下一条字幕" aria-label="下一条字幕" disabled={activeCueIndex >= selectedSceneCues.length - 1} onClick={() => setSelectedCueIndex((current) => Math.min(selectedSceneCues.length - 1, current + 1))}><ChevronRight size={14} /></button>
              </div>
            ) : <small className="task-media-cue-empty">暂无字幕</small>}
            <small className="task-media-scene-count">{coverSelected ? '00' : String(selectedSceneIndex + 1).padStart(2, '0')} / {String(scenes.length || generatedImageCount || 0).padStart(2, '0')}</small>
          </div>
        </section>
        <aside className="task-scene-rail">
          <div><h3>场景图片</h3><span>{generatedImageCount} / {scenes.length || generatedImageCount || 0} 已生成</span></div>
          <div className="task-scene-list">
            {task.coverPageEnabled ? (
              <button type="button" className={`task-scene-item cover ${coverAsset ? 'complete' : task.status === 'running' ? 'running' : 'pending'} ${coverSelected ? 'selected' : ''}`} data-scene-kind="cover" onClick={() => setSelectedSceneId(0)}>
                <span>00</span>
                <div><strong>封面页</strong><small>{coverAsset ? `${ORDINARY_TASK_COVER_PAGE_DURATION_MS / 1000} 秒 · 已生成` : task.status === 'running' ? '生成中' : '等待生成'}</small></div>
              </button>
            ) : null}
            {sceneRailItems.map((scene, index) => {
              const complete = imageBySceneId.has(scene.id);
              const running = !complete && nextPendingSceneId === scene.id && task.status === 'running';
              return (
                <button type="button" className={`task-scene-item ${complete ? 'complete' : running ? 'running' : 'pending'} ${selectedScene?.id === scene.id ? 'selected' : ''}`} key={scene.id} onClick={() => setSelectedSceneId(scene.id)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{trimForPreview(scene.cap, 18) || `场景 ${index + 1}`}</strong><small>{complete ? '已生成' : running ? '生成中' : '等待生成'}</small></div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <div className="preview-meta-grid">
        <div><small>任务</small><strong>{task.title || '未命名任务'}</strong></div>
        <div><small>状态</small><strong>{statusLabel(task.status)}</strong></div>
        <div><small>当前代理</small><strong>{currentAgent}</strong></div>
        <div><small>图片进度</small><strong>{imageProgress}</strong></div>
        <div><small>产物更新时间</small><strong>{snapshot?.updatedAt ? formatDate(snapshot.updatedAt) : '等待生成'}</strong></div>
        <div><small>输出目录</small><strong>{task.outputDir || '等待生成'}</strong></div>
        <div><small>失败步骤</small><strong>{task.failedStep ?? '-'}</strong></div>
        <div><small>状态文件</small><strong>{task.artifactStatePath || '等待生成'}</strong></div>
        <div><small>最近心跳</small><strong>{task.lastHeartbeatAt ? formatDate(task.lastHeartbeatAt) : '等待运行'}</strong></div>
        <div><small>恢复步骤</small><strong>{task.retryFromStep ?? '-'}</strong></div>
      </div>

      <div className="artifact-preview-head">
        <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={22} /> : <Database size={22} />}</div>
        <div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          {latestEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={latestEvent.detail} title="流水线错误" /> : <span>{snapshot?.message || latestEvent?.detail || '等待当前步骤产物落盘'}</span>}
        </div>
        {task.status === 'completed' && task.outputDir ? (
          <button className="ghost-action" disabled={artifactAction.busy} onClick={openArtifactOutput}>
            <FolderOpen size={15} />
            打开草稿目录
          </button>
        ) : null}
      </div>
      <InlineActionFeedback feedback={artifactAction.feedback} />

      {tab === 'preview' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="AI 搜索资料" badge={`${sourceContext?.sections.length ?? 0} 条`} actions={artifactStepActions(0)}>
            {sourceContext?.sections.length ? (
              <div className="artifact-source-list">
                {sourceContext.sections.map((source, index) => (
                  <div key={`${source.title}-${index}`}>
                    <strong>{source.title}</strong>
                    {source.url ? <span>{source.url}</span> : null}
                    <p>{trimForPreview(source.content || source.snippet || '', 260)}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待 AI 创作搜索资料" />}
          </ArtifactSection>

          <ArtifactSection title="文案预审" badge={`${countChars(artifact.reviewedText)} 字`} actions={artifactStepActions(0)}>
            <ArtifactText value={artifact.reviewedText} empty="等待文案预审产物" />
          </ArtifactSection>

          <ArtifactSection title="改写产物" badge={`${countChars(artifact.rewrittenCopy)} 字`} actions={artifactStepActions(1)}>
            <ArtifactText value={artifact.rewrittenCopy} empty="等待改写产物" />
          </ArtifactSection>

          <ArtifactSection title="封面信息" badge={artifact.cover?.title || '等待生成'} actions={artifactStepActions(1)}>
            {artifact.cover ? (
              <div className="artifact-cover-grid">
                <div><small>标题</small><strong>{artifact.cover.title}</strong></div>
                <div><small>副标题</small><strong>{artifact.cover.subtitle.join(' / ') || '-'}</strong></div>
                <div><small>摘要</small><p>{artifact.cover.summary || '-'}</p></div>
                <div><small>标签</small><p>{artifact.cover.tags.join(' ') || '-'}</p></div>
                <div><small>种子评论</small><p>{artifact.cover.comments.join(' / ') || '-'}</p></div>
              </div>
            ) : <ArtifactEmpty text="等待封面标题、摘要、标签和评论" />}
          </ArtifactSection>

          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`} actions={artifactStepActions(2)}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>

          <ArtifactSection title="绘图提示词" badge={`${imagePrompts.length} 条`} actions={artifactStepActions(3)}>
            <ArtifactPromptList prompts={imagePrompts} />
          </ArtifactSection>

          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`} actions={artifactStepActions(4)}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              imageErrors={imageErrors}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>

          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`} actions={artifactStepActions(5)}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.srt ? <pre className="artifact-text-block compact">{trimForPreview(subtitles.srt, 900)}</pre> : null}
          </ArtifactSection>

          <ArtifactSection title="草稿输出" badge={snapshot?.draft ? '已生成' : '等待生成'} actions={artifactStepActions(6)}>
            {snapshot?.draft ? (
              <div className="artifact-path-list">
                <span>{snapshot.draft.draftDir}</span>
                <span>{snapshot.draft.draftContentPath}</span>
                <span>{snapshot.draft.draftMetaPath}</span>
              </div>
            ) : <ArtifactEmpty text="等待剪映草稿目录" />}
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'storyboard' ? (
        <StoryboardSubtitleEditor
          api={api}
          task={task}
          scenes={scenes}
          subtitles={subtitles}
          maxCharsPerLine={draftTemplate.caption.maxCharsPerLine}
          disabled={!canRerunStep}
          isBrowserPreview={isBrowserPreview}
          regenerating={rerunningStepAction === '2:regenerate'}
          applyState={applyState}
          onAiStoryboard={() => rerunArtifactStep(2, 'regenerate')}
          onArtifactChanged={onArtifactChanged}
        />
      ) : null}

      {tab === 'images' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              imageErrors={imageErrors}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'audio' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.cues.length ? (
              <div className="artifact-scene-list">
                {subtitles.cues.map((cue) => (
                  <div key={cue.index}>
                    <strong>{cue.index}. {formatMs(cue.startMs)} - {formatMs(cue.endMs)}</strong>
                    <p>{cue.text}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待字幕时间轴" />}
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'events' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="任务事件" badge={`${events.length} 条`}>
            <EventTimeline events={events} />
          </ArtifactSection>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactSection({ title, badge, actions, children }: { title: string; badge: string; actions?: ReactNode; children: React.ReactNode }) {
  return (
    <section className="artifact-section">
      <div className="panel-title-row">
        <h3>{title}</h3>
        <div className="artifact-section-actions">
          {actions}
          <small>{badge}</small>
        </div>
      </div>
      {children}
    </section>
  );
}

function ArtifactStepActions({
  step,
  disabled,
  regenerating,
  rewriting,
  onAction,
}: {
  step: number;
  disabled: boolean;
  regenerating: boolean;
  rewriting: boolean;
  onAction: (step: number, mode: TaskStepRerunMode) => void;
}) {
  const busy = regenerating || rewriting;
  return (
    <div className="artifact-step-action-buttons">
      <button className="mini-button" disabled={disabled || busy} title="从本步骤重新生成，并继续执行后续步骤" onClick={() => onAction(step, 'regenerate')}>
        {regenerating ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
        重新生成
      </button>
      <button className="mini-button" disabled={disabled || busy} title="参考当前产物改写本步骤，并继续执行后续步骤" onClick={() => onAction(step, 'rewrite')}>
        {rewriting ? <Loader2 className="spin" size={14} /> : <Wand2 size={14} />}
        改写后继续
      </button>
    </div>
  );
}

function ArtifactText({ value, empty }: { value?: string; empty: string }) {
  return value ? <pre className="artifact-text-block">{value}</pre> : <ArtifactEmpty text={empty} />;
}

export function ArtifactEmpty({ text }: { text: string }) {
  return <div className="artifact-empty">{text}</div>;
}

function ArtifactSceneList({
  scenes,
  imagePrompts,
  images,
}: {
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
}) {
  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜生成" />;
  return (
    <div className="artifact-scene-list">
      {scenes.map((scene) => {
        const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
        const image = images.find((item) => item.sceneId === scene.id);
        return (
          <div key={scene.id}>
            <strong>{scene.id}. {scene.cap}</strong>
            <p>{scene.descPrompt}</p>
            {prompt ? <small>Prompt: {trimForPreview(prompt.prompt, 220)}</small> : null}
            {image ? <span>{image.path}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function StoryboardSubtitleEditor({
  api,
  task,
  scenes,
  subtitles,
  maxCharsPerLine,
  disabled,
  isBrowserPreview,
  regenerating,
  applyState,
  onAiStoryboard,
  onArtifactChanged,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'];
  maxCharsPerLine: number;
  disabled: boolean;
  isBrowserPreview: boolean;
  regenerating: boolean;
  applyState: ApplyMutationResult;
  onAiStoryboard: () => void | Promise<void>;
  onArtifactChanged: () => void;
}) {
  const editorAction = useAsyncAction();
  const initialLines = useMemo(
    () => storyboardSubtitleLines(scenes, subtitles, maxCharsPerLine),
    [maxCharsPerLine, scenes, subtitles],
  );
  const initialSignature = useMemo(() => subtitleLineSignature(scenes, initialLines), [initialLines, scenes]);
  const [linesBySceneId, setLinesBySceneId] = useState<Record<number, string[]>>(initialLines);
  const currentSignature = subtitleLineSignature(scenes, linesBySceneId);
  const dirty = currentSignature !== initialSignature;
  const issuesBySceneId = Object.fromEntries(scenes.map((scene) => [
    scene.id,
    subtitleLineIssues(linesBySceneId[scene.id] ?? [], maxCharsPerLine),
  ]));
  const invalidSceneIds = scenes
    .filter((scene) => issuesBySceneId[scene.id].some((issue) => issue.kind === 'empty'))
    .map((scene) => scene.id);
  const overLimitLineCount = Object.values(issuesBySceneId)
    .flat()
    .filter((issue) => issue.kind === 'over-limit').length;
  const problemLineCount = Object.values(issuesBySceneId).flat().length;
  const locked = disabled || editorAction.busy || isBrowserPreview;

  useEffect(() => {
    setLinesBySceneId(initialLines);
  }, [initialLines]);

  function updateSceneLines(sceneId: number, value: string) {
    const lines = value.replace(/\r/gu, '').split('\n');
    setLinesBySceneId((current) => ({ ...current, [sceneId]: lines }));
    editorAction.clearFeedback();
  }

  function resplitSubtitles() {
    setLinesBySceneId(Object.fromEntries(scenes.map((scene) => [
      scene.id,
      splitCaptionLines(scene.cap, maxCharsPerLine),
    ])));
    editorAction.clearFeedback();
  }

  function repairProblemLines() {
    setLinesBySceneId(Object.fromEntries(scenes.map((scene) => {
      const lines = linesBySceneId[scene.id] ?? [];
      return [
        scene.id,
        issuesBySceneId[scene.id].length > 0
          ? repairSubtitleProblemLines(lines, scene.cap, maxCharsPerLine)
          : lines,
      ];
    })));
    editorAction.clearFeedback();
  }

  async function copyAllCopy() {
    await editorAction.run(async () => {
      if (!navigator.clipboard) throw new Error('当前环境不支持剪贴板写入。');
      await navigator.clipboard.writeText(scenes.map((scene) => (linesBySceneId[scene.id] ?? []).join('\n')).join('\n\n'));
    }, { successMessage: '全部字幕文案已复制' });
  }

  async function saveSubtitleLines() {
    if (!dirty || invalidSceneIds.length > 0) return;
    const input: TaskSubtitleSceneLines[] = scenes.map((scene) => ({
      sceneId: scene.id,
      lines: (linesBySceneId[scene.id] ?? []).map((line) => line.trim()),
    }));
    await editorAction.run(async () => {
      applyState(await api.updateTaskSubtitleLines(task.id, input));
      onArtifactChanged();
    }, { successMessage: '字幕断句已保存，剪映草稿待重新打包' });
  }

  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜生成" />;
  return (
    <section className="storyboard-subtitle-editor" data-dirty={dirty ? 'true' : 'false'}>
      <header className="storyboard-editor-toolbar">
        <div>
          <strong>字幕断句</strong>
          <span>{scenes.length} 个分镜 · {Object.values(linesBySceneId).reduce((sum, lines) => sum + lines.length, 0)} 行字幕</span>
        </div>
        <div className="storyboard-editor-actions">
          <button className="mini-button" type="button" disabled={locked || dirty} title={dirty ? '请先保存字幕断句' : '重新生成分镜并继续后续步骤'} onClick={() => void onAiStoryboard()}>
            {regenerating ? <Loader2 className="spin" size={14} /> : <Wand2 size={14} />}
            AI 重新分镜
          </button>
          <button className="mini-button" type="button" disabled={editorAction.busy} onClick={copyAllCopy}>
            <ClipboardCopy size={14} />
            复制全部文案
          </button>
          <button className="mini-button" type="button" disabled={locked} onClick={resplitSubtitles}>
            <Scissors size={14} />
            重新切分字幕
          </button>
          <button className="primary-action compact" type="button" disabled={locked || !dirty || invalidSceneIds.length > 0} onClick={saveSubtitleLines}>
            {editorAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
            保存字幕断句
          </button>
        </div>
      </header>
      {problemLineCount > 0 ? (
        <div className="storyboard-editor-warning" role="status">
          <span>
            {invalidSceneIds.length > 0 ? `分镜 ${invalidSceneIds.join('、')} 存在空字幕行。` : ''}
            {overLimitLineCount > 0 ? ` ${overLimitLineCount} 行超过模板上限 ${maxCharsPerLine} 字，行号已标红。` : ''}
          </span>
          <button className="mini-button" type="button" disabled={locked} onClick={repairProblemLines}><Wrench size={13} />修复问题行</button>
        </div>
      ) : null}
      <InlineActionFeedback feedback={editorAction.feedback} />
      <div className="storyboard-editor-columns" aria-hidden="true">
        <span>分镜原文</span>
        <span>字幕行</span>
      </div>
      <div className="storyboard-editor-rows">
        {scenes.map((scene, sceneIndex) => {
          const lines = linesBySceneId[scene.id] ?? [];
          const issues = issuesBySceneId[scene.id];
          const issueByLineIndex = new Map(issues.map((issue) => [issue.index, issue]));
          const sceneOverLimitCount = issues.filter((issue) => issue.kind === 'over-limit').length;
          return (
            <article className="storyboard-editor-row" key={scene.id}>
              <div className="storyboard-source-copy">
                <small>#{String(sceneIndex + 1).padStart(2, '0')} 分镜原文</small>
                <p>{scene.cap}</p>
                <span>{countChars(scene.cap)} 字 · {(scene.durationMs / 1000).toFixed(1)} 秒</span>
              </div>
              <div className="storyboard-caption-field">
                <small>字幕行</small>
                <div className="storyboard-caption-input">
                  <div className="storyboard-caption-numbers" aria-hidden="true">
                    {lines.map((_, index) => {
                      const issue = issueByLineIndex.get(index);
                      return (
                        <span
                          className={issue ? `issue ${issue.kind}` : ''}
                          data-line-status={issue?.kind ?? 'ok'}
                          key={index}
                          title={issue?.kind === 'over-limit' ? `${issue.characterCount} 字，超过 ${maxCharsPerLine} 字上限` : issue?.kind === 'empty' ? '空字幕行' : undefined}
                        >{index + 1}</span>
                      );
                    })}
                  </div>
                  <textarea
                    aria-label={`第 ${sceneIndex + 1} 个分镜字幕行，每行最多 ${maxCharsPerLine} 字`}
                    disabled={locked}
                    rows={Math.max(2, lines.length)}
                    spellCheck={false}
                    wrap="off"
                    value={lines.join('\n')}
                    onChange={(event) => updateSceneLines(scene.id, event.target.value)}
                  />
                </div>
                <span>{lines.length} 行 · {countChars(lines.join(''))} 字 · 每行上限 {maxCharsPerLine}{sceneOverLimitCount > 0 ? ` · ${sceneOverLimitCount} 行超限` : ''}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function storyboardSubtitleLines(
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>,
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'],
  maxCharsPerLine: number,
): Record<number, string[]> {
  const cuesBySceneId = new Map<number, string[]>();
  for (const cue of subtitles?.cues ?? []) {
    if (cue.sceneId === undefined) continue;
    const lines = cuesBySceneId.get(cue.sceneId) ?? [];
    lines.push(cue.text);
    cuesBySceneId.set(cue.sceneId, lines);
  }
  return Object.fromEntries(scenes.map((scene) => [
    scene.id,
    cuesBySceneId.get(scene.id) ?? splitCaptionLines(scene.cap, maxCharsPerLine),
  ]));
}

function subtitleLineSignature(
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>,
  linesBySceneId: Record<number, string[]>,
): string {
  return JSON.stringify(scenes.map((scene) => [scene.id, linesBySceneId[scene.id] ?? []]));
}

function ArtifactPromptList({ prompts }: { prompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']> }) {
  if (prompts.length === 0) return <ArtifactEmpty text="等待绘图提示词" />;
  return (
    <div className="artifact-scene-list">
      {prompts.map((prompt) => (
        <div key={prompt.sceneId}>
          <strong>{prompt.sceneId}. {prompt.cap}</strong>
          <p>{prompt.prompt}</p>
          <small>负面：{prompt.negativePrompt || '-'}</small>
        </div>
      ))}
    </div>
  );
}

function ImageGenerationGallery({
  api,
  task,
  scenes,
  imagePrompts,
  images,
  imageErrors,
  concurrency,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
  imageErrors: TaskArtifactSnapshot['assets']['imageErrors'];
  concurrency: number;
  isBrowserPreview: boolean;
  applyState: ApplyMutationResult;
}) {
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, string>>({});
  const [activeSceneId, setActiveSceneId] = useState<number | 'batch' | null>(null);
  const [editor, setEditor] = useState<{ sceneId: number; mode: 'prompt' | 'reference'; text: string } | null>(null);
  const [copiedSceneId, setCopiedSceneId] = useState<number | null>(null);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<number>>(new Set());
  const [librarySceneId, setLibrarySceneId] = useState<number | null>(null);
  const [libraryRecords, setLibraryRecords] = useState<ImageLabSummary[]>([]);
  const [libraryPreviewUrls, setLibraryPreviewUrls] = useState<Record<string, string>>({});
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [previewSceneId, setPreviewSceneId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const imageGenerationAction = useAsyncAction();
  const imagePaths = images.map((asset) => asset.path).join('|');
  const imageBySceneId = useMemo(() => new Map(images.map((asset) => [asset.sceneId, asset] as const)), [images]);
  const promptBySceneId = useMemo(() => new Map(imagePrompts.map((prompt) => [prompt.sceneId, prompt] as const)), [imagePrompts]);
  const imageErrorBySceneId = useMemo(() => new Map(imageErrors.map((item) => [item.sceneId, item] as const)), [imageErrors]);
  const taskLocked = isBrowserPreview || task.status === 'running' || task.status === 'pending';
  const filteredLibraryRecords = useMemo(() => {
    const query = libraryQuery.trim().toLocaleLowerCase();
    if (!query) return libraryRecords;
    return libraryRecords.filter((record) => `${record.promptPreview} ${record.style} ${record.provider}`.toLocaleLowerCase().includes(query));
  }, [libraryQuery, libraryRecords]);

  useEffect(() => {
    if (isBrowserPreview || images.length === 0) {
      setImagePreviewUrls({});
      setImagePreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(images.map((asset) => asset.path));
    setImagePreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setImagePreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of images) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setImagePreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const normalized = imageGenerationAction.reportError(error);
            setImagePreviewErrors((current) => ({ ...current, [asset.path]: normalized.message }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, imageGenerationAction.reportError, imagePaths, isBrowserPreview]);

  useEffect(() => {
    if (librarySceneId === null || isBrowserPreview) return undefined;
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError('');
    setLibraryRecords([]);
    setLibraryPreviewUrls({});
    api.listImageLabRecords({ filter: 'active', status: 'generated', limit: 60 })
      .then(async (page) => {
        if (cancelled) return;
        setLibraryRecords(page.items);
        const previews = await Promise.all(page.items.map(async (record) => {
          try {
            return [record.imagePath, await api.readAssetDataUrl(record.imagePath)] as const;
          } catch {
            return [record.imagePath, ''] as const;
          }
        }));
        if (!cancelled) setLibraryPreviewUrls(Object.fromEntries(previews.filter(([, url]) => Boolean(url))));
      })
      .catch((error) => {
        if (!cancelled) setLibraryError(summarizeErrorMessage(error instanceof Error ? error.message : String(error)));
      })
      .finally(() => {
        if (!cancelled) setLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, isBrowserPreview, librarySceneId]);

  async function regenerate(sceneId: number) {
    setActiveSceneId(sceneId);
    const result = await imageGenerationAction.run(() => api.regenerateTaskImage(task.id, sceneId));
    setActiveSceneId(null);
    if (result.ok) {
      applyState(result.value);
      setNotice(`分镜 ${sceneId} 已进入重新生成队列。`);
    }
  }

  async function regenerateSelected() {
    const sceneIds = [...selectedSceneIds].sort((left, right) => left - right);
    if (sceneIds.length === 0) return;
    setActiveSceneId('batch');
    const result = await imageGenerationAction.run(() => api.regenerateTaskImages(task.id, sceneIds));
    setActiveSceneId(null);
    if (result.ok) {
      applyState(result.value);
      setNotice(`${sceneIds.length} 张图片已进入重新生成队列。`);
      setSelectedSceneIds(new Set());
      setMultiSelect(false);
    }
  }

  async function importImages() {
    setActiveSceneId('batch');
    const result = await imageGenerationAction.run(() => api.importTaskImages(task.id));
    setActiveSceneId(null);
    if (result.ok && result.value) {
      applyState(result.value);
      setNotice('已按文件名中的分镜编号导入图片。');
    }
  }

  async function replaceImage(sceneId: number) {
    setActiveSceneId(sceneId);
    const result = await imageGenerationAction.run(() => api.replaceTaskImage(task.id, sceneId, { kind: 'local' }));
    setActiveSceneId(null);
    if (result.ok && result.value) {
      applyState(result.value);
      setNotice(`分镜 ${sceneId} 已替换。`);
    }
  }

  async function pasteImage(sceneId: number) {
    if (copiedSceneId === null) return;
    setActiveSceneId(sceneId);
    const result = await imageGenerationAction.run(() => api.replaceTaskImage(task.id, sceneId, { kind: 'scene', sourceSceneId: copiedSceneId }));
    setActiveSceneId(null);
    if (result.ok && result.value) {
      applyState(result.value);
      setNotice(`已将分镜 ${copiedSceneId} 的图片粘贴到分镜 ${sceneId}。`);
    }
  }

  async function chooseLibraryImage(recordId: string) {
    if (librarySceneId === null) return;
    const sceneId = librarySceneId;
    setActiveSceneId(sceneId);
    const result = await imageGenerationAction.run(() => api.replaceTaskImage(task.id, sceneId, { kind: 'image-lab', recordId }));
    setActiveSceneId(null);
    if (result.ok && result.value) {
      applyState(result.value);
      setLibrarySceneId(null);
      setNotice(`已从素材库替换分镜 ${sceneId}。`);
    }
  }

  async function submitEditor() {
    if (!editor?.text.trim()) return;
    setActiveSceneId(editor.sceneId);
    const currentEditor = editor;
    const result = await imageGenerationAction.run(async () => {
      if (currentEditor.mode === 'reference') {
        return api.referenceEditTaskImage(task.id, currentEditor.sceneId, currentEditor.text.trim());
      }
      applyState(await api.updateTaskImagePrompt(task.id, currentEditor.sceneId, currentEditor.text.trim()));
      return api.regenerateTaskImage(task.id, currentEditor.sceneId);
    });
    setActiveSceneId(null);
    if (result.ok) {
      applyState(result.value);
      setEditor(null);
      setNotice(currentEditor.mode === 'reference'
        ? `分镜 ${currentEditor.sceneId} 已完成参考图编辑。`
        : `分镜 ${currentEditor.sceneId} 已保存提示词并重新生成。`);
    }
  }

  function toggleMultiSelect() {
    setMultiSelect((current) => {
      if (current) setSelectedSceneIds(new Set());
      return !current;
    });
  }

  function toggleSceneSelection(sceneId: number) {
    setSelectedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜后生成图片" />;

  return (
    <div className="image-generation-gallery">
      <div className="image-generation-toolbar">
        <div className="image-generation-summary">
          <strong>{images.length}<small> / {scenes.length}</small></strong>
          <span>已生成 · 并发 {concurrency}</span>
        </div>
        <div className="image-generation-tools">
          {multiSelect ? (
            <>
              <button type="button" className="gallery-tool-button" disabled={imageGenerationAction.busy} onClick={() => setSelectedSceneIds(new Set(scenes.map((scene) => scene.id)))}><CheckSquare2 size={15} />全选</button>
              <button type="button" className="gallery-tool-button" disabled={imageGenerationAction.busy || selectedSceneIds.size === 0} onClick={() => setSelectedSceneIds(new Set())}><Square size={15} />清空</button>
              <button type="button" className="gallery-tool-button primary" disabled={taskLocked || imageGenerationAction.busy || selectedSceneIds.size === 0} onClick={() => void regenerateSelected()}>
                {activeSceneId === 'batch' ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}批量重绘 {selectedSceneIds.size || ''}
              </button>
            </>
          ) : (
            <button type="button" className="gallery-tool-button" disabled={taskLocked || imageGenerationAction.busy} onClick={() => void importImages()}>
              {activeSceneId === 'batch' ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}批量导入
            </button>
          )}
          <button type="button" className={`gallery-tool-button ${multiSelect ? 'active' : ''}`} disabled={imageGenerationAction.busy} onClick={toggleMultiSelect}>
            {multiSelect ? <X size={15} /> : <CheckSquare2 size={15} />}{multiSelect ? '退出多选' : '多选'}
          </button>
        </div>
      </div>
      <InlineActionFeedback feedback={imageGenerationAction.feedback} />
      {notice ? <div className="image-gallery-notice" role="status"><Check size={14} />{notice}</div> : null}
      <div className="image-preview-grid">
        {scenes.map((scene) => {
          const image = imageBySceneId.get(scene.id);
          const prompt = promptBySceneId.get(scene.id);
          const imageError = imageErrorBySceneId.get(scene.id);
          const previewUrl = image ? imagePreviewUrls[image.path] : '';
          const previewError = image ? imagePreviewErrors[image.path] : '';
          const cardState = image?.borrowedFrom !== undefined ? 'borrowed' : image ? 'ready' : imageError ? 'failed' : 'pending';
          const statusText = image
            ? image.borrowedFrom ? `借 #${image.borrowedFrom}` : '已生成'
            : imageError ? '生成失败' : task.status === 'running' ? '等待/生成中' : '未生成';
          const promptText = prompt?.prompt ?? scene.descPrompt;
          const selected = selectedSceneIds.has(scene.id);
          const busy = activeSceneId === scene.id;
          return (
            <article className={`image-preview-card ${cardState} ${selected ? 'selected' : ''}`} key={scene.id} data-scene-id={scene.id}>
              <div className="image-thumb" onDoubleClick={() => previewUrl && setPreviewSceneId(scene.id)}>
                {previewUrl ? <img src={previewUrl} alt={`Scene ${scene.id}`} /> : null}
                {!previewUrl && image && !previewError ? <span className="thumb-state">读取中</span> : null}
                {!previewUrl && previewError ? <span className="thumb-state danger">读取失败</span> : null}
                {!image && imageError ? <XCircle size={24} /> : null}
                {!image && !imageError ? <ImageIcon size={24} /> : null}
                {multiSelect ? (
                  <button type="button" className={`image-select-toggle ${selected ? 'selected' : ''}`} aria-label={`${selected ? '取消选择' : '选择'}分镜 ${scene.id}`} onClick={() => toggleSceneSelection(scene.id)}>
                    {selected ? <Check size={15} /> : null}
                  </button>
                ) : null}
                <span className={`image-card-status ${cardState}`}>{statusText}</span>
                {!multiSelect ? (
                  <div className="image-card-action-panel">
                    <button type="button" disabled={taskLocked || imageGenerationAction.busy || (!image && !imageError)} onClick={() => void regenerate(scene.id)}>{busy ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}重新生成</button>
                    <button type="button" disabled={taskLocked || imageGenerationAction.busy || !prompt} onClick={() => setEditor({ sceneId: scene.id, mode: 'prompt', text: promptText })}><Pencil size={14} />改提示词</button>
                    <button type="button" disabled={taskLocked || imageGenerationAction.busy || !image} onClick={() => setEditor({ sceneId: scene.id, mode: 'reference', text: promptText })}><Wand2 size={14} />参考图编辑</button>
                    <button type="button" disabled={taskLocked || imageGenerationAction.busy} onClick={() => void replaceImage(scene.id)}><ImageUp size={14} />替换图片</button>
                    <button type="button" disabled={taskLocked || imageGenerationAction.busy} onClick={() => setLibrarySceneId(scene.id)}><Library size={14} />素材库选图</button>
                    <button type="button" disabled={!image} onClick={() => { setCopiedSceneId(scene.id); setNotice(`已复制分镜 ${scene.id} 的图片。`); }}><ClipboardCopy size={14} />复制图</button>
                    {copiedSceneId !== null && copiedSceneId !== scene.id ? <button type="button" disabled={taskLocked || imageGenerationAction.busy} onClick={() => void pasteImage(scene.id)}><ClipboardPaste size={14} />粘贴图</button> : null}
                    <button type="button" disabled={!previewUrl} onClick={() => setPreviewSceneId(scene.id)}><Eye size={14} />预览</button>
                    <button type="button" disabled title="需要先接入独立的图生视频服务"><Play size={14} />生成视频</button>
                  </div>
                ) : null}
              </div>
              <div className="image-preview-body">
                <div className="image-preview-title">
                  <strong>{scene.id}. {scene.cap}</strong>
                </div>
                <p>{trimForPreview(promptText, 120)}</p>
                {imageError ? <div className="artifact-image-error" title={imageError.message}>{image?.borrowedFrom ? '原始生成失败：' : ''}{summarizeErrorMessage(imageError.message)}</div> : null}
                {previewError ? <small className="danger-text">{previewError}</small> : null}
              </div>
            </article>
          );
        })}
      </div>

      {editor ? (
        <div className="image-gallery-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !imageGenerationAction.busy && setEditor(null)}>
          <section className="image-gallery-editor-dialog" role="dialog" aria-modal="true" aria-label={editor.mode === 'reference' ? `参考图编辑分镜 ${editor.sceneId}` : `修改分镜 ${editor.sceneId} 提示词`} onKeyDown={(event) => event.key === 'Escape' && !imageGenerationAction.busy && setEditor(null)}>
            <header>
              <div><small>分镜 {String(editor.sceneId).padStart(2, '0')}</small><strong>{editor.mode === 'reference' ? '参考图编辑' : '修改提示词'}</strong></div>
              <button type="button" title="关闭" aria-label="关闭" disabled={imageGenerationAction.busy} onClick={() => setEditor(null)}><X size={17} /></button>
            </header>
            <textarea autoFocus value={editor.text} disabled={imageGenerationAction.busy} onChange={(event) => setEditor({ ...editor, text: event.target.value })} />
            <footer>
              <button type="button" className="ghost-action" disabled={imageGenerationAction.busy} onClick={() => setEditor(null)}>取消</button>
              <button type="button" className="primary-action" disabled={imageGenerationAction.busy || !editor.text.trim()} onClick={() => void submitEditor()}>
                {imageGenerationAction.busy ? <Loader2 className="spin" size={15} /> : editor.mode === 'reference' ? <Wand2 size={15} /> : <Save size={15} />}
                {editor.mode === 'reference' ? '开始编辑' : '保存并重绘'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {librarySceneId !== null ? (
        <div className="image-gallery-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !imageGenerationAction.busy && setLibrarySceneId(null)}>
          <section className="image-library-dialog" role="dialog" aria-modal="true" aria-label={`为分镜 ${librarySceneId} 选择素材`}>
            <header>
              <div><small>替换分镜 {String(librarySceneId).padStart(2, '0')}</small><strong>素材库选图</strong></div>
              <button type="button" title="关闭" aria-label="关闭" disabled={imageGenerationAction.busy} onClick={() => setLibrarySceneId(null)}><X size={17} /></button>
            </header>
            <div className="image-library-toolbar">
              <input aria-label="搜索图片素材" value={libraryQuery} placeholder="搜索提示词、风格或模型" onChange={(event) => setLibraryQuery(event.target.value)} />
              <button type="button" className="gallery-tool-button" disabled={taskLocked || imageGenerationAction.busy} onClick={() => void replaceImage(librarySceneId)}><ImageUp size={15} />本地图片</button>
            </div>
            <div className="image-library-grid">
              {libraryLoading ? <div className="image-library-state"><Loader2 className="spin" size={20} />正在读取素材</div> : null}
              {libraryError ? <div className="image-library-state danger"><XCircle size={20} />{libraryError}</div> : null}
              {!libraryLoading && !libraryError && filteredLibraryRecords.length === 0 ? <div className="image-library-state"><Images size={20} />暂无可用图片</div> : null}
              {filteredLibraryRecords.map((record) => (
                <button type="button" className="image-library-item" key={record.id} disabled={imageGenerationAction.busy} onClick={() => void chooseLibraryImage(record.id)}>
                  <span>{libraryPreviewUrls[record.imagePath] ? <img src={libraryPreviewUrls[record.imagePath]} alt="" /> : <ImageIcon size={21} />}</span>
                  <strong>{trimForPreview(record.promptPreview, 42) || '未命名素材'}</strong>
                  <small>{record.provider} · {record.ratio}<i>选用</i></small>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {previewSceneId !== null ? (
        <div className="image-gallery-modal-backdrop preview" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPreviewSceneId(null)}>
          <section className="image-gallery-preview-dialog" role="dialog" aria-modal="true" aria-label={`预览分镜 ${previewSceneId}`}>
            {imagePreviewUrls[imageBySceneId.get(previewSceneId)?.path ?? ''] ? <img src={imagePreviewUrls[imageBySceneId.get(previewSceneId)?.path ?? '']} alt={`分镜 ${previewSceneId}`} /> : null}
            <button type="button" title="关闭预览" aria-label="关闭预览" onClick={() => setPreviewSceneId(null)}><X size={18} /></button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function NarrationPreviewList({
  api,
  task,
  scenes,
  subtitles,
  assets,
  empty,
  isBrowserPreview,
  applyState,
}: {
  api: StoryDreamApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'];
  assets: TaskArtifactSnapshot['assets']['narration'];
  empty: string;
  isBrowserPreview: boolean;
  applyState: ApplyMutationResult;
}) {
  const [audioPreviewUrls, setAudioPreviewUrls] = useState<Record<string, string>>({});
  const [audioPreviewErrors, setAudioPreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const narrationAction = useAsyncAction();
  const audioPaths = assets.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || assets.length === 0) {
      setAudioPreviewUrls({});
      setAudioPreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(assets.map((asset) => asset.path));
    setAudioPreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setAudioPreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of assets) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setAudioPreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const normalized = narrationAction.reportError(error);
            setAudioPreviewErrors((current) => ({ ...current, [asset.path]: normalized.message }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, assets, audioPaths, isBrowserPreview, narrationAction.reportError]);

  async function regenerate(sceneId: number) {
    await narrationAction.run(async () => {
      setRegeneratingSceneId(sceneId);
      try {
        applyState(await api.regenerateTaskNarration(task.id, sceneId));
      } finally {
        setRegeneratingSceneId(null);
      }
    });
  }

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const rows = scenes.length
    ? [
        ...scenes.map((scene) => ({
          sceneId: scene.id,
          cap: scene.cap,
          cues: subtitles?.cues.filter((cue) => cue.sceneId === scene.id) ?? [],
          assets: assets.filter((item) => item.sceneId === scene.id).sort(compareNarrationPreviewAssets),
          canRegenerate: true,
        })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({
          sceneId: asset.sceneId,
          cap: '已生成配音',
          cues: [],
          assets: [asset],
          canRegenerate: false,
        })),
      ]
    : assets.map((asset) => ({
        sceneId: asset.sceneId,
        cap: '已生成配音',
        cues: [],
        assets: [asset],
        canRegenerate: false,
      }));

  if (rows.length === 0) return <ArtifactEmpty text={empty} />;

  return (
    <div className="narration-preview-list">
      <InlineActionFeedback feedback={narrationAction.feedback} />
      {rows.map((item) => {
        const disabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || regeneratingSceneId === item.sceneId || !item.canRegenerate;
        const ready = item.assets.length > 0;
        const firstCue = item.cues[0];
        const lastCue = item.cues[item.cues.length - 1];
        return (
          <article className={`narration-preview-card ${ready ? 'ready' : 'pending'}`} key={`${item.sceneId}-${item.assets.map((asset) => asset.path).join('|') || 'pending'}`}>
            <div className="narration-preview-head">
              <div>
                <strong>{item.sceneId}. {item.cap}</strong>
                {firstCue && lastCue ? <span>{formatMs(firstCue.startMs)} - {formatMs(lastCue.endMs)} · {item.cues.length} 条短字幕</span> : null}
              </div>
              <span>{ready ? `${item.assets.length} 段可试听` : task.status === 'running' ? '等待/生成中' : '未生成'}</span>
            </div>
            {item.assets.map((asset, index) => {
              const previewUrl = audioPreviewUrls[asset.path] ?? '';
              const previewError = audioPreviewErrors[asset.path] ?? '';
              return (
                <div className="narration-turn-preview" key={`${asset.path}-${asset.turnIndex ?? index}`}>
                  <strong>{narrationTurnLabel(asset, index)}</strong>
                  {previewUrl ? <audio controls className="narration-player" preload="metadata" src={previewUrl} /> : null}
                  {!previewUrl && !previewError ? <div className="narration-player loading">读取音频中</div> : null}
                  {!previewUrl && previewError ? <div className="narration-player error">音频读取失败</div> : null}
                  {asset.text ? <p>{asset.text}</p> : null}
                  <small>{asset.path}</small>
                  {previewError ? <small className="danger-text">{previewError}</small> : null}
                </div>
              );
            })}
            {!ready ? <div className="narration-player loading">等待音频落盘</div> : null}
            {item.cues.length > 0 ? <p>{item.cues.map((cue) => cue.text).join(' / ')}</p> : null}
            {!ready ? <small>等待 TTS 返回真实音频</small> : null}
            <button className="mini-button" disabled={disabled} onClick={() => regenerate(item.sceneId)}>
              {regeneratingSceneId === item.sceneId ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
              {ready ? '重新生成配音' : '生成配音'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function compareNarrationPreviewAssets(a: TaskArtifactSnapshot['assets']['narration'][number], b: TaskArtifactSnapshot['assets']['narration'][number]): number {
  const aTurn = a.turnIndex ?? Number.MAX_SAFE_INTEGER;
  const bTurn = b.turnIndex ?? Number.MAX_SAFE_INTEGER;
  if (aTurn !== bTurn) return aTurn - bTurn;
  return a.path.localeCompare(b.path);
}

function narrationTurnLabel(asset: TaskArtifactSnapshot['assets']['narration'][number], index: number): string {
  const speaker = asset.speaker ? `主播 ${asset.speaker}` : '配音';
  const turn = asset.turnIndex ?? index + 1;
  return `${speaker} · 第 ${turn} 段`;
}

function ArtifactImageGallery({
  assets,
  scenes,
  empty,
}: {
  assets: TaskArtifactSnapshot['assets']['images'];
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  empty: string;
}) {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const galleryItems = scenes.length
    ? [
        ...scenes.map((scene) => ({ sceneId: scene.id, cap: scene.cap, asset: assets.find((item) => item.sceneId === scene.id) })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset })),
      ]
    : assets.map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset }));
  if (galleryItems.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-image-gallery">
      {galleryItems.map((item) => {
        const imagePath = item.asset?.path ?? '';
        return (
          <figure className={imagePath ? 'artifact-image-card' : 'artifact-image-card pending'} key={`${item.sceneId}-${imagePath || 'pending'}`}>
            {imagePath ? (
              <img src={toLocalImageUrl(imagePath)} alt={`分镜 ${item.sceneId}: ${item.cap}`} loading="lazy" />
            ) : (
              <div className="artifact-image-pending">
                <ImageIcon size={22} />
                <span>等待生成</span>
              </div>
            )}
            <figcaption>
              <strong>{item.sceneId}. {item.cap}</strong>
              <span>{imagePath || '等待生成'}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ArtifactAssetList({ assets, empty }: { assets: TaskArtifactSnapshot['assets']['images']; empty: string }) {
  if (assets.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-path-list">
      {assets.map((asset) => <span key={`${asset.sceneId}-${asset.path}`}>{asset.sceneId}. {asset.path}</span>)}
    </div>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Database, FolderOpen, Image as ImageIcon, Loader2, Pencil, RotateCcw, Save, Wand2, X, XCircle } from 'lucide-react';
import { ErrorDetails as ErrorSummaryButton, summarizeErrorMessage } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { StatusBadge as StatusPill, taskStatusLabel as statusLabel } from '../../components/StatusBadge';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  AppConfig,
  Task,
  TaskArtifactSnapshot,
  TaskEvent,
  TaskStepRerunMode,
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
import { artifactPanelTitle, imageProgressLabel, snapshotStepStatus } from './task-pipeline';

export function ArtifactPreviewContent({
  api,
  task,
  config,
  applyState,
  tab,
  snapshot,
  latestEvent,
  currentAgent,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  task: Task;
  config: AppConfig;
  applyState: ApplyMutationResult;
  tab: 'preview' | 'storyboard' | 'audio';
  snapshot: TaskArtifactSnapshot | null;
  latestEvent: TaskEvent | null;
  currentAgent: string;
  isBrowserPreview: boolean;
}) {
  const artifact = snapshot?.artifact ?? {};
  const sourceContext = artifact.sourceContext;
  const scenes = artifact.scenes ?? [];
  const imagePrompts = artifact.imagePrompts ?? [];
  const subtitles = artifact.subtitles;
  const imageAssets = snapshot?.assets.images ?? [];
  const imageErrors = snapshot?.assets.imageErrors ?? [];
  const narrationAssets = snapshot?.assets.narration ?? [];
  const imageProgress = imageProgressLabel(scenes.length, imageAssets.length, snapshotStepStatus(snapshot, 4));
  const [rerunningStepAction, setRerunningStepAction] = useState<string | null>(null);
  const artifactAction = useAsyncAction();
  const canRerunStep = !isBrowserPreview && task.status !== 'running' && task.status !== 'pending' && Boolean(task.artifactStatePath);

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
      <div className="artifact-preview-head">
        <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={22} /> : <Database size={22} />}</div>
        <div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          {latestEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={latestEvent.detail} title="流水线错误" /> : <span>{snapshot?.message || latestEvent?.detail || '等待当前步骤产物落盘'}</span>}
        </div>
        {task.status === 'completed' && task.outputDir ? (
          <button className="ghost-action" disabled={artifactAction.busy} onClick={openArtifactOutput}>
            <FolderOpen size={15} />
            打开剪映草稿
          </button>
        ) : null}
      </div>
      <InlineActionFeedback feedback={artifactAction.feedback} />

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
          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
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
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const [editingPromptSceneId, setEditingPromptSceneId] = useState<number | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [savingPromptSceneId, setSavingPromptSceneId] = useState<number | null>(null);
  const imageGenerationAction = useAsyncAction();
  const imagePaths = images.map((asset) => asset.path).join('|');
  const imageBySceneId = useMemo(() => new Map(images.map((asset) => [asset.sceneId, asset] as const)), [images]);
  const promptBySceneId = useMemo(() => new Map(imagePrompts.map((prompt) => [prompt.sceneId, prompt] as const)), [imagePrompts]);
  const imageErrorBySceneId = useMemo(() => new Map(imageErrors.map((item) => [item.sceneId, item] as const)), [imageErrors]);

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

  async function regenerate(sceneId: number) {
    await imageGenerationAction.run(async () => {
      setRegeneratingSceneId(sceneId);
      try {
        applyState(await api.regenerateTaskImage(task.id, sceneId));
      } finally {
        setRegeneratingSceneId(null);
      }
    });
  }

  function openPromptEditor(sceneId: number, promptText: string) {
    setEditingPromptSceneId(sceneId);
    setEditingPromptText(promptText);
  }

  function cancelPromptEdit() {
    setEditingPromptSceneId(null);
    setEditingPromptText('');
  }

  async function savePrompt(sceneId: number) {
    const nextPrompt = editingPromptText.trim();
    if (!nextPrompt) return;
    await imageGenerationAction.run(async () => {
      setSavingPromptSceneId(sceneId);
      try {
        applyState(await api.updateTaskImagePrompt(task.id, sceneId, nextPrompt));
        cancelPromptEdit();
      } finally {
        setSavingPromptSceneId(null);
      }
    });
  }

  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜后生成图片" />;

  return (
    <div className="image-generation-gallery">
      <div className="image-generation-toolbar">
        <span>并发数 {concurrency}</span>
        <span>{images.length}/{scenes.length} 张已落盘</span>
      </div>
      <InlineActionFeedback feedback={imageGenerationAction.feedback} />
      <div className="image-preview-grid">
        {scenes.map((scene) => {
          const image = imageBySceneId.get(scene.id);
          const prompt = promptBySceneId.get(scene.id);
          const imageError = imageErrorBySceneId.get(scene.id);
          const previewUrl = image ? imagePreviewUrls[image.path] : '';
          const previewError = image ? imagePreviewErrors[image.path] : '';
          const cardState = image ? 'ready' : imageError ? 'failed' : 'pending';
          const statusText = image ? '已生成' : imageError ? '生成失败' : task.status === 'running' ? '等待/生成中' : '未生成';
          const promptText = prompt?.prompt ?? scene.descPrompt;
          const isEditingPrompt = editingPromptSceneId === scene.id;
          const isSavingPrompt = savingPromptSceneId === scene.id;
          const editDisabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || !prompt || isSavingPrompt;
          return (
            <article className={`image-preview-card ${cardState}`} key={scene.id}>
              <div className="image-thumb">
                {previewUrl ? <img src={previewUrl} alt={`Scene ${scene.id}`} /> : null}
                {!previewUrl && image && !previewError ? <span className="thumb-state">读取中</span> : null}
                {!previewUrl && previewError ? <span className="thumb-state danger">读取失败</span> : null}
                {!image && imageError ? <XCircle size={24} /> : null}
                {!image && !imageError ? <ImageIcon size={24} /> : null}
              </div>
              <div className="image-preview-body">
                <div className="image-preview-title">
                  <strong>{scene.id}. {scene.cap}</strong>
                  <span>{statusText}</span>
                </div>
                <p>{trimForPreview(promptText, 180)}</p>
                {image ? <small>{image.path}</small> : <small>等待 provider 返回真实图片</small>}
                {imageError ? <div className="artifact-image-error" title={imageError.message}>{summarizeErrorMessage(imageError.message)}</div> : null}
                {previewError ? <small className="danger-text">{previewError}</small> : null}
              </div>
              <div className="image-preview-actions">
                <button
                  className="mini-button"
                  disabled={isBrowserPreview || task.status === 'running' || task.status === 'pending' || (!image && !imageError) || regeneratingSceneId === scene.id}
                  onClick={() => regenerate(scene.id)}
                >
                  {regeneratingSceneId === scene.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                  重新生成
                </button>
                <button className="mini-button" disabled={editDisabled} onClick={() => openPromptEditor(scene.id, promptText)}>
                  <Pencil size={14} />
                  修改提示词
                </button>
                {isEditingPrompt ? (
                  <div className="image-prompt-editor">
                    <textarea value={editingPromptText} disabled={isSavingPrompt} onChange={(event) => setEditingPromptText(event.target.value)} />
                    <div className="image-prompt-editor-actions">
                      <button className="mini-button" disabled={isSavingPrompt || !editingPromptText.trim()} onClick={() => savePrompt(scene.id)}>
                        {isSavingPrompt ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
                        保存提示词
                      </button>
                      <button className="mini-button" disabled={isSavingPrompt} onClick={cancelPromptEdit}>
                        <X size={14} />
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
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
        ...scenes.map((scene, index) => ({
          sceneId: scene.id,
          cap: scene.cap,
          cue: subtitles?.cues[index],
          assets: assets.filter((item) => item.sceneId === scene.id).sort(compareNarrationPreviewAssets),
          canRegenerate: true,
        })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({
          sceneId: asset.sceneId,
          cap: '已生成配音',
          cue: undefined,
          assets: [asset],
          canRegenerate: false,
        })),
      ]
    : assets.map((asset) => ({
        sceneId: asset.sceneId,
        cap: '已生成配音',
        cue: undefined,
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
        return (
          <article className={`narration-preview-card ${ready ? 'ready' : 'pending'}`} key={`${item.sceneId}-${item.assets.map((asset) => asset.path).join('|') || 'pending'}`}>
            <div className="narration-preview-head">
              <div>
                <strong>{item.sceneId}. {item.cap}</strong>
                {item.cue ? <span>{formatMs(item.cue.startMs)} - {formatMs(item.cue.endMs)}</span> : null}
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
            {item.cue ? <p>{item.cue.text}</p> : null}
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

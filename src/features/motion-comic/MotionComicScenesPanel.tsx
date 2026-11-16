import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ArrowLeft, Layers3, Plus, Users, Sparkles } from 'lucide-react';
import { Button, CheckboxField, Toolbar, TextField, TextAreaField, SelectField } from '../../ui';
import type { MotionComicPipelineData, MotionComicEpisode, MotionComicDramaticScene, MotionComicWorkflowStage, MotionComicShot, MotionComicDialogueCue } from '../../shared/motion-comic';
import { MotionComicSceneShotEditor } from './MotionComicSceneShotEditor';
import { resolveMotionComicSceneAct } from '../../shared/motion-comic';
import { motionComicSourceEpisodeIdForEpisode } from '../../shared/motion-comic-planning';
import { ScenePreview, sceneShotImage, type SceneMediaResolver } from './MotionComicScenePreview';
import { MotionComicSceneReferences } from './MotionComicSceneReferences';
import './motion-comic-scenes-workspace.css';

export interface ScenesPanelProps {
  document: MotionComicPipelineData;
  activeEpisode: MotionComicEpisode;
  onSelectEpisode: (episodeId: string) => void;
  onBack?: () => void;
  resolveMediaUrl?: SceneMediaResolver;
  onOpenAssets?: () => void;
  onAddScene: () => void;
  onAddSceneDefinition?: (scene: MotionComicDramaticScene) => void;
  onUpdateScene: (sceneId: string, updates: Partial<MotionComicDramaticScene>) => void;
  onSetActBoundary: (sceneId: string, startsNewAct: boolean) => void;
  onRenameAct: (actIndex: number, title: string) => void;
  onPlanEpisode?: (sourceEpisodeId: string) => void;
  onContinue?: (stage: MotionComicWorkflowStage) => void;
  onUpdateShot?: (shotId: string, updates: Partial<MotionComicShot>) => void;
  onUpdateCue?: (cueId: string, updates: Partial<MotionComicDialogueCue>) => void;
  onDraftGuardChange?: (guard: (() => boolean) | null) => void;
}
export function MotionComicScenesPanel({ document, activeEpisode, onSelectEpisode, onBack, resolveMediaUrl, onOpenAssets, onAddScene, onUpdateScene, onSetActBoundary, onRenameAct, onPlanEpisode, onContinue, onUpdateShot, onUpdateCue, onDraftGuardChange }: ScenesPanelProps): ReactElement {
  const [editingShotIds, setEditingShotIds] = useState<string[]>([]);
  const hasPendingShotEdits = editingShotIds.length > 0;
  const [draftWarning, setDraftWarning] = useState('');
  const [selectedScenes, setSelectedScenes] = useState<Record<string, string>>({});
  const pendingAddedScene = useRef<{ episodeId: string; ids: string[] } | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const [sceneInfoEditing, setSceneInfoEditing] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  useEffect(() => {
    onDraftGuardChange?.(() => {
      if (!hasPendingShotEdits) return true;
      setDraftWarning('镜头仍在编辑，请先保存镜头或取消编辑后再切换。');
      return false;
    });
    return () => onDraftGuardChange?.(null);
  }, [hasPendingShotEdits, onDraftGuardChange]);
  useEffect(() => { if (!hasPendingShotEdits) setDraftWarning(''); }, [hasPendingShotEdits]);
  useEffect(() => {
    const pending = pendingAddedScene.current;
    if (!pending || pending.episodeId !== activeEpisode.id) return;
    const added = activeEpisode.scenes.find(scene => !pending.ids.includes(scene.id));
    if (added) {
      setSelectedScenes(current => ({ ...current, [activeEpisode.id]: added.id }));
      pendingAddedScene.current = null;
    }
  }, [activeEpisode.id, activeEpisode.scenes]);
  const onShotEditingChange = (shotId: string, editing: boolean) => setEditingShotIds(current => editing ? [...new Set([...current, shotId])] : current.filter(id => id !== shotId));
  const resolvedScenes = activeEpisode.scenes.map((scene, position) => {
    const act = resolveMotionComicSceneAct(scene, position, activeEpisode.scenes.length);
    const previousAct = position > 0 ? resolveMotionComicSceneAct(activeEpisode.scenes[position - 1], position - 1, activeEpisode.scenes.length) : undefined;
    return { scene, position, act, startsNewAct: position === 0 || act.actIndex !== previousAct?.actIndex };
  });
  const actGroups = new Map<number, typeof resolvedScenes>();
  resolvedScenes.forEach(entry => actGroups.set(entry.act.actIndex, [...(actGroups.get(entry.act.actIndex) ?? []), entry]));
  const selected = resolvedScenes.find(entry => entry.scene.id === selectedScenes[activeEpisode.id]) ?? resolvedScenes[0];
  useEffect(() => { detailRef.current?.scrollTo({ top: 0 }); setSceneInfoEditing(false); }, [activeEpisode.id, selected?.scene.id]);
  const sourceId = motionComicSourceEpisodeIdForEpisode(document, activeEpisode) ?? activeEpisode.id;
  const currentSource = document.sourceDocument?.episodes.find(source => source.id === sourceId);
  const sourceLabel = (source: string) => source === 'ai-planned' ? 'AI 规划' : source === 'manual' ? '人工调整' : '规则推断';

  return <div className="motion-comic-stage-panel motion-comic-scenes-panel comic-scenes-workspace" data-motion-comic-stage-panel="scenes">
    <div className="comic-scenes-breadcrumb"><span>打开本集剧本工作台</span><span>/</span><span>第 {activeEpisode.number} 集</span><span>/</span><strong>分幕与场次</strong></div>
    <header className="motion-comic-stage-panel__heading">
      {onBack ? <Button className="comic-scenes-back" icon={<ArrowLeft size={14} />} disabled={hasPendingShotEdits} onClick={onBack}>返回本集剧本</Button> : <span><Layers3 size={18} /></span>}
      <div><p>分幕与场次</p><h1>第 {activeEpisode.number} 集 · {activeEpisode.title}</h1><small>{activeEpisode.scenes.length ? `${actGroups.size} 幕 · ${activeEpisode.scenes.length} 场 · ${activeEpisode.scenes.flatMap(scene => scene.shots).length} 镜头` : '本集尚未应用分镜，请先审核并应用本集分镜'}</small></div>
      <Toolbar aria-label="分幕分场操作">
        <SelectField label="当前分集" value={activeEpisode.id} disabled={hasPendingShotEdits} options={document.episodes.map(episode => ({ value: episode.id, label: `第 ${episode.number} 集 · ${episode.title}` }))} onChange={event => { if (!hasPendingShotEdits) onSelectEpisode(event.target.value); }} />
        {activeEpisode.scenes.length ? <Button icon={<Plus size={14} />} disabled={hasPendingShotEdits} onClick={() => { pendingAddedScene.current = { episodeId: activeEpisode.id, ids: activeEpisode.scenes.map(scene => scene.id) }; onAddScene(); }}>新增场次</Button> : null}
        {activeEpisode.scenes.length > 0 && onContinue ? <Button variant="primary" icon={<Users size={14} />} disabled={hasPendingShotEdits} onClick={() => onContinue('assets')}>进入制作资产</Button> : null}
      </Toolbar>
    </header>
    {hasPendingShotEdits ? <p className="comic-scenes-workspace__draft" role="status">有 {editingShotIds.length} 个镜头正在编辑，请保存或取消后再切换。</p> : null}
    {draftWarning ? <p role="alert">{draftWarning}</p> : null}
    {!selected ? <div className="motion-comic-scenes-unplanned-box">
      <h3>本集尚未应用分镜</h3><p>请返回本集剧本，完成审核、生成分镜并确认应用后，再编辑幕、场次与镜头。</p>
      {currentSource?.sourceText ? <div className="motion-comic-scenes-source-preview" tabIndex={0} aria-label="本集原文">{currentSource.sourceText}</div> : null}
      <Button variant="primary" disabled={!onBack && !onPlanEpisode} icon={<Sparkles size={14} />} onClick={() => onBack ? onBack() : onPlanEpisode?.(sourceId)}>返回本集剧本</Button>
    </div> : <div className={`comic-scenes-workspace__layout${referencesOpen ? ' is-references-open' : ''}`}>
      <nav className="comic-scenes-directory" aria-label="本集幕与场次目录">
        {Array.from(actGroups.entries()).map(([actIndex, entries]) => <section key={actIndex} aria-label={`第 ${actIndex} 幕`}>
          <h2>第 {actIndex} 幕 · {entries[0].act.actTitle}</h2>
          {entries.map(({ scene }) => <Button key={scene.id} variant="subtle" title={`场次 ${scene.index} · ${scene.title}`} aria-pressed={scene.id === selected.scene.id} disabled={hasPendingShotEdits && scene.id !== selected.scene.id} onClick={() => { if (!hasPendingShotEdits) setSelectedScenes(current => ({ ...current, [activeEpisode.id]: scene.id })); }}>
            <ScenePreview path={sceneShotImage(document, scene.shots[0])?.localPath || sceneShotImage(document, scene.shots[0])?.uri} label={`${scene.title}场次画面`} resolveUrl={resolveMediaUrl} compact />
            <span className="comic-scenes-directory__copy"><strong>场次 {scene.index}</strong><span>{scene.title}</span><small>{scene.shots.length} 镜头 · {activeEpisode.dialogueCues.filter(cue => scene.shots.some(shot => shot.dialogueCueIds.includes(cue.id))).length} 句对白</small></span>
          </Button>)}
        </section>)}
      </nav>
      <section ref={detailRef} className="comic-scenes-detail" aria-label="当前场次编辑" key={`${activeEpisode.id}:${selected.scene.id}`}>
        <header className="comic-scenes-detail__heading"><div><h2>场次 {selected.scene.index} · {selected.scene.title}</h2><p>第 {selected.act.actIndex} 幕 {selected.act.actTitle} / {sourceLabel(selected.act.actSource)} / {selected.scene.shots.length} 镜头 · {selected.scene.shots.reduce((total, shot) => total + shot.durationMs, 0) / 1000} 秒</p></div><Button className="comic-scenes-reference-toggle" variant="subtle" density="compact" aria-expanded={referencesOpen} onClick={() => setReferencesOpen(current => !current)}>{referencesOpen ? '收起引用' : '场次引用'}</Button></header>
        <details className="comic-scenes-info" open><summary>场次信息</summary>
          <div className="comic-scenes-info__summary"><strong>场景概述：</strong><p>{selected.scene.summary || '尚未填写场次概要'}</p><Button variant="subtle" density="compact" aria-expanded={sceneInfoEditing} onClick={() => setSceneInfoEditing(current => !current)}>{sceneInfoEditing ? '完成编辑' : '编辑场次信息'}</Button></div>
          {sceneInfoEditing ? <div className="comic-scenes-detail__fields">
          <TextField label="幕标题" key={`${selected.act.actIndex}-${selected.act.actTitle}`} defaultValue={selected.act.actTitle} maxLength={512} onBlur={event => { const title = event.currentTarget.value.trim(); if (title && title !== selected.act.actTitle) onRenameAct(selected.act.actIndex, title); }} />
          <TextField label="场次标题" value={selected.scene.title} onChange={(_, data) => onUpdateScene(selected.scene.id, { title: data.value })} />
          <CheckboxField label={selected.position === 0 ? '本集从此场开始第 1 幕' : '从本场开始新一幕'} checked={selected.startsNewAct} disabled={selected.position === 0} onChange={(_, data) => onSetActBoundary(selected.scene.id, data.checked === true)} />
          <TextAreaField label="场次概要" value={selected.scene.summary} rows={2} resize="vertical" onChange={(_, data) => onUpdateScene(selected.scene.id, { summary: data.value })} />
          </div> : null}
          <details className="comic-scenes-info__boundary"><summary>幕边界依据</summary><TextAreaField label="幕边界依据" key={`${selected.scene.id}-${selected.act.actBoundaryReason}`} defaultValue={selected.act.actBoundaryReason} rows={2} resize="vertical" onBlur={event => { const reason = event.currentTarget.value.trim(); if (reason && reason !== selected.act.actBoundaryReason) onUpdateScene(selected.scene.id, { actBoundaryReason: reason, actSource: 'manual' }); }} /></details>
        </details>
        <section className="comic-scene-shot-list" aria-label={`${selected.scene.title}镜头内容`}>
          <header><strong>逐镜制作内容</strong><small>{selected.scene.shots.length} 镜头 · {selected.scene.shots.reduce((total, shot) => total + shot.durationMs, 0) / 1000} 秒</small></header>
          {!selected.scene.shots.length ? <p>本场还没有镜头，请补充分镜后再制作。</p> : selected.scene.shots.map(shot => <MotionComicSceneShotEditor key={shot.id} document={document} shot={shot} hasPreview={Boolean(sceneShotImage(document, shot)?.localPath || sceneShotImage(document, shot)?.uri)} preview={<ScenePreview path={sceneShotImage(document, shot)?.localPath || sceneShotImage(document, shot)?.uri} label={`${shot.title}镜头画面`} resolveUrl={resolveMediaUrl} />} cues={activeEpisode.dialogueCues.filter(cue => shot.dialogueCueIds.includes(cue.id))} onUpdateShot={onUpdateShot} onUpdateCue={onUpdateCue} onEditingChange={onShotEditingChange} />)}
        </section>
      </section>
      <MotionComicSceneReferences document={document} scene={selected.scene} resolveUrl={resolveMediaUrl} onOpenAssets={onOpenAssets} disabled={hasPendingShotEdits} />
    </div>}
  </div>;
}

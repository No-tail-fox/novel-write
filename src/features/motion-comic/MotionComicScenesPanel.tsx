import { useEffect, useState, type ReactElement } from 'react';
import { Layers3, Plus, Users, Sparkles } from 'lucide-react';
import { Button, CheckboxField, Toolbar, TextField, TextAreaField } from '../../ui';
import type { MotionComicPipelineData, MotionComicEpisode, MotionComicDramaticScene, MotionComicWorkflowStage } from '../../shared/motion-comic';
import { resolveMotionComicSceneAct } from '../../shared/motion-comic';
import { motionComicSourceEpisodeIdForEpisode, nextUnplannedMotionComicSourceEpisodeId } from '../../shared/motion-comic-planning';

export interface ScenesPanelProps {
  document: MotionComicPipelineData;
  activeEpisode: MotionComicEpisode;
  onSelectEpisode: (episodeId: string) => void;
  onAddScene: () => void;
  onAddSceneDefinition?: (scene: MotionComicDramaticScene) => void;
  onUpdateScene: (sceneId: string, updates: Partial<MotionComicDramaticScene>) => void;
  onSetActBoundary: (sceneId: string, startsNewAct: boolean) => void;
  onRenameAct: (actIndex: number, title: string) => void;
  onPlanEpisode?: (sourceEpisodeId: string) => void;
  onContinue?: (stage: MotionComicWorkflowStage) => void;
}
export function MotionComicScenesPanel({ document, activeEpisode, onSelectEpisode, onAddScene, onUpdateScene, onSetActBoundary, onRenameAct, onPlanEpisode, onContinue }: ScenesPanelProps): ReactElement {
  const allSourceEpisodes = document.sourceDocument?.episodes ?? [];
  const displayEpisodes = allSourceEpisodes.length > 0
    ? allSourceEpisodes.map((sourceEp) => {
        const generated = document.episodes.find((e) => motionComicSourceEpisodeIdForEpisode(document, e) === sourceEp.id);
        return {
          id: generated?.id ?? sourceEp.id,
          sourceId: sourceEp.id,
          number: sourceEp.number,
          title: sourceEp.title,
          isPlanned: Boolean(generated && generated.scenes.length > 0),
          sceneCount: generated?.scenes.length ?? 0,
          shotCount: generated?.scenes.flatMap((s) => s.shots).length ?? 0,
          sourceText: sourceEp.sourceText,
        };
      })
    : document.episodes.map((e) => ({
        id: e.id,
        sourceId: e.id,
        number: e.number,
        title: e.title,
        isPlanned: e.scenes.length > 0,
        sceneCount: e.scenes.length,
        shotCount: e.scenes.flatMap((s) => s.shots).length,
        sourceText: '',
      }));

  const CHUNK_SIZE = 20;
  const totalEpisodes = displayEpisodes.length;
  const chunkCount = Math.ceil(totalEpisodes / CHUNK_SIZE);
  const activeEpisodeNumber = activeEpisode.number ?? 1;
  const defaultChunk = chunkCount > 1 ? Math.floor((activeEpisodeNumber - 1) / CHUNK_SIZE) : -1;
  const [selectedChunk, setSelectedChunk] = useState<number>(defaultChunk);
  useEffect(() => {
    setSelectedChunk((current) => current === -1 ? current : Math.floor((activeEpisodeNumber - 1) / CHUNK_SIZE));
  }, [activeEpisodeNumber]);

  const filteredEpisodes = selectedChunk === -1 || chunkCount <= 1
    ? displayEpisodes
    : displayEpisodes.slice(selectedChunk * CHUNK_SIZE, (selectedChunk + 1) * CHUNK_SIZE);

  const isCurrentPlanned = activeEpisode.scenes.length > 0;
  const resolvedScenes = activeEpisode.scenes.map((scene, position) => {
    const act = resolveMotionComicSceneAct(scene, position, activeEpisode.scenes.length);
    const previousAct = position > 0
      ? resolveMotionComicSceneAct(activeEpisode.scenes[position - 1], position - 1, activeEpisode.scenes.length)
      : undefined;
    return { scene, position, act, startsNewAct: position === 0 || act.actIndex !== previousAct?.actIndex };
  });
  const actGroups = new Map<number, typeof resolvedScenes>();
  if (isCurrentPlanned) {
    resolvedScenes.forEach((entry) => {
      actGroups.set(entry.act.actIndex, [...(actGroups.get(entry.act.actIndex) ?? []), entry]);
    });
  }

  const sourceId = motionComicSourceEpisodeIdForEpisode(document, activeEpisode) ?? activeEpisode.id;
  const currentSource = allSourceEpisodes.find((s) => s.id === sourceId);
  const canPlan = Boolean(onPlanEpisode && (!currentSource || currentSource.id === nextUnplannedMotionComicSourceEpisodeId(document)));

  return <div className="motion-comic-stage-panel motion-comic-scenes-panel" data-motion-comic-stage-panel="scenes">
    <header className="motion-comic-stage-panel__heading">
      <span><Layers3 size={18} /></span>
      <div>
        <p>03 · 分幕分场</p>
        <h1>{activeEpisode.title}</h1>
        <small>
          {isCurrentPlanned
            ? `${actGroups.size} 幕 · ${activeEpisode.scenes.length} 场 · ${activeEpisode.scenes.flatMap((scene) => scene.shots).length} 镜头`
            : '本集尚未生成结构，请先生成并确认预览'}
        </small>
      </div>
      <Toolbar aria-label="分幕分场操作">
        {isCurrentPlanned ? <Button variant="secondary" icon={<Plus size={14} />} onClick={onAddScene}>新增场次</Button> : null}
        {isCurrentPlanned && onContinue ? <Button variant="primary" icon={<Users size={14} />} onClick={() => onContinue('assets')}>确认并进入角色资产</Button> : null}
      </Toolbar>
    </header>
    {chunkCount > 1 ? (
      <div className="motion-comic-scenes-panel__episodes-filter">
        <Button
          variant={selectedChunk === -1 ? 'primary' : 'subtle'}
          density="compact"
          onClick={() => setSelectedChunk(-1)}
        >
          全部 ({totalEpisodes})
        </Button>
        {Array.from({ length: chunkCount }).map((_, idx) => {
          const startNum = idx * CHUNK_SIZE + 1;
          const endNum = Math.min((idx + 1) * CHUNK_SIZE, totalEpisodes);
          return (
            <Button
              key={idx}
              variant={selectedChunk === idx ? 'primary' : 'subtle'}
              density="compact"
              onClick={() => setSelectedChunk(idx)}
            >
              {String(startNum).padStart(2, '0')}-{String(endNum).padStart(2, '0')} 集
            </Button>
          );
        })}
      </div>
    ) : null}

    <div className="motion-comic-scenes-panel__episodes" role="tablist" aria-label="选择分集">
      {filteredEpisodes.map((ep) => {
        const isActive = ep.id === activeEpisode.id;
        return (
          <Button
            key={ep.id}
            variant="subtle"
            density="compact"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'is-active' : ''}
            onClick={() => onSelectEpisode(ep.id)}

          >
            <span>EP {String(ep.number).padStart(2, '0')} · {ep.title}</span>
            {ep.isPlanned ? (
              <span>({ep.sceneCount}场)</span>
            ) : (
              <span className="motion-comic-ep-pill">待分幕</span>
            )}
          </Button>
        );
      })}
    </div>

    {!isCurrentPlanned ? (
      <div className="motion-comic-scenes-unplanned-box">
        <h3>{activeEpisode.title} · 尚未生成分幕与分场</h3>
        <p>
          {currentSource?.sourceText ? `已读取本集源文本（共 ${currentSource.sourceText.length} 字）。逐集规划场次、角色与分镜，确认后再进入制作。` : '可通过 AI 模型规划本集，或手动添加场次。'}
        </p>
        {currentSource?.sourceText ? (
          <div className="motion-comic-scenes-source-preview" tabIndex={0} aria-label="本集原文">
            {currentSource.sourceText}
          </div>
        ) : null}
        <div>
          <Button variant="primary" disabled={!canPlan} icon={<Sparkles size={14} />} onClick={() => onPlanEpisode?.(currentSource?.id ?? activeEpisode.id)}>生成本集结构预览</Button>
          {!currentSource ? <Button variant="secondary" icon={<Plus size={14} />} onClick={onAddScene}>手动添加第一场</Button> : null}
        </div>
        {!canPlan && currentSource ? <p>请先完成前一集的结构化，以复用角色和场景设定。</p> : null}
      </div>
    ) : (
      <div className="motion-comic-scenes-board">
        {Array.from(actGroups.entries()).map(([actIndex, entries]) => {
          const actSource = entries.some((entry) => entry.act.actSource === 'manual')
            ? 'manual'
            : entries.every((entry) => entry.act.actSource === 'ai-planned') ? 'ai-planned' : 'rule-inferred';
          const actSourceLabel = actSource === 'ai-planned' ? 'AI 规划' : actSource === 'manual' ? '人工调整' : '规则推断';
          return <div key={actIndex} className="motion-comic-act-card" data-act-source={actSource}>
            <div className="motion-comic-act-card__header">
              <div>
                <span className="motion-comic-act-card__badge">第 {actIndex} 幕</span>
                <span className="motion-comic-act-card__source">{actSourceLabel}</span>
              </div>
              <span>{entries.length} 场 · {entries.flatMap(({ scene }) => scene.shots).length} 镜头</span>
            </div>
            <TextField
              fieldClassName="motion-comic-act-card__title-field"
              label="幕标题"
              key={`${actIndex}-${entries[0]?.act.actTitle}`}
              defaultValue={entries[0]?.act.actTitle ?? `第 ${actIndex} 幕`}
              maxLength={512}
              onBlur={(event) => {
                const title = event.currentTarget.value.trim();
                if (title && title !== entries[0]?.act.actTitle) onRenameAct(actIndex, title);
              }}
            />
            <div className="motion-comic-scenes-panel__list">
              {entries.map(({ scene, position, act, startsNewAct }) => {
                const dialogueCount = activeEpisode.dialogueCues.filter((cue) => scene.shots.some((shot) => shot.dialogueCueIds.includes(cue.id))).length;
                return (
                  <div key={scene.id} className="motion-comic-scene-editor">
                    <div>
                      <strong>场次 {scene.index}</strong>
                      <span>{scene.shots.length} 镜 · {dialogueCount} 句对白</span>
                    </div>
                    <div>
                      <CheckboxField
                        label={position === 0 ? '本集从此场开始第 1 幕' : '从本场开始新一幕'}
                        checked={startsNewAct}
                        disabled={position === 0}
                        onChange={(_, data) => onSetActBoundary(scene.id, data.checked === true)}
                      />
                      <TextField label="场次标题" value={scene.title} onChange={(_, data) => onUpdateScene(scene.id, { title: data.value })} />
                      <TextAreaField label="场次概要" value={scene.summary} rows={3} onChange={(_, data) => onUpdateScene(scene.id, { summary: data.value })} />
                      <TextAreaField
                        key={`${scene.id}-${act.actBoundaryReason}`}
                        label="幕边界依据"
                        defaultValue={act.actBoundaryReason}
                        rows={2}
                        resize="vertical"
                        onBlur={(event) => {
                          const reason = event.currentTarget.value.trim();
                          if (reason && reason !== act.actBoundaryReason) onUpdateScene(scene.id, { actBoundaryReason: reason, actSource: 'manual' });
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>;
        })}
      </div>
    )}
  </div>;
}

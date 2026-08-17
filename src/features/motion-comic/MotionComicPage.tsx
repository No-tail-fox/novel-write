import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, ChevronRight, Film, Loader2, Plus, Save, ShieldCheck, UserRound } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import {
  MOTION_COMIC_RATIOS,
  parseMotionComicPipelineData,
  validateMotionComicPipeline,
  type MotionComicCharacter,
  type MotionComicCharacterLook,
  type MotionComicDramaticScene,
  type MotionComicEpisode,
  type MotionComicPipelineData,
  type MotionComicSceneAsset,
  type MotionComicShot,
} from '../../shared/motion-comic';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, Pane, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import '../../styles/features/motion-comic.css';

type NodeKind = 'series' | 'character' | 'look' | 'episode' | 'scene' | 'shot' | 'scene-asset' | 'prop';
interface SelectedNode { kind: NodeKind; id: string }

const stageLabels: Record<MotionComicPipelineData['stage'], string> = {
  draft: '草稿',
  'series-bible': '系列设定',
  'character-bible': '角色设定',
  'episode-script': '分集剧本',
  'shot-board': '镜头板',
  keyframes: '关键帧',
  audio: '对白与配音',
  assembly: '合成',
  qa: '质量检查',
  completed: '已完成',
  failed: '失败',
};

export function MotionComicPage({
  api,
  state,
  applyState,
  requestedTaskId,
  onRequestedTaskHandled,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  requestedTaskId: string;
  onRequestedTaskHandled: (taskId: string) => void;
}) {
  const projectAction = useAsyncAction();
  const [document, setDocument] = useState<MotionComicPipelineData | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selection, setSelection] = useState<SelectedNode | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createPremise, setCreatePremise] = useState('');
  const [createEpisodeTitle, setCreateEpisodeTitle] = useState('第一集');
  const [createRatio, setCreateRatio] = useState<MotionComicPipelineData['ratio']>('9:16');
  const [dirty, setDirty] = useState(false);

  const projects = useMemo(
    () => state.tasks.filter((task) => task.taskType === 'motion-comic' && !task.archivedAt),
    [state.tasks],
  );
  const resolved = useMemo(() => resolveWorkspaceSelection(document, selection), [document, selection]);
  const activeEpisode = resolved.episode ?? document?.episodes.find((episode) => episode.id === document.activeEpisodeId) ?? document?.episodes[0] ?? null;
  const selectedShot = resolved.shot ?? activeEpisode?.scenes[0]?.shots[0] ?? null;
  const readyIssues = document ? validateMotionComicPipeline(document, { ready: true }) : [];

  const openProject = useCallback(async (taskId: string) => {
    const result = await projectAction.run(async () => {
      const task = await api.getTaskDetail(taskId);
      if (!task || task.taskType !== 'motion-comic') throw new Error('AI 漫剧项目不存在或已被移除。');
      return parseMotionComicPipelineData(task.pipelineData);
    });
    if (!result.ok) return;
    setDocument(result.value);
    setActiveProjectId(taskId);
    setSelection({ kind: 'series', id: result.value.series.id });
    setCreateOpen(false);
    setDirty(false);
  }, [api, projectAction.run]);

  useEffect(() => {
    if (!requestedTaskId) return;
    void openProject(requestedTaskId).finally(() => onRequestedTaskHandled(requestedTaskId));
  }, [onRequestedTaskHandled, openProject, requestedTaskId]);

  useEffect(() => {
    if (requestedTaskId || activeProjectId || projects.length === 0) return;
    void openProject(projects[0].id);
  }, [activeProjectId, openProject, projects, requestedTaskId]);

  function mutateDocument(update: (current: MotionComicPipelineData) => MotionComicPipelineData) {
    setDocument((current) => current ? update(current) : current);
    setDirty(true);
  }

  function selectNode(kind: NodeKind, id: string) {
    setSelection({ kind, id });
    if (!document) return;
    const next = resolveWorkspaceSelection(document, { kind, id });
    if (next.episode && next.episode.id !== document.activeEpisodeId) {
      mutateDocument((current) => ({ ...current, activeEpisodeId: next.episode!.id }));
    }
  }

  async function createProject() {
    const result = await projectAction.run(async () => {
      const mutation = await api.createMotionComic({
        title: createTitle,
        premise: createPremise,
        episodeTitle: createEpisodeTitle || undefined,
        ratio: createRatio,
      });
      applyState(mutation);
      if (!mutation || mutation.kind !== 'task-upsert') throw new Error('AI 漫剧项目已保存，但未返回可打开的任务记录。');
      const task = await api.getTaskDetail(mutation.task.id);
      if (!task) throw new Error('AI 漫剧项目已创建，但无法重新读取。');
      return { id: task.id, document: parseMotionComicPipelineData(task.pipelineData) };
    }, { successMessage: 'AI 漫剧系列项目已创建。' });
    if (!result.ok) return;
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    setSelection({ kind: 'series', id: result.value.document.series.id });
    setCreateTitle('');
    setCreatePremise('');
    setCreateEpisodeTitle('第一集');
    setCreateOpen(false);
    setDirty(false);
  }

  async function saveProject() {
    if (!document) return;
    const result = await projectAction.run(async () => {
      const mutation = await api.saveMotionComic({ id: document.id, expectedUpdatedAt: document.updatedAt, document });
      applyState(mutation);
      const task = await api.getTaskDetail(document.id);
      if (!task) throw new Error('AI 漫剧项目保存后无法重新读取。');
      return parseMotionComicPipelineData(task.pipelineData);
    }, { successMessage: 'AI 漫剧项目已保存。' });
    if (!result.ok) return;
    setDocument(result.value);
    setDirty(false);
  }

  function updateCharacter(characterId: string, update: (character: MotionComicCharacter) => MotionComicCharacter) {
    mutateDocument((current) => ({ ...current, characters: current.characters.map((character) => character.id === characterId ? update(character) : character) }));
  }

  function updateLook(look: MotionComicCharacterLook, update: (look: MotionComicCharacterLook) => MotionComicCharacterLook) {
    updateCharacter(look.characterId, (character) => ({ ...character, looks: character.looks.map((candidate) => candidate.id === look.id ? update(candidate) : candidate) }));
  }

  function updateEpisode(episodeId: string, update: (episode: MotionComicEpisode) => MotionComicEpisode) {
    mutateDocument((current) => ({ ...current, episodes: current.episodes.map((episode) => episode.id === episodeId ? update(episode) : episode) }));
  }

  function updateScene(scene: MotionComicDramaticScene, update: (scene: MotionComicDramaticScene) => MotionComicDramaticScene) {
    updateEpisode(scene.episodeId, (episode) => ({ ...episode, scenes: episode.scenes.map((candidate) => candidate.id === scene.id ? update(candidate) : candidate) }));
  }

  function updateShot(shot: MotionComicShot, update: (shot: MotionComicShot) => MotionComicShot) {
    updateEpisode(shot.episodeId, (episode) => ({
      ...episode,
      scenes: episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((candidate) => candidate.id === shot.id ? update(candidate) : candidate) })),
    }));
  }

  return (
    <div className="comic-workbench" data-motion-comic-workbench="true">
      <header className="comic-workbench-header">
        <div className="comic-workbench-title">
          <BookOpenCheck size={18} aria-hidden="true" />
          <div>
            <h2>{document?.title || 'AI 漫剧'}</h2>
            <span>{document ? `${document.episodes.length} 集 · ${document.characters.length} 个角色 · ${activeEpisode?.timeline.clips.length ?? 0} 个镜头` : `${projects.length} 个系列项目`}</span>
          </div>
          {document ? <StatusBadge status="draft" label={stageLabels[document.stage]} /> : null}
        </div>
        <Toolbar aria-label="AI 漫剧项目命令">
          <Button density="compact" variant="subtle" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>新建</Button>
          <Button density="compact" variant="primary" icon={projectAction.busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />} disabled={!document || !dirty || projectAction.busy} onClick={() => void saveProject()}>保存</Button>
        </Toolbar>
      </header>

      <AsyncActionFeedback feedback={projectAction.feedback} />

      <div className="comic-workspace-grid">
        <Pane as="aside" tone="subtle" className="comic-outline-pane" aria-label="系列项目与镜头树">
          <section className="comic-pane-section">
            <div className="comic-section-heading"><strong>系列项目</strong><span>{projects.length}</span></div>
            <div className="comic-node-list">
              {projects.map((project) => (
                <NodeButton key={project.id} active={project.id === activeProjectId} label={project.title || '未命名系列'} meta={project.pipelineStep || 'draft'} onClick={() => void openProject(project.id)} />
              ))}
              {projects.length === 0 ? <span className="comic-muted-line">暂无系列项目</span> : null}
            </div>
          </section>
          {document ? (
            <section className="comic-pane-section comic-outline-section">
              <div className="comic-section-heading"><strong>项目结构</strong><ShieldCheck size={14} aria-hidden="true" /></div>
              <div className="comic-tree">
                <NodeButton active={isSelected(selection, 'series', document.series.id)} label="Series Bible" meta={document.series.genre} onClick={() => selectNode('series', document.series.id)} />
                <TreeLabel icon={<UserRound size={13} />} label="角色与造型" count={document.characters.length} />
                {document.characters.map((character) => (
                  <div className="comic-tree-branch" key={character.id}>
                    <NodeButton active={isSelected(selection, 'character', character.id)} label={character.name} meta={character.role} onClick={() => selectNode('character', character.id)} />
                    {character.looks.map((look) => <NodeButton key={look.id} active={isSelected(selection, 'look', look.id)} label={look.label} meta={look.pinned ? '固定' : '候选'} depth={1} onClick={() => selectNode('look', look.id)} />)}
                  </div>
                ))}
                <TreeLabel icon={<Film size={13} />} label="分集与镜头" count={document.episodes.length} />
                {document.episodes.map((episode) => (
                  <div className="comic-tree-branch" key={episode.id}>
                    <NodeButton active={isSelected(selection, 'episode', episode.id)} label={`EP${String(episode.number).padStart(2, '0')} ${episode.title}`} meta={episode.status} onClick={() => selectNode('episode', episode.id)} />
                    {episode.scenes.map((scene) => (
                      <div className="comic-tree-branch" key={scene.id}>
                        <NodeButton active={isSelected(selection, 'scene', scene.id)} label={`${scene.index}. ${scene.title}`} meta={`${scene.shots.length} 镜`} depth={1} onClick={() => selectNode('scene', scene.id)} />
                        {scene.shots.map((shot) => <NodeButton key={shot.id} active={isSelected(selection, 'shot', shot.id)} label={shot.title} meta={formatDuration(shot.durationMs)} depth={2} onClick={() => selectNode('shot', shot.id)} />)}
                      </div>
                    ))}
                  </div>
                ))}
                <TreeLabel label="场景与道具" count={document.sceneAssets.length + document.props.length} />
                {document.sceneAssets.map((asset) => <NodeButton key={asset.id} active={isSelected(selection, 'scene-asset', asset.id)} label={asset.label} meta="场景" onClick={() => selectNode('scene-asset', asset.id)} />)}
                {document.props.map((prop) => <NodeButton key={prop.id} active={isSelected(selection, 'prop', prop.id)} label={prop.label} meta="道具" onClick={() => selectNode('prop', prop.id)} />)}
              </div>
            </section>
          ) : null}
        </Pane>

        <main className="comic-canvas-pane">
          {document && activeEpisode && selectedShot ? (
            <>
              <div className="comic-canvas-stage" data-ratio={document.ratio}>
                <div className="comic-frame" style={{ aspectRatio: ratioCss(document.ratio) }}>
                  <div className="comic-frame-location">{document.sceneAssets.find((asset) => asset.id === selectedShot.sceneAssetId)?.label || '场景待绑定'}</div>
                  <div className="comic-frame-number">EP{String(activeEpisode.number).padStart(2, '0')} / SHOT {String(selectedShot.index).padStart(2, '0')}</div>
                  <div className="comic-panel-grid" aria-hidden="true">
                    <div className="comic-panel-depth" />
                    {selectedShot.characterLookIds.map((lookId, index) => {
                      const look = findLook(document, lookId);
                      const character = look ? document.characters.find((candidate) => candidate.id === look.characterId) : null;
                      return <div key={lookId} className="comic-character-silhouette" data-position={index % 2 === 0 ? 'left' : 'right'}><span>{character?.name || '角色'}</span></div>;
                    })}
                  </div>
                  <div className="comic-frame-copy"><strong>{selectedShot.title}</strong><span>{selectedShot.framing} · {selectedShot.motionPrompt}</span></div>
                  <div className="comic-frame-dialogue">{dialogueText(activeEpisode, selectedShot)}</div>
                </div>
              </div>
              <div className="comic-timeline" aria-label="分集时间线">
                <div className="comic-timeline-heading"><strong>{activeEpisode.title}</strong><span>{formatDuration(activeEpisode.timeline.durationMs)}</span></div>
                <div className="comic-timeline-track">
                  {activeEpisode.scenes.flatMap((scene) => scene.shots).map((shot) => (
                    <Button key={shot.id} density="compact" variant={shot.id === selectedShot.id ? 'primary' : 'secondary'} className="comic-timeline-shot" style={{ flexGrow: shot.durationMs }} onClick={() => selectNode('shot', shot.id)}>{shot.title}</Button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="还没有打开 AI 漫剧项目" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>新建系列项目</Button>} />
          )}
        </main>

        <Pane as="aside" tone="base" className="comic-inspector-pane" aria-label="AI 漫剧检查器">
          {createOpen || !document ? (
            <div className="comic-inspector-form">
              <div className="comic-section-heading"><strong>新建系列项目</strong><BookOpenCheck size={15} aria-hidden="true" /></div>
              <TextField label="系列名称" value={createTitle} onChange={(_, data) => setCreateTitle(data.value)} placeholder="例如：雨夜来信" />
              <TextAreaField label="核心设定" value={createPremise} onChange={(_, data) => setCreatePremise(data.value)} placeholder="一句话写清主角、异常事件与核心冲突" resize="vertical" />
              <TextField label="首集标题" value={createEpisodeTitle} onChange={(_, data) => setCreateEpisodeTitle(data.value)} />
              <SelectField label="画幅" value={createRatio} options={MOTION_COMIC_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(event) => setCreateRatio(event.target.value as MotionComicPipelineData['ratio'])} />
              <div className="comic-form-actions">
                {document ? <Button variant="subtle" onClick={() => setCreateOpen(false)}>取消</Button> : null}
                <Button variant="primary" icon={projectAction.busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} disabled={!createTitle.trim() || !createPremise.trim() || projectAction.busy} onClick={() => void createProject()}>创建系列骨架</Button>
              </div>
            </div>
          ) : (
            <div className="comic-inspector-form">
              <Inspector
                document={document}
                resolved={resolved}
                selection={selection}
                mutateDocument={mutateDocument}
                updateCharacter={updateCharacter}
                updateLook={updateLook}
                updateEpisode={updateEpisode}
                updateScene={updateScene}
                updateShot={updateShot}
              />
              <div className="comic-inspector-divider" />
              <div className="comic-consistency-health" data-state={readyIssues.length === 0 ? 'ready' : 'blocked'}>
                <strong>{readyIssues.length === 0 ? '一致性门禁通过' : `${readyIssues.length} 项一致性门禁待处理`}</strong>
                <span>{readyIssues[0]?.message || '角色造型、场景、道具和关键帧引用均有效。'}</span>
                <small>预算 ¥{document.estimatedCost.toFixed(2)} · Provider 任务 {document.providerJobs.length}</small>
              </div>
            </div>
          )}
        </Pane>
      </div>
    </div>
  );
}

function Inspector({
  document,
  resolved,
  selection,
  mutateDocument,
  updateCharacter,
  updateLook,
  updateEpisode,
  updateScene,
  updateShot,
}: {
  document: MotionComicPipelineData;
  resolved: ReturnType<typeof resolveWorkspaceSelection>;
  selection: SelectedNode | null;
  mutateDocument: (update: (current: MotionComicPipelineData) => MotionComicPipelineData) => void;
  updateCharacter: (id: string, update: (character: MotionComicCharacter) => MotionComicCharacter) => void;
  updateLook: (look: MotionComicCharacterLook, update: (look: MotionComicCharacterLook) => MotionComicCharacterLook) => void;
  updateEpisode: (id: string, update: (episode: MotionComicEpisode) => MotionComicEpisode) => void;
  updateScene: (scene: MotionComicDramaticScene, update: (scene: MotionComicDramaticScene) => MotionComicDramaticScene) => void;
  updateShot: (shot: MotionComicShot, update: (shot: MotionComicShot) => MotionComicShot) => void;
}) {
  const kind = selection?.kind ?? 'series';
  if (kind === 'character' && resolved.character) {
    const character = resolved.character;
    return <><InspectorHeading title={character.name} meta="角色身份" /><TextField label="角色名" value={character.name} onChange={(_, data) => updateCharacter(character.id, (item) => ({ ...item, name: data.value }))} /><TextField label="戏剧职能" value={character.role} onChange={(_, data) => updateCharacter(character.id, (item) => ({ ...item, role: data.value }))} /><TextAreaField label="身份提示词" value={character.identityPrompt} onChange={(_, data) => updateCharacter(character.id, (item) => ({ ...item, identityPrompt: data.value }))} resize="vertical" /><TextAreaField label="声音规则" value={character.voiceNotes} onChange={(_, data) => updateCharacter(character.id, (item) => ({ ...item, voiceNotes: data.value }))} resize="vertical" /></>;
  }
  if (kind === 'look' && resolved.look) {
    const look = resolved.look;
    return <><InspectorHeading title={look.label} meta={look.pinned ? '固定造型' : '候选造型'} /><TextField label="造型名称" value={look.label} onChange={(_, data) => updateLook(look, (item) => ({ ...item, label: data.value }))} /><TextAreaField label="外观提示词" value={look.appearancePrompt} onChange={(_, data) => updateLook(look, (item) => ({ ...item, appearancePrompt: data.value }))} resize="vertical" /><TextAreaField label="服装" value={look.wardrobe} onChange={(_, data) => updateLook(look, (item) => ({ ...item, wardrobe: data.value }))} resize="vertical" /><TextAreaField label="连续性备注" value={look.continuityNotes} onChange={(_, data) => updateLook(look, (item) => ({ ...item, continuityNotes: data.value }))} resize="vertical" /></>;
  }
  if (kind === 'episode' && resolved.episode) {
    const episode = resolved.episode;
    return <><InspectorHeading title={`EP${String(episode.number).padStart(2, '0')}`} meta={episode.status} /><TextField label="分集标题" value={episode.title} onChange={(_, data) => updateEpisode(episode.id, (item) => ({ ...item, title: data.value }))} /><TextAreaField label="一句话梗概" value={episode.logline} onChange={(_, data) => updateEpisode(episode.id, (item) => ({ ...item, logline: data.value }))} resize="vertical" /><TextAreaField label="分集剧本" value={episode.script} onChange={(_, data) => updateEpisode(episode.id, (item) => ({ ...item, script: data.value }))} resize="vertical" /></>;
  }
  if (kind === 'scene' && resolved.scene) {
    const scene = resolved.scene;
    return <><InspectorHeading title={`场景 ${scene.index}`} meta={`${scene.shots.length} 个镜头`} /><TextField label="场景标题" value={scene.title} onChange={(_, data) => updateScene(scene, (item) => ({ ...item, title: data.value }))} /><TextAreaField label="戏剧目标" value={scene.summary} onChange={(_, data) => updateScene(scene, (item) => ({ ...item, summary: data.value }))} resize="vertical" /><SelectField label="固定场景资产" value={scene.locationAssetId} options={document.sceneAssets.map((asset) => ({ value: asset.id, label: asset.label }))} onChange={(event) => updateScene(scene, (item) => ({ ...item, locationAssetId: event.target.value }))} /></>;
  }
  if (kind === 'shot' && resolved.shot) {
    const shot = resolved.shot;
    return <><InspectorHeading title={shot.title} meta={`${shot.framing} · ${formatDuration(shot.durationMs)}`} /><TextField label="镜头标题" value={shot.title} onChange={(_, data) => updateShot(shot, (item) => ({ ...item, title: data.value }))} /><TextField label="景别" value={shot.framing} onChange={(_, data) => updateShot(shot, (item) => ({ ...item, framing: data.value }))} /><SelectField label="主角色造型" value={shot.characterLookIds[0] ?? ''} options={document.characters.flatMap((character) => character.looks.map((look) => ({ value: look.id, label: `${character.name} · ${look.label}` })))} onChange={(event) => updateShot(shot, (item) => ({ ...item, characterLookIds: [event.target.value, ...item.characterLookIds.filter((id) => id !== event.target.value)] }))} /><SelectField label="场景资产" value={shot.sceneAssetId} options={document.sceneAssets.map((asset) => ({ value: asset.id, label: asset.label }))} onChange={(event) => updateShot(shot, (item) => ({ ...item, sceneAssetId: event.target.value }))} /><TextAreaField label="画面提示词" value={shot.prompt} onChange={(_, data) => updateShot(shot, (item) => ({ ...item, prompt: data.value }))} resize="vertical" /><TextAreaField label="运动提示词" value={shot.motionPrompt} onChange={(_, data) => updateShot(shot, (item) => ({ ...item, motionPrompt: data.value }))} resize="vertical" /></>;
  }
  if (kind === 'scene-asset' && resolved.sceneAsset) {
    const asset = resolved.sceneAsset;
    const update = (fn: (asset: MotionComicSceneAsset) => MotionComicSceneAsset) => mutateDocument((current) => ({ ...current, sceneAssets: current.sceneAssets.map((item) => item.id === asset.id ? fn(item) : item) }));
    return <><InspectorHeading title={asset.label} meta="系列场景资产" /><TextField label="场景名称" value={asset.label} onChange={(_, data) => update((item) => ({ ...item, label: data.value }))} /><TextAreaField label="场景描述" value={asset.description} onChange={(_, data) => update((item) => ({ ...item, description: data.value }))} resize="vertical" /><TextAreaField label="固定提示词" value={asset.prompt} onChange={(_, data) => update((item) => ({ ...item, prompt: data.value }))} resize="vertical" /><TextAreaField label="连续性备注" value={asset.continuityNotes} onChange={(_, data) => update((item) => ({ ...item, continuityNotes: data.value }))} resize="vertical" /></>;
  }
  if (kind === 'prop' && resolved.prop) {
    const prop = resolved.prop;
    const update = (label: string, value: string) => mutateDocument((current) => ({ ...current, props: current.props.map((item) => item.id === prop.id ? { ...item, [label]: value } : item) }));
    return <><InspectorHeading title={prop.label} meta="系列道具资产" /><TextField label="道具名称" value={prop.label} onChange={(_, data) => update('label', data.value)} /><TextAreaField label="道具描述" value={prop.description} onChange={(_, data) => update('description', data.value)} resize="vertical" /><TextAreaField label="固定提示词" value={prop.prompt} onChange={(_, data) => update('prompt', data.value)} resize="vertical" /></>;
  }
  return <><InspectorHeading title="Series Bible" meta="系列级" /><TextField label="项目工作名" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value }))} /><TextField label="系列名称" value={document.series.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, title: data.value } }))} /><TextAreaField label="核心设定" value={document.series.premise} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, premise: data.value } }))} resize="vertical" /><TextField label="类型" value={document.series.genre} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, genre: data.value } }))} /><TextField label="基调" value={document.series.tone} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, tone: data.value } }))} /><TextAreaField label="世界规则" value={document.series.worldRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, worldRules: lines(data.value) } }))} resize="vertical" /><TextAreaField label="视觉一致性规则" value={document.series.visualRules.join('\n')} onChange={(_, data) => mutateDocument((current) => ({ ...current, series: { ...current.series, visualRules: lines(data.value) } }))} resize="vertical" /></>;
}

function InspectorHeading({ title, meta }: { title: string; meta: string }) {
  return <div className="comic-section-heading"><strong>{title}</strong><span>{meta}</span></div>;
}

function NodeButton({ active, label, meta, depth = 0, onClick }: { active: boolean; label: string; meta: string; depth?: number; onClick: () => void }) {
  return <Button density="compact" variant={active ? 'secondary' : 'subtle'} className="comic-node-button" data-depth={depth} onClick={onClick}><span><ChevronRight size={12} aria-hidden="true" />{label}</span><small>{meta}</small></Button>;
}

function TreeLabel({ icon, label, count }: { icon?: React.ReactNode; label: string; count: number }) {
  return <div className="comic-tree-label">{icon}<strong>{label}</strong><span>{count}</span></div>;
}

function resolveWorkspaceSelection(document: MotionComicPipelineData | null, selection: SelectedNode | null) {
  const empty = { character: null, look: null, episode: null, scene: null, shot: null, sceneAsset: null, prop: null };
  if (!document || !selection) return empty;
  const character = document.characters.find((item) => item.id === selection.id) ?? null;
  const look = document.characters.flatMap((item) => item.looks).find((item) => item.id === selection.id) ?? null;
  let episode = document.episodes.find((item) => item.id === selection.id) ?? null;
  let scene: MotionComicDramaticScene | null = null;
  let shot: MotionComicShot | null = null;
  for (const candidateEpisode of document.episodes) {
    const candidateScene = candidateEpisode.scenes.find((item) => item.id === selection.id);
    const candidateShot = candidateEpisode.scenes.flatMap((item) => item.shots).find((item) => item.id === selection.id);
    if (candidateScene || candidateShot) {
      episode = candidateEpisode;
      scene = candidateScene ?? candidateEpisode.scenes.find((item) => item.id === candidateShot?.sceneId) ?? null;
      shot = candidateShot ?? scene?.shots[0] ?? null;
      break;
    }
  }
  if (look && !episode) {
    episode = document.episodes.find((item) => item.scenes.some((candidateScene) => candidateScene.shots.some((candidateShot) => candidateShot.characterLookIds.includes(look.id)))) ?? null;
    shot = episode?.scenes.flatMap((item) => item.shots).find((item) => item.characterLookIds.includes(look.id)) ?? null;
    scene = episode?.scenes.find((item) => item.id === shot?.sceneId) ?? null;
  }
  const sceneAsset = document.sceneAssets.find((item) => item.id === selection.id) ?? null;
  const prop = document.props.find((item) => item.id === selection.id) ?? null;
  return { character, look, episode, scene, shot, sceneAsset, prop };
}

function findLook(document: MotionComicPipelineData, lookId: string) {
  return document.characters.flatMap((character) => character.looks).find((look) => look.id === lookId) ?? null;
}

function dialogueText(episode: MotionComicEpisode, shot: MotionComicShot): string {
  return shot.dialogueCueIds.map((id) => episode.dialogueCues.find((cue) => cue.id === id)?.text).filter(Boolean).join(' ');
}

function isSelected(selection: SelectedNode | null, kind: NodeKind, id: string): boolean {
  return selection?.kind === kind && selection.id === id;
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs / 100) / 10}s`;
}

function ratioCss(ratio: MotionComicPipelineData['ratio']): string {
  const [width, height] = ratio.split(':').map(Number);
  return `${width} / ${height}`;
}

function lines(value: string): string[] {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Layers3, Loader2, Plus, Save, Sparkles } from 'lucide-react';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import {
  EDITORIAL_COLLAGE_RATIOS,
  EDITORIAL_RENDER_STRATEGIES,
  parseEditorialCollagePipelineData,
  validateEditorialCollagePipeline,
  type EditorialCollageBeat,
  type EditorialCollageLayer,
  type EditorialCollagePipelineData,
  type EditorialRenderStrategy,
} from '../../shared/editorial-collage';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, Pane, SegmentedControl, SelectField, TextAreaField, TextField, Toolbar } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import '../../styles/features/editorial-collage.css';

const stageLabels: Record<EditorialCollagePipelineData['stage'], string> = {
  draft: '草稿',
  'script-approved': '文案确认',
  'style-approved': '风格确认',
  assets: '素材准备',
  rendering: '渲染中',
  qa: '质量检查',
  completed: '已完成',
  failed: '失败',
};

const strategyLabels: Record<EditorialRenderStrategy, string> = {
  'deterministic-layers': '确定性图层',
  'living-poster': 'Omni 动态海报',
  hybrid: '混合模式',
};

export function EditorialCollagePage({
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
  const [document, setDocument] = useState<EditorialCollagePipelineData | null>(null);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [selectedBeatId, setSelectedBeatId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createSource, setCreateSource] = useState('');
  const [createRatio, setCreateRatio] = useState<EditorialCollagePipelineData['ratio']>('9:16');
  const [dirty, setDirty] = useState(false);

  const projects = useMemo(
    () => state.tasks.filter((task) => task.taskType === 'editorial-collage' && !task.archivedAt),
    [state.tasks],
  );
  const selectedBeat = document?.beats.find((beat) => beat.id === selectedBeatId) ?? document?.beats[0] ?? null;
  const selectedShot = selectedBeat?.shots[0] ?? null;
  const issues = document ? validateEditorialCollagePipeline(document, { ready: true }) : [];

  const openProject = useCallback(async (taskId: string) => {
    const result = await projectAction.run(async () => {
      const task = await api.getTaskDetail(taskId);
      if (!task || task.taskType !== 'editorial-collage') throw new Error('VOX 项目不存在或已被移除。');
      return parseEditorialCollagePipelineData(task.pipelineData);
    });
    if (!result.ok) return;
    setDocument(result.value);
    setActiveProjectId(taskId);
    setSelectedBeatId(result.value.beats[0]?.id ?? '');
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

  function mutateDocument(update: (current: EditorialCollagePipelineData) => EditorialCollagePipelineData) {
    setDocument((current) => current ? update(current) : current);
    setDirty(true);
  }

  async function createProject() {
    const result = await projectAction.run(async () => {
      const mutation = await api.createEditorialCollage({ title: createTitle, sourceText: createSource, ratio: createRatio });
      applyState(mutation);
      if (!mutation || mutation.kind !== 'task-upsert') throw new Error('VOX 项目已保存，但未返回可打开的任务记录。');
      const task = await api.getTaskDetail(mutation.task.id);
      if (!task) throw new Error('VOX 项目已创建，但无法重新读取。');
      return { id: task.id, document: parseEditorialCollagePipelineData(task.pipelineData) };
    }, { successMessage: 'VOX 项目已创建。' });
    if (!result.ok) return;
    setActiveProjectId(result.value.id);
    setDocument(result.value.document);
    setSelectedBeatId(result.value.document.beats[0]?.id ?? '');
    setCreateTitle('');
    setCreateSource('');
    setCreateOpen(false);
    setDirty(false);
  }

  async function saveProject() {
    if (!document) return;
    const result = await projectAction.run(async () => {
      const mutation = await api.saveEditorialCollage({
        id: document.id,
        expectedUpdatedAt: document.updatedAt,
        document,
      });
      applyState(mutation);
      const task = await api.getTaskDetail(document.id);
      if (!task) throw new Error('VOX 项目保存后无法重新读取。');
      return parseEditorialCollagePipelineData(task.pipelineData);
    }, { successMessage: 'VOX 项目已保存。' });
    if (!result.ok) return;
    setDocument(result.value);
    setDirty(false);
  }

  function updateSelectedBeat(update: (beat: EditorialCollageBeat) => EditorialCollageBeat) {
    if (!selectedBeat) return;
    mutateDocument((current) => ({
      ...current,
      beats: current.beats.map((beat) => beat.id === selectedBeat.id ? update(beat) : beat),
    }));
  }

  function selectStyle(styleId: string) {
    mutateDocument((current) => ({
      ...current,
      selectedStyleId: styleId,
      styleCandidates: current.styleCandidates.map((candidate) => ({ ...candidate, selected: candidate.id === styleId })),
    }));
  }

  function changeRenderStrategy(strategy: EditorialRenderStrategy) {
    updateSelectedBeat((beat) => ({
      ...beat,
      shots: beat.shots.map((shot, index) => index === 0 ? { ...shot, renderStrategy: strategy } : shot),
    }));
  }

  return (
    <div className="vox-workbench" data-editorial-collage-workbench="true">
      <header className="vox-workbench-header">
        <div className="vox-workbench-title">
          <Layers3 size={18} aria-hidden="true" />
          <div>
            <h2>{document?.title || 'VOX 视觉导演'}</h2>
            <span>{document ? `${document.beats.length} 个节拍 · ${formatDuration(document.timeline?.durationMs ?? 0)}` : `${projects.length} 个项目`}</span>
          </div>
          {document ? <StatusBadge status="draft" label={stageLabels[document.stage]} /> : null}
        </div>
        <Toolbar aria-label="VOX 项目命令">
          <Button density="compact" variant="subtle" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>新建</Button>
          <Button density="compact" variant="primary" icon={projectAction.busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />} disabled={!document || !dirty || projectAction.busy} onClick={() => void saveProject()}>保存</Button>
        </Toolbar>
      </header>

      <AsyncActionFeedback feedback={projectAction.feedback} />

      <div className="vox-workspace-grid">
        <Pane as="aside" tone="subtle" className="vox-outline-pane" aria-label="项目与节拍">
          <section className="vox-pane-section">
            <div className="vox-section-heading"><strong>项目</strong><span>{projects.length}</span></div>
            <div className="vox-project-list">
              {projects.map((project) => (
                <Button key={project.id} density="compact" variant={project.id === activeProjectId ? 'secondary' : 'subtle'} className="vox-list-button" onClick={() => void openProject(project.id)}>
                  <span>{project.title || '未命名项目'}</span><small>{project.pipelineStep || 'draft'}</small>
                </Button>
              ))}
              {projects.length === 0 ? <span className="vox-muted-line">暂无项目</span> : null}
            </div>
          </section>
          <section className="vox-pane-section vox-beat-section">
            <div className="vox-section-heading"><strong>节拍</strong><span>{document?.beats.length ?? 0}</span></div>
            <div className="vox-beat-list">
              {document?.beats.map((beat) => (
                <Button key={beat.id} density="compact" variant={beat.id === selectedBeat?.id ? 'secondary' : 'subtle'} className="vox-list-button" onClick={() => setSelectedBeatId(beat.id)}>
                  <span><b>{String(beat.index).padStart(2, '0')}</b>{beat.title}</span><small>{formatDuration(beat.durationMs)}</small>
                </Button>
              ))}
            </div>
          </section>
        </Pane>

        <main className="vox-canvas-pane">
          {document && selectedBeat && selectedShot ? (
            <>
              <div className="vox-canvas-stage" data-ratio={document.ratio}>
                <div className="vox-frame" style={{ aspectRatio: ratioCss(document.ratio) }}>
                  {selectedShot.layers.slice().sort((left, right) => left.zIndex - right.zIndex).map((layer) => (
                    <PreviewLayer key={layer.id} layer={layer} beat={selectedBeat} />
                  ))}
                  <div className="vox-frame-kicker">VOX / {String(selectedBeat.index).padStart(2, '0')}</div>
                  <div className="vox-frame-caption">{selectedBeat.subtitleCues[0]?.text || selectedBeat.narration}</div>
                </div>
              </div>
              <div className="vox-timeline" aria-label="VOX 时间线">
                <div className="vox-timeline-ruler"><span>00:00</span><span>00:15</span><span>00:30</span></div>
                <div className="vox-timeline-track">
                  {document.beats.map((beat) => (
                    <Button
                      key={beat.id}
                      density="compact"
                      variant={beat.id === selectedBeat.id ? 'primary' : 'secondary'}
                      className="vox-timeline-beat"
                      style={{ flexGrow: beat.durationMs }}
                      onClick={() => setSelectedBeatId(beat.id)}
                    >
                      {beat.index}. {beat.title}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState title="还没有打开 VOX 项目" action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>新建项目</Button>} />
          )}
        </main>

        <Pane as="aside" tone="base" className="vox-inspector-pane" aria-label="VOX 检查器">
          {createOpen || !document ? (
            <div className="vox-inspector-form">
              <div className="vox-section-heading"><strong>新建项目</strong><Sparkles size={15} aria-hidden="true" /></div>
              <TextField label="标题" value={createTitle} onChange={(_, data) => setCreateTitle(data.value)} placeholder="例如：咖啡馆如何改变城市" />
              <TextAreaField label="原始文案" value={createSource} onChange={(_, data) => setCreateSource(data.value)} placeholder="粘贴需要拆成 30 秒解释型视频的文案" resize="vertical" />
              <SelectField label="画幅" value={createRatio} options={EDITORIAL_COLLAGE_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(event) => setCreateRatio(event.target.value as EditorialCollagePipelineData['ratio'])} />
              <div className="vox-form-actions">
                {document ? <Button variant="subtle" onClick={() => setCreateOpen(false)}>取消</Button> : null}
                <Button variant="primary" icon={projectAction.busy ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} disabled={!createTitle.trim() || !createSource.trim() || projectAction.busy} onClick={() => void createProject()}>创建 30 秒结构</Button>
              </div>
            </div>
          ) : (
            <div className="vox-inspector-form">
              <div className="vox-section-heading"><strong>项目</strong><span>{dirty ? '未保存' : '已保存'}</span></div>
              <TextField label="标题" value={document.title} onChange={(_, data) => mutateDocument((current) => ({ ...current, title: data.value }))} />
              <SelectField label="视觉风格" value={document.selectedStyleId ?? ''} options={document.styleCandidates.map((candidate) => ({ value: candidate.id, label: candidate.label }))} onChange={(event) => selectStyle(event.target.value)} />
              <SelectField label="画幅" value={document.ratio} options={EDITORIAL_COLLAGE_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(event) => mutateDocument((current) => ({ ...current, ratio: event.target.value as EditorialCollagePipelineData['ratio'] }))} />
              {selectedBeat && selectedShot ? (
                <>
                  <div className="vox-inspector-divider" />
                  <div className="vox-section-heading"><strong>节拍 {selectedBeat.index}</strong><span>{formatDuration(selectedBeat.durationMs)}</span></div>
                  <TextField label="节拍标题" value={selectedBeat.title} onChange={(_, data) => updateSelectedBeat((beat) => ({ ...beat, title: data.value }))} />
                  <SegmentedControl
                    label="渲染策略"
                    value={selectedShot.renderStrategy}
                    options={EDITORIAL_RENDER_STRATEGIES.map((strategy) => ({ value: strategy, label: strategyLabels[strategy] }))}
                    onChange={changeRenderStrategy}
                  />
                  <div className="vox-layer-inventory">
                    {selectedShot.layers.map((layer) => <div key={layer.id}><span>{layer.label}</span><small>{layer.kind} · z{layer.zIndex}</small></div>)}
                  </div>
                </>
              ) : null}
              <div className="vox-inspector-divider" />
              <div className="vox-project-health" data-state={issues.length === 0 ? 'ready' : 'blocked'}>
                <strong>{issues.length === 0 ? '结构可渲染' : `${issues.length} 项待处理`}</strong>
                <span>预算 ¥{document.estimatedCost.toFixed(2)} · {document.providerJobs.length} 个 Provider 任务</span>
              </div>
            </div>
          )}
        </Pane>
      </div>
    </div>
  );
}

function PreviewLayer({ layer, beat }: { layer: EditorialCollageLayer; beat: EditorialCollageBeat }) {
  const keyframe = layer.motion[0];
  const style: CSSProperties = keyframe ? {
    left: `${keyframe.x * 100}%`,
    top: `${keyframe.y * 100}%`,
    opacity: keyframe.opacity,
    transform: `translate(-50%, -50%) scale(${keyframe.scale}) rotate(${keyframe.rotation}deg)`,
    zIndex: layer.zIndex,
  } : { zIndex: layer.zIndex };
  return (
    <div className="vox-preview-layer" data-layer-kind={layer.kind} style={style} aria-hidden={layer.kind !== 'label'}>
      {layer.kind === 'label' ? layer.label : layer.kind === 'background' ? null : <span>{beat.title}</span>}
    </div>
  );
}

function formatDuration(durationMs: number): string {
  return `${Math.round(durationMs / 100) / 10}s`;
}

function ratioCss(ratio: EditorialCollagePipelineData['ratio']): string {
  const [width, height] = ratio.split(':').map(Number);
  return `${width} / ${height}`;
}

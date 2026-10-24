import { useEffect, useRef, useState } from 'react';
import { BookOpenCheck, CheckCircle2, Film, Loader2, Pause, Play, RefreshCw, Save, Square, WandSparkles } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { MotionComicPipelineData, MotionComicSourceEpisode } from '../../shared/motion-comic';
import { motionComicPlanRecoverySchema, motionComicSourceEpisodeIdForEpisode, type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import { motionComicScriptStatusLabel, type MotionComicScriptSnapshot, type MotionComicScriptTask, type MotionComicScriptCandidate, type MotionComicScriptStoryboard, type MotionComicScriptApproval } from '../../shared/motion-comic-script-batch';
import { motionComicScriptAssetSummary } from '../../shared/motion-comic-script-assets';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { Button, CheckboxField, Dialog, SelectField, Tabs, TextAreaField, TextField, Toolbar } from '../../ui';
import { MotionComicScriptReview } from './MotionComicScriptReview';

interface Props {
  api: StoryDreamApi;
  document: MotionComicPipelineData;
  model: string;
  selectedSourceEpisodeId: string;
  plannedSourceEpisodeIds: ReadonlySet<string>;
  onSelectSourceEpisode: (id: string) => void;
  onOpenEpisode: (id: string) => void;
  onDraftGuardChange: (guard: (() => boolean) | null) => void;
  withSavedProject: <T>(operation: (document: MotionComicPipelineData) => Promise<T>) => Promise<T>;
  onApplyStoryboard: (input: { taskId: string; outputRevision: number; reviewedAdjustments: boolean }) => Promise<void>;
  onApproveScripts: (revisions: Array<{ taskId: string; outputRevision: number }>) => Promise<MotionComicScriptSnapshot>;
  onOpenProjectAssets: () => void;
}

/** Saved-source workflow follows Toonflow/Jellyfish: queue scripts, review, approve, then storyboard. */
export function MotionComicScriptWorkspace({ api, document, model, selectedSourceEpisodeId, plannedSourceEpisodeIds, onSelectSourceEpisode, onOpenEpisode, onDraftGuardChange, withSavedProject, onApplyStoryboard, onApproveScripts, onOpenProjectAssets }: Props) {
  const [snapshot, setSnapshot] = useState<MotionComicScriptSnapshot | null>(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [chunk, setChunk] = useState(-1);
  const [startScope, setStartScope] = useState<'missing' | 'selected' | 'failed' | null>(null);
  const [instructions, setInstructions] = useState('');
  const [duration, setDuration] = useState('');
  const [reviewedVersions, setReviewedVersions] = useState<Record<string, number>>({});
  const [approveOpen, setApproveOpen] = useState(false);
  const [bulkReviewed, setBulkReviewed] = useState(false);
  const [tab, setTab] = useState('script');
  const alive = useRef(true);
  const sequence = useRef(0);
  const mutating = useRef(false);
  const draftGuard = useRef<(() => boolean) | null>(null);
  const sourceEpisodes = document.sourceDocument?.episodes ?? [];
  const latest = new Map<string, MotionComicScriptTask>();
  for (const task of snapshot?.tasks ?? []) latest.set(task.sourceEpisodeId, task);
  const selected = sourceEpisodes.find((item) => item.id === selectedSourceEpisodeId) ?? sourceEpisodes[0];
  const task = selected && latest.get(selected.id);
  const candidate = snapshot?.candidates.find((item) => item.taskId === task?.id);
  const approval = snapshot?.approvals.find((item) => item.taskId === task?.id && item.outputRevision === task.outputRevision && !item.stale);
  const storyboard = approval?.assetsConfirmedAt ? snapshot?.storyboards.find((item) => item.taskId === task?.id && item.outputRevision === task.outputRevision) : undefined;
  const generated = selected && document.episodes.find((item) => motionComicSourceEpisodeIdForEpisode(document, item) === selected.id);
  const activeTasks = [...latest.values()];
  const ready = activeTasks.filter((item) => ['script-ready', 'review'].includes(item.status));
  const reviewed = ready.filter((item) => { const entry = snapshot?.candidates.find((entry) => entry.taskId === item.id); return reviewedVersions[item.id] === item.outputRevision && entry && !entry.issues.length && !motionComicScriptAssetSummary(document, entry.script).unresolved; });
  const queued = activeTasks.filter((item) => item.status === 'queued').length;
  const running = activeTasks.filter((item) => item.status === 'running').length;
  const approved = activeTasks.filter((item) => item.status === 'approved').length;
  const chunks = Math.ceil(sourceEpisodes.length / 20);
  const filtered = sourceEpisodes.filter((item) => {
    const state = latest.get(item.id)?.status ?? (plannedSourceEpisodeIds.has(item.id) ? 'produced' : 'missing');
    const matches = !query.trim() || `${item.number} 第${item.number}集 ${item.title}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === 'all' || (filter === 'review' ? ['script-ready', 'review'].includes(state) : state === filter))
      && (query.trim() || chunk === -1 || Math.floor((item.number - 1) / 20) === chunk);
  });

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (mutating.current) { timer = setTimeout(() => void poll(), 2000); return; }
      const request = ++sequence.current;
      try {
        const result = await api.getMotionComicScripts(document.id);
        if (!disposed && request === sequence.current) { setSnapshot(result); setPollError(''); }
      } catch (cause) { if (!disposed && request === sequence.current) setPollError(message(cause)); }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 2000); }
    }
    void poll();
    return () => { disposed = true; alive.current = false; sequence.current += 1; clearTimeout(timer); };
  }, [api, document.id]);

  useEffect(() => {
    onDraftGuardChange(() => draftGuard.current?.() !== false);
    return () => onDraftGuardChange(null);
  }, [onDraftGuardChange]);

  useEffect(() => { setTab('script'); }, [selected?.id]);

  async function run(operation: () => Promise<MotionComicScriptSnapshot>, success: string): Promise<MotionComicScriptSnapshot> {
    if (mutating.current) throw new Error('上一项操作尚未完成，请稍后重试。');
    mutating.current = true;
    sequence.current += 1;
    setBusy(true); setError('');
    try {
      const result = await operation();
      sequence.current += 1;
      if (alive.current) { setSnapshot(result); setNotice(success); }
      return result;
    } catch (cause) { if (alive.current) setError(message(cause)); throw cause; }
    finally { mutating.current = false; if (alive.current) setBusy(false); }
  }
  function control(action: 'pause' | 'resume' | 'cancel') {
    void run(() => api.controlMotionComicScripts({ id: document.id, action, ...(action === 'cancel' ? { taskId: task?.id } : {}) }),
      action === 'pause' ? '当前集完成后暂停后续任务。' : action === 'resume' ? '已恢复后台队列。' : '当前任务已取消，未批准任何结果。').catch(() => {});
  }
  async function enqueue() {
    if (!startScope) return;
    const scope = startScope;
    const targetDurationSec = duration.trim() ? Number(duration) : undefined;
    if (targetDurationSec !== undefined && (!Number.isFinite(targetDurationSec) || targetDurationSec < 5 || targetDurationSec > 1800)) { setError('目标时长需要在 5 到 1800 秒之间。'); return; }
    await run(() => withSavedProject((current) => api.enqueueMotionComicScripts({ id: current.id, expectedUpdatedAt: current.updatedAt,
      scope, ...(scope === 'selected' && selected ? { sourceEpisodeIds: [selected.id] } : {}), instructions, targetDurationSec })), '剧本任务已提交；可离开本页，任务在后台逐集保存。');
    if (alive.current) setStartScope(null);
  }
  async function approveTasks(revisions: Array<{ taskId: string; outputRevision: number }>) {
    await run(() => onApproveScripts(revisions), '剧本已批准，人物、地点和道具已保存到项目资产；分镜待单独生成。');
    if (alive.current) setApproveOpen(false);
  }
  const durationInvalid = Boolean(duration.trim() && (!Number.isFinite(Number(duration)) || Number(duration) < 5 || Number(duration) > 1800));
  return <div className="motion-comic-stage-panel comic-script-workspace" data-motion-comic-stage-panel="episodes" data-motion-comic-script-workspace="true">
    <header className="motion-comic-stage-panel__heading"><span><BookOpenCheck size={18} /></span><div><p>02 · 分集剧本</p><h1>剧本工作台</h1><small>{sourceEpisodes.length} 集 · 排队 {queued} · 生成 {running} · 待审 {ready.length} · 已批准 {approved} · 分镜已应用 {plannedSourceEpisodeIds.size}</small></div></header>
    <Toolbar aria-label="剧本批量操作" className="comic-script-workspace__toolbar">
      <Button variant="primary" icon={<WandSparkles size={14} />} disabled={busy || !snapshot} onClick={() => setStartScope('missing')}>生成未完成剧本</Button>
      <Button icon={<RefreshCw size={14} />} disabled={busy || !activeTasks.some((item) => item.status === 'failed')} onClick={() => setStartScope('failed')}>重试失败集</Button>
      <Button icon={snapshot?.paused ? <Play size={14} /> : <Pause size={14} />} disabled={busy || !snapshot} onClick={() => control(snapshot?.paused ? 'resume' : 'pause')}>{snapshot?.paused ? '恢复队列' : '暂停后续'}</Button>
      <Button icon={<CheckCircle2 size={14} />} disabled={busy || !reviewed.length} onClick={() => { setBulkReviewed(false); setApproveOpen(true); }}>批准已审阅 ({reviewed.length})</Button>
      <small role="status">{snapshot?.paused ? '队列已暂停' : running || queued ? '后台执行中' : '队列空闲'}</small>
    </Toolbar>
    {error || pollError ? <div role="alert" className="motion-comic-plan-error">{error || pollError}</div> : notice ? <div role="status" className="comic-script-notice">{notice}</div> : null}
    <div className="comic-script-workspace__layout">
      <aside className="comic-script-source-list" aria-label="分集剧本列表">
        <TextField label="搜索分集" placeholder="集数或标题" value={query} onChange={(_, data) => setQuery(data.value)} />
        <div className="comic-script-source-list__filters">
          <SelectField label="任务状态" value={filter} options={[{ value: 'all', label: '全部' }, { value: 'review', label: '待审核' }, { value: 'queued', label: '排队中' }, { value: 'running', label: '生成中' }, { value: 'approved', label: '已批准' }, { value: 'failed', label: '失败' }, { value: 'stale', label: '输入已变化' }, { value: 'cancelled', label: '已取消' }, { value: 'missing', label: '未生成' }, { value: 'produced', label: '已有制作' }]} onChange={(event) => setFilter(event.target.value)} />
          {chunks > 1 ? <SelectField label="分集范围" value={String(chunk)} options={[{ value: '-1', label: '全部分集' }, ...Array.from({ length: chunks }, (_, index) => ({ value: String(index), label: `${index * 20 + 1}–${Math.min((index + 1) * 20, sourceEpisodes.length)} 集` }))]} onChange={(event) => setChunk(Number(event.target.value))} /> : null}
        </div>
        <div className="comic-script-source-list__items">{filtered.map((item) => {
          const job = latest.get(item.id);
          return <Button key={item.id} variant="subtle" aria-pressed={item.id === selected?.id} className="comic-script-source-row" onClick={() => { if (draftGuard.current?.() !== false) onSelectSourceEpisode(item.id); }}>
            <span><strong>EP {String(item.number).padStart(2, '0')} · {item.title}</strong><small>{plannedSourceEpisodeIds.has(item.id) ? '分镜已应用' : job ? motionComicScriptStatusLabel[job.status] : '未生成'}{job ? ` · r${job.outputRevision} · ${job.progress}%` : ''}</small></span>
            {job?.status === 'running' || job?.storyboardStatus === 'running' ? <Loader2 size={14} className="director-spin" /> : null}
          </Button>;
        })}{!filtered.length ? <p className="comic-script-notice">没有符合条件的分集</p> : null}</div>
      </aside>
      <section className="comic-script-detail" aria-label="当前集剧本与分镜">
        {selected ? <>
          <header className="comic-script-detail__heading"><div><strong>第 {selected.number} 集 · {selected.title}</strong><small>{task ? `${motionComicScriptStatusLabel[task.status]} · r${task.outputRevision} · ${task.model} · ${new Date(task.updatedAt).toLocaleString('zh-CN')}` : `${selected.sourceText.length} 字 · 尚无后台任务`}</small></div>
            <Toolbar aria-label="当前集任务操作">
              {task && ['queued', 'running'].includes(task.status) ? <Button icon={<Square size={13} />} disabled={busy} onClick={() => control('cancel')}>取消本集</Button> : null}
              {!plannedSourceEpisodeIds.has(selected.id) && (!task || ['failed', 'cancelled', 'stale'].includes(task.status)) ? <Button icon={<RefreshCw size={13} />} disabled={busy} onClick={() => setStartScope('selected')}>{task ? '重新提交本集' : '生成本集剧本'}</Button> : null}
              {generated ? <Button icon={<Film size={13} />} onClick={() => { if (draftGuard.current?.() !== false) onOpenEpisode(generated.id); }}>查看分幕分场</Button> : null}
            </Toolbar>
          </header>
          {task?.error ? <p role="status" className="motion-comic-plan-error">{task.error}</p> : null}
          {task?.status === 'stale' ? <p className="comic-script-notice">源文、系列设定或前集版本已变化。旧稿保留只读，重新提交不会覆盖已有制作。</p> : null}
          {task?.storyboardError ? <p role="status" className="motion-comic-plan-error">分镜：{task.storyboardError}</p> : null}
          <Tabs label="当前集内容" value={tab} onChange={(value) => { if (draftGuard.current?.() !== false) setTab(value); }} items={[{ value: 'script', label: '剧本与对白' }, { value: 'source', label: '原文与边界' }, { value: 'storyboard', label: storyboard ? `分镜 (${storyboard.plan.shots.length})` : '分镜', disabled: !storyboard }]} />
          {tab === 'source' ? <div className="comic-script-detail__scroll"><p>{selected.splitReason}</p><p>{selected.continuityHook}</p><TextAreaField label="本集原文" value={selected.sourceText} readOnly rows={18} resize="vertical" /></div>
            : tab === 'storyboard' && storyboard ? <StoryboardReview key={`${task!.id}:${storyboard.outputRevision}`} storyboard={storyboard} disabled={busy || plannedSourceEpisodeIds.has(selected.id) || task!.status !== 'approved'} onApply={async (reviewedAdjustments) => {
              await run(async () => {
                await onApplyStoryboard({ taskId: task!.id, outputRevision: storyboard.outputRevision, reviewedAdjustments });
                return api.getMotionComicScripts(document.id);
              }, '分镜已应用；尚未启动图片、视频或配音生成。').catch(() => {});
            }} />
            : task && candidate ? <ScriptEditor key={task.id} task={task} candidate={candidate} approval={approval} project={document} source={selected} busy={busy} locked={!['script-ready', 'review'].includes(task.status) && !(task.status === 'approved' && !approval?.assetsConfirmedAt)} reviewed={reviewedVersions[task.id] === candidate.outputRevision}
                onOpenProjectAssets={() => { if (draftGuard.current?.() !== false) onOpenProjectAssets(); }}
                onDraftGuardChange={(guard) => { draftGuard.current = guard; }}
                onReviewed={(value) => setReviewedVersions((current) => ({ ...current, [task.id]: value ? candidate.outputRevision : 0 }))}
                onSave={async (script, revision) => run(() => withSavedProject((current) => api.editMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: revision, script })), '修改已保存并校验；下游受影响剧本将标记过期。')}
                onApprove={() => approveTasks([{ taskId: task.id, outputRevision: candidate.outputRevision }])}
                onStoryboard={() => run(() => withSavedProject((current) => api.storyboardMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: candidate.outputRevision })), '分镜任务已启动；剧本不会重新生成，也不会调用媒体服务。')}
                canStoryboard={task.status === 'approved' && Boolean(approval?.assetsConfirmedAt) && !storyboard && task.storyboardStatus !== 'running' && !plannedSourceEpisodeIds.has(selected.id)} />
              : <div className="comic-script-detail__scroll"><p>{task?.status === 'running' ? '正在后台生成本集剧本，可以切换页面；生成结果会逐集保存。' : task?.status === 'queued' ? '本集已排队，将按故事顺序生成剧本，不依赖上一集分镜是否完成。' : '原文已保存。提交剧本任务后在这里审核对白、动作和原文证据。'}</p><TextAreaField label="本集原文" value={selected.sourceText} readOnly rows={14} resize="vertical" /></div>}
        </> : <p>请先导入并保存源分集。</p>}
      </section>
    </div>
    <Dialog open={startScope !== null} title="提交后台剧本任务" onOpenChange={(open) => { if (!open && !busy) setStartScope(null); }} actions={<><Button disabled={busy} onClick={() => setStartScope(null)}>取消</Button><Button variant="primary" disabled={busy || durationInvalid} onClick={() => void enqueue().catch(() => {})}>{busy ? '正在提交' : '开始后台生成'}</Button></>}>
      <div className="comic-script-start"><p>{startScope === 'selected' ? `第 ${selected?.number} 集` : startScope === 'failed' ? '所有失败集' : '所有未完成集'} · 文本模型：{model || '未配置'}</p><TextField label="目标集长（秒，可留空）" type="number" min={5} max={1800} value={duration} validationMessage={durationInvalid ? '请输入 5 到 1800 秒。' : undefined} onChange={(_, data) => setDuration(data.value)} /><TextAreaField label="改编要求" value={instructions} rows={4} maxLength={4000} resize="vertical" onChange={(_, data) => setInstructions(data.value)} /><small>只生成剧本并逐集保存。不会自动批准、生成分镜、图片、视频或配音。</small>{error ? <p role="alert">{error}</p> : null}</div>
    </Dialog>
    <Dialog open={approveOpen} title="批准已审阅剧本" onOpenChange={(open) => { if (!busy) setApproveOpen(open); }} actions={<><Button disabled={busy} onClick={() => setApproveOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !bulkReviewed || !reviewed.length} onClick={() => void approveTasks(reviewed.map((item) => ({ taskId: item.id, outputRevision: item.outputRevision }))).catch(() => {})}>批准 {reviewed.length} 集</Button></>}>
      <p>仅批准在编辑区逐集勾选的当前版本，不包含未审核或校验失败的剧本。</p><p>{reviewed.map((item) => `第 ${sourceEpisodes.find((source) => source.id === item.sourceEpisodeId)?.number} 集 r${item.outputRevision}`).join('、')}</p><CheckboxField label="确认以上版本已逐集审阅；批准后仍需单独生成分镜" checked={bulkReviewed} onChange={(_, data) => setBulkReviewed(data.checked === true)} />{error ? <p role="alert">{error}</p> : null}
    </Dialog>
  </div>;
}

function ScriptEditor({ task, candidate, approval, project, onOpenProjectAssets, source, locked, busy, reviewed, onReviewed, onSave, onApprove, onStoryboard, canStoryboard, onDraftGuardChange }: {
  task: MotionComicScriptTask; candidate: MotionComicScriptCandidate; source: MotionComicSourceEpisode; locked: boolean; busy: boolean; reviewed: boolean;
  approval?: MotionComicScriptApproval; project: MotionComicPipelineData; onOpenProjectAssets: () => void;
  onDraftGuardChange: (guard: (() => boolean) | null) => void;
  onReviewed: (value: boolean) => void; onSave: (script: MotionComicScriptDraft, revision: number) => Promise<MotionComicScriptSnapshot>;
  onApprove: () => Promise<void>; onStoryboard: () => Promise<MotionComicScriptSnapshot>; canStoryboard: boolean;
}) {
  const [draft, setDraft] = useState(candidate.script);
  const [baseRevision, setBaseRevision] = useState(candidate.outputRevision);
  const [localError, setLocalError] = useState('');
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(candidate.script);
  const conflict = baseRevision !== candidate.outputRevision;
  const invalidText = draft.scenes.some((scene) => scene.beats.some((beat) => !beat.text.trim()));
  const unresolvedAssets = motionComicScriptAssetSummary(project, draft).unresolved;
  const recovery: MotionComicPlanRecovery = { token: task.id, projectId: task.projectId, sourceText: source.sourceText, instructions: task.instructions,
    title: draft.title, scenes: draft.scenes.length, script: task.status === 'approved' && approval?.assetsConfirmedAt ? approval.script : draft, createdAt: candidate.createdAt, phase: 'script-review', adjustments: candidate.adjustments,
    needsValidation: changed || conflict || candidate.issues.length > 0 };
  const localDraft = useWorkspaceDraft({ id: `comic-script-${task.projectId}-${task.id}`, label: `第 ${source.number} 集剧本草稿`, enabled: changed, busy: saving,
    value: { scriptJson: JSON.stringify(draft), revision: baseRevision }, restore: (saved) => {
      try {
        const parsed = motionComicPlanRecoverySchema.shape.script.safeParse(JSON.parse(saved.scriptJson));
        if (parsed.success) { setDraft(parsed.data); setBaseRevision(saved.revision); }
      } catch { /* Invalid local content must not replace the persisted candidate. */ }
    } });
  useEffect(() => {
    onDraftGuardChange(() => {
      if (!changed) return true;
      try { localDraft.persist(localDraft.snapshot()); setLocalError(''); return true; }
      catch { setLocalError('本地草稿保存失败，已阻止切换，请先保存或释放本地存储空间。'); return false; }
    });
    return () => onDraftGuardChange(null);
  }, [changed, localDraft, onDraftGuardChange]);
  function change(script: MotionComicScriptDraft) {
    setDraft(script); onReviewed(false);
    try { localDraft.persist({ scriptJson: JSON.stringify(script), revision: baseRevision }); setLocalError(''); }
    catch { setLocalError('本地草稿保存失败，请勿关闭页面。'); }
  }
  async function save() {
    setSaving(true);
    try {
      const result = await onSave(draft, baseRevision);
      const saved = result.candidates.find((item) => item.taskId === task.id)!;
      setDraft(saved.script); setBaseRevision(saved.outputRevision); onReviewed(false);
      localDraft.complete({ scriptJson: JSON.stringify(saved.script), revision: saved.outputRevision }); setLocalError('');
    } catch (cause) { setLocalError(message(cause)); }
    finally { setSaving(false); }
  }
  function discardConflict() {
    try {
      localDraft.complete({ scriptJson: JSON.stringify(candidate.script), revision: candidate.outputRevision });
      setDraft(candidate.script); setBaseRevision(candidate.outputRevision); onReviewed(false); setLocalError('');
    } catch { setLocalError('本地草稿清理失败，当前改动仍保留，请释放存储空间后重试。'); }
  }
  return <div className="comic-script-editor">
    {localError ? <p role="alert" className="motion-comic-plan-error">{localError}</p> : null}
    {conflict ? <div role="alert" className="motion-comic-plan-error">服务器版本已变化，当前本地草稿仍保留，不会自动覆盖。<Button disabled={saving || busy} onClick={discardConflict}>载入当前版本并放弃本地改动</Button></div> : null}
    {candidate.issues.length ? <details open className="comic-script-issues"><summary>校验问题 ({candidate.issues.length})</summary>{candidate.issues.map((issue, index) => <p key={index}>{issue.path}：{issue.message}</p>)}</details> : null}
    <MotionComicScriptReview recovery={recovery} project={project} onOpenProjectAssets={onOpenProjectAssets} episodeNumber={source.number} locked={locked || busy || saving || conflict} reviewed={reviewed} onReviewed={onReviewed} onChange={locked ? undefined : change} statusLabel={task.status === 'approved' && !approval?.assetsConfirmedAt ? '待确认项目资产' : motionComicScriptStatusLabel[task.status]} approvalLabel="我已核对当前版本的剧情、对白、人物地点道具及修改记录，加入待批准列表" workflowNote={approval?.assetsConfirmedAt ? '本集资产身份已确认；分镜待单独生成。' : '批准时确认项目资产身份，分镜待单独生成。'} />
    <Toolbar aria-label="剧本审核操作"><small>{changed ? '本地草稿 · 尚未提交校验' : `已保存 r${candidate.outputRevision}`}</small>
      {!locked ? <><Button icon={<Save size={14} />} disabled={busy || saving || !changed || invalidText || conflict} onClick={() => void save()}>保存修改并校验</Button><Button variant="primary" icon={<CheckCircle2 size={14} />} disabled={busy || saving || changed || conflict || !reviewed || unresolvedAssets > 0 || candidate.issues.length > 0} onClick={() => void onApprove().catch(() => {})}>批准本集剧本</Button></> : null}
      {canStoryboard ? <Button variant="primary" icon={<Film size={14} />} disabled={busy || changed || conflict} onClick={() => void onStoryboard().catch(() => {})}>仅生成本集分镜</Button> : task.storyboardStatus === 'running' ? <span role="status">分镜后台生成中</span> : null}
    </Toolbar>
  </div>;
}

function StoryboardReview({ storyboard, disabled, onApply }: { storyboard: MotionComicScriptStoryboard; disabled: boolean; onApply: (reviewed: boolean) => Promise<void> }) {
  const [reviewed, setReviewed] = useState(false);
  const plan = storyboard.plan;
  return <div className="comic-script-editor">
    <div className="comic-script-detail__scroll" aria-label="分镜候选审核">{storyboard.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      {plan.script.scenes.map((scene) => <section className="comic-script-board-scene" key={scene.key}><h3>第 {scene.actIndex} 幕 · {scene.title}</h3><p>{scene.summary}</p>{plan.shots.filter((shot) => shot.sceneKey === scene.key).map((shot) => <article key={shot.key}><strong>{shot.title} · {shot.framing} · {shot.durationSec} 秒</strong><p>{shot.prompt}</p><p>动作：{shot.motionPrompt}</p><small>{shot.continuity.startState} → {shot.continuity.endState}</small></article>)}</section>)}
      {plan.adjustments?.length ? <details open><summary>整理与修改记录 ({plan.adjustments.length})</summary>{plan.adjustments.map((item, index) => <p key={index}>{item.path}：{item.before} → {item.after}</p>)}</details> : null}
    </div>
    <CheckboxField label="已核对当前分镜与整理记录，同意写入正式分集；不启动媒体生成" checked={reviewed} disabled={disabled} onChange={(_, data) => setReviewed(data.checked === true)} />
    <Toolbar aria-label="分镜应用"><Button variant="primary" disabled={disabled || !reviewed} onClick={() => void onApply(reviewed)}>确认并应用本集分镜</Button></Toolbar>
  </div>;
}

function message(cause: unknown) { return formatAppErrorMessage(normalizeAppError(cause)); }

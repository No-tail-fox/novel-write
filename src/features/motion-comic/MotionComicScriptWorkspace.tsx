import { useEffect, useRef, useState } from 'react';
import { BookOpenCheck, CheckCircle2, Film, Loader2, Pause, Play, RefreshCw, Save, Square, WandSparkles } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { MotionComicPipelineData, MotionComicSourceEpisode } from '../../shared/motion-comic';
import { motionComicPlanRecoverySchema, motionComicSourceEpisodeIdForEpisode, type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import { motionComicScriptStatusLabel, motionComicRuntimeChanged, type MotionComicScriptSnapshot, type MotionComicScriptTask, type MotionComicScriptCandidate, type MotionComicScriptStoryboard, type MotionComicScriptApproval } from '../../shared/motion-comic-script-batch';
import { motionComicScriptAssetSummary } from '../../shared/motion-comic-script-assets';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { Button, CheckboxField, Dialog, SelectField, Tabs, TextAreaField, TextField, Toolbar } from '../../ui';
import { MotionComicScriptReview } from './MotionComicScriptReview';
import { ScriptAwaitingCard, ScriptSourceCard, ScriptStatusChip, scriptStatusTone } from './MotionComicScriptReading';
import { MotionComicScriptProposal, scriptProposalRevertReason, type ScriptProposalRequest } from './MotionComicScriptProposal';
import type { MotionComicScriptOriginal, MotionComicScriptProposal as ScriptProposal } from '../../shared/motion-comic-script-proposal';
import { changeScriptEditHistory, createScriptEditHistory, type ScriptHistoryAction } from './motion-comic-script-history';
import { repairScriptTitleNarration, scriptDraftIssues, scriptIssueLocation } from './motion-comic-script-validation';
import './motion-comic-script-layout.css';

interface Props {
  api: StoryDreamApi;
  document: MotionComicPipelineData;
  model: string;
  /** Same identity pair the main process records on each task; never infer it from `model` alone. */
  runtimeIdentity: { provider: string; model: string };
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
export function MotionComicScriptWorkspace({ api, document, model, runtimeIdentity, selectedSourceEpisodeId, plannedSourceEpisodeIds, onSelectSourceEpisode, onOpenEpisode, onDraftGuardChange, withSavedProject, onApplyStoryboard, onApproveScripts, onOpenProjectAssets }: Props) {
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
  const reviewed = ready.filter((item) => { const entry = snapshot?.candidates.find((entry) => entry.taskId === item.id); const source = sourceEpisodes.find(source => source.id === item.sourceEpisodeId); return reviewedVersions[item.id] === item.outputRevision && entry && source && !scriptDraftIssues(entry.script, source.sourceText, document, item.instructions).length && !motionComicScriptAssetSummary(document, entry.script).unresolved; });
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
  function regenerateSelected() {
    if (!selected || draftGuard.current?.() === false) return;
    setInstructions(task?.instructions ?? '');
    setDuration(task?.targetDurationSec ? String(task.targetDurationSec) : '');
    setStartScope('selected');
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
    <div className="comic-script-command-row"><header className="motion-comic-stage-panel__heading"><span><BookOpenCheck size={18} /></span><div><p>02 · 分集剧本</p><h1>剧本工作台</h1><details className="comic-script-queue-summary"><summary>{sourceEpisodes.length} 集 · 待审 {ready.length}</summary><small>排队 {queued} · 生成 {running} · 已批准 {approved} · 分镜已应用 {plannedSourceEpisodeIds.size}</small></details></div></header>
    <Toolbar aria-label="剧本批量操作" className="comic-script-workspace__toolbar">
      <Button variant="primary" icon={<WandSparkles size={14} />} disabled={busy || !snapshot} onClick={() => setStartScope('missing')}>生成未完成剧本</Button>
      <Button icon={<RefreshCw size={14} />} disabled={busy || !activeTasks.some((item) => item.status === 'failed')} onClick={() => setStartScope('failed')}>重试失败集</Button>
      <Button icon={snapshot?.paused ? <Play size={14} /> : <Pause size={14} />} disabled={busy || !snapshot} onClick={() => control(snapshot?.paused ? 'resume' : 'pause')}>{snapshot?.paused ? '恢复队列' : '暂停后续'}</Button>
      <Button icon={<CheckCircle2 size={14} />} disabled={busy || !reviewed.length} onClick={() => { setBulkReviewed(false); setApproveOpen(true); }}>批准已审阅 ({reviewed.length})</Button>
      <small role="status" className="comic-script-task-status">{snapshot?.paused ? '队列已暂停' : running || queued ? '后台执行中' : '队列空闲'} · 生成 {running} · 排队 {queued}</small>
    </Toolbar></div>
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
          return <Button key={item.id} variant="subtle" aria-pressed={item.id === selected?.id} data-status={plannedSourceEpisodeIds.has(item.id) ? 'planned' : job?.status ?? 'missing'} data-tone={plannedSourceEpisodeIds.has(item.id) ? 'ok' : job?.status === 'queued' && snapshot?.paused ? 'warn' : scriptStatusTone(job?.status)} className="comic-script-source-row" onClick={() => { if (draftGuard.current?.() !== false) onSelectSourceEpisode(item.id); }}>
            <span><strong>EP {String(item.number).padStart(2, '0')} · {item.title}</strong><small><i className="comic-script-dot" aria-hidden="true" />{plannedSourceEpisodeIds.has(item.id) ? '分镜已应用' : job ? motionComicScriptStatusLabel[job.status] : '未生成'}{job?.status === 'running' ? ` · ${job.progress}%` : job && job.outputRevision ? ` · r${job.outputRevision}` : ''}</small></span>
            {job?.status === 'running' || job?.storyboardStatus === 'running' ? <Loader2 size={14} className="director-spin" /> : null}
          </Button>;
        })}{!filtered.length ? <p className="comic-script-notice">没有符合条件的分集</p> : null}</div>
      </aside>
      <section className="comic-script-detail" aria-label="当前集剧本与分镜">
        {selected ? <>
          <div className="comic-script-episode-row"><header className="comic-script-detail__heading"><div><span className="comic-script-detail__title"><strong>第 {selected.number} 集 · {selected.title}</strong><ScriptStatusChip status={task?.status} paused={Boolean(snapshot?.paused)} label={plannedSourceEpisodeIds.has(selected.id) ? '分镜已应用' : undefined} /></span><small title={task ? `${task.model} · ${new Date(task.updatedAt).toLocaleString('zh-CN')}` : undefined}>{task ? `版本 r${task.outputRevision} · 原文 ${selected.sourceText.length.toLocaleString('zh-CN')} 字` : `原文 ${selected.sourceText.length.toLocaleString('zh-CN')} 字 · 尚无后台任务`}</small></div>
            <Toolbar aria-label="当前集任务操作">
              {task && ['queued', 'running'].includes(task.status) ? <Button icon={<Square size={13} />} disabled={busy} onClick={() => control('cancel')}>取消本集</Button> : null}
              {!plannedSourceEpisodeIds.has(selected.id) && (!task || ['failed', 'cancelled', 'stale'].includes(task.status)) ? <Button icon={<RefreshCw size={13} />} disabled={busy} onClick={regenerateSelected}>{task ? '重新提交本集' : '生成本集剧本'}</Button> : null}
              {generated ? <Button icon={<Film size={13} />} onClick={() => { if (draftGuard.current?.() !== false) onOpenEpisode(generated.id); }}>编辑分幕与场次</Button> : null}
            </Toolbar>
          </header>
          <Tabs label="当前集内容" value={tab} onChange={(value) => { if (draftGuard.current?.() !== false) setTab(value); }} items={[{ value: 'script', label: '剧本与对白' }, { value: 'source', label: '原文与边界' }, { value: 'storyboard', label: storyboard ? `分镜 (${storyboard.plan.shots.length})` : '分镜', disabled: !storyboard }]} />
          </div>
          {task?.error ? <p role="status" className="motion-comic-plan-error">{task.error}</p> : null}
          {task?.status === 'stale' ? <p className="comic-script-notice">源文、系列设定或前集版本已变化。旧稿保留只读，重新提交不会覆盖已有制作。</p> : null}
          {task?.storyboardError ? <p role="status" className="motion-comic-plan-error">分镜：{task.storyboardError}</p> : null}
          {tab === 'source' ? <div className="comic-script-draft-grid is-source">
              <ScriptSourceCard source={selected} />
              <article className="comic-script-card" aria-label="分集边界">
                <header className="comic-script-card__head"><strong>分集边界</strong><small>来自分集确认</small></header>
                <div className="comic-script-card__body comic-script-boundary">
                  <section><h4>拆分依据</h4><p>{selected.splitReason || '按章节规则拆分，未记录额外依据。'}</p></section>
                  <section><h4>尾钩与承接</h4><p>{selected.continuityHook || '未记录承接说明。'}</p></section>
                </div>
              </article>
            </div>
            : tab === 'storyboard' && storyboard ? <StoryboardReview key={`${task!.id}:${storyboard.outputRevision}`} storyboard={storyboard} onEdit={generated ? () => onOpenEpisode(generated.id) : undefined} disabled={busy || plannedSourceEpisodeIds.has(selected.id) || task!.status !== 'approved'} onApply={async (reviewedAdjustments) => {
              await run(async () => {
                await onApplyStoryboard({ taskId: task!.id, outputRevision: storyboard.outputRevision, reviewedAdjustments });
                return api.getMotionComicScripts(document.id);
              }, '分镜已应用；尚未启动图片、视频或配音生成。').catch(() => {});
            }} />
            : task && candidate ? <ScriptEditor key={task.id} resolveReferenceUrl={path => api.getTaskMediaUrl(document.id, path)} task={task} candidate={candidate} approval={approval} project={document} source={selected} busy={busy} locked={!['script-ready', 'review'].includes(task.status) && !(task.status === 'approved' && !approval?.assetsConfirmedAt)} reviewed={reviewedVersions[task.id] === candidate.outputRevision}
                original={snapshot?.originals?.find(item => item.taskId === task.id)} proposals={snapshot?.proposals?.filter(item => item.taskId === task.id) ?? []}
                onRegenerate={regenerateSelected}
                proposalLocked={plannedSourceEpisodeIds.has(selected.id) || Boolean(approval?.assetsConfirmedAt)}
                onPropose={(input) => run(() => withSavedProject(current => api.proposeMotionComicScriptChange({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: candidate.outputRevision, ...input })), '局部候选请求已提交，不会自动采用。')}
                onRefreshProposals={() => run(() => api.getMotionComicScripts(document.id), '已读取服务器提案状态。')}
                onRevert={(proposalId) => run(() => withSavedProject(current => api.revertMotionComicScriptChange({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: candidate.outputRevision, proposalId })), '已撤销此次采用并保存为新版本，请重新审阅。')}
                onAdopt={(proposalId) => run(() => withSavedProject(current => api.adoptMotionComicScriptChange({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: candidate.outputRevision, proposalId })), '局部候选已采用，请重新审阅当前版本。')}
                onOpenProjectAssets={() => { if (draftGuard.current?.() !== false) onOpenProjectAssets(); }}
                onDraftGuardChange={(guard) => { draftGuard.current = guard; }}
                onReviewed={(value) => setReviewedVersions((current) => ({ ...current, [task.id]: value ? candidate.outputRevision : 0 }))}
                onSave={async (script, revision) => run(() => withSavedProject((current) => api.editMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: revision, script })), '修改已保存并校验；下游受影响剧本将标记过期。')}
                onApprove={() => approveTasks([{ taskId: task.id, outputRevision: candidate.outputRevision }])}
                onStoryboard={() => {
                  // The switch itself already carried the confirmation; never ask again here.
                  return run(() => withSavedProject((current) => api.storyboardMotionComicScript({ id: current.id, expectedUpdatedAt: current.updatedAt, taskId: task.id, outputRevision: candidate.outputRevision, ...(motionComicRuntimeChanged(task, runtimeIdentity) ? { allowModelChange: true } : {}) })), '分镜任务已启动；剧本不会重新生成，也不会调用媒体服务。');
                }}
                canStoryboard={task.status === 'approved' && Boolean(approval?.assetsConfirmedAt) && !storyboard && task.storyboardStatus !== 'running' && !plannedSourceEpisodeIds.has(selected.id)} />
              : <div className="comic-script-draft-grid">
                <ScriptSourceCard source={selected} />
                <ScriptAwaitingCard task={task} paused={Boolean(snapshot?.paused)} queue={{ running, queued }} />
              </div>}
        </> : <p>请先导入并保存源分集。</p>}
      </section>
    </div>
    <Dialog open={startScope !== null} title={startScope === 'selected' && candidate ? '重新生成本集剧本' : '提交后台剧本任务'} onOpenChange={(open) => { if (!open && !busy) setStartScope(null); }} actions={<><Button disabled={busy} onClick={() => setStartScope(null)}>取消</Button><Button variant="primary" disabled={busy || durationInvalid} onClick={() => void enqueue().catch(() => {})}>{busy ? '正在提交' : '开始后台生成'}</Button></>}>
      <div className="comic-script-start">{startScope === 'selected' && candidate ? <p>将按原文重新生成本集剧本。旧稿保留为历史记录，新结果需要重新审阅和批准。请先保存需要保留的本地修改。</p> : null}<p>{startScope === 'selected' ? `仅当前章：第 ${selected?.number} 集 · ${selected?.title}` : startScope === 'failed' ? '所有失败集' : '所有未完成集'} · 文本模型：{model || '未配置'}</p><TextField label="目标集长（秒，可留空）" type="number" min={5} max={1800} value={duration} validationMessage={durationInvalid ? '请输入 5 到 1800 秒。' : undefined} onChange={(_, data) => setDuration(data.value)} /><TextAreaField label="改编要求" value={instructions} rows={4} maxLength={4000} resize="vertical" onChange={(_, data) => setInstructions(data.value)} /><small>只生成剧本并逐集保存。不会自动批准、生成分镜、图片、视频或配音。</small>{error ? <p role="alert">{error}</p> : null}</div>
    </Dialog>
    <Dialog open={approveOpen} title="批准已审阅剧本" onOpenChange={(open) => { if (!busy) setApproveOpen(open); }} actions={<><Button disabled={busy} onClick={() => setApproveOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !bulkReviewed || !reviewed.length} onClick={() => void approveTasks(reviewed.map((item) => ({ taskId: item.id, outputRevision: item.outputRevision }))).catch(() => {})}>批准 {reviewed.length} 集</Button></>}>
      <p>仅批准在编辑区逐集勾选的当前版本，不包含未审核或校验失败的剧本。</p><p>{reviewed.map((item) => `第 ${sourceEpisodes.find((source) => source.id === item.sourceEpisodeId)?.number} 集 r${item.outputRevision}`).join('、')}</p><CheckboxField label="确认以上版本已逐集审阅；批准后仍需单独生成分镜" checked={bulkReviewed} onChange={(_, data) => setBulkReviewed(data.checked === true)} />{error ? <p role="alert">{error}</p> : null}
    </Dialog>
  </div>;
}

function ScriptEditor({ onRegenerate, resolveReferenceUrl, task, candidate, approval, original, proposals, proposalLocked, onPropose, onAdopt, onRevert, onRefreshProposals, project, onOpenProjectAssets, source, locked, busy, reviewed, onReviewed, onSave, onApprove, onStoryboard, canStoryboard, onDraftGuardChange }: {
  onRegenerate: () => void;
  resolveReferenceUrl: (path: string) => Promise<string>;
  task: MotionComicScriptTask; candidate: MotionComicScriptCandidate; source: MotionComicSourceEpisode; locked: boolean; busy: boolean; reviewed: boolean;
  approval?: MotionComicScriptApproval; project: MotionComicPipelineData; onOpenProjectAssets: () => void;
  original?: MotionComicScriptOriginal; proposals: ScriptProposal[]; proposalLocked: boolean;
  onPropose: (input: ScriptProposalRequest) => Promise<MotionComicScriptSnapshot>;
  onAdopt: (proposalId: string) => Promise<MotionComicScriptSnapshot>;
  onRevert: (proposalId: string) => Promise<MotionComicScriptSnapshot>;
  onRefreshProposals: () => Promise<MotionComicScriptSnapshot>;
  onDraftGuardChange: (guard: (() => boolean) | null) => void;
  onReviewed: (value: boolean) => void; onSave: (script: MotionComicScriptDraft, revision: number) => Promise<MotionComicScriptSnapshot>;
  onApprove: () => Promise<void>; onStoryboard: () => Promise<MotionComicScriptSnapshot>; canStoryboard: boolean;
}) {
  const [history, setHistory] = useState(() => createScriptEditHistory(task.id, candidate.outputRevision, candidate.script));
  const historyRef = useRef(history);
  const draft = history.present;
  const baseRevision = history.baseRevision;
  function resetHistory(script: MotionComicScriptDraft, revision: number) {
    const next = createScriptEditHistory(task.id, revision, script);
    historyRef.current = next;
    setHistory(next);
  }
  const [localError, setLocalError] = useState('');
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(candidate.script);
  const conflict = baseRevision !== candidate.outputRevision || baseRevision !== task.outputRevision;
  const editingLocked = locked || busy || saving || conflict;
  const invalidText = draft.scenes.some((scene) => scene.beats.some((beat) => !beat.text.trim()));
  const unresolvedAssets = motionComicScriptAssetSummary(project, draft).unresolved;
  const issues = scriptDraftIssues(draft, source.sourceText, project, task.instructions);
  const titleRepair = repairScriptTitleNarration(draft, source.sourceText);
  const canRepairTitle = JSON.stringify(titleRepair) !== JSON.stringify(draft);
  const undoReason = conflict ? '服务器版本已变化，请先载入当前版本。' : locked ? '当前版本只读。' : busy || saving ? '正在处理请求，请稍后。' : !history.past.length ? '暂无可撤销的本地修改；编辑剧情后即可撤销。' : '';
  const recovery: MotionComicPlanRecovery = { token: task.id, projectId: task.projectId, sourceText: source.sourceText, instructions: task.instructions,
    title: draft.title, scenes: draft.scenes.length, script: task.status === 'approved' && approval?.assetsConfirmedAt ? approval.script : draft, createdAt: candidate.createdAt, phase: 'script-review', adjustments: candidate.adjustments,
    needsValidation: changed || conflict || issues.length > 0 };
  const localDraft = useWorkspaceDraft({ id: `comic-script-${task.projectId}-${task.id}`, label: `第 ${source.number} 集剧本草稿`, enabled: changed, busy: saving,
    value: { scriptJson: JSON.stringify(draft), revision: baseRevision }, restore: (saved) => {
      try {
        const parsed = motionComicPlanRecoverySchema.shape.script.safeParse(JSON.parse(saved.scriptJson));
        if (parsed.success) { resetHistory(parsed.data, saved.revision); onReviewed(false); }
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
  function applyHistory(action: ScriptHistoryAction) {
    try {
      const next = changeScriptEditHistory(historyRef.current, action, {
        taskId: task.id, revision: candidate.outputRevision, expected: draft, locked: editingLocked,
      });
      if (next === historyRef.current) return;
      historyRef.current = next;
      setHistory(next); onReviewed(false);
      try { localDraft.persist({ scriptJson: JSON.stringify(next.present), revision: next.baseRevision }); setLocalError(''); }
      catch { setLocalError('本地草稿保存失败，请勿关闭页面。'); }
    } catch (cause) { setLocalError(message(cause)); }
  }
  function change(script: MotionComicScriptDraft) { applyHistory({ type: 'edit', script }); }
  async function save() {
    if (editingLocked || !changed || invalidText) return;
    setSaving(true);
    try {
      const result = await onSave(draft, baseRevision);
      const saved = result.candidates.find((item) => item.taskId === task.id);
      if (!saved || saved.outputRevision <= baseRevision) throw new Error('保存结果缺少新的剧本版本，本地稿与撤销记录仍保留，请刷新后核对。');
      resetHistory(saved.script, saved.outputRevision); onReviewed(false);
      localDraft.complete({ scriptJson: JSON.stringify(saved.script), revision: saved.outputRevision }); setLocalError('');
    } catch (cause) { setLocalError(message(cause)); }
    finally { setSaving(false); }
  }
  const proposalDisabledReason = conflict ? '服务器版本已变化，请先处理本地稿冲突。' : changed ? '当前有未保存改稿，请先点击“保存修改并校验”。' : busy || saving ? '正在保存或处理请求，请等待完成。' : locked || proposalLocked ? '本集已确认资产、已进入制作或当前状态不可编辑，不能生成、采用或撤销局部提案。' : '';
  async function adoptProposal(proposal: ScriptProposal) {
    if (proposalDisabledReason || proposal.status !== 'ready') throw new Error(proposalDisabledReason || '候选已不可采用');
    const result = await onAdopt(proposal.id);
    const saved = result.candidates.find(item => item.taskId === task.id);
    if (!saved || saved.outputRevision <= baseRevision) throw new Error('采用结果缺少新版本，请等待刷新核对；本地稿仍保留');
    resetHistory(saved.script, saved.outputRevision); onReviewed(false);
    localDraft.complete({ scriptJson: JSON.stringify(saved.script), revision: saved.outputRevision });
  }
  async function revertProposal(proposal: ScriptProposal) {
    const reason = scriptProposalRevertReason(proposal, candidate.outputRevision, proposalDisabledReason);
    if (reason) throw new Error(reason);
    const result = await onRevert(proposal.id);
    const saved = result.candidates.find(item => item.taskId === task.id);
    const reverted = result.proposals?.find(item => item.id === proposal.id);
    if (!saved || saved.outputRevision <= baseRevision || reverted?.status !== 'reverted' || reverted.revertedRevision !== saved.outputRevision) throw new Error('撤销结果缺少确认的新版本，请读取状态核对；本地稿仍保留');
    resetHistory(saved.script, saved.outputRevision); onReviewed(false);
    localDraft.complete({ scriptJson: JSON.stringify(saved.script), revision: saved.outputRevision });
  }
  function discardConflict() {
    try {
      localDraft.complete({ scriptJson: JSON.stringify(candidate.script), revision: candidate.outputRevision });
      resetHistory(candidate.script, candidate.outputRevision); onReviewed(false); setLocalError('');
    } catch { setLocalError('本地草稿清理失败，当前改动仍保留，请释放存储空间后重试。'); }
  }
  return <div className="comic-script-editor">
    {localError ? <p role="alert" className="motion-comic-plan-error">{localError}</p> : null}
    {conflict ? <div role="alert" className="motion-comic-plan-error">服务器版本已变化，当前本地草稿仍保留，不会自动覆盖。<Button disabled={saving || busy} onClick={discardConflict}>载入当前版本并放弃本地改动</Button></div> : null}
    {issues.length ? <details open className="comic-script-issues" aria-label="当前剧本校验问题"><summary>当前剧本有 {issues.length} 项校验问题，修复后才能批准</summary><div className="comic-script-issues__list">{issues.map((issue, index) => <p key={index}><strong>{scriptIssueLocation(issue.path)}</strong>：{issue.message}</p>)}</div><small>可编辑对应剧情后保存校验，或点击“重新生成剧本”重新改编本集。</small>{!editingLocked && canRepairTitle ? <Button onClick={() => change(titleRepair)}>修复章节标题旁白</Button> : null}{canRepairTitle ? <small>仅将独立章节标题改为不朗读的动作类型，保留文字和原文依据；修改后需保存校验。</small> : null}</details> : null}
    {!locked ? <Toolbar aria-label="本地改稿历史">
      <Button title={undoReason || '撤销上一步尚未保存的本地编辑'} disabled={editingLocked || !history.past.length} onClick={() => applyHistory({ type: 'undo' })}>撤销本地修改</Button>
      <Button icon={<RefreshCw size={14} />} disabled={editingLocked || changed || proposalLocked} title={changed ? '请先保存本地修改，再重新生成。' : '按原文重新生成本集剧本'} onClick={onRegenerate}>重新生成剧本</Button>
      <small role="status">{changed ? '有未保存修改，请先保存后重新生成。' : undoReason || '可撤销本次尚未保存的编辑；保存后清空本地历史。'}</small>
    </Toolbar> : null}
    <MotionComicScriptReview resolveReferenceUrl={resolveReferenceUrl} originalScript={original?.script} originalRevision={original?.outputRevision} proposalPanel={<MotionComicScriptProposal scopeId={`${project.id}:${task.id}`} onRefresh={async () => (await onRefreshProposals()).proposals?.filter(item => item.taskId === task.id) ?? []} script={candidate.script} revision={candidate.outputRevision} proposals={proposals} disabledReason={proposalDisabledReason} onPropose={async input => { if (!proposalDisabledReason) await onPropose(input); }} onAdopt={adoptProposal} onRevert={revertProposal} />} savedScript={candidate.script} savedRevision={candidate.outputRevision} recovery={recovery} project={project} onOpenProjectAssets={onOpenProjectAssets} episodeNumber={source.number} locked={locked || busy || saving || conflict} reviewed={reviewed} onReviewed={onReviewed} onChange={locked ? undefined : change} statusLabel={task.status === 'approved' && !approval?.assetsConfirmedAt ? '待确认项目资产' : motionComicScriptStatusLabel[task.status]} approvalLabel="我已核对当前版本的剧情、对白、人物地点道具及修改记录，加入待批准列表" workflowNote={approval?.assetsConfirmedAt ? '本集资产身份已确认；分镜待单独生成。' : '批准时确认项目资产身份，分镜待单独生成。'} />
    <Toolbar aria-label="剧本审核操作"><small>{changed ? '本地草稿 · 尚未提交校验' : `已保存 r${candidate.outputRevision}`}</small>
      {!locked ? <><Button icon={<Save size={14} />} disabled={busy || saving || !changed || invalidText || conflict} onClick={() => void save()}>保存修改并校验</Button><Button variant="primary" icon={<CheckCircle2 size={14} />} disabled={busy || saving || changed || conflict || !reviewed || unresolvedAssets > 0 || issues.length > 0} onClick={() => void onApprove().catch(() => {})}>批准本集剧本</Button></> : null}
      {canStoryboard ? <Button variant="primary" icon={<Film size={14} />} disabled={busy || changed || conflict} onClick={() => void onStoryboard().catch(() => {})}>仅生成本集分镜</Button> : task.storyboardStatus === 'running' ? <span role="status">分镜后台生成中</span> : null}
    </Toolbar>
  </div>;
}

function StoryboardReview({ storyboard, disabled, onApply, onEdit }: { storyboard: MotionComicScriptStoryboard; disabled: boolean; onApply: (reviewed: boolean) => Promise<void>; onEdit?: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const plan = storyboard.plan;
  return <div className="comic-script-editor">
    <Toolbar aria-label="分镜内容操作" className="comic-script-board-toolbar"><strong>{plan.script.scenes.length} 场 · {plan.shots.length} 个镜头</strong>{onEdit ? <Button icon={<Film size={14} />} onClick={onEdit}>编辑本集分镜</Button> : <small>应用后可从每集“编辑分幕与场次”进入，逐镜编辑画面、运镜和对白。</small>}</Toolbar>
    <div className="comic-script-detail__scroll" aria-label="分镜候选审核">{storyboard.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      {plan.script.scenes.map((scene) => <section className="comic-script-board-scene" key={scene.key}>
        <header><h3>第 {scene.actIndex} 幕 · {scene.title}</h3><small>{plan.shots.filter(shot => shot.sceneKey === scene.key).length} 个镜头</small></header><p>{scene.summary}</p>
        {plan.shots.filter((shot) => shot.sceneKey === scene.key).map((shot) => <article className="comic-script-board-shot" key={shot.key}>
          <header><span className="comic-script-board-index">镜头 {String(plan.shots.indexOf(shot) + 1).padStart(2, '0')}</span><strong>{shot.title}</strong><span>{shot.framing} · {shot.durationSec} 秒</span></header>
          <dl><div><dt>画面</dt><dd>{shot.prompt}</dd></div><div><dt>动作 / 运镜</dt><dd>{shot.motionPrompt}</dd></div><div><dt>动作承接</dt><dd>{shot.continuity.startState} → {shot.continuity.endState}</dd></div></dl>
        </article>)}
      </section>)}
      {plan.adjustments?.length ? <details open><summary>整理与修改记录 ({plan.adjustments.length})</summary>{plan.adjustments.map((item, index) => <p key={index}>{item.path}：{item.before} → {item.after}</p>)}</details> : null}
    </div>
    <CheckboxField label="已核对当前分镜与整理记录，同意写入正式分集；不启动媒体生成" checked={reviewed} disabled={disabled} onChange={(_, data) => setReviewed(data.checked === true)} />
    <Toolbar aria-label="分镜应用"><Button variant="primary" disabled={disabled || !reviewed} onClick={() => void onApply(reviewed)}>确认并应用本集分镜</Button></Toolbar>
  </div>;
}

function message(cause: unknown) { return formatAppErrorMessage(normalizeAppError(cause)); }

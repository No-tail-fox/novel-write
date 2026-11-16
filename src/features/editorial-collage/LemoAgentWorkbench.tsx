import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Bot, Camera, CircleCheck, Clapperboard, FilePen, FileText, FolderOpen, Image, ImagePlus, LoaderCircle, PenLine, TriangleAlert } from 'lucide-react';
import { Button } from '../../ui';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { VoxProductionRun } from '../../shared/vox-production';
import { lemoAgentMaxTurns, lemoAgentProgressText, type LemoUpstreamFilm } from '../../shared/creative-animation/upstream-agent';
import { lemoAgentToolLabel, type LemoAgentActivity, type LemoAgentTurnSummary } from '../../shared/lemo-agent-activity';
import { toLocalImageUrl } from '../tasks/task-formatters';
import '../../styles/features/lemo-agent-workbench.css';

const POLL_MS = 2500;

/**
 * Read-only Lemo Agent process for the current v3 run. Polls while the run is executing and reloads once whenever
 * the saved turn or run status changes. Never dispatches anything: it only summarizes the run journal.
 */
export function useLemoAgentActivity(api: Pick<StoryDreamApi, 'getVoxAgentActivity'>, projectId: string | undefined, run: VoxProductionRun | undefined, filmTurn: number | undefined) {
  const runId = run?.authoringVersion === 3 ? run.id : '';
  const running = run?.status === 'running';
  const key = projectId && runId ? `${projectId}\u0000${runId}` : '';
  const [result, setResult] = useState<{ key: string; activity: LemoAgentActivity | null; error?: string }>({ key: '', activity: null });
  useEffect(() => {
    if (!key || !projectId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const activity = await api.getVoxAgentActivity({ id: projectId, runId });
        if (!cancelled) setResult({ key, activity });
      } catch (error) {
        if (!cancelled) setResult(previous => ({ key, activity: previous.key === key ? previous.activity : null, error: error instanceof Error ? error.message : String(error) }));
      }
      if (!cancelled && running) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, key, projectId, runId, running, filmTurn, run?.status]);
  return result.key === key ? result : { key, activity: null };
}

const toolIcons: Record<string, ReactElement> = {
  list_files: <FolderOpen size={14} />, read_file: <FileText size={14} />, write_file: <FilePen size={14} />, replace_text: <PenLine size={14} />,
  review_frames: <Camera size={14} />, finish: <CircleCheck size={14} />, view_asset: <Image size={14} />, request_image: <ImagePlus size={14} />,
};
const EDIT_TOOLS = new Set(['write_file', 'replace_text', 'request_image']);

function elapsedText(startedAt: string | undefined, now: number) {
  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(started)) return '';
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export function LemoAgentWorkbench({ run, film, activity, error }: {
  run: VoxProductionRun;
  /** The run's own film state (already matched by runId), or undefined before the first turn. */
  film?: Pick<LemoUpstreamFilm, 'runId' | 'turn' | 'status' | 'usage' | 'review' | 'sourceHash'> & Partial<Pick<LemoUpstreamFilm, 'cost'>>;
  activity: LemoAgentActivity | null;
  error?: string;
}) {
  const running = run.status === 'running';
  const turns = useMemo(() => activity?.turns ?? [], [activity]);
  const pending = running && film?.status !== 'ready' ? activity?.pending : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!pending?.startedAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending?.startedAt]);

  const reviews = useMemo(() => turns.filter(turn => turn.frames?.length), [turns]);
  const [selectedReview, setSelectedReview] = useState<number | undefined>();
  const [frameIndex, setFrameIndex] = useState(0);
  const latestReview = reviews.at(-1);
  const review = reviews.find(turn => turn.index === selectedReview) ?? latestReview;
  const frames = review?.frames ?? [];
  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  useEffect(() => { setFrameIndex(0); }, [review?.index]);
  const editsAfter = review ? turns.filter(turn => turn.index > review.index && turn.ok && EDIT_TOOLS.has(turn.tool)).length : 0;

  const maxTurns = lemoAgentMaxTurns(run.settings.agentMaxTurns);
  const turnNumber = pending?.index ?? film?.turn ?? 0;
  const budget = lemoAgentProgressText(film, run.settings).split(' · ').slice(1).join(' · ');
  const state = film?.status === 'ready'
    ? running ? '已完成审片 · 正在合成成片' : run.status === 'completed' ? '制作完成' : '已完成审片'
    : run.status === 'paused' ? '已暂停'
      : run.status === 'failed' ? '已停止 · 请查看制作进度'
        : run.status === 'cancelled' ? '已取消'
          : pending ? pending.phase === 'waiting-model' ? `等待模型回复${elapsedText(pending.startedAt, now) ? ` · 已等 ${elapsedText(pending.startedAt, now)}` : ''}` : '正在执行本轮动作'
            : running ? '准备下一轮' : '等待开始';
  const tone = run.status === 'failed' ? 'danger' : film?.status === 'ready' ? 'ok' : running ? 'active' : 'idle';
  const rows = [...turns].reverse();
  const wasted = turns.filter(turn => turn.tool === 'invalid_reply').length;

  return <section className="lemo-agent-workbench" aria-label="原生 Agent 制作过程" data-run-status={run.status}>
    <header className="lemo-agent-workbench__header">
      <Bot size={16} aria-hidden="true" />
      <strong>原生 Agent 第 {turnNumber} / {maxTurns} 轮</strong>
      <span className="lemo-agent-workbench__state" data-tone={tone} role="status" aria-live="polite">{state}</span>
      {budget ? <small title={budget}>{budget}</small> : null}
    </header>
    <div className="lemo-agent-workbench__body">
      <figure className="lemo-agent-workbench__stage">
        <div className="lemo-agent-workbench__frame">
          {frame ? <img src={toLocalImageUrl(frame)} alt={`第 ${review!.index} 轮抽帧 · 第 ${Math.min(frameIndex, frames.length - 1) + 1} 帧`} />
            : <div className="lemo-agent-workbench__placeholder"><Clapperboard size={22} aria-hidden="true" /><span>{turns.length ? 'Agent 正在读库和编写工程，还没有渲染抽帧。' : '等待 Agent 第一轮动作。'}</span><small>抽帧检查后，这里会显示真实渲染的画面。</small></div>}
        </div>
        {frames.length > 1 ? <div className="lemo-agent-workbench__thumbs" role="group" aria-label="抽帧">
          {frames.map((path, index) => <Button key={path} variant="subtle" density="compact" className="lemo-agent-workbench__thumb" aria-pressed={index === Math.min(frameIndex, frames.length - 1)} aria-label={`查看第 ${index + 1} 帧`} onClick={() => setFrameIndex(index)}><img src={toLocalImageUrl(path)} alt="" /></Button>)}
        </div> : null}
        {review ? <figcaption>
          第 {review.index} 轮抽帧 · <span data-ok={review.technicalPassed ? 'true' : 'false'}>{review.detail}</span>
          {review === latestReview && editsAfter ? ` · 之后又改了 ${editsAfter} 次，待重新抽帧` : ''}
          {review !== latestReview ? <> · <Button variant="subtle" density="compact" onClick={() => setSelectedReview(undefined)}>回到最新抽帧</Button></> : null}
        </figcaption> : null}
      </figure>
      <ol className="lemo-agent-workbench__turns" aria-label="Agent 每轮动作">
        {wasted > 0 && turns.length >= 4 && wasted * 3 >= turns.length ? <li data-state="notice"><TriangleAlert size={14} aria-hidden="true" /><div><strong>{turns.length} 轮中有 {wasted} 轮没有给出可执行动作</strong><small>这些轮次也计入轮数上限，是总步数持续增长的主要原因；如果比例一直很高，建议换用更严格遵守格式的文本模型。</small></div></li> : null}
        {pending ? <li data-state="pending">
          <LoaderCircle size={14} className="lemo-agent-workbench__spin" aria-hidden="true" />
          <div><strong>第 {pending.index} 轮</strong><small>{pending.phase === 'waiting-model' ? '模型正在思考下一步动作…' : '正在执行动作…'}</small></div>
        </li> : null}
        {rows.map(turn => <TurnRow key={turn.index} turn={turn} selected={review?.index === turn.index} onShowFrames={() => setSelectedReview(turn.index)} />)}
        {!rows.length && !pending ? <li data-state="empty"><div><small>{error ? `无法读取过程记录：${error}` : '还没有完成的轮次。'}</small></div></li> : null}
        {activity && activity.totalTurns > turns.length ? <li data-state="empty"><div><small>更早的 {activity.totalTurns - turns.length} 轮已省略。</small></div></li> : null}
      </ol>
    </div>
  </section>;
}

function TurnRow({ turn, selected, onShowFrames }: { turn: LemoAgentTurnSummary; selected: boolean; onShowFrames(): void }) {
  return <li data-state={turn.ok ? 'ok' : 'rejected'} data-tool={turn.tool} aria-current={selected ? 'true' : undefined}>
    {turn.ok ? toolIcons[turn.tool] ?? <FileText size={14} /> : <TriangleAlert size={14} />}
    <div>
      <strong>第 {turn.index} 轮 · {lemoAgentToolLabel(turn.tool)}{turn.target ? <span className="lemo-agent-workbench__target" title={turn.target}> {turn.target}</span> : null}</strong>
      {turn.detail ? <small title={turn.detail}>{turn.ok || turn.tool === 'invalid_reply' ? '' : '未执行：'}{turn.detail}</small> : null}
    </div>
    {turn.frames?.length ? <Button variant="subtle" density="compact" aria-pressed={selected} onClick={onShowFrames}>看帧</Button> : null}
  </li>;
}

import type { ReactNode } from 'react';
import { AlertTriangle, CircleDashed, Clock3, FileText, Loader2, PauseCircle, XCircle } from 'lucide-react';
import type { MotionComicSourceEpisode } from '../../shared/motion-comic';
import { motionComicScriptStatusLabel, type MotionComicScriptTask } from '../../shared/motion-comic-script-batch';
import './motion-comic-script-hierarchy.css';

export type ScriptStatusTone = 'neutral' | 'active' | 'review' | 'ok' | 'warn' | 'danger';

export function scriptStatusTone(status: MotionComicScriptTask['status'] | undefined): ScriptStatusTone {
  if (!status) return 'neutral';
  if (status === 'running') return 'active';
  if (status === 'script-ready' || status === 'review') return 'review';
  if (status === 'approved') return 'ok';
  if (status === 'stale') return 'warn';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

export function ScriptStatusChip({ status, paused, label }: { status?: MotionComicScriptTask['status']; paused?: boolean; label?: string }) {
  const tone = paused && status === 'queued' ? 'warn' : scriptStatusTone(status);
  const text = label ?? (status ? paused && status === 'queued' ? '排队已暂停' : motionComicScriptStatusLabel[status] : '未生成');
  return <span className="comic-script-chip" data-tone={tone}>{text}</span>;
}

/** Split saved source text into readable paragraphs; empty lines are boundaries, never content. */
export function sourceParagraphs(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** Read-only original text card. Paragraph numbers are the same natural paragraphs used by evidence locations. */
export function ScriptSourceCard({ source, aside }: { source: MotionComicSourceEpisode; aside?: ReactNode }) {
  const paragraphs = sourceParagraphs(source.sourceText);
  return <article className="comic-script-card comic-script-source-card" aria-label={`第 ${source.number} 集原文`}>
    <header className="comic-script-card__head"><strong>原文</strong><small>只读 · 保留来源</small></header>
    <div className="comic-script-card__body">
      <p className="comic-script-eyebrow">第 {source.number} 集</p>
      <h3 className="comic-script-source-card__title">{source.title}</h3>
      {aside}
      {paragraphs.length ? <ol className="comic-script-paragraphs">{paragraphs.map((paragraph, index) =>
        <li key={index}><span aria-hidden="true">{index + 1}</span><p>{paragraph}</p></li>)}</ol>
        : <p className="comic-script-card__empty">本集原文为空。请返回分集确认补充正文。</p>}
    </div>
    <footer className="comic-script-card__foot">来源：第 {source.number} 集 · 共 {paragraphs.length} 段 · {source.sourceText.length.toLocaleString('zh-CN')} 字　/　原文不随改写更改</footer>
  </article>;
}

const awaitingCopy = (status: MotionComicScriptTask['status'] | undefined, paused: boolean) => {
  if (status === 'running') return { icon: <Loader2 size={28} className="director-spin" />, title: '剧本生成中', body: '任务在后台执行，完成后会保存为待审核稿；现在可以离开页面。' };
  if (status === 'queued') return paused
    ? { icon: <PauseCircle size={28} />, title: '排队已暂停', body: '恢复队列后会继续按故事顺序生成，原文已保留。' }
    : { icon: <Clock3 size={28} />, title: '等待生成', body: '将按故事顺序生成剧本，不依赖上一集分镜是否完成。' };
  if (status === 'failed') return { icon: <XCircle size={28} />, title: '生成失败', body: '尚无可审核结果。原文已保留；核对错误后使用“重新提交本集”。' };
  if (status === 'cancelled') return { icon: <XCircle size={28} />, title: '任务已取消', body: '未保存任何改写结果。需要时可重新提交本集。' };
  if (status === 'stale') return { icon: <AlertTriangle size={28} />, title: '输入已变化', body: '源文、系列设定或前集版本已变化；旧稿保留只读，重新提交不会覆盖已有制作。' };
  return { icon: <CircleDashed size={28} />, title: '尚未生成剧本', body: '提交剧本任务后，可在这里审核对白、动作与原文依据。' };
};

/** Right-hand draft card before any candidate exists: real task state only, no placeholder script. */
export function ScriptAwaitingCard({ task, paused, error, queue }: {
  task?: MotionComicScriptTask; paused: boolean; error?: string; queue: { running: number; queued: number };
}) {
  const copy = awaitingCopy(task?.status, paused);
  const tone = paused && task?.status === 'queued' ? 'warn' : scriptStatusTone(task?.status);
  return <article className="comic-script-card comic-script-awaiting-card" aria-label="漫剧改写稿">
    <header className="comic-script-card__head"><strong>漫剧改写稿</strong><ScriptStatusChip status={task?.status} paused={paused} /></header>
    <div className="comic-script-card__body comic-script-awaiting-card__body" data-tone={tone}>
      <span className="comic-script-awaiting-card__icon" aria-hidden="true">{copy.icon}</span>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      {task?.status === 'running' ? <div className="comic-script-progress" role="progressbar" aria-label="剧本生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}>
        <span className="comic-script-progress__track"><span style={{ width: `${Math.max(2, Math.min(100, task.progress))}%` }} /></span><small>{task.progress}%</small>
      </div> : null}
      {error ? <details className="comic-script-awaiting-card__error"><summary>查看错误信息</summary><p>{error}</p></details> : null}
      <dl className="comic-script-facts">
        <div><dt>后台队列</dt><dd>生成 {queue.running} · 排队 {queue.queued}{paused ? ' · 已暂停' : ''}</dd></div>
        {task ? <div><dt>文本模型</dt><dd>{task.model || '未记录'}</dd></div> : null}
        {task ? <div><dt>最近更新</dt><dd>{new Date(task.updatedAt).toLocaleString('zh-CN')}</dd></div> : null}
      </dl>
    </div>
    <footer className="comic-script-card__foot"><FileText size={13} aria-hidden="true" />生成后先保存为草稿，需逐项核对后再批准本集。</footer>
  </article>;
}

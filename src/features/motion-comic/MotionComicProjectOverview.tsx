import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { Button } from '../../ui';
import { motionComicEpisodeProgress, motionComicOverviewFacts, motionComicOverviewRows } from './motion-comic-overview';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import './motion-comic-overview.css';

interface Props {
  document: MotionComicPipelineData;
  busy: boolean;
  onOpenEpisode: (id: string) => void;
  onOpenScript: (id?: string) => void;
  onOpenAssets: () => void;
  onContinue: () => void;
  onBack: () => void;
  scriptSnapshot?: MotionComicScriptSnapshot;
  onAddEpisode?: () => void;
  onBatchProcess?: () => void;
}

/** Imported sources often put separator rulers and blank runs into the premise; show prose only. */
function premiseText(value: string) {
  return value.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !/^[=＝\-—_*~·.。]{4,}$/u.test(line)).join(' ').replace(/[=＝]{4,}/gu, ' ').replace(/\s{2,}/gu, ' ').trim();
}

/** Long premises are clamped to three lines with an explicit expand toggle. */
function OverviewPremise({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p className="comic-overview-premise">从剧本出发，让故事成为画面。</p>;
  const long = text.length > 140;
  return <>
    <p className="comic-overview-premise" data-open={open || !long}>{text}</p>
    {long ? <button type="button" className="comic-overview-premise-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? '收起简介' : '展开简介'}</button> : null}
  </>;
}

/** Project-level navigation; source episodes remain distinct from generated episodes. */
export function MotionComicProjectOverview({ document, busy, onOpenEpisode, onOpenScript, onOpenAssets, onContinue, onBack, scriptSnapshot, onAddEpisode, onBatchProcess }: Props) {
  const rows = motionComicOverviewRows(document);
  const snapshot = scriptSnapshot?.projectId === document.id ? scriptSnapshot : undefined;
  const pendingReview = snapshot ? rows.filter(row => ['script-ready', 'review'].includes(motionComicOverviewFacts(document, row, snapshot).task?.status ?? '')).length : undefined;
  const active = document.episodes.find(episode => episode.id === document.activeEpisodeId);
  const premise = premiseText(document.series.premise || '');
  const metrics = [
    { label: '项目分集', value: rows.length },
    { label: '待审核脚本', value: pendingReview ?? '—', detail: snapshot ? '来自脚本任务' : '尚未读取脚本任务', attention: Boolean(pendingReview) },
    { label: '已建资产条目', value: document.characters.length + document.sceneAssets.length + document.props.length },
    { label: active ? `第 ${active.number} 集镜头` : '当前分集镜头', value: active?.scenes.reduce((sum, scene) => sum + scene.shots.length, 0) ?? 0 },
  ];
  return <section className="comic-project-overview" aria-label="漫剧项目总览">
    <header className="comic-project-overview__heading">
      <div className="comic-overview-hero">
        <Button variant="subtle" density="compact" icon={<ArrowLeft size={14} />} disabled={busy} onClick={onBack}>返回项目列表</Button>
        <span className="comic-overview-eyebrow">项目总览</span>
        <h1>{document.title}</h1>
        <OverviewPremise key={premise} text={premise} />
        <small>{rows.length} 个分集 · {document.ratio} · 项目资产跨集共享</small>
      </div>
      <Button variant="primary" aria-label="继续制作" disabled={busy} onClick={onContinue}>继续制作{active ? `第 ${active.number} 集` : ''} →</Button>
    </header>
    <div className="comic-project-overview__columns">
      <section aria-label="项目分集"><h2>分集制作进度</h2>
        {rows.map(row => {
          const progress = row.episode ? motionComicEpisodeProgress(document, row.episode) : undefined;
          const shots = progress?.shots ?? 0;
          const facts = motionComicOverviewFacts(document, row, snapshot);
          const needsReview = ['script-ready', 'review'].includes(facts.task?.status ?? '');
          return <article className="comic-project-overview__episode" key={row.id}>
            <div className="comic-overview-episode-info"><span className="comic-overview-episode-number">{String(row.number).padStart(2, '0')}</span><div><strong>第 {row.number} 集 · {row.title}</strong><p>{row.episode ? `${row.episode.scenes.length} 场 · ${shots} 个镜头` : '剧本待结构化'}{row.episode?.id === document.activeEpisodeId ? ' · 当前分集' : ''}</p>{progress && shots > 0 ? <p>画面就绪 {progress.videos}/{progress.shots} · 镜头计划时长 {(progress.durationMs / 1000).toFixed(1)} 秒</p> : null}</div></div>
            <Button disabled={busy} onClick={() => needsReview ? onOpenScript(row.sourceEpisodeId) : row.episode ? onOpenEpisode(row.episode.id) : onOpenScript(row.sourceEpisodeId)}>{needsReview ? '去审核' : row.episode ? '打开分集' : '编辑剧本'}</Button>
            <div className="comic-overview-stages" aria-label={`第 ${row.number} 集制作阶段`}>{facts.stages.map(stage => <div className="comic-overview-stage" data-complete={stage.complete} key={stage.label}><span>{stage.label}</span><i aria-hidden="true" /><small>{stage.detail}</small></div>)}</div>
            <span className="comic-overview-status" data-attention={facts.task?.status === 'failed'}>{facts.status}</span>
          </article>;
        })}
        {!rows.length && <p>项目尚无分集，从剧本创作开始。</p>}
      </section>
      <aside className="comic-project-overview__assets"><div><h2>项目内容</h2><p>角色、场景和道具由整个项目共享；分集的剧本与镜头独立管理。</p></div><Button disabled={busy} onClick={onOpenAssets}>管理项目资产</Button><Button disabled={busy} onClick={() => onOpenScript()}>剧本与分集管理</Button>{onBatchProcess ? <Button disabled={busy} onClick={onBatchProcess}>批量处理</Button> : null}{onAddEpisode ? <Button disabled={busy} onClick={onAddEpisode}>＋ 添加分集</Button> : null}</aside>
    </div>
    <dl className="comic-overview-metrics">{metrics.map(metric => <div key={metric.label} data-attention={metric.attention || undefined}><dd>{metric.value}</dd><dt>{metric.label}</dt>{metric.detail ? <small>{metric.detail}</small> : null}</div>)}</dl>
  </section>;
}

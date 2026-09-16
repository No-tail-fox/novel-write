import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, Play, RefreshCw, Save } from 'lucide-react';
import type { ViralReferenceApi } from '../../shared/viral-reference-api';
import { REFERENCE_TRACKS, REFERENCE_TRACK_LABELS, type ReferenceEvidence, type ReferenceManifest, type ReferenceObservation, type ReferencePart, type ReferenceTrack } from '../../shared/viral-reference';
import { Button, SelectField, Tabs, TextAreaField } from '../../ui';
import '../../styles/features/viral-reference.css';

type ReferenceView = 'overview' | 'shots' | 'timeline' | 'blueprint';
type ObservationDraft = { text: string; baseText: string; revision: number; partId: string };
export type ReferenceDrafts = Record<string, ObservationDraft>;

const stateLabels = { observed: '有证据观察', inferred: '推断 · 待复核', 'not-analyzed': '尚未分析' };
const presenceLabels = { present: '已发现', absent: '未发现', unknown: '尚不能判断' };
const confidenceLabels = { high: '高', medium: '中', low: '低' };
const reasonLabels = { pending: '待处理', budget: '调用额度已用完', 'missing-capability': '当前服务缺少相应能力', failed: '处理失败', 'insufficient-evidence': '证据不足', 'not-applicable': '不适用' };
const evidenceLabels = { frame: '画面帧', 'video-range': '连续视频', 'audio-range': '原声音频', 'transcript-range': '转写区间', 'signal-measurement': '信号测量' };

export function referenceTimeLabel(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs) / 1000;
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toFixed(1).padStart(4, '0')}`;
}

export function referenceObservations(part: ReferencePart | null): ReferenceObservation[] {
  if (!part) return [];
  return [...new Map([...part.observations, ...part.shots.flatMap((shot) => shot.observations)].map((item) => [item.id, item])).values()]
    .sort((a, b) => a.range.startMs - b.range.startMs || a.id.localeCompare(b.id));
}

/** Stable drafts keep their original CAS revision; refresh must never silently rebase an edit. */
export function referenceDraftIsStale(draft: ObservationDraft | undefined, revision: number): boolean {
  return Boolean(draft && draft.revision !== revision);
}

export function ViralReferenceReport({ api, analysisId, readOnly, refreshKey }: {
  api: ViralReferenceApi; analysisId: string; readOnly: boolean; refreshKey: string;
}) {
  const [manifest, setManifest] = useState<ReferenceManifest | null>(null);
  const [part, setPart] = useState<ReferencePart | null>(null);
  const [partId, setPartId] = useState('');
  const [selectedObservationId, setSelectedObservationId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [view, setView] = useState<ReferenceView>('overview');
  const [trackFilter, setTrackFilter] = useState<ReferenceTrack | 'all'>('all');
  const [drafts, setDrafts] = useState<ReferenceDrafts>({});
  const [videoUrl, setVideoUrl] = useState('');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [partLoading, setPartLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekTarget = useRef<number | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    let active = true;
    const generation = ++epoch.current;
    setLoading(true);
    api.getViralReferenceIndex(analysisId).then((next) => {
      if (!active || generation !== epoch.current) return;
      setManifest(next);
      setPartId((previous) => next?.parts.some((entry) => entry.partId === previous) ? previous : next?.parts[0]?.partId ?? '');
      setError('');
    }).catch((cause) => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, analysisId, refreshKey, reload]);

  useEffect(() => {
    let active = true;
    if (!manifest || !partId) { setPart(null); return; }
    setPartLoading(true);
    api.getViralReferencePart(analysisId, partId, manifest.revision).then((next) => {
      if (!active) return;
      setPart(next);
      const observations = referenceObservations(next);
      setSelectedObservationId((previous) => observations.some((item) => item.id === previous) ? previous : next.shots[0]?.observations[0]?.id ?? observations[0]?.id ?? '');
      setSelectedShotId((previous) => next.shots.some((shot) => shot.id === previous) ? previous : next.shots[0]?.id ?? '');
      setError('');
    }).catch((cause) => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setPartLoading(false); });
    return () => { active = false; };
  }, [api, analysisId, partId, manifest?.revision, reload]);

  useEffect(() => {
    let active = true;
    api.getViralMediaUrl(analysisId, 'source').then((next) => {
      if (active) { setVideoUrl(next); setMediaError(''); }
    }).catch((cause) => { if (active) setMediaError(errorText(cause)); });
    return () => { active = false; };
  }, [api, analysisId, Boolean(manifest), reload]);

  const observations = useMemo(() => referenceObservations(part), [part]);
  const visibleObservations = observations.filter((item) => trackFilter === 'all' || item.track === trackFilter);
  const selected = observations.find((item) => item.id === selectedObservationId) ?? null;
  const draft = selected ? drafts[selected.id] : undefined;
  const activePartIndex = manifest?.parts.findIndex((entry) => entry.partId === partId) ?? -1;
  const activePart = manifest?.parts[activePartIndex];
  const currentPartVisible = part?.partId === partId;
  const editable = Boolean(selected && manifest && currentPartVisible && !partLoading && !readOnly);
  const staleDraft = referenceDraftIsStale(draft, manifest?.revision ?? 0);
  const dirtyDraftCount = Object.values(drafts).filter((item) => item.text !== item.baseText).length;

  const seek = useCallback((timeMs: number) => {
    seekTarget.current = timeMs;
    setCurrentTimeMs(timeMs);
    if (videoRef.current?.readyState) videoRef.current.currentTime = timeMs / 1000;
  }, []);

  function selectObservation(item: ReferenceObservation) {
    setSelectedObservationId(item.id);
    setSelectedShotId(part?.shots.find((shot) => shot.observations.some((observation) => observation.id === item.id))?.id ?? '');
    seek(item.range.startMs);
  }

  function updateDraft(text: string) {
    if (!selected || !manifest || !part) return;
    setDrafts((previous) => ({ ...previous, [selected.id]: {
      ...(previous[selected.id] ?? { text: selected.text, baseText: selected.text, revision: manifest.revision, partId: part.partId }), text,
    } }));
  }

  async function saveEdit() {
    if (!selected || !draft || !editable || busy || !draft.text.trim()) return;
    setBusy(true); setNotice('');
    try {
      const next = await api.saveViralReferenceEdit({ analysisId, expectedRevision: draft.revision, partId: draft.partId, observationId: selected.id, text: draft.text.trim() });
      // Invalidate an older in-flight index refresh so it cannot overwrite this accepted revision.
      epoch.current += 1;
      setManifest(next);
      setDrafts((previous) => { const nextDrafts = { ...previous }; delete nextDrafts[selected.id]; return nextDrafts; });
      setError(''); setNotice('修订已保存。原始证据与观察状态保留，文字来源记为人工修订。');
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  async function exportReport(format: 'markdown' | 'json' | 'csv') {
    setBusy(true); setNotice('');
    try {
      const path = await api.exportViralReference({ analysisId, format });
      if (path) setNotice(`已导出：${path}${dirtyDraftCount ? '（未保存的修订未导出）' : ''}`);
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }

  return <div className="viral-reference" data-viral-reference="whole-video">
    <div className="viral-reference-toolbar">
      <Tabs label="整体拆解视图" value={view} onChange={(value) => setView(value as ReferenceView)} items={[
        { value: 'overview', label: '全片总览' }, { value: 'shots', label: '逐镜头' }, { value: 'timeline', label: '视听时间线' }, { value: 'blueprint', label: '制作线索' },
      ]} />
      <div className="viral-reference-export" aria-label="报告操作">
        <Button density="compact" onClick={() => setReload((value) => value + 1)} disabled={busy} icon={<RefreshCw size={14} />}>刷新</Button>
        {(['markdown', 'json', 'csv'] as const).map((format) => <Button key={format} density="compact" disabled={!manifest || busy} onClick={() => void exportReport(format)} icon={<Download size={14} />}>{format === 'markdown' ? 'Markdown' : format.toUpperCase()}</Button>)}
      </div>
    </div>
    {error ? <div className="viral-reference-error" role="alert">{error}<p>已加载的结果和未保存文字仍保留。可刷新后核对最新版本。</p></div> : null}
    {notice ? <p className="viral-reference-notice" role="status">{notice}</p> : null}
    {dirtyDraftCount ? <p className="viral-reference-draft-notice" role="status">有 {dirtyDraftCount} 条未保存修订；切换区间或刷新不会清空。导出只包含已保存内容。</p> : null}
    {!manifest ? <div className="viral-reference-empty" role="status">
      {loading ? <Loader2 size={22} className="spin" /> : null}
      <strong>{loading ? '正在读取拆解索引' : '等待全片扫描建立拆解索引'}</strong>
      <p>完成首批处理后即可查看镜头和多轨证据。未处理的时间区间会明确标出。</p>
    </div> : <>
      <div className="viral-reference-summary">
        <strong>{manifest.coverageState === 'complete' ? '全片各维度已有记录' : '部分结果 · 仍有未分析区间'}</strong>
        <span>原片 {referenceTimeLabel(manifest.durationMs)} · {manifest.totals.shots} 个镜头区间 · {manifest.totals.observations} 条观察 · 版本 {manifest.revision}</span>
      </div>
      {view === 'overview' ? <><ReferenceGlobalSummary manifest={manifest} view="overview" /><ReferenceCoverageOverview manifest={manifest} /></> : null}
      {view === 'blueprint' ? <ReferenceGlobalSummary manifest={manifest} view="blueprint" /> : null}
      <div className="viral-reference-pagination">
        <SelectField label="原片区间" value={partId} onChange={(event) => setPartId(event.target.value)} options={manifest.parts.map((entry, index) => ({ value: entry.partId, label: `${index + 1}. ${referenceTimeLabel(entry.coreRange.startMs)} – ${referenceTimeLabel(entry.coreRange.endMs)}` }))} />
        <Button density="compact" disabled={activePartIndex <= 0 || partLoading} onClick={() => setPartId(manifest.parts[activePartIndex - 1].partId)} icon={<ChevronLeft size={14} />}>上一区间</Button>
        <Button density="compact" disabled={activePartIndex < 0 || activePartIndex >= manifest.parts.length - 1 || partLoading} onClick={() => setPartId(manifest.parts[activePartIndex + 1].partId)} icon={<ChevronRight size={14} />}>下一区间</Button>
        <span role="status">{partLoading ? '正在加载区间…' : `${activePartIndex + 1} / ${manifest.parts.length}`}</span>
      </div>
      <div className="viral-reference-workspace" aria-busy={partLoading}>
        <section className="viral-reference-source" aria-label="原片与区间观察">
          <div className="viral-reference-player">
            {videoUrl ? <video ref={videoRef} src={videoUrl} controls preload="metadata" onTimeUpdate={(event) => setCurrentTimeMs(event.currentTarget.currentTime * 1000)} onLoadedMetadata={() => { if (seekTarget.current !== null && videoRef.current) videoRef.current.currentTime = seekTarget.current / 1000; }} onError={() => setMediaError('原片暂时无法播放。请刷新媒体链接，已保存的拆解结果仍可查看。')} /> : <p>原片准备中</p>}
          </div>
          {mediaError ? <p className="viral-reference-error">{mediaError}</p> : null}
          <div className="viral-reference-player-caption"><span>原片 {referenceTimeLabel(currentTimeMs)}</span><span>点击镜头、观察或证据定位回放</span></div>
          <SelectField label="观察维度" value={trackFilter} onChange={(event) => setTrackFilter(event.target.value as ReferenceTrack | 'all')} options={[{ value: 'all', label: '全部维度' }, ...REFERENCE_TRACKS.map((track) => ({ value: track, label: REFERENCE_TRACK_LABELS[track] }))]} />
          {!currentPartVisible ? <p className="viral-reference-empty">{partLoading ? '正在加载当前区间' : '当前区间读取失败，请刷新重试。'}</p> : part ? <>
            {view === 'shots' ? <div className="viral-reference-shot-list" aria-label="逐镜头列表">
              {part.shots.map((shot, index) => <div key={shot.id} className={selectedShotId === shot.id ? 'viral-reference-shot selected' : 'viral-reference-shot'}>
                <Button variant="subtle" className="viral-reference-shot-button" aria-pressed={selectedShotId === shot.id} onClick={() => { setSelectedShotId(shot.id); if (shot.observations[0]) setSelectedObservationId(shot.observations[0].id); seek(shot.range.startMs); }} icon={<Play size={14} />}>
                  <strong>{shot.label || `镜头 ${index + 1}`}</strong><span>{rangeLabel(shot.range)} · {((shot.range.endMs - shot.range.startMs) / 1000).toFixed(2)} 秒</span>
                </Button>
                <p>{shot.boundary.startState === 'not-analyzed' || shot.boundary.endState === 'not-analyzed' ? '包含处理窗口边界 · 尚未确认为剪辑点' : shot.boundary.startState === 'inferred' || shot.boundary.endState === 'inferred' ? '候选边界 · 需人工复核' : '边界有证据记录'}{shot.boundary.uncertaintyMs ? ` · 误差范围 ±${shot.boundary.uncertaintyMs} ms` : ''}</p>
                <ObservationList observations={shot.observations.filter((item) => trackFilter === 'all' || item.track === trackFilter)} selectedId={selectedObservationId} onSelect={selectObservation} drafts={drafts} />
              </div>)}
              {!part.shots.length ? <p className="muted-text">此区间尚无镜头记录。</p> : null}
            </div> : view === 'timeline' ? <div className="viral-reference-timeline" aria-label="视听时间线">
              <div className="viral-reference-ruler"><span>{referenceTimeLabel(part.coreRange.startMs)}</span><span>{referenceTimeLabel(part.coreRange.endMs)}</span></div>
              {(trackFilter === 'all' ? REFERENCE_TRACKS : [trackFilter]).map((track) => <div className="viral-reference-track" key={track}>
                <strong>{REFERENCE_TRACK_LABELS[track]}</strong>
                <div className="viral-reference-track-events">
                  {visibleObservations.filter((item) => item.track === track).map((item) => <Button key={item.id} density="compact" variant="subtle" className={`viral-reference-event ${item.state}${item.id === selectedObservationId ? ' selected' : ''}`} aria-pressed={item.id === selectedObservationId} title={`${rangeLabel(item.range)} ${item.text}`} style={{ marginLeft: `${Math.max(0, (item.range.startMs - part.coreRange.startMs) / (part.coreRange.endMs - part.coreRange.startMs) * 100)}%`, width: `${Math.max(4, Math.min(100, (item.range.endMs - item.range.startMs) / (part.coreRange.endMs - part.coreRange.startMs) * 100))}%` }} onClick={() => selectObservation(item)}>{referenceTimeLabel(item.range.startMs)} · {item.text}</Button>)}
                  {!visibleObservations.some((item) => item.track === track) ? <span className="muted-text">此区间暂无观察；查看下方覆盖说明。</span> : null}
                </div>
              </div>)}
            </div> : <>
              {view === 'blueprint' ? <p className="muted-text">以下为当前区间的叙事、节奏及制作观察。尚未生成可执行制作蓝图，推断仍需核对原片。</p> : <h4>当前区间观察</h4>}
              <ObservationList observations={view === 'blueprint' ? visibleObservations.filter((item) => ['narrative', 'rhythm', 'layer-motion', 'av-sync', 'onscreen-text'].includes(item.track)) : visibleObservations} selectedId={selectedObservationId} onSelect={selectObservation} drafts={drafts} />
            </>}
            <details className="viral-reference-transcript"><summary>本区间转写（{part.transcript.length} 段）</summary>
              {part.transcript.map((segment) => <div key={segment.id}><Button variant="subtle" density="compact" disabled={!segment.range} onClick={() => segment.range && seek(segment.range.startMs)}>{segment.range ? rangeLabel(segment.range) : '时间未知'} · {segment.timingQuality === 'estimated' ? '估算时间' : segment.timingQuality === 'missing' ? '缺少时间戳' : '服务返回时间'}</Button><p>{segment.text}</p></div>)}
              {!part.transcript.length ? <p>暂无转写；这不表示原片没有对白。</p> : null}
            </details>
            <details className="viral-reference-coverage-details"><summary>本区间覆盖与缺口</summary>
              {part.coverage.filter((cell) => trackFilter === 'all' || cell.track === trackFilter).map((cell, index) => <div key={`${cell.track}-${index}`}><strong>{REFERENCE_TRACK_LABELS[cell.track]}</strong><span>{rangeLabel(cell.range)} · {stateLabels[cell.state]} · {presenceLabels[cell.presence]}{cell.reason ? ` · ${reasonLabels[cell.reason]}` : ''}</span></div>)}
            </details>
          </> : null}
        </section>
        <aside className="viral-reference-inspector" aria-label="观察与证据检查器">
          <h4>观察与证据</h4>
          {selected && currentPartVisible ? <>
            <div className="viral-reference-observation-meta"><strong>{REFERENCE_TRACK_LABELS[selected.track]}</strong><span>{rangeLabel(selected.range)}</span><span className={`viral-reference-state ${selected.state}`}>{stateLabels[selected.state]}</span><span>{presenceLabels[selected.presence]} · 置信度：{confidenceLabels[selected.confidence]}</span><span>来源：{selected.origin === 'user' ? '人工修订' : selected.origin === 'model' ? '模型' : '本地检测'}</span></div>
            {selected.reason ? <p className="viral-reference-draft-notice">{reasonLabels[selected.reason]}</p> : null}
            <TextAreaField label="观察文字" value={draft?.text ?? selected.text} onChange={(event) => updateDraft(event.target.value)} readOnly={!editable || busy} rows={7} maxLength={20000} hint="修改文字不自动提升证据状态或置信度。" />
            {staleDraft ? <div className="viral-reference-draft-notice"><p>报告版本已变化。你的草稿已保留，请比较最新文字后再确认沿用。</p><details><summary>查看最新保存文字</summary><p>{selected.text}</p></details><Button density="compact" disabled={busy || !editable} onClick={() => selected && manifest && setDrafts((previous) => ({ ...previous, [selected.id]: { ...previous[selected.id], revision: manifest.revision, baseText: selected.text } }))}>核对后沿用我的修订</Button></div> : null}
            <div className="viral-reference-edit-actions"><Button variant="primary" density="compact" disabled={!editable || busy || !draft || draft.text === draft.baseText || !draft.text.trim() || staleDraft} icon={<Save size={14} />} onClick={() => void saveEdit()}>保存修订</Button><Button density="compact" disabled={!draft || busy} onClick={() => setDrafts((previous) => { const next = { ...previous }; delete next[selected.id]; return next; })}>撤销未保存修订</Button></div>
            <h4>原片证据（{selected.evidenceIds.length}）</h4>
            {selected.evidenceIds.map((id) => {
              const evidence = part?.evidence.find((item) => item.id === id);
              return evidence ? <EvidencePreview key={id} evidence={evidence} api={api} analysisId={analysisId} onSeek={seek} /> : <p key={id} className="muted-text">证据 {id} 不在当前区间，请重新加载核对。</p>;
            })}
            {!selected.evidenceIds.length ? <p className="muted-text">此观察暂无可回放证据。</p> : null}
          </> : <p className="muted-text">选择镜头或时间线观察，查看原片证据并修订。</p>}
        </aside>
      </div>
      {activePart ? <p className="viral-reference-footer">正在查看 {rangeLabel(activePart.coreRange)}；每次只加载一个区间。观察与推断分开展示，“未分析”不能解释为原片没有该元素。</p> : null}
    </>}
  </div>;
}

export function ReferenceCoverageOverview({ manifest }: { manifest: ReferenceManifest }) {
  return <section className="viral-reference-coverage" aria-label="全片各维度覆盖">
    <p>覆盖比例按原片时长统计。有证据观察、推断与未分析分别计量；扫描到整片不代表已理解全部视听细节。</p>
    <div className="viral-reference-coverage-table" role="table" aria-label="分析覆盖率">
      <div className="viral-reference-coverage-row heading" role="row"><span role="columnheader">维度</span><span role="columnheader">有证据观察</span><span role="columnheader">推断 / 待复核</span><span role="columnheader">未分析</span></div>
      {manifest.coverageSummary.map((cell) => <div className="viral-reference-coverage-row" role="row" key={cell.track}><strong role="rowheader">{REFERENCE_TRACK_LABELS[cell.track]}</strong><span role="cell">{coveragePercent(cell.observedMs, manifest.durationMs)}</span><span role="cell" className="viral-reference-inferred">{coveragePercent(cell.inferredMs, manifest.durationMs)}</span><span role="cell" className={cell.notAnalyzedMs ? 'viral-reference-inferred' : ''}>{coveragePercent(cell.notAnalyzedMs, manifest.durationMs)}</span></div>)}
    </div>
  </section>;
}

export function ReferenceGlobalSummary({ manifest, view }: { manifest: ReferenceManifest; view: 'overview' | 'blueprint' }) {
  const summary = manifest.summary;
  if (!summary) return <p className="viral-reference-footer">全片总结尚未生成。可以先查看已保存区间的观察与证据。</p>;
  return <section className="viral-reference-global-summary" aria-label={view === 'overview' ? '全片总结' : '全片制作规则'}>
    {view === 'overview' ? <div className="viral-reference-global-summary-grid">
      {[['全片概况', summary.overview], ['叙事结构', summary.narrative], ['整体节奏', summary.rhythm]].map(([title, content]) => <section key={title}><h4>{title}</h4><p>{content || '暂无总结。'}</p></section>)}
    </div> : <>
      <h4>全片制作规则</h4>
      {summary.productionRules.length ? <ol>{summary.productionRules.map((rule, index) => <li key={`${index}-${rule.slice(0, 30)}`}>{rule}</li>)}</ol> : <p>尚无制作规则。下方保留区间级观察，便于核对和补充。</p>}
      <p className="viral-reference-footer">这些规则用于理解原片的制作方法，仍需结合区间证据核对；尚未生成可直接执行的制作工程。</p>
    </>}
    {summary.limitations.length ? <div className="viral-reference-summary-limitations"><h4>识别限制与待复核项</h4><ul>{summary.limitations.map((item, index) => <li key={`${index}-${item.slice(0, 30)}`}>{item}</li>)}</ul></div> : null}
  </section>;
}

function ObservationList({ observations, selectedId, onSelect, drafts }: { observations: ReferenceObservation[]; selectedId: string; onSelect: (item: ReferenceObservation) => void; drafts: ReferenceDrafts }) {
  return <div className="viral-reference-observation-list">{observations.map((item) => <Button key={item.id} variant="subtle" className={`viral-reference-observation${item.id === selectedId ? ' selected' : ''}`} aria-pressed={item.id === selectedId} onClick={() => onSelect(item)}><span className="viral-reference-observation-heading">{REFERENCE_TRACK_LABELS[item.track]} · {rangeLabel(item.range)}<span className={`viral-reference-state ${item.state}`}>{stateLabels[item.state]}</span></span><span>{drafts[item.id]?.text ?? item.text}</span>{drafts[item.id] && drafts[item.id].text !== drafts[item.id].baseText ? <small>有未保存修订</small> : null}</Button>)}{!observations.length ? <p className="muted-text">当前筛选下暂无观察。请查看区间覆盖状态或切换维度。</p> : null}</div>;
}

function EvidencePreview({ evidence, api, analysisId, onSeek }: { evidence: ReferenceEvidence; api: ViralReferenceApi; analysisId: string; onSeek: (timeMs: number) => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    setUrl('');
    if (evidence.kind === 'frame') api.getViralMediaUrl(analysisId, evidence.mediaId).then((next) => { if (active) setUrl(next); }).catch(() => {});
    return () => { active = false; };
  }, [api, analysisId, evidence.mediaId, evidence.kind]);
  return <div className="viral-reference-evidence">
    {url ? <img src={url} alt={`${evidenceLabels[evidence.kind]}，${rangeLabel(evidence.range)}`} loading="lazy" /> : null}
    <Button variant="subtle" density="compact" icon={<Play size={14} />} onClick={() => onSeek(evidence.frameTimeMs ?? evidence.range.startMs)}>{evidenceLabels[evidence.kind]} · {rangeLabel(evidence.range)}</Button>
    {evidence.sampleTimesMs?.length ? <span>有序采样 {evidence.sampleTimesMs.length} 帧</span> : null}
    {evidence.measurement ? <span>测量：{({ 'scene-change': '画面变化', 'optical-flow': '光流运动', 'audio-energy': '音频能量', 'audio-transient': '瞬态', 'audio-track-absence': '无音轨', beat: '节拍候选', silence: '静音', duration: '时长' } as const)[evidence.measurement]}</span> : null}
    <small>{evidence.consumedBy.length ? `${evidence.consumedBy.length} 个分析器使用此证据` : '仅保留原始证据，尚未由分析器消费'}</small>
  </div>;
}

function rangeLabel(range: { startMs: number; endMs: number }): string { return `${referenceTimeLabel(range.startMs)} – ${referenceTimeLabel(range.endMs)}`; }
function coveragePercent(timeMs: number, durationMs: number): string { return `${(Math.min(1, Math.max(0, timeMs / durationMs)) * 100).toFixed(1)}%`; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

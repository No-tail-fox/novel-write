import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Code2, Loader2, RefreshCw, Save, SlidersHorizontal } from 'lucide-react';
import '@hyperframes/player';
import type { HyperframesPlayer } from '@hyperframes/player';
import type { ApplyMutationResult } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import {
  clampHtmlVideoMediaTrimStartDelta,
  getVisibleHtmlVideoTrackIndices,
  moveHtmlVideoClipTrack,
} from '../../shared/hyperframes';
import type {
  HtmlVideoClipInfo,
  HtmlVideoCompositionSnapshot,
  HtmlVideoCompositionSource,
  HtmlVideoLintFinding,
  TaskStatus,
} from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';

type AuthoringPanel = 'source' | 'properties' | 'lint' | 'queue';
type DragKind = 'move' | 'trim-start' | 'trim-end';

interface AuthoringClip extends HtmlVideoClipInfo {
  sourceIndex: number;
  media: boolean;
}

interface ParsedComposition {
  clips: AuthoringClip[];
  durationSec: number;
  error: string;
}

interface TimelineDrag {
  clip: AuthoringClip;
  kind: DragKind;
  startX: number;
  startY: number;
}

const panelItems: ReadonlyArray<{ key: AuthoringPanel; label: string }> = [
  { key: 'source', label: '源码' },
  { key: 'properties', label: '属性' },
  { key: 'lint', label: '检查' },
  { key: 'queue', label: '渲染队列' },
];

export function HtmlVideoAuthoringWorkspace({
  api,
  taskId,
  taskStatus,
  scenes,
  applyState,
  refreshTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  taskId: string;
  taskStatus: TaskStatus;
  scenes: readonly HtmlVideoCompositionSnapshot[];
  applyState: ApplyMutationResult;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  isBrowserPreview: boolean;
}) {
  const firstSceneIndex = scenes[0]?.index ?? 0;
  const [sceneIndex, setSceneIndex] = useState(firstSceneIndex);
  const [composition, setComposition] = useState<HtmlVideoCompositionSource | null>(null);
  const [source, setSource] = useState('');
  const [activePanel, setActivePanel] = useState<AuthoringPanel>('properties');
  const [selectedClipId, setSelectedClipId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [lintFindings, setLintFindings] = useState<HtmlVideoLintFinding[]>([]);
  const [lintPending, setLintPending] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const playerRef = useRef<HyperframesPlayer | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<TimelineDrag | null>(null);
  const sourceRequest = useRef(0);
  const sourceAction = useAsyncAction();
  const deferredSource = useDeferredValue(source);
  const parsed = useMemo(() => parseCompositionSource(deferredSource, composition?.durationSec ?? 0), [composition?.durationSec, deferredSource]);
  const selectedClip = parsed.clips.find((clip) => clip.id === selectedClipId) ?? parsed.clips[0] ?? null;
  const dirty = Boolean(composition && source !== composition.source);
  const locked = isBrowserPreview || taskStatus === 'pending' || taskStatus === 'running';
  const lintErrorCount = lintFindings.filter((finding) => finding.severity === 'error').length;
  const visibleTrackIndices = useMemo(() => getVisibleHtmlVideoTrackIndices(parsed.clips), [parsed.clips]);
  const trackRowByIndex = useMemo(
    () => new Map(visibleTrackIndices.map((trackIndex, rowIndex) => [trackIndex, rowIndex])),
    [visibleTrackIndices],
  );
  const trackCount = visibleTrackIndices.length;

  useEffect(() => {
    if (!scenes.some((scene) => scene.index === sceneIndex)) setSceneIndex(firstSceneIndex);
  }, [firstSceneIndex, sceneIndex, scenes]);

  const loadCompositionSource = useCallback(async () => {
    const request = ++sourceRequest.current;
    setLoadError('');
    setStatusMessage('');
    setComposition(null);
    setSource('');
    if (!taskId || !sceneIndex) return;
    if (isBrowserPreview) {
      setLoadError('浏览器预览不能读取任务目录内的 HTML 源码。');
      return;
    }
    try {
      const loaded = await api.getHtmlVideoCompositionSource(taskId, sceneIndex);
      if (request !== sourceRequest.current) return;
      setComposition(loaded);
      setSource(loaded.source);
      setPlayerDuration(loaded.durationSec);
    } catch (error) {
      if (request !== sourceRequest.current) return;
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [api, isBrowserPreview, sceneIndex, taskId]);

  useEffect(() => {
    void loadCompositionSource();
  }, [loadCompositionSource]);

  useEffect(() => {
    const clip = parsed.clips.find((item) => item.id === selectedClipId) ?? parsed.clips[0];
    if (clip && clip.id !== selectedClipId) setSelectedClipId(clip.id);
    if (!clip && selectedClipId) setSelectedClipId('');
  }, [parsed.clips, selectedClipId]);

  useEffect(() => {
    let disposed = false;
    if (!deferredSource.trim()) {
      setLintFindings([]);
      setLintPending(false);
      return;
    }
    setLintPending(true);
    const timer = window.setTimeout(() => {
      void api.lintHtmlVideoCompositionSource({ taskId, sceneIndex, source: deferredSource })
        .then((findings) => {
          if (!disposed) setLintFindings(findings);
        })
        .catch((error) => {
          if (!disposed) {
            setLintFindings([{ code: 'studio_lint_failed', severity: 'error', message: error instanceof Error ? error.message : String(error) }]);
          }
        })
        .finally(() => {
          if (!disposed) setLintPending(false);
        });
    }, 240);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [api, deferredSource, sceneIndex, taskId]);

  const setPlayerElement = useCallback((element: HyperframesPlayer | null) => {
    playerRef.current = element;
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ duration?: number }>).detail;
      setPlayerDuration(detail?.duration ?? player.duration ?? composition?.durationSec ?? 0);
      setPlayerTime(player.currentTime ?? 0);
    };
    const onTimeUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ currentTime?: number }>).detail;
      setPlayerTime(detail?.currentTime ?? player.currentTime ?? 0);
    };
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setLoadError(detail?.message || 'HyperFrames Player 无法加载当前场景。');
    };
    player.addEventListener('ready', onReady);
    player.addEventListener('timeupdate', onTimeUpdate);
    player.addEventListener('error', onError);
    return () => {
      player.removeEventListener('ready', onReady);
      player.removeEventListener('timeupdate', onTimeUpdate);
      player.removeEventListener('error', onError);
    };
  }, [composition]);

  const updateClip = useCallback((clip: AuthoringClip, changes: Partial<Pick<HtmlVideoClipInfo, 'startSec' | 'durationSec' | 'trackIndex' | 'mediaStartSec' | 'zIndex'>>) => {
    setSource((current) => updateCompositionClip(current, clip, changes));
    setStatusMessage('场景有未保存修改。');
  }, []);

  useEffect(() => {
    const finishDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      const timeline = timelineRef.current;
      dragRef.current = null;
      if (!drag || !timeline) return;
      const width = timeline.getBoundingClientRect().width;
      if (width <= 0) return;
      const deltaSec = snapSeconds(((event.clientX - drag.startX) / width) * parsed.durationSec);
      if (drag.kind === 'move') {
        const deltaTrack = Math.round((event.clientY - drag.startY) / 28);
        updateClip(drag.clip, {
          startSec: Math.max(0, snapSeconds(drag.clip.startSec + deltaSec)),
          trackIndex: moveHtmlVideoClipTrack(drag.clip.trackIndex, deltaTrack, visibleTrackIndices),
        });
      } else if (drag.kind === 'trim-end') {
        updateClip(drag.clip, { durationSec: Math.max(0.1, snapSeconds(drag.clip.durationSec + deltaSec)) });
      } else if (drag.clip.media) {
        const appliedDelta = clampHtmlVideoMediaTrimStartDelta(drag.clip, deltaSec);
        updateClip(drag.clip, {
          startSec: snapSeconds(drag.clip.startSec + appliedDelta),
          durationSec: snapSeconds(drag.clip.durationSec - appliedDelta),
          mediaStartSec: snapSeconds((drag.clip.mediaStartSec ?? 0) + appliedDelta),
        });
      }
    };
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [parsed.durationSec, updateClip, visibleTrackIndices]);

  function beginDrag(event: React.PointerEvent, clip: AuthoringClip, kind: DragKind) {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedClipId(clip.id);
    dragRef.current = { clip, kind, startX: event.clientX, startY: event.clientY };
  }

  function handleClipKeyDown(event: React.KeyboardEvent, clip: AuthoringClip) {
    if (locked) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' ? -0.1 : 0.1;
      updateClip(clip, { startSec: Math.max(0, snapSeconds(clip.startSec + delta)) });
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      updateClip(clip, { trackIndex: Math.max(0, clip.trackIndex + delta) });
    }
  }

  async function saveHtmlVideoCompositionSource() {
    if (!composition || locked || !dirty || lintPending || lintErrorCount) return;
    await sourceAction.run(async () => {
      setStatusMessage('');
      try {
        const result = await api.saveHtmlVideoCompositionSource({
          taskId,
          sceneIndex,
          expectedRevision: composition.revision,
          source,
        });
        applyState(result.mutation);
        setComposition(result.composition);
        setSource(result.composition.source);
        await refreshTaskDetail(taskId);
        setStatusMessage(`场景 ${sceneIndex} 已保存，修订版 ${result.composition.revision}。`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('HTML_VIDEO_SOURCE_CONFLICT')) {
          setLoadError('源码已在其他窗口更新，请重新载入后再保存。');
        }
        throw error;
      }
    }, { onError: (error) => setStatusMessage(error.message) });
  }

  const duration = Math.max(0.1, parsed.durationSec, playerDuration);
  const canSave = Boolean(composition && dirty && !locked && !lintPending && lintErrorCount === 0 && !parsed.error);

  return (
    <section className="hv-authoring-workspace" aria-label="HyperFrames 可视编排工作台">
      <header className="hv-authoring-toolbar">
        <label className="hv-authoring-scene-select">
          <span>场景</span>
          <select value={sceneIndex} onChange={(event) => setSceneIndex(Number(event.target.value))} disabled={!scenes.length}>
            {scenes.map((scene) => <option key={scene.index} value={scene.index}>场景 {String(scene.index).padStart(2, '0')}</option>)}
          </select>
        </label>
        <nav className="hv-authoring-panels" aria-label="编排工具">
          {panelItems.map((item) => (
            <button key={item.key} type="button" className={activePanel === item.key ? 'active' : ''} aria-pressed={activePanel === item.key} onClick={() => setActivePanel(item.key)}>
              {item.label}
              {item.key === 'lint' && lintErrorCount ? <span>{lintErrorCount}</span> : null}
            </button>
          ))}
        </nav>
        <button className="hv-authoring-save" type="button" onClick={saveHtmlVideoCompositionSource} disabled={!canSave} title="保存 HTML 源码">
          {sourceAction.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
          保存
        </button>
      </header>

      <div className="hv-authoring-main">
        <div className="hv-authoring-preview" data-media-canvas="html-video-authoring">
          {composition ? (
            <hyperframes-player
              key={`${composition.taskId}:${composition.sceneIndex}:${composition.revision}`}
              ref={setPlayerElement}
              src={composition.mediaUrl}
              width={composition.canvas.w}
              height={composition.canvas.h}
              controls
              muted
              aria-label={`场景 ${sceneIndex} HyperFrames 预览`}
            />
          ) : (
            <div className="hv-authoring-empty">
              {loadError ? <AlertTriangle size={20} /> : <Loader2 className="spin" size={20} />}
              <span>{loadError || '正在读取场景源码'}</span>
            </div>
          )}
          {dirty ? <span className="hv-authoring-dirty">未保存</span> : null}
        </div>

        <aside className="hv-authoring-inspector" aria-label={`${panelItems.find((item) => item.key === activePanel)?.label ?? ''}面板`}>
          {activePanel === 'source' ? (
            <div className="hv-authoring-panel hv-authoring-source-panel">
              <div className="hv-authoring-panel-title"><Code2 size={14} /><strong>HTML 源码</strong><span>rev {composition?.revision ?? '-'}</span></div>
              <textarea value={source} onChange={(event) => { setSource(event.target.value); setStatusMessage('场景有未保存修改。'); }} spellCheck={false} disabled={!composition || locked} aria-label="HTML 动画源码" />
            </div>
          ) : null}

          {activePanel === 'properties' ? (
            <div className="hv-authoring-panel">
              <div className="hv-authoring-panel-title"><SlidersHorizontal size={14} /><strong>片段属性</strong><span>{selectedClip?.tagName ?? '-'}</span></div>
              {selectedClip ? (
                <fieldset className="hv-authoring-fields" disabled={locked}>
                  <label><span>片段</span><input value={selectedClip.label} readOnly /></label>
                  <label><span>开始时间</span><input type="number" min={0} step={0.1} value={selectedClip.startSec} onChange={(event) => updateClip(selectedClip, { startSec: Math.max(0, Number(event.target.value)) })} /></label>
                  <label><span>持续时间</span><input type="number" min={0.1} step={0.1} value={selectedClip.durationSec} onChange={(event) => updateClip(selectedClip, { durationSec: Math.max(0.1, Number(event.target.value)) })} /></label>
                  <label><span>轨道</span><input type="number" min={0} step={1} value={selectedClip.trackIndex} onChange={(event) => updateClip(selectedClip, { trackIndex: Math.max(0, Math.round(Number(event.target.value))) })} /></label>
                  {selectedClip.media ? <label><span>媒体偏移</span><input type="number" min={0} step={0.1} value={selectedClip.mediaStartSec ?? 0} onChange={(event) => updateClip(selectedClip, { mediaStartSec: Math.max(0, Number(event.target.value)) })} /></label> : null}
                  <label><span>层级 z-index</span><input type="number" step={1} value={selectedClip.zIndex ?? 0} onChange={(event) => updateClip(selectedClip, { zIndex: Math.round(Number(event.target.value)) })} /></label>
                </fieldset>
              ) : <div className="hv-authoring-panel-empty">当前场景没有可编辑片段</div>}
            </div>
          ) : null}

          {activePanel === 'lint' ? (
            <div className="hv-authoring-panel">
              <div className="hv-authoring-panel-title">
                {lintPending ? <Loader2 className="spin" size={14} /> : lintErrorCount ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                <strong>官方检查</strong><span>{lintPending ? '检查中' : `${lintErrorCount} 错误`}</span>
              </div>
              <div className="hv-authoring-lint-list">
                {parsed.error ? <LintFinding finding={{ code: 'html_parse_error', severity: 'error', message: parsed.error }} /> : null}
                {lintFindings.map((finding, index) => <LintFinding key={`${finding.code}-${index}`} finding={finding} />)}
                {!lintPending && !parsed.error && lintFindings.length === 0 ? <div className="hv-authoring-lint-ok"><CheckCircle2 size={16} />通过 HyperFrames 0.7.83 检查</div> : null}
              </div>
            </div>
          ) : null}

          {activePanel === 'queue' ? (
            <div className="hv-authoring-panel">
              <div className="hv-authoring-panel-title"><RefreshCw size={14} /><strong>渲染队列</strong><span>{taskStatusLabel(taskStatus)}</span></div>
              <dl className="hv-authoring-queue">
                <div><dt>任务</dt><dd>{taskId.slice(0, 8)}</dd></div>
                <div><dt>场景</dt><dd>{sceneIndex} / {scenes.length}</dd></div>
                <div><dt>修订版</dt><dd>{composition?.revision ?? '-'}</dd></div>
                <div><dt>输出阶段</dt><dd>{dirty ? '等待保存' : '逐帧合成'}</dd></div>
              </dl>
            </div>
          ) : null}
        </aside>
      </div>

      <div className="hv-authoring-timeline" data-hyperframes-timeline>
        <div className="hv-authoring-time-ruler" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => <span key={index} style={{ left: `${index * 25}%` }}>{formatTime((duration * index) / 4)}</span>)}
        </div>
        <div className="hv-authoring-track-grid" style={{ minHeight: `${Math.max(84, trackCount * 28)}px` }}>
          <div className="hv-authoring-track-labels" aria-hidden="true">
            {visibleTrackIndices.map((trackIndex, rowIndex) => (
              <span key={trackIndex} className="hv-authoring-track-line" style={{ top: `${rowIndex * 28}px` }}>T{trackIndex}</span>
            ))}
          </div>
          <div ref={timelineRef} className="hv-authoring-track-surface">
            {parsed.clips.map((clip) => (
              <div
                key={`${clip.sourceIndex}-${clip.id}`}
                className={`hv-authoring-clip hv-authoring-clip-${clip.trackIndex % 3}${selectedClip?.id === clip.id ? ' selected' : ''}`}
                style={{
                  left: `${Math.min(100, (clip.startSec / duration) * 100)}%`,
                  top: `${(trackRowByIndex.get(clip.trackIndex) ?? 0) * 28 + 3}px`,
                  width: `${Math.max(2.5, Math.min(100 - (clip.startSec / duration) * 100, (clip.durationSec / duration) * 100))}%`,
                }}
                role="button"
                tabIndex={0}
                aria-label={`${clip.label}，开始 ${formatTime(clip.startSec)}，时长 ${formatTime(clip.durationSec)}，轨道 ${clip.trackIndex}`}
                aria-pressed={selectedClip?.id === clip.id}
                onClick={() => setSelectedClipId(clip.id)}
                onKeyDown={(event) => handleClipKeyDown(event, clip)}
                onPointerDown={(event) => beginDrag(event, clip, 'move')}
              >
                {clip.media ? <span className="hv-authoring-trim start" data-trim-edge="start" onPointerDown={(event) => beginDrag(event, clip, 'trim-start')} /> : null}
                <span className="hv-authoring-clip-label">{clip.label}</span>
                <span className="hv-authoring-trim end" data-trim-edge="end" onPointerDown={(event) => beginDrag(event, clip, 'trim-end')} />
              </div>
            ))}
          </div>
        </div>
        <footer className="hv-authoring-statusbar">
          <span>{formatTime(playerTime)} / {formatTime(duration)}</span>
          <span>{parsed.clips.length} 片段 · {trackCount} 轨道</span>
          <span className={lintErrorCount ? 'error' : ''}>{lintPending ? '检查中' : lintErrorCount ? `${lintErrorCount} 个错误` : '检查通过'}</span>
          {statusMessage ? <span role="status">{statusMessage}</span> : null}
        </footer>
      </div>
    </section>
  );
}

function LintFinding({ finding }: { finding: HtmlVideoLintFinding }) {
  return (
    <div className={`hv-authoring-lint-finding ${finding.severity}`}>
      <strong>{finding.code}</strong>
      <span>{finding.message}</span>
      {finding.fixHint ? <small>{finding.fixHint}</small> : null}
    </div>
  );
}

function parseCompositionSource(source: string, fallbackDuration: number): ParsedComposition {
  if (!source.trim()) return { clips: [], durationSec: Math.max(0.1, fallbackDuration), error: '' };
  try {
    const document = new DOMParser().parseFromString(source, 'text/html');
    const root = document.querySelector<HTMLElement>('[data-composition-id]');
    if (!root) return { clips: [], durationSec: Math.max(0.1, fallbackDuration), error: '缺少 data-composition-id 根节点。' };
    const elements = clipElements(root);
    const clips = elements.map<AuthoringClip>((element, sourceIndex) => {
      const id = element.id || element.getAttribute('data-hf-id') || `clip-${sourceIndex + 1}`;
      const text = element.getAttribute('aria-label') || element.getAttribute('alt') || element.textContent?.trim().replace(/\s+/gu, ' ').slice(0, 24);
      const startSec = finiteAttribute(element, 'data-start', 0);
      const durationSec = Math.max(0.1, finiteAttribute(element, 'data-duration', 0.1));
      const trackIndex = Math.max(0, Math.round(finiteAttribute(element, 'data-track-index', 0)));
      const mediaAttribute = element.hasAttribute('data-media-start') ? 'data-media-start' : 'data-playback-start';
      const mediaStartSec = element.hasAttribute(mediaAttribute) ? Math.max(0, finiteAttribute(element, mediaAttribute, 0)) : undefined;
      const inlineZIndex = Number(element.style.zIndex);
      return {
        id,
        tagName: element.tagName.toLowerCase(),
        label: text || id,
        startSec,
        durationSec,
        trackIndex,
        ...(mediaStartSec === undefined ? {} : { mediaStartSec }),
        ...(Number.isFinite(inlineZIndex) && element.style.zIndex ? { zIndex: inlineZIndex } : {}),
        sourceIndex,
        media: element.matches('audio, video'),
      };
    });
    const durationSec = Math.max(fallbackDuration, finiteAttribute(root, 'data-duration', 0), ...clips.map((clip) => clip.startSec + clip.durationSec), 0.1);
    return { clips, durationSec, error: '' };
  } catch (error) {
    return { clips: [], durationSec: Math.max(0.1, fallbackDuration), error: error instanceof Error ? error.message : String(error) };
  }
}

function updateCompositionClip(
  source: string,
  clip: AuthoringClip,
  changes: Partial<Pick<HtmlVideoClipInfo, 'startSec' | 'durationSec' | 'trackIndex' | 'mediaStartSec' | 'zIndex'>>,
): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  const root = document.querySelector<HTMLElement>('[data-composition-id]');
  if (!root) return source;
  const target = clipElements(root)[clip.sourceIndex];
  if (!target) return source;
  if (changes.startSec !== undefined && Number.isFinite(changes.startSec)) target.setAttribute('data-start', formatNumber(Math.max(0, changes.startSec)));
  if (changes.durationSec !== undefined && Number.isFinite(changes.durationSec)) target.setAttribute('data-duration', formatNumber(Math.max(0.1, changes.durationSec)));
  if (changes.trackIndex !== undefined && Number.isFinite(changes.trackIndex)) target.setAttribute('data-track-index', String(Math.max(0, Math.round(changes.trackIndex))));
  if (changes.mediaStartSec !== undefined && Number.isFinite(changes.mediaStartSec)) {
    const attribute = target.hasAttribute('data-playback-start') && !target.hasAttribute('data-media-start') ? 'data-playback-start' : 'data-media-start';
    target.setAttribute(attribute, formatNumber(Math.max(0, changes.mediaStartSec)));
  }
  if (changes.zIndex !== undefined && Number.isFinite(changes.zIndex)) target.style.zIndex = String(Math.round(changes.zIndex));
  const serializer = new XMLSerializer();
  if (!serializer.serializeToString(root)) return source;
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

function clipElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-start][data-duration]')).filter((element) => element !== root && element.classList.contains('clip'));
}

function finiteAttribute(element: Element, attribute: string, fallback: number): number {
  const value = Number(element.getAttribute(attribute));
  return Number.isFinite(value) ? value : fallback;
}

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function snapSeconds(value: number): number {
  return Math.round(value * 20) / 20;
}

function formatTime(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function taskStatusLabel(status: TaskStatus): string {
  return {
    draft: '草稿',
    pending: '排队中',
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

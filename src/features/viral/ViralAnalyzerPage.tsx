import { useEffect, useState } from 'react';
import { Flame, Loader2, RotateCcw, Search } from 'lucide-react';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult, ViralAnalysisEvent, ViralAnalysisResult, ViralAnalysisStatus, ViralAnalysisSummary, ViralPlatform } from '../../shared/types';
import { contentTracks, ratioOptions, styleOptions } from '../../shared/editorial-options';
import { createViralTemplateDrafts } from '../../shared/viral-template-extraction';
import { viralEventRefreshKey } from '../../shared/state-reconciliation';
import { useAsyncAction } from '../../ui/async-action';
import { taskFromMutation } from '../tasks/task-formatters';
import { ViralReport } from './ViralReport';

function viralFromMutation(result: AppMutationResult | null): ViralAnalysisSummary | null {
  return result?.kind === 'viral-upsert' ? result.record : null;
}

type ViralSourceMode = 'auto' | 'douyin' | 'kuaishou' | 'bilibili';

const viralSourceModes: ViralSourceMode[] = ['auto', 'douyin', 'kuaishou', 'bilibili'];

export function ViralAnalyzerPage({
  api,
  state,
  applyState,
  refreshViralEvents,
  onActiveAnalysisChange,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  state: AppState;
  applyState: ApplyMutationResult;
  refreshViralEvents: (analysisId: string) => Promise<void>;
  onActiveAnalysisChange: (analysisId: string) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [url, setUrl] = useState('');
  const [sourceMode, setSourceMode] = useState<ViralSourceMode>('auto');
  const [track, setTrack] = useState('ecommerce');
  const [style, setStyle] = useState('photo-real');
  const [ratio, setRatio] = useState('9:16');
  const [templateId, setTemplateId] = useState('default-portrait-9-16');
  const [keyFrameCount, setKeyFrameCount] = useState(8);
  const [cookieFilePath, setCookieFilePath] = useState(state.config.viral.cookieFilePath);
  const [selectedId, setSelectedId] = useState(state.viralAnalyses[0]?.id ?? '');
  const [result, setResult] = useState<ViralAnalysisResult | null>(null);
  const [message, setMessage] = useState('');
  const viralAction = useAsyncAction();
  const selected = state.viralAnalyses.find((item) => item.id === selectedId) ?? state.viralAnalyses[0] ?? null;
  const selectedArchived = Boolean(selected?.archivedAt);
  const selectedEvents = selected ? state.viralEvents.filter((event) => event.analysisId === selected.id) : [];
  const selectedEventRefreshKey = viralEventRefreshKey(selected);
  const detectedPlatform = detectBrowserViralPlatform(url);
  const selectedPlatformForAnalysis: ViralPlatform = sourceMode === 'auto' ? detectedPlatform : sourceMode;
  const selectedStageIndex = selected ? viralStages.indexOf(selected.currentStage) : -1;

  useEffect(() => {
    if (!selectedId && state.viralAnalyses[0]) setSelectedId(state.viralAnalyses[0].id);
  }, [selectedId, state.viralAnalyses]);

  useEffect(() => {
    if (!selected) {
      onActiveAnalysisChange('');
      return;
    }
    onActiveAnalysisChange(selected.id);
    return () => onActiveAnalysisChange('');
  }, [onActiveAnalysisChange, selected?.id]);

  useEffect(() => {
    if (selected) void refreshViralEvents(selected.id);
  }, [refreshViralEvents, selected?.id, selectedEventRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!selected || selected.status !== 'completed') {
      setResult(null);
      return;
    }
    api.getViralAnalysisResult(selected.id)
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((error) => {
        if (!cancelled) viralAction.reportError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selected?.id, selected?.status, viralAction.reportError]);

  function handleUrlChange(value: string) {
    setUrl(value);
  }

  function persistViralCookiePath(path: string) {
    const trimmed = path.trim();
    setCookieFilePath(trimmed);
    return api.saveConfig({
      config: {
        ...state.config,
        viral: {
          ...state.config.viral,
          cookieFilePath: trimmed,
        },
      },
      secretChanges: {},
    }).then(applyState);
  }

  async function saveViralCookiePath(path: string) {
    await viralAction.run(() => persistViralCookiePath(path));
  }

  async function chooseCookieFile() {
    await viralAction.run(async () => {
      const selectedPath = await api.selectCookieFile();
      if (selectedPath) await persistViralCookiePath(selectedPath);
    });
  }

  async function openDouyinLogin() {
    await viralAction.run(async () => {
      setMessage('请在打开的抖音窗口完成登录，关闭窗口后会自动保存 Cookie。');
      const loginCookiePath = await api.openViralLoginWindow();
      if (loginCookiePath) {
        setCookieFilePath(loginCookiePath);
        setMessage(`已保存 Cookie 文件：${loginCookiePath}`);
      }
    });
  }

  async function startAnalysis() {
    if (!url.trim()) {
      setMessage('请输入抖音、快手或 B 站公开视频链接');
      return;
    }
    if (selectedPlatformForAnalysis === 'unknown') {
      setMessage('未识别到平台，请选择抖音、快手或 B站。');
      return;
    }
    setMessage('');
    await viralAction.run(async () => {
      if (cookieFilePath !== state.config.viral.cookieFilePath) await persistViralCookiePath(cookieFilePath);
      const next = await api.createAndRunViralAnalysis({
        url: url.trim(),
        platform: selectedPlatformForAnalysis,
        settings: { track, style, ratio, templateId, keyFrameCount, storyboardSceneCount: 12 },
      });
      applyState(next);
      setSelectedId(viralFromMutation(next)?.id ?? '');
    });
  }

  async function createProductionTask() {
    if (!selected) return;
    await viralAction.run(async () => {
      const next = await api.createProductionTaskFromViral(selected.id, {
        track: selected.settings.track,
        style: selected.settings.style,
        ratio: selected.settings.ratio,
        templateId: selected.settings.templateId,
        storyboardSceneCount: result?.recreation.taskDefaults.storyboardSceneCount ?? 12,
      });
      applyState(next);
      const task = taskFromMutation(next);
      if (task) openTaskDetail(task.id);
    });
  }

  async function saveViralTemplates(input: { storyTemplateName: string; imageTemplateName: string }) {
    if (!result) return;
    const actionResult = await viralAction.run(async () => {
      const drafts = createViralTemplateDrafts(result, {
        storyTemplateName: input.storyTemplateName,
        imageTemplateName: input.imageTemplateName,
        track: selected.settings.track,
        style: selected.settings.style,
        draftTemplateId: selected.settings.templateId,
      });
      const next = await api.saveViralTemplates(drafts);
      applyState(next);
      setMessage('已保存故事模板和图片模板，可在提示词模板中继续编辑。');
    });
    if (!actionResult.ok && actionResult.error) throw actionResult.error;
  }

  async function retryAnalysis() {
    if (!selected || selectedArchived) return;
    await viralAction.run(async () => {
      applyState(await api.retryViralAnalysis(selected.id));
    });
  }

  async function updateAnalysisStatus(status: ViralAnalysisStatus) {
    if (!selected || selectedArchived) return;
    await viralAction.run(async () => {
      applyState(await api.updateViralAnalysisStatus(selected.id, status));
    });
  }

  const pauseAnalysis = () => updateAnalysisStatus('paused');
  const cancelAnalysis = () => updateAnalysisStatus('cancelled');
  const resumeAnalysis = () => updateAnalysisStatus('running');

  return (
    <div className="viral-analyzer-layout">
      <div className="viral-workbench">
        <section className="panel viral-input-panel" data-media-canvas="viral-source">
          <div className="panel-title-row">
            <div>
              <h2>爆款拆解</h2>
              <p>支持抖音、快手、B站链接，拆解开头、结构、结尾、爆点。</p>
            </div>
            <Flame size={20} />
          </div>
          <label className="field-label" htmlFor="viral-url-input">视频链接</label>
          <input id="viral-url-input" className="text-input viral-url-input" value={url} onChange={(event) => handleUrlChange(event.target.value)} placeholder="https://www.douyin.com/video/..." />
          <div className="segmented viral-platform-picker">
            {viralSourceModes.map((item) => (
              <button key={item} type="button" className={sourceMode === item ? 'active' : ''} onClick={() => setSourceMode(item)}>
                {viralSourceModeLabel(item)}
              </button>
            ))}
          </div>
          <p className="viral-source-status">
            {sourceMode === 'auto' ? `自动识别：${viralPlatformLabel(detectedPlatform)}` : `手动指定：${viralPlatformLabel(selectedPlatformForAnalysis)}`}
          </p>
          <button className="primary-action viral-start-action" disabled={viralAction.busy} onClick={startAnalysis}>
            {viralAction.busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            {viralAction.busy ? '拆解中' : '开始拆解'}
          </button>
          <div className="viral-settings-grid">
            <Field label="关键帧数量">
              <input
                className="text-input"
                type="number"
                min={1}
                max={40}
                step={1}
                value={keyFrameCount}
                onChange={(event) => setKeyFrameCount(normalizeViralKeyFrameCount(event.target.value))}
              />
            </Field>
            <ViralChoiceGroup title="赛道" options={contentTracks} value={track} onChange={setTrack} />
            <ViralChoiceGroup title="风格" options={styleOptions} value={style} onChange={setStyle} />
            <ViralChoiceGroup title="比例" options={ratioOptions.map((item) => [item, item, ''])} value={ratio} onChange={setRatio} compact />
            <Field label="草稿模板">
              <select className="viral-draft-template-select" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                {state.draftTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.canvas.ratio}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="viral-cookie-tools">
            <div className="settings-inline-actions">
              <button className="mini-button" type="button" disabled={viralAction.busy} onClick={openDouyinLogin}>打开抖音登录窗口</button>
              <button className="mini-button" type="button" disabled={viralAction.busy} onClick={chooseCookieFile}>选择 Cookie 文件</button>
            </div>
            <Field label="Cookie 文件">
              <div className="viral-cookie-input-row">
                <input
                  id="viral-cookie-input"
                  className="text-input"
                  value={cookieFilePath}
                  disabled={viralAction.busy}
                  onChange={(event) => setCookieFilePath(event.target.value)}
                  onBlur={() => saveViralCookiePath(cookieFilePath)}
                  placeholder="C:\\Users\\you\\Downloads\\cookies.txt"
                />
                {cookieFilePath ? <button className="mini-button" type="button" disabled={viralAction.busy} onClick={() => saveViralCookiePath('')}>清空</button> : null}
              </div>
            </Field>
            <p className="muted-text">抖音风控时先点登录窗口完成登录；关闭窗口后会自动写入本应用的 Cookie 文件。也可以手动选择 Netscape cookies.txt。</p>
          </div>
          {message ? <div className="test-result">{message}</div> : null}
          <InlineActionFeedback feedback={viralAction.feedback} />
        </section>

        <section className="panel viral-history-panel">
          <div className="panel-title-row">
            <h3>历史拆解</h3>
            <span className="panel-count">{state.viralAnalyses.length}</span>
          </div>
          <div className="viral-history-list">
            {state.viralAnalyses.map((item) => (
              <button key={item.id} title={item.title || item.url} className={selected?.id === item.id ? 'viral-history-item active' : 'viral-history-item'} onClick={() => setSelectedId(item.id)}>
                <strong>{item.title || item.url}</strong>
                <span>{viralPlatformLabel(item.platform)} · {viralStatusLabel(item.status)} · {(item.progress * 100).toFixed(0)}%</span>
              </button>
            ))}
            {state.viralAnalyses.length === 0 ? <p className="muted-text">暂无拆解任务</p> : null}
          </div>
        </section>
      </div>

      <section className="panel viral-progress-panel">
        <h3>任务进度</h3>
        <div className="viral-progress-list viral-stage-timeline">
          {viralStages.map((stage, stageIndex) => {
            const isActive = selected?.currentStage === stage;
            const isCompleted = selected?.status === 'completed' || (selectedStageIndex > stageIndex && selectedStageIndex !== -1);
            const isFailed = selected?.status === 'failed' && isActive;
            const className = ['viral-progress-step', 'viral-stage-node', isActive ? 'active' : '', isCompleted ? 'completed' : '', isFailed ? 'failed' : ''].filter(Boolean).join(' ');
            const latestEvent = latestViralEventForStage(selectedEvents, stage);
            return (
              <div key={stage} className={className}>
                <span>{viralStageLabel(stage)}</span>
                <small>{latestEvent?.detail ?? '等待中'}</small>
              </div>
            );
          })}
        </div>
        {selected?.errorMessage ? <ErrorSummaryButton title="拆解错误" fullMessage={selected.errorMessage} /> : null}
      </section>

      <section className="panel viral-report-panel viral-result-drawer">
        <div className="panel-title-row">
          <h3>拆解报告</h3>
          {!selectedArchived && selected?.status === 'running' ? <button className="mini-button" type="button" disabled={viralAction.busy} onClick={pauseAnalysis}>暂停</button> : null}
          {!selectedArchived && (selected?.status === 'pending' || selected?.status === 'running' || selected?.status === 'paused') ? <button className="mini-button" type="button" disabled={viralAction.busy} onClick={cancelAnalysis}>取消</button> : null}
          {!selectedArchived && selected?.status === 'paused' ? <button className="mini-button" type="button" disabled={viralAction.busy} onClick={resumeAnalysis}>继续</button> : null}
          {!selectedArchived && (selected?.status === 'failed' || selected?.status === 'cancelled') ? <button className="mini-button viral-retry-button" type="button" disabled={viralAction.busy} onClick={retryAnalysis}><RotateCcw size={14} />重试</button> : null}
        </div>
        {result ? <ViralReport result={result} readOnly={selectedArchived} createProductionTask={createProductionTask} saveTemplates={saveViralTemplates} /> : <p className="muted-text">任务完成后显示开头、结构、结尾、爆点和复刻方案。</p>}
      </section>
    </div>
  );
}

const viralStages = ['downloading', 'extracting', 'transcribing', 'analyzing_frames', 'breaking_down', 'recreating', 'completed'];

function latestViralEventForStage(events: ViralAnalysisEvent[], stage: string): ViralAnalysisEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.stage === stage) return event;
  }
  return null;
}

function normalizeViralKeyFrameCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8;
  return Math.min(40, Math.max(1, Math.round(parsed)));
}

function ViralChoiceGroup({
  title,
  options,
  value,
  onChange,
  compact = false,
}: {
  title: string;
  options: string[][];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={compact ? 'viral-choice-section compact' : 'viral-choice-section'}>
      <span>{title}</span>
      <div className="viral-choice-grid" role="radiogroup" aria-label={title}>
        {options.map(([id, label, hint]) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'viral-choice-button active' : 'viral-choice-button'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function viralPlatformLabel(platform: ViralPlatform): string {
  return { douyin: '抖音', kuaishou: '快手', bilibili: 'B站', unknown: '自动识别' }[platform];
}

function viralSourceModeLabel(mode: ViralSourceMode): string {
  return mode === 'auto' ? '自动识别' : viralPlatformLabel(mode);
}

function detectBrowserViralPlatform(url: string): ViralPlatform {
  const normalized = url.toLowerCase();
  if (/douyin\.com|iesdouyin\.com|amemv\.com/.test(normalized)) return 'douyin';
  if (/kuaishou\.com|gifshow\.com|kwai\.com/.test(normalized)) return 'kuaishou';
  if (/bilibili\.com|b23\.tv/.test(normalized)) return 'bilibili';
  return 'unknown';
}

function viralStatusLabel(status: ViralAnalysisStatus): string {
  return { pending: '等待', running: '运行中', paused: '暂停', completed: '已完成', failed: '失败', cancelled: '已取消' }[status];
}

function viralStageLabel(stage: string): string {
  return {
    downloading: '下载视频',
    extracting: '抽帧提音频',
    transcribing: '语音转写',
    analyzing_frames: '画面分析',
    breaking_down: '内容拆解',
    recreating: '复刻生成',
    completed: '完成',
  }[stage] ?? stage;
}

import { useEffect, useState } from 'react';
import { Flame, FolderOpen, Loader2, RotateCcw, Search } from 'lucide-react';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult, ViralAnalysisEvent, ViralAnalysisResult, ViralAnalysisStatus, ViralAnalysisSummary, ViralPlatform } from '../../shared/types';
import { contentTracks, ratioOptions, styleOptions } from '../../shared/editorial-options';
import { createViralTemplateDrafts } from '../../shared/viral-template-extraction';
import { viralEventRefreshKey } from '../../shared/state-reconciliation';
import { useAsyncAction } from '../../ui/async-action';
import { Button, SegmentedControl, SelectField, TextField } from '../../ui';
import { taskFromMutation } from '../tasks/task-formatters';
import { ViralReport } from './ViralReport';
import { ViralReferenceReport } from './ViralReferenceReport';
import { ReferenceCapabilityFields, ViralReferenceRunSettings, type ReferenceRunConfiguration } from './ViralReferenceRunSettings';

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
  const [inputKind, setInputKind] = useState<'url' | 'local'>('url');
  const [analysisMode, setAnalysisMode] = useState<'quick' | 'deep'>('deep');
  const [maxAnalysisRequests, setMaxAnalysisRequests] = useState(64);
  const [referenceVisualInput, setReferenceVisualInput] = useState<'frames' | 'video'>('frames');
  const [referenceAudioInput, setReferenceAudioInput] = useState(false);
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
    const benchmarkUrl = sessionStorage.getItem('benchmark_viral_url');
    const benchmarkPlatform = sessionStorage.getItem('benchmark_viral_platform');
    sessionStorage.removeItem('benchmark_viral_url');
    sessionStorage.removeItem('benchmark_viral_platform');
    if (!benchmarkUrl) return;
    setUrl(benchmarkUrl);
    if (benchmarkPlatform === 'douyin' || benchmarkPlatform === 'bilibili') setSourceMode(benchmarkPlatform);
    setMessage('已从对标监控带入作品链接。');
  }, []);

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
    if (!selected || selected.status !== 'completed' || selected.settings.analysisMode === 'deep') {
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
  }, [api, selected?.id, selected?.status, selected?.settings.analysisMode, viralAction.reportError]);

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
    const settings = { track, style, ratio, templateId, keyFrameCount, storyboardSceneCount: 12, analysisMode, maxAnalysisRequests, referenceVisualInput, referenceAudioInput };
    if (inputKind === 'local') {
      await viralAction.run(async () => {
        const next = await api.importLocalViralAnalysis({ settings });
        if (!next) return;
        applyState(next);
        setSelectedId(viralFromMutation(next)?.id ?? '');
        setMessage('视频已导入。确认任务后点击“开始分析”，从头到尾处理整条视频。');
      });
      return;
    }
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
        settings,
      });
      applyState(next);
      setSelectedId(viralFromMutation(next)?.id ?? '');
    });
  }

  async function createProductionTask() {
    if (!selected || result?.recreationState === 'not-requested') return;
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
    if (!result || !selected || result.recreationState === 'not-requested') return;
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
  async function analyzePrepared() {
    if (!selected || selectedArchived) return;
    await viralAction.run(async () => applyState(await api.analyzePreparedViralAnalysis(selected.id)));
  }
  const preparedLocal = selected?.status === 'paused' && selected.currentStage === 'queued';
  async function configureReferenceRun(input: ReferenceRunConfiguration) {
    const action = await viralAction.run(async () => applyState(await api.configureViralReferenceRun(input)));
    if (!action.ok) throw action.error ?? new Error('运行设置保存失败。');
  }

  return (
    <div className="viral-analyzer-layout">
      <div className="viral-workbench">
        <section className="panel viral-input-panel">
          <div className="panel-title-row">
            <div>
              <h2>爆款拆解</h2>
              <p>从头到尾拆解镜头、文案、版式、转场、动效与声音，点击证据回看原片。</p>
            </div>
            <Flame size={20} />
          </div>
          <SegmentedControl label="视频来源" value={inputKind} onChange={(value) => { setInputKind(value); if (value === 'local') setAnalysisMode('deep'); }} options={[{ value: 'url', label: '视频链接' }, { value: 'local', label: '本地视频' }]} />
          {inputKind === 'url' ? <>
          <TextField label="视频链接" id="viral-url-input" className="viral-url-input" value={url} onChange={(event) => handleUrlChange(event.target.value)} placeholder="https://www.douyin.com/video/..." />
          <SegmentedControl className="viral-platform-picker" label="视频平台" value={sourceMode} onChange={setSourceMode} options={viralSourceModes.map((item) => ({ value: item, label: viralSourceModeLabel(item) }))} />
          <p className="viral-source-status">
            {sourceMode === 'auto' ? `自动识别：${viralPlatformLabel(detectedPlatform)}` : `手动指定：${viralPlatformLabel(selectedPlatformForAnalysis)}`}
          </p></> : <p className="muted-text">选择文件后保存到应用素材目录；导入完成后再开始分析。</p>}
          <SegmentedControl className="viral-analysis-mode" label="拆解方式" value={analysisMode} onChange={setAnalysisMode} options={[{ value: 'deep', label: '整体拆解' }, { value: 'quick', label: '快速概览', disabled: inputKind === 'local' }]} />
          <p className="viral-source-status">{analysisMode === 'deep' ? '覆盖完整视频。报告分别显示本地扫描、各维度分析和待复核区间；达到调用上限时保留部分结果。' : '抽取关键帧与文案，快速了解内容结构；不代表全片所有镜头均已分析。'}</p>
          <Button variant="primary" className="viral-start-action" disabled={viralAction.busy || (inputKind === 'local' && isBrowserPreview)} onClick={startAnalysis} icon={viralAction.busy ? <Loader2 className="spin" size={16} /> : inputKind === 'local' ? <FolderOpen size={16} /> : <Search size={16} />}>
            {viralAction.busy ? '处理中' : inputKind === 'local' ? '选择并导入视频' : '开始拆解'}
          </Button>
          {inputKind === 'local' && isBrowserPreview ? <p className="muted-text">本地视频导入请在桌面应用中使用。</p> : null}
          <div className="viral-settings-grid">
            {analysisMode === 'deep' ? <TextField label="本次模型调用上限" type="number" min={1} max={10000} step={1} value={String(maxAnalysisRequests)} onChange={(event) => setMaxAnalysisRequests(Math.min(10000, Math.max(1, Math.round(Number(event.target.value) || 64))))} hint="跨批次累计；不限制原片时长。实际费用由所选服务计价。" /> : <TextField label="关键帧数量"
                type="number"
                min={1}
                max={40}
                step={1}
                value={String(keyFrameCount)}
                onChange={(event) => setKeyFrameCount(normalizeViralKeyFrameCount(event.target.value))}
              />}
            {analysisMode === 'quick' ? <>
            <ViralChoiceGroup title="赛道" options={contentTracks} value={track} onChange={setTrack} />
            <ViralChoiceGroup title="风格" options={styleOptions} value={style} onChange={setStyle} />
            <ViralChoiceGroup title="比例" options={ratioOptions.map((item) => [item, item, ''])} value={ratio} onChange={setRatio} compact />
            <SelectField label="草稿模板" className="viral-draft-template-select" value={templateId} onChange={(event) => setTemplateId(event.target.value)} options={state.draftTemplates.map((template) => ({ value: template.id, label: `${template.name} · ${template.canvas.ratio}` }))} />
            </> : null}
          </div>
          {analysisMode === 'deep' ? <ReferenceCapabilityFields visualInput={referenceVisualInput} audioInput={referenceAudioInput} onVisualChange={setReferenceVisualInput} onAudioChange={setReferenceAudioInput} disabled={viralAction.busy} /> : null}
          {inputKind === 'url' ? <div className="viral-cookie-tools">
            <div className="settings-inline-actions">
              <Button density="compact" disabled={viralAction.busy} onClick={openDouyinLogin}>打开抖音登录窗口</Button>
              <Button density="compact" disabled={viralAction.busy} onClick={chooseCookieFile}>选择 Cookie 文件</Button>
            </div>
              <div className="viral-cookie-input-row">
                <TextField label="Cookie 文件"
                  id="viral-cookie-input"
                  value={cookieFilePath}
                  disabled={viralAction.busy}
                  onChange={(event) => setCookieFilePath(event.target.value)}
                  onBlur={() => saveViralCookiePath(cookieFilePath)}
                  placeholder="C:\\Users\\you\\Downloads\\cookies.txt"
                />
                {cookieFilePath ? <Button density="compact" disabled={viralAction.busy} onClick={() => saveViralCookiePath('')}>清空</Button> : null}
              </div>
            <p className="muted-text">抖音风控时先点登录窗口完成登录；关闭窗口后会自动写入本应用的 Cookie 文件。也可以手动选择 Netscape cookies.txt。</p>
          </div> : null}
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
              <Button key={item.id} variant="subtle" aria-pressed={selected?.id === item.id} title={item.title || item.url} className={selected?.id === item.id ? 'viral-history-item active' : 'viral-history-item'} onClick={() => setSelectedId(item.id)}>
                <strong>{item.title || item.url}</strong>
                <span>{!item.url ? '本地视频' : viralPlatformLabel(item.platform)} · {viralStatusLabel(item.status)} · {(item.progress * 100).toFixed(0)}%</span>
              </Button>
            ))}
            {state.viralAnalyses.length === 0 ? <p className="muted-text">暂无拆解任务</p> : null}
          </div>
        </section>
      </div>

      <section className="panel viral-progress-panel">
        <h3>任务进度</h3>
        <div className="viral-progress-list viral-stage-timeline">
          {viralStages.filter((stage) => selected?.settings.analysisMode !== 'deep' || !['recreating', 'transcribing'].includes(stage)).map((stage) => {
            const stageIndex = viralStages.indexOf(stage);
            const isActive = selected?.currentStage === stage;
            const isCompleted = selected?.status === 'completed' || (selectedStageIndex > stageIndex && selectedStageIndex !== -1);
            const isFailed = selected?.status === 'failed' && isActive;
            const className = ['viral-progress-step', 'viral-stage-node', isActive ? 'active' : '', isCompleted ? 'completed' : '', isFailed ? 'failed' : ''].filter(Boolean).join(' ');
            const latestEvent = latestViralEventForStage(selectedEvents, stage);
            return (
              <div key={stage} className={className}>
                <span>{selected?.settings.analysisMode === 'deep' ? ({ downloading: '来源准备', extracting: '全片扫描', analyzing_frames: '视听分段分析', breaking_down: '全片汇总', completed: '报告就绪' } as Record<string, string>)[stage] ?? viralStageLabel(stage) : viralStageLabel(stage)}</span>
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
          {!selectedArchived && selected?.status === 'running' ? <Button density="compact" disabled={viralAction.busy} onClick={pauseAnalysis}>暂停</Button> : null}
          {!selectedArchived && (selected?.status === 'pending' || selected?.status === 'running' || selected?.status === 'paused') ? <Button density="compact" disabled={viralAction.busy} onClick={cancelAnalysis}>取消</Button> : null}
          {!selectedArchived && selected?.status === 'paused' ? <Button density="compact" variant={preparedLocal ? 'primary' : 'secondary'} disabled={viralAction.busy} onClick={preparedLocal ? analyzePrepared : resumeAnalysis}>{preparedLocal ? '开始分析' : '继续'}</Button> : null}
          {!selectedArchived && selected?.settings.analysisMode !== 'deep' && (selected?.status === 'failed' || selected?.status === 'cancelled') ? <Button density="compact" className="viral-retry-button" disabled={viralAction.busy} onClick={retryAnalysis} icon={<RotateCcw size={14} />}>重试</Button> : null}
        </div>
        {selected?.settings.analysisMode === 'deep' && !selectedArchived && ['paused', 'failed', 'cancelled'].includes(selected.status) ? <ViralReferenceRunSettings key={selected.id} analysisId={selected.id} settings={selected.settings} busy={viralAction.busy} onConfigure={configureReferenceRun} /> : null}
        {selected?.settings.analysisMode === 'deep' ? <ViralReferenceReport key={selected.id} api={api} analysisId={selected.id} readOnly={selectedArchived} refreshKey={selectedEventRefreshKey} /> : result ? <ViralReport result={result} readOnly={selectedArchived} createProductionTask={createProductionTask} saveTemplates={saveViralTemplates} /> : <p className="muted-text">选择视频开始拆解。整体拆解会按区间逐步显示结果，无需等待全片完成。</p>}
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
          <Button key={id} variant="subtle" type="button" role="radio" aria-checked={value === id} className={value === id ? 'viral-choice-button active' : 'viral-choice-button'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </Button>
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

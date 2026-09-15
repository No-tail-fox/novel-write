import { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, FolderOpen, ImagePlus, Loader2, RefreshCw, RotateCcw, Settings2, Trash2, Wand2 } from 'lucide-react';
import type { RendererAppState } from '../../app/route-types';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { VIDEO_LAB_RATIOS, type VideoLabGenerateInput, type VideoLabRecord } from '../../shared/video-lab';
import { Button, IconButton, SelectField, TextAreaField, TextField } from '../../ui';
import { formatDate, toLocalAssetUrl, toLocalImageUrl } from '../tasks/task-formatters';
import { videoLabInput, videoLabInputIssue, videoLabProviderIssue, videoLabRecordDraft, videoLabReferences, type VideoLabDraft } from './video-lab-helpers';
import '../../styles/features/local-labs.css';
import './video-lab.css';

const statusLabels = { running: '生成中', completed: '已完成', failed: '生成失败' } as const;

export function VideoLabPage({ api, state, openSettings }: {
  api: StoryDreamApi;
  state: RendererAppState;
  openSettings?: () => void;
}) {
  const [draft, setDraft] = useState<VideoLabDraft>(() => ({
    prompt: '',
    providerId: state.config.video.activeProviderId || state.config.video.providers[0]?.id || '',
    durationSec: 5,
    ratio: '16:9',
    firstFramePath: '',
    lastFramePath: '',
    referenceImagePaths: '',
  }));
  const [records, setRecords] = useState<VideoLabRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [pickingImage, setPickingImage] = useState(false);
  const [openingDirectory, setOpeningDirectory] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const generationLock = useRef(false);
  const imagePickerLock = useRef(false);
  const historyRequest = useRef(0);
  const provider = state.config.video.providers.find((item) => item.id === draft.providerId);
  const providerIssue = videoLabProviderIssue(provider, state.secretStatus);
  const inputIssue = videoLabInputIssue(draft, provider, state.config.video.automation.budgetLimit);
  const references = videoLabReferences(draft.referenceImagePaths);
  const generationBusy = generating || records.some((record) => record.status === 'running');
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0];
  const supportsFirstFrame = provider?.capabilities.includes('i2v') ?? false;
  const supportsLastFrame = provider?.capabilities.includes('first-last-frame') ?? false;
  const supportsReferences = provider?.capabilities.includes('reference-image') ?? false;
  const estimatedCost = Math.max(0, (provider?.pricePerSecond ?? 0) * draft.durationSec);

  useWorkspaceDraft({
    id: 'video-lab-input', label: '视频生成草稿', value: { ...draft },
    restore: (restored) => setDraft({
      ...restored,
      providerId: state.config.video.providers.some((item) => item.id === restored.providerId)
        ? restored.providerId : state.config.video.activeProviderId || state.config.video.providers[0]?.id || '',
    }), busy: generating,
  });

  const refreshHistory = useCallback(async (showLoading = false) => {
    const requestId = ++historyRequest.current;
    if (showLoading) setHistoryLoading(true);
    try {
      const next = await api.listVideoLabRecords();
      if (!mounted.current || requestId !== historyRequest.current) return;
      setRecords(next);
      setHistoryError('');
    } catch (error) {
      if (mounted.current && requestId === historyRequest.current) setHistoryError(errorMessage(error));
    } finally {
      if (mounted.current && requestId === historyRequest.current) setHistoryLoading(false);
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void refreshHistory();
    const onFocus = () => { void refreshHistory(); };
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      historyRequest.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (!generationBusy) return;
    const timer = window.setInterval(() => { void refreshHistory(); }, 3000);
    return () => window.clearInterval(timer);
  }, [generationBusy, refreshHistory]);

  useEffect(() => { setPlaybackError(''); }, [selectedRecord?.id, selectedRecord?.videoPath]);

  function updateDraft(patch: Partial<VideoLabDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice('');
  }

  async function selectReferenceImage(kind: 'first' | 'last' | 'reference') {
    if (imagePickerLock.current) return;
    imagePickerLock.current = true;
    setPickingImage(true);
    setSubmitError('');
    try {
      const path = await api.selectLocalImage();
      if (!path || !mounted.current) return;
      setDraft((current) => kind === 'first' ? { ...current, firstFramePath: path }
        : kind === 'last' ? { ...current, lastFramePath: path }
          : { ...current, referenceImagePaths: Array.from(new Set([...videoLabReferences(current.referenceImagePaths), path])).slice(0, 8).join('\n') });
    } catch (error) {
      if (mounted.current) setSubmitError(errorMessage(error));
    } finally {
      imagePickerLock.current = false;
      if (mounted.current) setPickingImage(false);
    }
  }

  async function runGeneration(input: VideoLabGenerateInput) {
    if (generationLock.current || generationBusy) return;
    generationLock.current = true;
    setGenerating(true);
    setSubmitError('');
    setNotice('');
    try {
      const record = await api.generateVideoLab(input);
      if (!mounted.current) return;
      // Ignore a history read that started before this authoritative result arrived.
      historyRequest.current += 1;
      setHistoryLoading(false);
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setSelectedRecordId(record.id);
      if (record.status === 'failed') setSubmitError(record.errorMessage || '视频生成失败，请查看记录并重试。');
      else if (record.status === 'completed') setNotice('视频已生成，可在右侧预览或打开文件目录。');
    } catch (error) {
      if (mounted.current) setSubmitError(errorMessage(error));
    } finally {
      generationLock.current = false;
      if (mounted.current) {
        setGenerating(false);
        void refreshHistory();
      }
    }
  }

  async function generateVideo() {
    if (providerIssue || inputIssue || pickingImage) return;
    await runGeneration(videoLabInput(draft));
  }

  function reuseRecord(record: VideoLabRecord) {
    setDraft(videoLabRecordDraft(record));
    setSubmitError('');
    setNotice('已回填提示词、生成参数和参考图。');
  }

  async function retryRecord(record: VideoLabRecord) {
    const retryDraft = videoLabRecordDraft(record);
    const retryProvider = state.config.video.providers.find((item) => item.id === record.providerId);
    const issue = videoLabProviderIssue(retryProvider, state.secretStatus)
      || videoLabInputIssue(retryDraft, retryProvider, state.config.video.automation.budgetLimit);
    if (issue) {
      setSubmitError(issue);
      return;
    }
    await runGeneration(videoLabInput(retryDraft));
  }

  async function openOutputDirectory(record: VideoLabRecord) {
    setOpeningDirectory(true);
    setSubmitError('');
    try { await api.openVideoLabOutputDirectory(record.id); }
    catch (error) { if (mounted.current) setSubmitError(errorMessage(error)); }
    finally { if (mounted.current) setOpeningDirectory(false); }
  }

  return (
    <div className="local-lab-workbench video-lab-page" data-local-lab-workbench="video-lab">
      <section className="video-lab-editor" aria-label="视频生成参数">
        <div className="video-lab-heading"><h2>视频生成</h2><span>提示词与参考图生成独立视频片段</span></div>
        <SelectField label="视频服务" value={draft.providerId} onChange={(_, data) => updateDraft({ providerId: data.value })} options={[
          ...(!provider ? [{ value: draft.providerId, label: draft.providerId ? '所选服务已移除，请重新选择' : '请选择视频服务' }] : []),
          ...state.config.video.providers.map((item) => ({ value: item.id, label: `${item.name || '未命名服务'}${item.enabled ? '' : '（未启用）'}` })),
        ]} hint={provider?.model || '在系统设置中配置视频模型'} />
        {providerIssue ? <div className="video-lab-provider-notice" role="status"><span>{providerIssue}</span>{openSettings ? <Button density="compact" icon={<Settings2 size={15} />} onClick={openSettings}>配置视频服务</Button> : null}</div>
          : openSettings ? <Button className="video-lab-settings" variant="subtle" density="compact" icon={<Settings2 size={14} />} onClick={openSettings}>视频服务设置</Button> : null}
        <TextAreaField label="视频描述" rows={7} resize="vertical" value={draft.prompt} maxLength={65_536} placeholder="描述主体、场景、动作、镜头运动和画面风格" onChange={(_, data) => updateDraft({ prompt: data.value })} />
        <div className="video-lab-parameters">
          <TextField label="时长（秒）" type="number" min={1} max={Math.min(600, provider?.maxDurationSec ?? 600)} step={1} value={String(draft.durationSec)} onChange={(_, data) => updateDraft({ durationSec: Number(data.value) })} hint={provider ? `最长 ${provider.maxDurationSec} 秒` : undefined} />
          <SelectField label="画面比例" value={draft.ratio} options={VIDEO_LAB_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))} onChange={(_, data) => updateDraft({ ratio: data.value })} />
        </div>
        {(supportsFirstFrame || supportsLastFrame || draft.firstFramePath || draft.lastFramePath) ? <section className="video-lab-image-section" aria-label="首尾帧">
          <div className="video-lab-section-heading"><h3>首尾帧</h3><span>可选</span></div>
          <div className="video-lab-frame-grid">
            {(supportsFirstFrame || draft.firstFramePath) ? <VideoFrame label="首帧" path={draft.firstFramePath} disabled={pickingImage || !supportsFirstFrame} onSelect={() => { void selectReferenceImage('first'); }} onRemove={() => updateDraft({ firstFramePath: '' })} /> : null}
            {(supportsLastFrame || draft.lastFramePath) ? <VideoFrame label="尾帧" path={draft.lastFramePath} disabled={pickingImage || !supportsLastFrame} onSelect={() => { void selectReferenceImage('last'); }} onRemove={() => updateDraft({ lastFramePath: '' })} /> : null}
          </div>
        </section> : null}
        {(supportsReferences || references.length > 0) ? <section className="video-lab-image-section" aria-label="视频参考图">
          <div className="video-lab-section-heading"><h3>参考图</h3><span>{references.length} / 8 张</span><Button density="compact" icon={<ImagePlus size={14} />} disabled={pickingImage || !supportsReferences || references.length >= 8} onClick={() => { void selectReferenceImage('reference'); }}>添加参考图</Button></div>
          {references.length ? <div className="video-lab-reference-grid">{references.map((path, index) => <div className="video-lab-reference" key={path}>
            <img src={toLocalImageUrl(path)} alt={`视频参考图 ${index + 1}`} title={path} />
            <IconButton label={`移除参考图 ${index + 1}`} icon={<Trash2 size={14} />} onClick={() => updateDraft({ referenceImagePaths: references.filter((item) => item !== path).join('\n') })} />
          </div>)}</div> : <p className="video-lab-muted">添加角色、物体或风格参考。</p>}
        </section> : null}
        <div className="video-lab-submit">
          {provider && Number.isFinite(estimatedCost) ? <p className="video-lab-muted">{provider.pricePerSecond > 0 ? `预计费用 ${estimatedCost.toFixed(2)}（按服务设置单价）` : '服务尚未设置单价，实际费用以供应商账单为准。'}</p> : null}
          {inputIssue && !providerIssue && draft.prompt.trim() ? <p className="video-lab-validation" role="status">{inputIssue}</p> : null}
          <Button variant="primary" icon={generationBusy ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} />} disabled={generationBusy || pickingImage || historyLoading || Boolean(providerIssue || inputIssue)} onClick={() => { void generateVideo(); }}>{generationBusy ? '视频生成中' : '生成视频'}</Button>
          {generationBusy ? <p className="video-lab-muted" role="status">正在等待视频服务处理，生成记录会自动更新。</p> : null}
          {submitError ? <p className="video-lab-error" role="alert">{submitError}</p> : null}
          {notice ? <p className="video-lab-notice" role="status">{notice}</p> : null}
        </div>
      </section>

      <section className="video-lab-results" aria-label="视频生成结果">
        <div className="video-lab-section-heading"><h3>视频预览</h3>{selectedRecord ? <span className={`video-lab-status ${selectedRecord.status}`}>{statusLabels[selectedRecord.status]}</span> : null}</div>
        <div className="video-lab-preview">
          {selectedRecord?.videoPath ? <video key={`${selectedRecord.id}:${selectedRecord.videoPath}`} data-media-canvas="video-lab" controls preload="metadata" src={toLocalAssetUrl(selectedRecord.videoPath)} onError={() => setPlaybackError('无法播放此视频，可打开文件目录检查文件。')} /> : <div className="video-lab-preview-empty" data-media-canvas="video-lab">
            {selectedRecord?.status === 'running' || generating ? <Loader2 size={30} className="spin" /> : <Clapperboard size={32} />}
            <strong>{selectedRecord ? statusLabels[selectedRecord.status] : historyLoading ? '正在读取生成记录' : '生成后在这里预览视频'}</strong>
            <span>{selectedRecord?.status === 'failed' ? '查看错误后可按原参数重试。' : '支持播放本地视频和打开输出目录。'}</span>
          </div>}
        </div>
        {playbackError ? <p className="video-lab-error" role="alert">{playbackError}</p> : null}
        {selectedRecord ? <div className="video-lab-record-detail">
          <p className="video-lab-record-prompt">{selectedRecord.prompt}</p>
          <p className="video-lab-muted">{selectedRecord.providerName} · {selectedRecord.model} · {selectedRecord.durationSec} 秒 · {selectedRecord.ratio} · {formatDate(selectedRecord.createdAt)}</p>
          {selectedRecord.errorMessage ? <p className="video-lab-error" role="alert">{selectedRecord.errorMessage}</p> : null}
          <div className="video-lab-record-actions">
            <Button density="compact" icon={<RotateCcw size={14} />} onClick={() => reuseRecord(selectedRecord)}>回填参数</Button>
            {selectedRecord.status === 'failed' ? <Button density="compact" disabled={generationBusy || pickingImage} icon={<RefreshCw size={14} />} onClick={() => { void retryRecord(selectedRecord); }}>按原参数重试</Button> : null}
            <Button density="compact" disabled={!selectedRecord.videoPath || openingDirectory} icon={<FolderOpen size={14} />} onClick={() => { void openOutputDirectory(selectedRecord); }}>打开目录</Button>
          </div>
        </div> : null}
        <section className="video-lab-history" aria-label="视频生成记录" data-video-lab-history>
          <div className="video-lab-section-heading"><h3>生成记录 · {records.length}</h3><Button density="compact" variant="subtle" icon={<RefreshCw size={14} className={historyLoading ? 'spin' : ''} />} disabled={historyLoading} onClick={() => { void refreshHistory(true); }}>刷新记录</Button></div>
          {historyError ? <p className="video-lab-error" role="alert">读取记录失败：{historyError}</p> : null}
          {!records.length && !historyLoading ? <p className="video-lab-empty-history">暂无视频生成记录。填写提示词并选择服务后开始生成。</p> : null}
          <div className="video-lab-history-list">{records.map((record) => <Button key={record.id} className="video-lab-history-item" variant="subtle" aria-pressed={selectedRecord?.id === record.id} onClick={() => setSelectedRecordId(record.id)}>
            <span className="video-lab-history-line"><strong>{record.prompt}</strong><span className={`video-lab-status ${record.status}`}>{statusLabels[record.status]}</span></span>
            <span className="video-lab-muted">{record.providerName} · {record.durationSec} 秒 · {record.ratio} · {formatDate(record.createdAt)}</span>
          </Button>)}</div>
        </section>
      </section>
    </div>
  );
}

function VideoFrame({ label, path, disabled, onSelect, onRemove }: { label: string; path: string; disabled: boolean; onSelect: () => void; onRemove: () => void }) {
  return <div className="video-lab-frame">
    {path ? <img src={toLocalImageUrl(path)} alt={`${label}参考图`} title={path} /> : <div className="video-lab-frame-empty"><ImagePlus size={23} /><span>选择{label}</span></div>}
    <div className="video-lab-frame-actions"><Button density="compact" variant="subtle" disabled={disabled} onClick={onSelect}>{path ? `更换${label}` : `选择${label}`}</Button>{path ? <IconButton label={`移除${label}`} icon={<Trash2 size={14} />} onClick={onRemove} /> : null}</div>
  </div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

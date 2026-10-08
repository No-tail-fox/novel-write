import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Clapperboard, FolderOpen, ImagePlus, Loader2, RefreshCw, RotateCcw, Settings2, Trash2, Users, Video, Wand2 } from 'lucide-react';
import type { RendererAppState } from '../../app/route-types';
import { useWorkspaceDraft } from '../../app/workspace-draft';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { isRemoteVideoReference, VIDEO_LAB_RATIOS, type VideoLabGenerateInput, type VideoLabRecord, type VideoReferenceKind } from '../../shared/video-lab';
import { VIDEO_MODEL_PRESETS, videoModelLimits, videoModelPreset, videoReferenceToken, type VideoModelPreset } from '../../shared/video-models';
import { createVideoModelProfile } from '../../shared/video-model-presets';
import { VideoLabPersonPicker } from './VideoLabPersonPicker';
import { Button, CheckboxField, IconButton, SegmentedControl, SelectField, TextAreaField, TextField } from '../../ui';
import { formatDate, toLocalAssetUrl } from '../tasks/task-formatters';
import { normalizeVideoLabDraft, videoLabInput, videoLabInputIssue, videoLabProviderIssue, videoLabRecordDraft, videoLabResolutionOptions, type VideoLabDraft } from './video-lab-helpers';
import '../../styles/features/local-labs.css';
import './video-lab.css';

const statusLabels = { running: '生成中', completed: '已完成', failed: '生成失败' } as const;
const referenceKindOptions: Array<{ value: VideoReferenceKind; label: string }> = [
  { value: 'character', label: '人物' }, { value: 'scene', label: '场景' }, { value: 'object', label: '物体' },
  { value: 'style', label: '风格' }, { value: 'opening', label: '开场画面' }, { value: 'transition', label: '中段画面' }, { value: 'ending', label: '结尾画面' },
];

export function VideoLabPage({ api, state, openSettings }: {
  api: StoryDreamApi;
  state: RendererAppState;
  openSettings?: (preset?: VideoModelPreset) => void;
}) {
  const [draft, setDraft] = useState<VideoLabDraft>(() => {
    const providerId = state.config.video.activeProviderId || state.config.video.providers[0]?.id || '';
    const initialProvider = state.config.video.providers.find((item) => item.id === providerId);
    return {
      mode: 'text', prompt: '', providerId, modelPreset: videoModelPreset(initialProvider ?? { model: '' }), durationSec: 5, ratio: '16:9',
      resolution: videoLabResolutionOptions(initialProvider?.model ?? '', initialProvider?.maxResolution ?? '720P')[0] ?? '720P',
      generateAudio: true, firstFramePath: '', lastFramePath: '', referenceImages: [], referenceVideoPaths: [], referenceAudioPaths: [],
    };
  });
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
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [remoteReference, setRemoteReference] = useState('');
  const [remoteKind, setRemoteKind] = useState<'image' | 'video' | 'audio'>('video');
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const mounted = useRef(false);
  const generationLock = useRef(false);
  const imagePickerLock = useRef(false);
  const historyRequest = useRef(0);
  const selectedPreset = draft.modelPreset ?? 'custom';
  const modelLabel = VIDEO_MODEL_PRESETS.find((item) => item.id === selectedPreset)?.label ?? '自定义模型';
  const matchingProviders = state.config.video.providers.filter((item) => videoModelPreset(item) === selectedPreset);
  const provider = matchingProviders.find((item) => item.id === draft.providerId) ?? matchingProviders[0];
  const modelProfile = provider ?? createVideoModelProfile(selectedPreset, 'preview');
  const providerIssue = !provider ? `尚未配置 ${modelLabel} 服务，可先准备描述和参考素材。` : videoLabProviderIssue(provider, state.secretStatus);
  const inputIssue = videoLabInputIssue(draft, provider ?? modelProfile, state.config.video.automation.budgetLimit);
  const references = draft.referenceImages;
  const generationBusy = generating || records.some((record) => record.status === 'running');
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0];
  const supportsFirstFrame = modelProfile.capabilities.includes('i2v');
  const supportsLastFrame = modelProfile.capabilities.includes('first-last-frame');
  const supportsReferences = modelProfile.capabilities.includes('reference-image');
  const supportsReferenceVideo = modelProfile.capabilities.includes('reference-video');
  const supportsReferenceAudio = modelProfile.capabilities.includes('reference-audio');
  const referenceLimits = videoModelLimits(modelProfile);
  const modelFamily = referenceLimits.family;
  const resolutionOptions = referenceLimits.resolutions;
  const framesAdaptive = draft.mode === 'frames' && (modelFamily === 'h3' || selectedPreset === 'seedance-2.5');
  const referenceToken = (type: 'Image' | 'Video' | 'Audio', index: number) => videoReferenceToken(modelProfile, type, index);
  const estimatedCost = Math.max(0, (provider?.pricePerSecond ?? 0) * draft.durationSec);
  const frameSupportLabel = supportsFirstFrame && supportsLastFrame
    ? '当前服务支持首帧和尾帧'
    : supportsFirstFrame ? '可上传尾帧；当前服务尚未声明尾帧支持'
      : '可先上传；当前服务尚未声明首尾帧支持';
  const supportedReferenceLabels = [
    supportsReferences ? '图片' : '',
    supportsReferenceVideo ? '视频' : '',
    supportsReferenceAudio ? '音频' : '',
  ].filter(Boolean);
  const referenceSupportLabel = supportedReferenceLabels.length
    ? `当前服务支持参考${supportedReferenceLabels.join('、')}`
    : '可先上传；当前服务尚未声明多模态参考支持';

  useWorkspaceDraft({
    id: 'video-lab-input', label: '视频生成草稿', value: {
      mode: draft.mode, prompt: draft.prompt, providerId: draft.providerId, modelPreset: selectedPreset, durationSec: draft.durationSec,
      referenceImagePaths: '',
      ratio: draft.ratio, resolution: draft.resolution, generateAudio: draft.generateAudio,
      firstFramePath: draft.firstFramePath, lastFramePath: draft.lastFramePath,
      referenceImagesJson: JSON.stringify(draft.referenceImages),
      referenceVideoPathsJson: JSON.stringify(draft.referenceVideoPaths),
      referenceAudioPathsJson: JSON.stringify(draft.referenceAudioPaths),
    },
    restore: (restored) => setDraft({
      ...normalizeVideoLabDraft({
        ...restored,
        referenceImages: restored.referenceImagesJson && restored.referenceImagesJson !== '[]' ? parseReferenceImages(restored.referenceImagesJson) : restored.referenceImagePaths ? undefined : [],
        referenceVideoPaths: parseStringArray(restored.referenceVideoPathsJson),
        referenceAudioPaths: parseStringArray(restored.referenceAudioPathsJson),
      }),
      providerId: state.config.video.providers.some((item) => item.id === restored.providerId)
        ? restored.providerId : state.config.video.activeProviderId || state.config.video.providers[0]?.id || '',
      modelPreset: VIDEO_MODEL_PRESETS.some((item) => item.id === restored.modelPreset) ? restored.modelPreset as VideoModelPreset : videoModelPreset(state.config.video.providers.find((item) => item.id === restored.providerId) ?? { model: '' }),
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

  const localPreviewPaths = Array.from(new Set([
    draft.firstFramePath,
    draft.lastFramePath,
    ...references.map((reference) => reference.path),
  ].filter((path) => isLocalImagePath(path))));
  const localPreviewKey = JSON.stringify(localPreviewPaths);
  useEffect(() => {
    let active = true;
    const expectedPaths = new Set(localPreviewPaths);
    setImagePreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => expectedPaths.has(path))));
    void Promise.all(localPreviewPaths.map(async (path) => {
      try { return [path, await api.readAssetDataUrl(path)] as const; }
      catch { return [path, ''] as const; }
    })).then((entries) => {
      if (active) setImagePreviewUrls(Object.fromEntries(entries));
    });
    return () => { active = false; };
  }, [api, localPreviewKey]);

  useEffect(() => {
    if (!resolutionOptions.includes(draft.resolution)) {
      setDraft((current) => ({ ...current, resolution: resolutionOptions[0] ?? '720P' }));
    }
  }, [draft.resolution, provider?.id, resolutionOptions.join('|')]);

  useEffect(() => {
    if (modelFamily === 'h3' && !draft.generateAudio) setDraft((current) => ({ ...current, generateAudio: true }));
  }, [modelFamily, draft.generateAudio]);

  function chooseModel(modelPreset: VideoModelPreset) {
    const next = state.config.video.providers.find((item) => videoModelPreset(item) === modelPreset);
    const limits = videoModelLimits(next ?? createVideoModelProfile(modelPreset, 'preview'));
    updateDraft({ modelPreset, providerId: next?.id ?? '', resolution: limits.resolutions.includes(draft.resolution) ? draft.resolution : limits.resolutions[0],
      durationSec: Math.min(limits.maxDuration, Math.max(limits.minDuration, Math.round(draft.durationSec) || 5)),
      generateAudio: limits.family === 'h3' ? true : draft.generateAudio });
  }

  function appendPrompt(value: string) { updateDraft({ prompt: `${draft.prompt}${draft.prompt.trim() ? '\n' : ''}${value}` }); }

  function addRemoteReference() {
    const path = remoteReference.trim();
    if (!isRemoteVideoReference(path)) { setSubmitError('请输入有效的 HTTPS 素材地址、asset:// 或 mm_file:// 素材 ID。'); return; }
    if (remoteKind === 'image') {
      if (references.length >= referenceLimits.images || references.some((item) => item.path === path)) return;
      updateDraft({ referenceImages: [...references, { path, kind: 'character', description: '' }] });
    } else {
      const key = remoteKind === 'video' ? 'referenceVideoPaths' : 'referenceAudioPaths';
      if (draft[key].length >= (remoteKind === 'video' ? referenceLimits.videos : referenceLimits.audio)) return;
      updateDraft({ [key]: Array.from(new Set([...draft[key], path])) });
    }
    setRemoteReference(''); setSubmitError('');
  }

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
      const path = await api.selectLocalImage('video-reference');
      if (!path || !mounted.current) return;
      setDraft((current) => kind === 'first' ? { ...current, firstFramePath: path }
        : kind === 'last' ? { ...current, lastFramePath: path }
          : current.referenceImages.some((reference) => reference.path === path) ? current
            : { ...current, referenceImages: [...current.referenceImages, { path, kind: 'character' as const, description: '' }].slice(0, referenceLimits.images) });
    } catch (error) {
      if (mounted.current) setSubmitError(errorMessage(error));
    } finally {
      imagePickerLock.current = false;
      if (mounted.current) setPickingImage(false);
    }
  }

  async function selectReferenceMedia(kind: 'video' | 'audio') {
    if (imagePickerLock.current) return;
    imagePickerLock.current = true;
    setPickingImage(true);
    setSubmitError('');
    try {
      const path = kind === 'video' ? await api.selectLocalVideo() : await api.selectLocalAudio('video-reference');
      if (!path || typeof path !== 'string' || !mounted.current) return;
      setDraft((current) => {
        const key = kind === 'video' ? 'referenceVideoPaths' : 'referenceAudioPaths';
        return { ...current, [key]: Array.from(new Set([...current[key], path])).slice(0, kind === 'video' ? referenceLimits.videos : referenceLimits.audio) };
      });
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
    await runGeneration(videoLabInput({ ...draft, providerId: provider!.id, ratio: framesAdaptive ? 'adaptive' : draft.ratio }));
  }

  function reuseRecord(record: VideoLabRecord) {
    const sourceProvider = state.config.video.providers.find((item) => item.id === record.providerId);
    setDraft({ ...videoLabRecordDraft(record), modelPreset: videoModelPreset(sourceProvider ?? { model: record.model }) });
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
        <SelectField label="视频模型" value={selectedPreset} options={VIDEO_MODEL_PRESETS.map((item) => ({ value: item.id, label: item.label }))} onChange={(_, data) => chooseModel(data.value as VideoModelPreset)} />
        <SelectField label="使用服务" value={provider?.id ?? ''} disabled={!matchingProviders.length} onChange={(_, data) => updateDraft({ providerId: data.value })} options={matchingProviders.length
          ? matchingProviders.map((item) => ({ value: item.id, label: `${item.name || '未命名服务'} · ${item.model || '待配置'}` }))
          : [{ value: '', label: `尚未配置 ${modelLabel}` }]} hint={provider ? '本次选择仅用于当前生成。' : '选择模型后可直接准备素材，配置完成即可生成。'} />
        {providerIssue ? <div className="video-lab-provider-notice" role="status"><span>{providerIssue}</span>{openSettings ? <Button density="compact" icon={<Settings2 size={15} />} onClick={() => openSettings(selectedPreset)}>配置视频服务</Button> : null}</div>
          : openSettings ? <Button className="video-lab-settings" variant="subtle" density="compact" icon={<Settings2 size={14} />} onClick={() => openSettings(selectedPreset)}>视频服务设置</Button> : null}
        <div className="video-lab-mode-field">
          <span>生成模式</span>
          <SegmentedControl label="生成模式" value={draft.mode} onChange={(mode) => updateDraft({ mode })} options={[
            { value: 'text', label: '文本' },
            { value: 'frames', label: '首尾帧' },
            { value: 'references', label: '多模态参考' },
          ]} />
        </div>
        <p className="video-lab-muted">{draft.mode === 'frames' ? '严格按首帧到尾帧生成。若还要使用人物、场景等参考，请选多模态参考，并指定开场／结尾画面用途。' : draft.mode === 'references' ? '人物、场景与开场／中段／结尾画面可共同参考；画面顺序通过描述引导，不保证逐帧复刻。' : '用文字描述希望看到的画面、动作和声音。'}</p>
        <TextAreaField label="视频描述" rows={5} resize="vertical" value={draft.prompt} maxLength={modelFamily === 'h3' ? 7000 : 65_536} placeholder={draft.mode === 'references'
          ? '例：人物沿用参考图片 1 的外观，动作参考视频 1，声音节奏参考音频 1；中景跟拍，暖色电影光。'
          : draft.mode === 'frames' ? '描述首帧到尾帧之间发生的动作、转场和运镜。' : '描述主体、场景、动作、镜头运动、风格与声音。'} onChange={(_, data) => updateDraft({ prompt: data.value })} />
        <details className="video-lab-guidance">
          <summary>描述引导与运镜示例</summary>
          <p className="video-lab-muted">先写谁在什么场景做什么，再补镜头如何移动、动作先后和声音。点选示例后可继续改写。</p>
          <div className="video-lab-prompt-parts">
            {[
              ['人物一致', '人物外观、发型和服装沿用人物参考，动作自然连贯，保持身份一致。'],
              ['缓慢推近', '镜头从中景缓慢推近至面部特写，焦点始终跟随主体。'],
              ['横向跟拍', '镜头平稳横向跟拍主体，背景形成自然视差，保持主体在画面中央。'],
              ['固定镜头', '使用固定镜头，由人物动作推动画面变化，背景与构图保持稳定。'],
              ['动作顺序', '开场建立环境，中段主体完成主要动作，结尾停留在清晰的收尾姿态。'],
              ['声音氛围', '保留与动作同步的环境声和细节音效，背景声音轻柔，不遮盖人物对白。'],
            ].map(([label, value]) => <Button key={label} density="compact" variant="subtle" onClick={() => appendPrompt(value)}>{label}</Button>)}
          </div>
        </details>
        <div className="video-lab-parameters">
          <TextField label="时长（秒）" type="number" min={referenceLimits.minDuration} max={referenceLimits.maxDuration} step={1} value={String(draft.durationSec)} onChange={(_, data) => updateDraft({ durationSec: Number(data.value) })} hint={`${referenceLimits.minDuration}–${referenceLimits.maxDuration} 秒${modelFamily !== 'generic' ? '，整数' : ''}`} />
          <SelectField label="画面比例" value={framesAdaptive ? 'adaptive' : draft.ratio} disabled={framesAdaptive} options={VIDEO_LAB_RATIOS.filter((ratio) => ratio !== 'adaptive' || framesAdaptive || modelFamily === 'seedance' || draft.mode === 'references').map((ratio) => ({ value: ratio, label: ratio === 'adaptive' ? '自适应参考素材' : ratio }))} onChange={(_, data) => updateDraft({ ratio: data.value })} hint={framesAdaptive ? '按参考帧比例输出' : undefined} />
          <SelectField label="分辨率" value={draft.resolution} options={resolutionOptions.map((resolution) => ({ value: resolution, label: resolution }))} onChange={(_, data) => updateDraft({ resolution: data.value })} />
          <CheckboxField label={modelFamily === 'h3' ? '原生立体声（H3 默认）' : '生成同步声音'} checked={draft.generateAudio} onChange={(_, data) => updateDraft({ generateAudio: data.checked === true })} disabled={modelFamily === 'h3'} />
        </div>
        {draft.mode === 'frames' ? <section className="video-lab-image-section" aria-label="首尾帧">
          <div className="video-lab-section-heading"><h3>首尾帧</h3><span>{frameSupportLabel}</span></div>
          <div className="video-lab-frame-grid">
            <VideoFrame label="首帧" path={draft.firstFramePath} previewUrls={imagePreviewUrls} disabled={pickingImage} onSelect={() => { void selectReferenceImage('first'); }} onRemove={() => updateDraft({ firstFramePath: '' })} />
            <VideoFrame label="尾帧" path={draft.lastFramePath} previewUrls={imagePreviewUrls} disabled={pickingImage} onSelect={() => { void selectReferenceImage('last'); }} onRemove={() => updateDraft({ lastFramePath: '' })} />
          </div>
        </section> : null}
        {draft.mode === 'references' ? <section className="video-lab-image-section" aria-label="多模态参考素材">
          <div className="video-lab-section-heading"><h3>参考素材</h3><span>{referenceSupportLabel} · {references.length} 图 · {draft.referenceVideoPaths.length} 视频 · {draft.referenceAudioPaths.length} 音频</span></div>
          <div className="video-lab-reference-actions">
            <Button density="compact" icon={<ImagePlus size={14} />} disabled={pickingImage || references.length >= referenceLimits.images} onClick={() => { void selectReferenceImage('reference'); }}>添加图片</Button>
            <Button density="compact" icon={<Users size={14} />} disabled={references.length >= referenceLimits.images} onClick={() => setPersonPickerOpen(true)}>人物素材库</Button>
            <Button density="compact" icon={<Video size={14} />} disabled={pickingImage || draft.referenceVideoPaths.length >= referenceLimits.videos} onClick={() => { if (modelFamily === 'seedance') { setRemoteKind('video'); document.getElementById('video-reference-source')?.focus(); } else void selectReferenceMedia('video'); }}>添加视频</Button>
            <Button density="compact" icon={<AudioLines size={14} />} disabled={pickingImage || draft.referenceAudioPaths.length >= referenceLimits.audio} onClick={() => { void selectReferenceMedia('audio'); }}>添加音频</Button>
          </div>
          <p className="video-lab-muted">最多 {referenceLimits.images} 图 / {referenceLimits.videos} 视频 / {referenceLimits.audio} 音频{modelFamily === 'h3' ? '，合计不超过 12 份' : ''}。{modelFamily === 'seedance' ? '参考视频使用 HTTPS 地址或 asset:// 素材 ID。' : ''}</p>
          <div className="video-lab-remote-reference">
            <SelectField label="地址素材类型" value={remoteKind} options={[{ value: 'image', label: '图片 / 人物素材' }, { value: 'video', label: '参考视频' }, { value: 'audio', label: '参考音频' }]} onChange={(_, data) => setRemoteKind(data.value as typeof remoteKind)} />
            <TextField id="video-reference-source" label="素材地址或 ID" value={remoteReference} placeholder={modelFamily === 'seedance' ? 'https://… 或 asset://…' : 'https://… 或 mm_file://…'} onChange={(_, data) => setRemoteReference(data.value)} />
            <Button density="compact" disabled={!remoteReference.trim()} onClick={addRemoteReference}>添加地址素材</Button>
          </div>
          {references.length ? <div className="video-lab-reference-list">{references.map((reference, index) => <div className="video-lab-reference-row" key={reference.path}>
            <VideoReferencePreview label={`参考图片 ${index + 1}`} path={reference.path} previewUrls={imagePreviewUrls} />
            <div className="video-lab-reference-fields">
              <SelectField label={`图片 ${index + 1} 用途`} value={reference.kind} options={referenceKindOptions} onChange={(_, data) => updateDraft({ referenceImages: references.map((item) => item.path === reference.path ? { ...item, kind: data.value as VideoReferenceKind } : item) })} />
              <TextAreaField rows={2} resize="vertical" maxLength={500} label={`图片 ${index + 1} 参考内容`} value={reference.description} placeholder={reference.kind === 'opening' ? '开场使用这张图的构图与主体位置' : reference.kind === 'ending' ? '结尾接近这张图的姿态与环境' : reference.kind === 'transition' ? '中段出现这张图的动作或构图' : '例：保留人物脸型、服装和发型'} onChange={(_, data) => updateDraft({ referenceImages: references.map((item) => item.path === reference.path ? { ...item, description: data.value } : item) })} />
              <Button className="video-lab-insert-reference" density="compact" variant="subtle" onClick={() => appendPrompt(`${referenceToken('Image', index)} 用于${referenceKindOptions.find((item) => item.value === reference.kind)?.label}，${reference.description || '请补充希望保留的细节'}。`)}>插入 {referenceToken('Image', index)}</Button>
            </div>
            <IconButton label={`移除参考图片 ${index + 1}`} icon={<Trash2 size={14} />} onClick={() => updateDraft({ referenceImages: references.filter((item) => item.path !== reference.path) })} />
          </div>)}</div> : null}
          <MediaReferenceList label="参考视频" paths={draft.referenceVideoPaths} onInsert={(index) => appendPrompt(`${referenceToken('Video', index)} 用于动作与镜头运动参考。`)} onRemove={(path) => updateDraft({ referenceVideoPaths: draft.referenceVideoPaths.filter((item) => item !== path) })} />
          <MediaReferenceList label="参考音频" paths={draft.referenceAudioPaths} onInsert={(index) => appendPrompt(`${referenceToken('Audio', index)} 用于声音与节奏参考。`)} onRemove={(path) => updateDraft({ referenceAudioPaths: draft.referenceAudioPaths.filter((item) => item !== path) })} />
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
      <VideoLabPersonPicker api={api} open={personPickerOpen} remaining={referenceLimits.images - references.length} excludedPaths={references.map((item) => item.path)} onClose={() => setPersonPickerOpen(false)} onAdd={(images) => updateDraft({ referenceImages: [...references, ...images] })} />
    </div>
  );
}

function VideoFrame({ label, path, previewUrls, disabled, onSelect, onRemove }: { label: string; path: string; previewUrls: Record<string, string>; disabled: boolean; onSelect: () => void; onRemove: () => void }) {
  const previewUrl = imagePreviewUrl(path, previewUrls);
  return <div className="video-lab-frame">
    {path && previewUrl ? <img src={previewUrl} alt={`${label}参考图`} title={path} /> : <div className="video-lab-frame-empty"><ImagePlus size={23} /><span>{path ? previewStatus(path, previewUrls) : `选择${label}`}</span></div>}
    <div className="video-lab-frame-actions"><Button density="compact" variant="subtle" disabled={disabled} onClick={onSelect}>{path ? `更换${label}` : `选择${label}`}</Button>{path ? <IconButton label={`移除${label}`} icon={<Trash2 size={14} />} onClick={onRemove} /> : null}</div>
  </div>;
}

function VideoReferencePreview({ label, path, previewUrls }: { label: string; path: string; previewUrls: Record<string, string> }) {
  const previewUrl = imagePreviewUrl(path, previewUrls);
  return previewUrl
    ? <img src={previewUrl} alt={label} title={path} />
    : <div className="video-lab-reference-remote" title={path}><ImagePlus size={20} /><span>{isRemoteVideoReference(path) ? '地址素材' : previewStatus(path, previewUrls)}</span></div>;
}

function isLocalImagePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || /^\/(?!\/)/u.test(path);
}

function imagePreviewUrl(path: string, previewUrls: Record<string, string>): string {
  if (!path || /^(?:asset|mm_file):\/\//iu.test(path)) return '';
  if (isLocalImagePath(path)) return previewUrls[path] ?? '';
  return path;
}

function previewStatus(path: string, previewUrls: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(previewUrls, path) ? '预览不可用' : '正在读取预览';
}

function MediaReferenceList({ label, paths, onRemove, onInsert }: { label: string; paths: string[]; onRemove: (path: string) => void; onInsert: (index: number) => void }) {
  if (!paths.length) return null;
  return <div className="video-lab-media-references" aria-label={label}>{paths.map((path, index) => <div key={path}>
    <span><strong>{label} {index + 1}</strong><small title={path}>{path.split(/[\\/]/u).pop() ?? path}</small></span>
    <Button density="compact" variant="subtle" onClick={() => onInsert(index)}>插入描述</Button>
    <IconButton label={`移除${label} ${index + 1}`} icon={<Trash2 size={14} />} onClick={() => onRemove(path)} />
  </div>)}</div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function parseReferenceImages(value: string): VideoLabDraft['referenceImages'] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is VideoLabDraft['referenceImages'][number] => Boolean(
      item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string'
      && referenceKindOptions.some((option) => option.value === (item as { kind?: unknown }).kind)
      && typeof (item as { description?: unknown }).description === 'string',
    )) : [];
  } catch { return []; }
}

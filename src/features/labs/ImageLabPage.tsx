import { useState } from 'react';
import { Copy, FolderOpen, Image as ImageIcon, ImagePlus, Loader2, RefreshCcw, RotateCcw, Wand2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { AspectRatioSwatch } from '../../components/AspectRatioSwatch';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ImageGenerationQuality, ImageLabGenerateInput, ImageLabRecord, ImageLabSmartMode } from '../../shared/types';
import { smartImageModeOptions, styleOptions } from '../../shared/editorial-options';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate, toLocalImageUrl } from '../tasks/task-formatters';
import {
  buildImageLabBatchInputs,
  imageLabRetryInput,
  isImageLabProviderChoice,
  parseReferenceImagePaths,
  resolveImageLabSmartMode,
  smartImageModeLabel,
} from './image-lab-helpers';
import '../../styles/features/local-labs.css';
import { imageGenerationQualityLabel, normalizeImageGenerationQuality } from '../../shared/image-quality';

type ImageResolution = ImageLabRecord['resolution'];
type ImageLabProviderChoice = 'gpt_image' | 'jimeng' | 'custom';
type ImageLabTab = 'smart' | 'text' | 'reference';

const imageLabRatioChoices = [
  ['21:9', '宽屏'],
  ['16:9', '横屏'],
  ['3:2', '标准横'],
  ['4:3', '标准'],
  ['1:1', '方形'],
  ['3:4', '标准竖'],
  ['2:3', '竖图'],
  ['9:16', '竖屏'],
] as const;

const imageLabProviderChoices: Array<[ImageLabProviderChoice, string]> = [
  ['gpt_image', 'GPT Image'],
  ['jimeng', '即梦'],
  ['custom', '自定义图片'],
];

const smartPurposeOptions = smartImageModeOptions.filter(([mode]) => mode !== 'reference-edit');

export function ImageLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [tab, setTab] = useState<ImageLabTab>('smart');
  const [smartMode, setSmartMode] = useState<ImageLabSmartMode>('podcast-cover');
  const [prompt, setPrompt] = useState('根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，保持参考图主体和质感。');
  const [selectedRatios, setSelectedRatios] = useState<string[]>(['9:16']);
  const [selectedStyles, setSelectedStyles] = useState<string[]>(['photo-real']);
  const [provider, setProvider] = useState<ImageLabProviderChoice>(
    isImageLabProviderChoice(state.config.imageProvider) ? state.config.imageProvider : 'gpt_image',
  );
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  const [quality, setQuality] = useState<ImageGenerationQuality>(() => normalizeImageGenerationQuality(
    state.config.imageProvider === 'custom'
      ? state.config.customImage.quality
      : state.config.gptImage.quality ?? state.config.image.quality,
  ));
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [referencePasteDraft, setReferencePasteDraft] = useState('');
  const [imageLabOutputCount, setImageLabOutputCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [expandedReferenceImage, setExpandedReferenceImage] = useState('');
  const [copiedTaskId, setCopiedTaskId] = useState('');
  const imageLabAction = useAsyncAction();
  const referenceLimit = 10;
  const referenceCandidates = parseReferenceImagePaths(referenceImagePath);
  const references = referenceCandidates.slice(0, referenceLimit);
  const hiddenReferenceCount = Math.max(0, referenceCandidates.length - references.length);
  const referenceModeDescription = tab === 'smart'
    ? '智能规划多张图，可带参考图；适合根据需求批量出教程图、封面和分镜图。'
    : tab === 'reference'
      ? '参考图编辑/延展，需要先添加参考图；适合保留主体、材质和画面一致性。'
      : '纯文本生图，不使用参考图。';
  const baseSmartMode: ImageLabSmartMode = tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
  const resolvedSmartMode = resolveImageLabSmartMode(tab, baseSmartMode, references);
  const quantity = Math.max(1, Math.min(10, imageLabOutputCount));
  const batchRequestCount = selectedRatios.length * selectedStyles.length * quantity;
  const supportsImageQuality = provider !== 'jimeng';
  const failedRecords = state.imageLabRecords.filter((record) => record.status === 'failed');

  async function selectImageLabReferenceImage() {
    await imageLabAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setReferenceImagePath((current) => [...parseReferenceImagePaths(current), imagePath].join('\n'));
    });
  }

  function removeReferenceImagePath(reference: string) {
    setReferenceImagePath((current) => parseReferenceImagePaths(current).filter((item) => item !== reference).join('\n'));
    if (expandedReferenceImage === reference) setExpandedReferenceImage('');
  }

  function appendReferenceImagePaths(value: string) {
    const nextPaths = parseReferenceImagePaths(value);
    if (!nextPaths.length) return;
    setReferenceImagePath((current) => Array.from(new Set([...parseReferenceImagePaths(current), ...nextPaths])).join('\n'));
  }

  function toggleRatio(value: string) {
    setSelectedRatios((current) => current.includes(value)
      ? current.length === 1 ? current : current.filter((item) => item !== value)
      : [...current, value]);
  }

  function toggleStyle(value: string) {
    setSelectedStyles((current) => current.includes(value)
      ? current.length === 1 ? current : current.filter((item) => item !== value)
      : [...current, value]);
  }

  async function runImageLabInputs(inputs: ImageLabGenerateInput[]) {
    setGenerating(true);
    setSubmitError('');
    try {
      for (const input of inputs) {
        const nextState = await api.generateImageLab(input);
        applyState(nextState);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function addRecord() {
    if (generating) return;
    await imageLabAction.run(async () => {
      await runImageLabInputs(buildImageLabBatchInputs({
        prompt,
        ratios: selectedRatios,
        styles: selectedStyles,
        quantity,
        provider,
        resolution,
        quality,
        smartMode: resolvedSmartMode,
        referenceImagePaths: references,
      }));
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function importCompletedImage() {
    if (generating || imageLabAction.busy || !prompt.trim()) return;
    await imageLabAction.run(async () => {
      setSubmitError('');
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      const nextState = await api.addImageLabRecord({
        prompt,
        ratio: selectedRatios[0],
        style: selectedStyles[0],
        provider,
        imagePath,
        resolution,
        quality,
        smartMode: resolvedSmartMode,
        referenceImagePath: references[0] ?? '',
        referenceImagePaths: references,
      });
      applyState(nextState);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function imageLabRecordDetail(record: ImageLabRecord): Promise<ImageLabRecord> {
    return await api.getImageLabRecordDetail(record.id) ?? record;
  }

  async function retryImageLabRecord(record: ImageLabRecord) {
    if (generating || imageLabAction.busy) return;
    await imageLabAction.run(async () => {
      const detail = await imageLabRecordDetail(record);
      await runImageLabInputs([imageLabRetryInput(detail)]);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function retryFailedImageLabRecords() {
    if (generating || imageLabAction.busy || failedRecords.length === 0) return;
    await imageLabAction.run(async () => {
      const details = await Promise.all(failedRecords.map((record) => imageLabRecordDetail(record)));
      await runImageLabInputs(details.map(imageLabRetryInput));
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function refillImageLabPrompt(record: ImageLabRecord) {
    await imageLabAction.run(async () => {
      const detail = await imageLabRecordDetail(record);
      setPrompt(detail.prompt);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function copyImageLabTaskId(record: ImageLabRecord) {
    const taskId = record.upstreamTaskId || record.id;
    await imageLabAction.run(async () => {
      if (!navigator.clipboard) throw new Error('当前环境不支持复制到剪贴板。');
      await navigator.clipboard.writeText(taskId);
      setCopiedTaskId(taskId);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function openImageLabOutputDirectory(record: ImageLabRecord) {
    await imageLabAction.run(
      () => api.openImageLabOutputDirectory(record.id),
      { onError: (error) => setSubmitError(error.message) },
    );
  }

  return (
    <div className="local-lab-workbench image-lab-page" data-local-lab-workbench="image-lab">
      <section className="local-lab-main image-lab-workbench">
        <Segmented label="模式" value={tab} options={['smart', 'text', 'reference']} labels={['智慧生图', '文生图', '图像参考']} onChange={(value) => setTab(value as ImageLabTab)} />
        <div className="image-lab-mode-note">{referenceModeDescription}</div>
        <div className="image-lab-editor-grid">
          <div className="image-lab-primary-column">
            {tab !== 'text' ? (
              <div className="image-lab-reference-block">
                <div className="image-lab-section-head">
                  <strong>参考图</strong>
                  <small>最多 {referenceLimit} 张 · 已选 {references.length}</small>
                </div>
                <div className="image-lab-dropzone">
                  <button className="image-lab-upload-card" type="button" disabled={imageLabAction.busy} onClick={selectImageLabReferenceImage}>
                    <ImageIcon size={18} />
                    添加参考图
                  </button>
                  <span>
                    <strong>选择或粘贴本地图片路径</strong>
                    <small>PNG / JPG / WEBP，每行一张</small>
                  </span>
                </div>
                <textarea
                  className="reference-image-list"
                  value={referencePasteDraft}
                  placeholder="粘贴本地图片路径，每行一张"
                  onPaste={(event) => {
                    event.preventDefault();
                    appendReferenceImagePaths(event.clipboardData.getData('text'));
                    setReferencePasteDraft('');
                  }}
                  onChange={(event) => setReferencePasteDraft(event.target.value)}
                  onBlur={() => {
                    appendReferenceImagePaths(referencePasteDraft);
                    setReferencePasteDraft('');
                  }}
                />
                <div className="image-lab-reference-list" aria-live="polite">
                  {references.length ? (
                    <div className="image-lab-reference-grid">
                      {references.map((reference, index) => (
                        <article className="image-lab-reference-thumb" key={`${reference}-${index}`}>
                          <button type="button" className="image-lab-reference-image" onClick={() => setExpandedReferenceImage(reference)} aria-label={`放大参考图 ${index + 1}`}>
                            <img src={toLocalImageUrl(reference)} alt={`参考图 ${index + 1}`} loading="lazy" />
                          </button>
                          <div className="image-lab-reference-actions">
                            <button type="button" className="mini-button" onClick={() => setExpandedReferenceImage(reference)}>放大</button>
                            <button type="button" className="mini-button" onClick={() => removeReferenceImagePath(reference)}>删除</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <span className="image-lab-reference-empty">暂未添加参考图路径</span>}
                  {hiddenReferenceCount > 0 ? <span className="image-lab-reference-overflow">已忽略超出上限的 {hiddenReferenceCount} 张</span> : null}
                </div>
              </div>
            ) : null}
            <Field label="需求描述">
              <textarea className="prompt-box image-lab-prompt" value={prompt} placeholder="描述主体、场景、构图和用途" onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            <div className="image-lab-slider">
              <div className="image-lab-section-head">
                <strong>每组合数量</strong>
                <small>1-10 张</small>
              </div>
              <input type="range" min={1} max={10} step={1} value={imageLabOutputCount} onChange={(event) => setImageLabOutputCount(Number(event.target.value))} />
              <strong>{quantity} 张</strong>
            </div>
          </div>

          <aside className="image-lab-inspector">
            {tab === 'smart' ? (
              <Field label="智能用途">
                <select value={smartMode} onChange={(event) => setSmartMode(event.target.value as ImageLabSmartMode)}>
                  {smartPurposeOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </Field>
            ) : null}
            <div className="image-lab-control-group">
              <div className="image-lab-section-head">
                <strong>多选比例</strong>
                <small>已选 {selectedRatios.length}</small>
              </div>
              <div className="image-lab-ratio-grid">
                {imageLabRatioChoices.map(([value, label]) => (
                  <button key={value} className={selectedRatios.includes(value) ? 'selected' : ''} aria-pressed={selectedRatios.includes(value)} onClick={() => toggleRatio(value)} type="button">
                    <AspectRatioSwatch ratio={value} />
                    <strong>{value}</strong>
                    <small>{label}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="image-lab-control-group">
              <div className="image-lab-section-head">
                <strong>多选风格</strong>
                <small>已选 {selectedStyles.length}</small>
              </div>
              <div className="image-lab-style-grid">
                {styleOptions.map(([value, label, hint]) => (
                  <button key={value} className={selectedStyles.includes(value) ? 'selected' : ''} aria-pressed={selectedStyles.includes(value)} onClick={() => toggleStyle(value)} type="button" title={hint}>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            </div>
            <Segmented label="分辨率" value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as ImageResolution)} />
            {supportsImageQuality ? <Segmented label="生成质量" value={quality} options={['low', 'medium', 'high']} labels={['低成本', '标准', '高质量']} onChange={(value) => setQuality(value as ImageGenerationQuality)} /> : null}
            <Field label="Provider">
              <select value={provider} onChange={(event) => setProvider(event.target.value as ImageLabProviderChoice)}>
                {imageLabProviderChoices.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </Field>
            <div className="image-lab-batch-summary">
              <strong>{selectedRatios.length} 比例 × {selectedStyles.length} 风格 × {quantity} 张</strong>
              <span>共 {batchRequestCount} 个任务 · {supportsImageQuality ? `${imageGenerationQualityLabel(quality)}质量` : `${resolution} 分辨率`}</span>
            </div>
            <div className="image-lab-footer">
              <button className="ghost-action" type="button" onClick={importCompletedImage} disabled={generating || imageLabAction.busy || !prompt.trim()}>
                <ImagePlus size={17} />
                导入成品
              </button>
              <button className="primary-action" onClick={addRecord} disabled={generating || !prompt.trim() || (resolvedSmartMode === 'reference-edit' && references.length === 0)}>
                {generating ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
                {generating ? '生成中' : `智能生成 ${batchRequestCount} 项`}
              </button>
              <div className="provider-line">{provider} · {smartImageModeLabel(resolvedSmartMode)}</div>
            </div>
            {submitError ? <ErrorSummaryButton compact title="画图实验室操作失败" fullMessage={submitError} /> : null}
            <InlineActionFeedback feedback={imageLabAction.feedback} />
          </aside>
        </div>
      </section>

      {expandedReferenceImage ? (
        <div className="error-dialog-backdrop" onClick={() => setExpandedReferenceImage('')}>
          <section className="error-dialog image-lab-preview-dialog" role="dialog" aria-modal="true" aria-label="参考图预览" onClick={(event) => event.stopPropagation()}>
            <div className="error-dialog-head">
              <strong>参考图预览</strong>
              <button className="mini-button" type="button" onClick={() => setExpandedReferenceImage('')}>关闭</button>
            </div>
            <img src={toLocalImageUrl(expandedReferenceImage)} alt="参考图预览" />
          </section>
        </div>
      ) : null}

      <section className="local-lab-media image-lab-recent">
        <div className="image-lab-recent-head">
          <h3>最近生成 · {state.imageLabRecords.length}</h3>
          <button className="ghost-action compact" type="button" onClick={retryFailedImageLabRecords} disabled={generating || imageLabAction.busy || failedRecords.length === 0}>
            <RefreshCcw size={15} />
            重试全部失败项 ({failedRecords.length})
          </button>
        </div>
        {copiedTaskId ? <small className="image-lab-copy-status" aria-live="polite">已复制：{copiedTaskId}</small> : null}
        {state.imageLabRecords.length === 0 ? <EmptyState title="暂无画图记录" /> : null}
        <div className="image-grid-panel">
          {state.imageLabRecords.map((record) => (
            <article className={`image-record ${record.status}`} key={record.id}>
              <div className="lab-image-preview" data-media-canvas="image-lab">
                {record.imagePath ? <img src={toLocalImageUrl(record.imagePath)} alt={record.prompt} loading="lazy" /> : (
                  <>
                    <ImageIcon size={28} />
                    <span>{record.status === 'failed' ? '生成失败' : '等待图片'}</span>
                  </>
                )}
              </div>
              <strong title={record.prompt}>{record.prompt}</strong>
              <small>{record.provider} · {record.ratio} · {record.resolution}{record.provider === 'jimeng' ? '' : ` · ${imageGenerationQualityLabel(record.quality ?? 'medium')}质量`} · {smartImageModeLabel(record.smartMode)} · {formatDate(record.createdAt)}</small>
              {record.errorMessage ? <ErrorSummaryButton compact title="生图失败" fullMessage={record.errorMessage} /> : null}
              <div className="image-record-actions">
                {record.status === 'failed' ? (
                  <button className="mini-button" type="button" title="按原参数创建一次新尝试" onClick={() => retryImageLabRecord(record)} disabled={generating || imageLabAction.busy}>
                    <RotateCcw size={14} />
                    重试
                  </button>
                ) : null}
                <button className="mini-button" type="button" onClick={() => refillImageLabPrompt(record)} disabled={imageLabAction.busy}>
                  <RefreshCcw size={14} />
                  回填提示词
                </button>
                <button className="mini-button" type="button" onClick={() => copyImageLabTaskId(record)} disabled={imageLabAction.busy}>
                  <Copy size={14} />
                  复制任务 ID
                </button>
                <button className="mini-button" type="button" onClick={() => openImageLabOutputDirectory(record)} disabled={imageLabAction.busy}>
                  <FolderOpen size={14} />
                  打开目录
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

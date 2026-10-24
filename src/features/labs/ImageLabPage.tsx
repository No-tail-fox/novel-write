import { useEffect, useState } from 'react';
import { Copy, FolderOpen, Image as ImageIcon, ImagePlus, Loader2, Maximize2, RefreshCcw, RotateCcw, Save, Trash2, Wand2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { AspectRatioSwatch } from '../../components/AspectRatioSwatch';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ImageGenerationQuality, ImageLabGenerateInput, ImageLabRecord, ImageLabSmartMode } from '../../shared/types';
import { smartImageModeOptions } from '../../shared/editorial-options';
import { Button, CheckboxField, Dialog, HoverPreview, IconButton, SelectField, SliderField, TextAreaField, TextField } from '../../ui';
import { ImageStyleSample } from '../image-style-preview/ImageStylePreview';
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
import {
  createImageLabPromptTemplate,
  deleteImageLabPromptTemplate,
  imageLabTabForPromptMode,
  readImageLabPromptTemplates,
  readImageLabWorkspaceDraft,
  upsertImageLabPromptTemplate,
  writeImageLabPromptTemplates,
  writeImageLabWorkspaceDraft,
  type ImageLabProviderChoice,
  type ImageLabTab,
} from './image-lab-workspace';
import '../../styles/features/local-labs.css';
import { imageGenerationQualityLabel, normalizeImageGenerationQuality } from '../../shared/image-quality';
import { LibraryPicker } from '../asset-library/LibraryPicker';
import { LibrarySaveDialog, type LibraryDraft } from '../asset-library/LibrarySaveDialog';

type ImageResolution = ImageLabRecord['resolution'];

function alphaPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
}

function cutoutMethodLabel(method: ImageLabRecord['cutoutMethod']): string {
  if (method === 'onnx') return 'ONNX 模型';
  if (method === 'green-key') return '绿幕抠图';
  if (method === 'native-alpha') return '原生透明';
  return '尚未去底';
}

function cutoutQualityLabel(quality: ImageLabRecord['cutoutQuality']): string {
  if (quality === 'passed') return '合格';
  if (quality === 'warning') return '需复核';
  if (quality === 'failed') return '失败';
  return '待处理';
}

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
const defaultImageLabPrompt = '根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，保持参考图主体和质感。';

export function ImageLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [workspaceDraft] = useState(() => readImageLabWorkspaceDraft(window.localStorage));
  const restoredRatios = workspaceDraft?.selectedRatios.filter((ratio) => imageLabRatioChoices.some(([value]) => value === ratio)) ?? [];
  const restoredStyles = workspaceDraft?.selectedStyles.filter((id) => state.customStyles.some(style => style.id === id)) ?? [];
  const [tab, setTab] = useState<ImageLabTab>(workspaceDraft?.tab ?? 'smart');
  const [smartMode, setSmartMode] = useState<ImageLabSmartMode>(workspaceDraft?.smartMode ?? 'podcast-cover');
  const [prompt, setPrompt] = useState(workspaceDraft ? workspaceDraft.prompt : defaultImageLabPrompt);
  const [selectedRatios, setSelectedRatios] = useState<string[]>(restoredRatios.length ? restoredRatios : ['9:16']);
  const [selectedStyles, setSelectedStyles] = useState<string[]>(restoredStyles.length ? restoredStyles : ['photo-real']);
  const [provider, setProvider] = useState<ImageLabProviderChoice>(
    workspaceDraft?.provider ?? (isImageLabProviderChoice(state.config.imageProvider) ? state.config.imageProvider : 'gpt_image'),
  );
  const [resolution, setResolution] = useState<ImageResolution>(workspaceDraft?.resolution ?? '1K');
  const [quality, setQuality] = useState<ImageGenerationQuality>(() => workspaceDraft?.quality ?? normalizeImageGenerationQuality(
    provider === 'custom'
      ? state.config.customImage.quality
      : state.config.gptImage.quality ?? state.config.image.quality,
  ));
  const [referenceImagePath, setReferenceImagePath] = useState(workspaceDraft?.referenceImagePath ?? '');
  const [referencePasteDraft, setReferencePasteDraft] = useState('');
  const [imageLabOutputCount, setImageLabOutputCount] = useState(workspaceDraft?.outputCount ?? 3);
  const [promptTemplates, setPromptTemplates] = useState(() => readImageLabPromptTemplates(window.localStorage));
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState('');
  const [promptTemplateName, setPromptTemplateName] = useState('');
  const [promptTemplateNotice, setPromptTemplateNotice] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [expandedReferenceImage, setExpandedReferenceImage] = useState('');
  const [copiedTaskId, setCopiedTaskId] = useState('');
  const [libraryPicker, setLibraryPicker] = useState<'image' | 'text' | null>(null);
  const [libraryDraft, setLibraryDraft] = useState<LibraryDraft | null>(null);
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

  useEffect(() => {
    try {
      writeImageLabWorkspaceDraft(window.localStorage, {
        version: 1,
        savedAt: new Date().toISOString(),
        tab,
        smartMode,
        prompt,
        selectedRatios,
        selectedStyles,
        provider,
        resolution,
        quality,
        referenceImagePath,
        outputCount: imageLabOutputCount,
      });
    } catch {
      // The workbench remains usable when browser storage is unavailable.
    }
  }, [imageLabOutputCount, prompt, provider, quality, referenceImagePath, resolution, selectedRatios, selectedStyles, smartMode, tab]);

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

  async function retryImageLabBackground(record: ImageLabRecord) {
    if (generating || imageLabAction.busy || record.status !== 'generated') return;
    await imageLabAction.run(async () => {
      const detail = await imageLabRecordDetail(record);
      const mutation = await api.removeImageLabBackground({
        id: detail.id,
        method: detail.cutoutMethod ?? 'onnx',
      });
      applyState(mutation);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function refillImageLabPrompt(record: ImageLabRecord) {
    await imageLabAction.run(async () => {
      const detail = await imageLabRecordDetail(record);
      setPrompt(detail.prompt);
      setSelectedPromptTemplateId('');
      setPromptTemplateName('');
    }, { onError: (error) => setSubmitError(error.message) });
  }

  async function saveImageToLibrary(record: ImageLabRecord) {
    await imageLabAction.run(async () => {
      const detail = await imageLabRecordDetail(record);
      if (!detail.imagePath || detail.status !== 'generated') throw new Error('图片尚未生成完成。');
      setLibraryDraft({ kind: 'image', imagePath: detail.imagePath, prompt: detail.prompt, title: detail.prompt.slice(0, 80) || '生成图片', source: { kind: 'image-lab', id: detail.id } });
    }, { onError: (error) => setSubmitError(error.message) });
  }

  function selectPromptTemplate(id: string) {
    setSelectedPromptTemplateId(id);
    const template = promptTemplates.find((item) => item.id === id);
    if (!template) {
      setPromptTemplateName('');
      setPromptTemplateNotice('');
      return;
    }
    setPromptTemplateName(template.name);
    setPrompt(template.body);
    const nextTab = imageLabTabForPromptMode(template.mode);
    setTab(nextTab);
    if (nextTab === 'smart') setSmartMode(template.mode);
    setPromptTemplateNotice(`已应用：${template.name}`);
  }

  function savePromptTemplate() {
    try {
      const name = promptTemplateName.trim();
      const existingByName = promptTemplates.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      const selectedTemplate = promptTemplates.find((item) => item.id === selectedPromptTemplateId);
      const selectedKeepsIdentity = selectedTemplate?.name.toLocaleLowerCase() === name.toLocaleLowerCase();
      const previous = existingByName ?? (selectedKeepsIdentity ? selectedTemplate : undefined);
      const updatedAt = new Date().toISOString();
      const mode = tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
      const template = createImageLabPromptTemplate({
        id: previous?.id ?? crypto.randomUUID(),
        name,
        mode,
        body: prompt,
        createdAt: previous?.createdAt,
        updatedAt,
      });
      const nextTemplates = upsertImageLabPromptTemplate(promptTemplates, template);
      writeImageLabPromptTemplates(window.localStorage, nextTemplates);
      setPromptTemplates(nextTemplates);
      setSelectedPromptTemplateId(template.id);
      setPromptTemplateName(template.name);
      setPromptTemplateNotice(previous ? `已更新：${template.name}` : `已保存：${template.name}`);
    } catch (error) {
      setPromptTemplateNotice(error instanceof Error && /BODY_INVALID/u.test(error.message) ? '请先填写需求描述。' : '请填写模板名称。');
    }
  }

  function removePromptTemplate() {
    if (!selectedPromptTemplateId) return;
    const selected = promptTemplates.find((item) => item.id === selectedPromptTemplateId);
    const nextTemplates = deleteImageLabPromptTemplate(promptTemplates, selectedPromptTemplateId);
    writeImageLabPromptTemplates(window.localStorage, nextTemplates);
    setPromptTemplates(nextTemplates);
    setSelectedPromptTemplateId('');
    setPromptTemplateName('');
    setPromptTemplateNotice(selected ? `已删除：${selected.name}` : '模板已删除');
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
                  <Button density="compact" variant="subtle" icon={<ImagePlus size={14} />} disabled={imageLabAction.busy || references.length >= referenceLimit} onClick={() => setLibraryPicker('image')}>从素材库选择</Button>
                </div>
                <div className="image-lab-dropzone">
                  <Button icon={<ImageIcon size={18} />} disabled={imageLabAction.busy} onClick={selectImageLabReferenceImage}>
                    添加参考图
                  </Button>
                  <span>
                    <strong>选择或粘贴本地图片路径</strong>
                    <small>PNG / JPG / WEBP，每行一张</small>
                  </span>
                </div>
                <TextAreaField
                  label="参考图路径"
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
                          <Button variant="subtle" className="image-lab-reference-image" onClick={() => setExpandedReferenceImage(reference)} aria-label={`放大参考图 ${index + 1}`}>
                            <img src={toLocalImageUrl(reference)} alt={`参考图 ${index + 1}`} loading="lazy" />
                          </Button>
                          <div className="image-lab-reference-actions">
                            <IconButton label={`放大参考图 ${index + 1}`} icon={<Maximize2 size={14} />} onClick={() => setExpandedReferenceImage(reference)} />
                            <IconButton label={`删除参考图 ${index + 1}`} icon={<Trash2 size={14} />} onClick={() => removeReferenceImagePath(reference)} />
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <span className="image-lab-reference-empty">暂未添加参考图路径</span>}
                  {hiddenReferenceCount > 0 ? <span className="image-lab-reference-overflow">已忽略超出上限的 {hiddenReferenceCount} 张</span> : null}
                </div>
              </div>
            ) : null}
            <section className="image-lab-prompt-templates" aria-label="提示词模板">
              <div className="image-lab-section-head">
                <strong>提示词模板</strong>
                <small>{promptTemplates.length} 个已保存</small>
              </div>
              <div className="image-lab-prompt-template-row">
                <SelectField label="选择提示词模板" value={selectedPromptTemplateId} onChange={(event) => selectPromptTemplate(event.target.value)} options={[{ value: '', label: '选择模板' }, ...promptTemplates.map((template) => ({ value: template.id, label: template.name }))]} />
                <TextField label="提示词模板名称" maxLength={60} value={promptTemplateName} placeholder="模板名称" onChange={(event) => setPromptTemplateName(event.target.value)} />
                <IconButton label="保存当前提示词模板" icon={<Save size={14} />} onClick={savePromptTemplate} />
                <IconButton label="删除提示词模板" icon={<Trash2 size={14} />} disabled={!selectedPromptTemplateId} onClick={removePromptTemplate} />
              </div>
              {promptTemplateNotice ? <small className="image-lab-prompt-template-notice" aria-live="polite">{promptTemplateNotice}</small> : null}
            </section>
            <TextAreaField label="需求描述" className="image-lab-prompt" value={prompt} placeholder="描述主体、场景、构图和用途" onChange={(event) => setPrompt(event.target.value)} />
            <div className="library-inline-actions"><Button density="compact" variant="subtle" icon={<ImagePlus size={14} />} onClick={() => setLibraryPicker('text')}>从素材库追加文本</Button><Button density="compact" variant="subtle" icon={<Save size={14} />} disabled={!prompt.trim()} onClick={() => setLibraryDraft({ kind: 'text', text: prompt, title: prompt.slice(0, 60), source: { kind: 'image-lab', label: '生图提示词' } })}>存入素材库</Button></div>
            <div className="image-lab-slider">
              <SliderField label="每组合数量" valueLabel={`${quantity} 张`} min={1} max={10} step={1} value={imageLabOutputCount} onChange={(_, data) => setImageLabOutputCount(data.value)} />
            </div>
          </div>

          <aside className="image-lab-inspector">
            {tab === 'smart' ? (
              <SelectField label="智能用途" value={smartMode} onChange={(event) => setSmartMode(event.target.value as ImageLabSmartMode)} options={smartPurposeOptions.map(([value, label]) => ({ value, label }))} />
            ) : null}
            <div className="image-lab-control-group">
              <div className="image-lab-section-head">
                <strong>多选比例</strong>
                <small>已选 {selectedRatios.length}</small>
              </div>
              <div className="image-lab-ratio-grid">
                {imageLabRatioChoices.map(([value, label]) => (
                  <CheckboxField key={value} checked={selectedRatios.includes(value)} onChange={() => toggleRatio(value)} label={<span className="image-lab-ratio-label"><AspectRatioSwatch ratio={value} /><span>{value} · {label}</span></span>} />
                ))}
              </div>
            </div>
            <div className="image-lab-control-group">
              <div className="image-lab-section-head">
                <strong>多选风格</strong>
                <small>已选 {selectedStyles.length}</small>
              </div>
              <div className="image-lab-style-grid">
                {state.customStyles.map(style => (
                  <HoverPreview key={style.id} title={style.name} description={style.description} renderPreview={() => <ImageStyleSample style={style} />}>
                  <CheckboxField checked={selectedStyles.includes(style.id)} onChange={() => toggleStyle(style.id)} label={<span className="image-lab-style-label"><ImageStyleSample style={style} thumbnail /><span>{style.name}</span></span>} />
                  </HoverPreview>
                ))}
              </div>
            </div>
            <Segmented label="分辨率" value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as ImageResolution)} />
            {supportsImageQuality ? <Segmented label="生成质量" value={quality} options={['low', 'medium', 'high']} labels={['低成本', '标准', '高质量']} onChange={(value) => setQuality(value as ImageGenerationQuality)} /> : null}
            <SelectField label="Provider" value={provider} onChange={(event) => setProvider(event.target.value as ImageLabProviderChoice)} options={imageLabProviderChoices.map(([value, label]) => ({ value, label }))} />
            <div className="image-lab-batch-summary">
              <strong>{selectedRatios.length} 比例 × {selectedStyles.length} 风格 × {quantity} 张</strong>
              <span>共 {batchRequestCount} 个任务 · {supportsImageQuality ? `${imageGenerationQualityLabel(quality)}质量` : `${resolution} 分辨率`}</span>
            </div>
            <div className="image-lab-footer">
              <Button icon={<ImagePlus size={17} />} onClick={importCompletedImage} disabled={generating || imageLabAction.busy || !prompt.trim()}>
                导入成品
              </Button>
              <Button variant="primary" icon={generating ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />} onClick={addRecord} disabled={generating || !prompt.trim() || (resolvedSmartMode === 'reference-edit' && references.length === 0)}>
                {generating ? '生成中' : `智能生成 ${batchRequestCount} 项`}
              </Button>
              <div className="provider-line">{provider} · {smartImageModeLabel(resolvedSmartMode)}</div>
            </div>
            {submitError ? <ErrorSummaryButton compact title="画图实验室操作失败" fullMessage={submitError} /> : null}
            <InlineActionFeedback feedback={imageLabAction.feedback} />
          </aside>
        </div>
      </section>

      <Dialog open={Boolean(expandedReferenceImage)} title="参考图预览" surfaceClassName="image-lab-preview-dialog" onOpenChange={(open) => { if (!open) setExpandedReferenceImage(''); }} actions={<Button onClick={() => setExpandedReferenceImage('')}>关闭</Button>}>
        {expandedReferenceImage ? <img src={toLocalImageUrl(expandedReferenceImage)} alt="参考图预览" /> : null}
      </Dialog>

      <section className="local-lab-media image-lab-recent">
        <div className="image-lab-recent-head">
          <h3>最近生成 · {state.imageLabRecords.length}</h3>
          <Button density="compact" icon={<RefreshCcw size={15} />} onClick={retryFailedImageLabRecords} disabled={generating || imageLabAction.busy || failedRecords.length === 0}>
            重试全部失败项 ({failedRecords.length})
          </Button>
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
              {record.status === 'generated' && record.originalImagePath ? (
                <div className="image-record-cutout" aria-label="透明主体处理状态">
                  <div className={`image-record-cutout-status ${record.cutoutQuality ?? 'pending'}`}>
                    <strong>{record.cutoutQuality === 'passed' && record.cutoutImagePath ? '当前：透明图' : '当前：原图'}</strong>
                    <span>{cutoutQualityLabel(record.cutoutQuality)} · {cutoutMethodLabel(record.cutoutMethod)}</span>
                  </div>
                  <small>
                    原图已保留
                    {record.cutoutQuality ? ` · 透明 ${alphaPercent(record.cutoutTransparentFraction)} · 前景 ${alphaPercent(record.cutoutForegroundFraction)} · 边缘 ${alphaPercent(record.cutoutEdgeFraction)}` : ' · 尚未建立透明主体'}
                  </small>
                  {record.cutoutErrorMessage ? <ErrorSummaryButton compact title="去底失败" fullMessage={record.cutoutErrorMessage} /> : null}
                </div>
              ) : null}
              <div className="image-record-actions">
                {record.status === 'generated' && record.imagePath ? <Button density="compact" variant="subtle" icon={<Save size={14} />} disabled={imageLabAction.busy} onClick={() => void saveImageToLibrary(record)}>存入素材库</Button> : null}
                {record.status === 'generated' && record.originalImagePath ? (
                  <Button
                    variant="subtle"
                    density="compact"
                    icon={<Wand2 size={14} />}
                    className="image-record-cutout-action"
                    onClick={() => retryImageLabBackground(record)}
                    disabled={generating || imageLabAction.busy}
                    title="只重新处理透明主体，不会重新调用生图模型"
                  >
                    {record.cutoutQuality ? '重试去底' : '去底'}
                  </Button>
                ) : null}
                {record.status === 'failed' ? (
                  <Button density="compact" icon={<RotateCcw size={14} />} title="按原参数创建一次新尝试" onClick={() => retryImageLabRecord(record)} disabled={generating || imageLabAction.busy}>
                    重试
                  </Button>
                ) : null}
                <Button density="compact" icon={<RefreshCcw size={14} />} onClick={() => refillImageLabPrompt(record)} disabled={imageLabAction.busy}>
                  回填提示词
                </Button>
                <Button density="compact" icon={<Copy size={14} />} onClick={() => copyImageLabTaskId(record)} disabled={imageLabAction.busy}>
                  复制任务 ID
                </Button>
                <Button density="compact" icon={<FolderOpen size={14} />} onClick={() => openImageLabOutputDirectory(record)} disabled={imageLabAction.busy}>
                  打开目录
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
      {libraryPicker ? <LibraryPicker api={api} kind={libraryPicker} title={libraryPicker === 'image' ? '选择参考图' : '选择提示文本'} actionLabel={libraryPicker === 'image' ? '添加参考图' : '追加到需求描述'} onClose={() => setLibraryPicker(null)} onChoose={(selection) => {
        if (selection.kind === 'image' && selection.imagePath) {
          if (references.length >= referenceLimit) throw new Error('参考图已达到上限，请先移除一张。');
          appendReferenceImagePaths(selection.imagePath);
        } else if (selection.text) setPrompt((current) => [current.trim(), selection.text].filter(Boolean).join('\n\n'));
      }} /> : null}
      {libraryDraft ? <LibrarySaveDialog api={api} draft={libraryDraft} onClose={() => setLibraryDraft(null)} /> : null}
    </div>
  );
}

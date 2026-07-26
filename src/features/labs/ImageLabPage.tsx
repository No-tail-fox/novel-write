import { useState } from 'react';
import { Image as ImageIcon, ImagePlus, Loader2, Wand2 } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { ErrorDetails as ErrorSummaryButton } from '../../components/ErrorDetails';
import { FormField as Field } from '../../components/FormField';
import { OptionGroup as OptionCloud } from '../../components/OptionGroup';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { AspectRatioSwatch } from '../../components/AspectRatioSwatch';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult, ImageLabSmartMode } from '../../shared/types';
import { styleOptions } from '../../shared/editorial-options';
import { useAsyncAction } from '../../ui/async-action';
import { formatDate, toLocalImageUrl } from '../tasks/task-formatters';
import { parseReferenceImagePaths, resolveImageLabSmartMode, smartImageModeLabel } from './image-lab-helpers';
import '../../styles/features/local-labs.css';

type ImageResolution = '1K' | '2K' | '4K';

export function ImageLabPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [tab, setTab] = useState<'smart' | 'text' | 'reference'>('smart');
  const [smartMode] = useState<ImageLabSmartMode>('podcast-cover');
  const [prompt, setPrompt] = useState('根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，保持参考图主体和质感。');
  const [ratio, setRatio] = useState('9:16');
  const [style, setStyle] = useState('photo-real');
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [referencePasteDraft, setReferencePasteDraft] = useState('');
  const [imageLabOutputCount, setImageLabOutputCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [expandedReferenceImage, setExpandedReferenceImage] = useState('');
  const imageLabAction = useAsyncAction();
  const referenceLimit = 10;
  const referenceCandidates = parseReferenceImagePaths(referenceImagePath);
  const references = referenceCandidates.slice(0, referenceLimit);
  const hiddenReferenceCount = Math.max(0, referenceCandidates.length - references.length);
  const referenceModeDescription = tab === 'smart'
    ? '智能规划多张图，可带参考图；适合根据需求批量出教程图、封面和分镜图。'
    : tab === 'reference'
      ? '参考图编辑/延展，需要先添加参考图；适合保留主体、材质和画面一致性。'
      : '纯文本生成单张图，不使用参考图。';
  const baseSmartMode: ImageLabSmartMode = tab === 'smart' ? smartMode : tab === 'reference' ? 'reference-edit' : 'text-to-image';
  const imageLabRatioChoices = [
    ['21:9', '宽屏'],
    ['16:9', '横屏'],
    ['3:2', '标准横'],
    ['4:3', '标准'],
    ['1:1', '方形'],
    ['3:4', '标准竖'],
    ['2:3', '竖图'],
    ['9:16', '竖屏'],
  ];
  const estimatedCost = resolution === '1K' ? '0.08' : resolution === '2K' ? '0.16' : '0.32';
  const resolvedSmartMode = resolveImageLabSmartMode(tab, baseSmartMode, references);

  async function selectImageLabReferenceImage() {
    await imageLabAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setReferenceImagePath((current) => [...parseReferenceImagePaths(current), imagePath].join('\n'));
    });
  }

  function removeReferenceImagePath(reference: string) {
    setReferenceImagePath((current) => parseReferenceImagePaths(current).filter((item) => item !== reference).join('\n'));
    if (expandedReferenceImage === reference) {
      setExpandedReferenceImage('');
    }
  }

  function appendReferenceImagePaths(value: string) {
    const nextPaths = parseReferenceImagePaths(value);
    if (!nextPaths.length) return;
    setReferenceImagePath((current) => {
      const merged = [...parseReferenceImagePaths(current), ...nextPaths];
      return Array.from(new Set(merged)).join('\n');
    });
  }

  async function addRecord() {
    if (generating) return;
    await imageLabAction.run(async () => {
      setGenerating(true);
      setSubmitError('');
      try {
        const requestedCount = tab === 'text' ? 1 : Math.max(1, Math.min(10, imageLabOutputCount));
        let nextState: AppMutationResult | null = null;
        for (let index = 0; index < requestedCount; index += 1) {
          nextState = await api.generateImageLab({
            prompt,
            ratio,
            style,
            resolution,
            smartMode: resolvedSmartMode,
            referenceImagePath: references[0] ?? '',
            referenceImagePaths: references,
          });
        }
        applyState(nextState);
      } finally {
        setGenerating(false);
      }
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
        ratio,
        style,
        provider: state.config.imageProvider,
        imagePath,
        resolution,
        smartMode: resolvedSmartMode,
        referenceImagePath: references[0] ?? '',
        referenceImagePaths: references,
      });
      applyState(nextState);
    }, { onError: (error) => setSubmitError(error.message) });
  }

  return (
    <div className="local-lab-workbench image-lab-page" data-local-lab-workbench="image-lab">
      <section className="local-lab-main image-lab-workbench">
        <Segmented label="模式" value={tab} options={['smart', 'text', 'reference']} labels={['智慧生图', '文生图', '图像参考']} onChange={(value) => setTab(value as 'smart' | 'text' | 'reference')} />
        <div className="image-lab-mode-note">{referenceModeDescription}</div>
        <div className="image-lab-editor-grid">
          <div className="image-lab-primary-column">
            {tab !== 'text' ? (
              <div className="image-lab-reference-block">
            <div className="image-lab-section-head">
              <strong>参考图</strong>
              <small>建议统一 IP 形象，最多 {referenceLimit} 张 · 已选 {references.length}</small>
            </div>
            <div className="image-lab-dropzone">
              <button className="image-lab-upload-card" type="button" disabled={imageLabAction.busy} onClick={selectImageLabReferenceImage}>
                <ImageIcon size={18} />
                添加参考图
              </button>
              <span>
                <strong>选择或粘贴本地图片路径作为参考</strong>
                <small>支持 PNG / JPG / WEBP，每行一张，最多 {referenceLimit} 张会参与生成</small>
              </span>
            </div>
            <textarea
              className="reference-image-list"
              value={referencePasteDraft}
              placeholder="粘贴本地图片路径，每行一张；粘贴后下方只显示缩略图"
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
              <textarea className="prompt-box image-lab-prompt" value={prompt} placeholder="例如：根据食谱内容，规划 2-3 张美食教程图，合成品图、灵魂文案、制作步骤，不要点赞元素" onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            {tab !== 'text' ? (
              <div className="image-lab-slider">
                <div className="image-lab-section-head">
                  <strong>出图数量上限</strong>
                  <small>普通上限设为 10 张</small>
                </div>
                <input type="range" min={1} max={10} step={1} value={imageLabOutputCount} onChange={(event) => setImageLabOutputCount(Number(event.target.value))} />
                <strong>{imageLabOutputCount} 张</strong>
                <small>AI 会读懂需求，规划成最多 10 张图；每张图文案需进图里。</small>
              </div>
            ) : null}
          </div>
          <aside className="image-lab-inspector">
            <div className="image-lab-control-group">
          <div className="image-lab-section-head">
            <strong>比例</strong>
            <small>可多选体验保留为单选，已选 {ratio}</small>
          </div>
          <div className="image-lab-ratio-grid">
            {imageLabRatioChoices.map(([value, label]) => (
              <button key={value} className={ratio === value ? 'selected' : ''} onClick={() => setRatio(value)} type="button">
                <AspectRatioSwatch ratio={value} />
                <strong>{value}</strong>
                <small>{label}</small>
              </button>
            ))}
          </div>
            </div>
            <OptionCloud title="风格" options={styleOptions} value={style} onChange={setStyle} />
            <Segmented label="分辨率" value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as ImageResolution)} />
            <div className="image-lab-footer">
              <button className="ghost-action" type="button" onClick={importCompletedImage} disabled={generating || imageLabAction.busy || !prompt.trim()}>
                <ImagePlus size={17} />
                导入成品
              </button>
              <button className="primary-action" onClick={addRecord} disabled={generating || !prompt.trim() || (resolvedSmartMode === 'reference-edit' && references.length === 0)}>
                {generating ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
                {generating ? '生成中' : '智能生成'}
              </button>
              <div className="provider-line">当前 Provider：<strong>{state.config.imageProvider}</strong> · {smartImageModeLabel(resolvedSmartMode)} · 预计消耗 ￥{estimatedCost}</div>
            </div>
            {submitError ? <ErrorSummaryButton compact title="画图实验室提交失败" fullMessage={submitError} /> : null}
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
        <h3>最近生成 · {state.imageLabRecords.length}</h3>
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
            <strong>{record.prompt}</strong>
            <small>{record.provider} · {record.ratio} · {record.resolution} · {smartImageModeLabel(record.smartMode)} · {formatDate(record.createdAt)}</small>
            {record.errorMessage ? <ErrorSummaryButton compact title="生图失败" fullMessage={record.errorMessage} /> : null}
          </article>
          ))}
        </div>
      </section>
    </div>
  );

}

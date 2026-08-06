import { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, LayoutTemplate, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { AppMutationResult, DraftTemplate, DraftTextBorder, JianyingEffectCatalog } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { draftImageMotions, draftTemplates as builtinDraftTemplates, imageAnimations } from '../../shared/templates';
import { convertCozeWorkflowToDraftTemplate, convertManyCozeWorkflowsToDraftTemplates, type CozeWorkflowTemplateConversionResult } from '../../shared/coze-workflow-converter';
import { useAsyncAction } from '../../ui/async-action';
import { FormField as Field } from '../../components/FormField';
import { SegmentedControl as Segmented } from '../../components/SegmentedControl';
import { ToggleField } from '../../components/ToggleField';
import { RangeField } from '../../components/RangeField';
import { Accordion } from '../../components/Accordion';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { fallbackEffectCatalog } from '../../shared/editorial-options';
import { DRAFT_TEXT_WIDTH_MAX, DRAFT_TEXT_WIDTH_MIN, DraftTemplatePreview, EditableDraftCanvas, applyDraftCanvasRatio, applyDraftImageRatio, clamp, cloneDraftTemplate, firstVisibleDraftLayer, isDraftLayerVisible, normalizeColorInput, type DraftCanvasLayer } from './DraftCanvas';

export function DraftTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [templateDetails, setTemplateDetails] = useState<Record<string, DraftTemplate>>({});
  const galleryTemplates = state.draftTemplates.map((template) => resolveDraftTemplateDetail(template, templateDetails[template.id]));
  const editingTemplate = editingId ? galleryTemplates.find((template) => template.id === editingId) ?? null : null;
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [animationPreview, setAnimationPreview] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<DraftCanvasLayer>('title');
  const [expandedLayerPanels, setExpandedLayerPanels] = useState<Record<DraftCanvasLayer, boolean>>({
    image: true,
    title: false,
    subtitle: false,
    caption: false,
    disclaimer: false,
  });
  const [layerPanelScrollRequest, setLayerPanelScrollRequest] = useState<{ layer: DraftCanvasLayer; id: number } | null>(null);
  const [effectCatalog, setEffectCatalog] = useState<JianyingEffectCatalog>(fallbackEffectCatalog);
  const [cozeWorkflowSource, setCozeWorkflowSource] = useState('');
  const [cozeImportName, setCozeImportName] = useState('');
  const [cozeImportResult, setCozeImportResult] = useState<Extract<CozeWorkflowTemplateConversionResult, { ok: true }> | null>(null);
  const [cozeImportResults, setCozeImportResults] = useState<CozeWorkflowTemplateConversionResult[]>([]);
  const [cozeImportError, setCozeImportError] = useState('');
  const [cozeImportOpen, setCozeImportOpen] = useState(false);
  const [pendingDeleteTemplate, setPendingDeleteTemplate] = useState<DraftTemplate | null>(null);
  const draftTemplateAction = useAsyncAction();
  const draftDetailGeneration = useRef(0);
  const draftControlsRef = useRef<HTMLElement | null>(null);
  const editorReady = Boolean(editingId && draft);

  useEffect(() => {
    // Rehydrate only when switching templates; state refreshes must not overwrite unsaved drag edits.
    const currentEditingTemplate = galleryTemplates.find((template) => template.id === editingId) ?? null;
    setDraft(currentEditingTemplate ? cloneDraftTemplate(currentEditingTemplate) : null);
  }, [editingId]);

  useEffect(() => {
    let disposed = false;
    const summaries = state.draftTemplates;
    void Promise.all(summaries.map(async (template) => {
      try {
        return { id: template.id, detail: await api.getDraftTemplateDetail(template.id), error: null };
      } catch (error) {
        return { id: template.id, detail: null, error };
      }
    })).then((results) => {
      if (disposed) return;
      const loaded = new Map(results.map((result) => [result.id, result.detail]));
      setTemplateDetails((current) => {
        const next: Record<string, DraftTemplate> = {};
        for (const summary of summaries) {
          const detail = loaded.get(summary.id) ?? current[summary.id];
          if (detail && resolveDraftTemplateDetail(summary, detail) === detail) next[summary.id] = detail;
        }
        return next;
      });
      const failed = results.find((result) => result.error)?.error;
      if (failed) draftTemplateAction.reportError(failed);
    });
    return () => {
      disposed = true;
    };
  }, [api, state.draftTemplates, draftTemplateAction.reportError]);

  useEffect(() => {
    let disposed = false;
    api
      .getJianyingEffectCatalog()
      .then((catalog) => {
        if (!disposed) setEffectCatalog(catalog);
      })
      .catch((error) => {
        if (!disposed) {
          setEffectCatalog(fallbackEffectCatalog);
          draftTemplateAction.reportError(error);
        }
      });
    return () => {
      disposed = true;
    };
  }, [api, draftTemplateAction.reportError]);

  useEffect(() => {
    if (!draft || isDraftLayerVisible(draft, selectedLayer)) return;
    const nextLayer = firstVisibleDraftLayer(draft);
    setSelectedLayer(nextLayer);
    setExpandedLayerPanels((current) => (current[nextLayer] ? current : { ...current, [nextLayer]: true }));
    setLayerPanelScrollRequest((current) => ({ layer: nextLayer, id: (current?.id ?? 0) + 1 }));
  }, [draft, selectedLayer]);

  useEffect(() => {
    if (!editorReady || !draft) return;
    const nextLayer = isDraftLayerVisible(draft, selectedLayer) ? selectedLayer : firstVisibleDraftLayer(draft);
    setSelectedLayer(nextLayer);
    setExpandedLayerPanels((current) => (current[nextLayer] ? current : { ...current, [nextLayer]: true }));
    setLayerPanelScrollRequest((current) => ({ layer: nextLayer, id: (current?.id ?? 0) + 1 }));
  }, [editingId, editorReady]);

  useEffect(() => {
    const controls = draftControlsRef.current;
    if (!editorReady || !layerPanelScrollRequest || !controls) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = controls.querySelector<HTMLElement>(`[data-draft-layer-panel="${layerPanelScrollRequest.layer}"]`);
      if (!panel) return;
      const containerRect = controls.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      controls.scrollTo({
        top: Math.max(0, controls.scrollTop + panelRect.top - containerRect.top - 8),
        behavior: 'smooth',
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editorReady, layerPanelScrollRequest]);

  function handleDraftLayerSelection(layer: DraftCanvasLayer) {
    setSelectedLayer(layer);
    setExpandedLayerPanels((current) => (current[layer] ? current : { ...current, [layer]: true }));
    setLayerPanelScrollRequest((current) => ({ layer, id: (current?.id ?? 0) + 1 }));
  }

  function handleLayerPanelExpanded(layer: DraftCanvasLayer, expanded: boolean) {
    setExpandedLayerPanels((current) => ({ ...current, [layer]: expanded }));
  }

  function applyDraftTemplateMutation(result: AppMutationResult | null): DraftTemplate | null {
    applyState(result);
    if (result?.kind !== 'state-patch' || result.patch.kind !== 'draft-template-upsert') return null;
    const saved = result.patch.template;
    setTemplateDetails((current) => ({ ...current, [saved.id]: saved }));
    return saved;
  }

  async function save() {
    if (!draft) return;
    await draftTemplateAction.run(async () => {
      const saved = applyDraftTemplateMutation(await api.saveDraftTemplate(draft));
      if (saved) setDraft(cloneDraftTemplate(saved));
    });
  }

  async function copyTemplate(template: DraftTemplate) {
    await draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id) ?? template;
      const copy = { ...cloneDraftTemplate(detail), id: crypto.randomUUID(), name: `${detail.name} 副本`, isDefault: false };
      applyDraftTemplateMutation(await api.saveDraftTemplate(copy));
      setEditingId(copy.id);
    });
  }

  async function createTemplate() {
    const base = cloneDraftTemplate(builtinDraftTemplates[0]);
    const next = { ...base, id: crypto.randomUUID(), name: '新模板', isDefault: false };
    await draftTemplateAction.run(async () => {
      applyDraftTemplateMutation(await api.saveDraftTemplate(next));
      setEditingId(next.id);
    });
  }

  async function deleteTemplate() {
    const template = pendingDeleteTemplate;
    if (!template || template.isDefault) return;
    await draftTemplateAction.run(async () => {
      applyState(await api.deleteDraftTemplate(template.id));
      setPendingDeleteTemplate(null);
    });
  }

  function previewCozeWorkflowTemplate() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    const result = results[0] ?? convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    setCozeImportResults(results);
    if (!result.ok || results.some((item) => !item.ok)) {
      setCozeImportResult(null);
      setCozeImportError(!result.ok ? result.error : '部分 Coze 工作流转换失败，请检查源码。');
      return;
    }
    setCozeImportResult(result);
    setCozeImportError('');
    if (!cozeImportName.trim()) setCozeImportName(result.template.name);
  }

  async function saveCozeWorkflowTemplate() {
    const result = convertCozeWorkflowToDraftTemplate(cozeWorkflowSource, { name: cozeImportName });
    if (!result.ok) {
      setCozeImportResult(null);
      setCozeImportError(result.error);
      return;
    }
    const template = cozeImportName.trim() ? { ...result.template, name: cozeImportName.trim() } : result.template;
    await draftTemplateAction.run(async () => {
      applyDraftTemplateMutation(await api.saveDraftTemplate(template));
      setCozeImportResult({ ...result, template });
      setCozeImportError('');
      setEditingId(template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  async function saveAllCozeWorkflowTemplates() {
    const results = convertManyCozeWorkflowsToDraftTemplates(cozeWorkflowSource, { namePrefix: cozeImportName.trim() || undefined });
    setCozeImportResults(results);
    const failures = results.filter((result) => !result.ok);
    if (failures.length) {
      setCozeImportResult(null);
      setCozeImportError(`${failures.length} 个 Coze 工作流转换失败。`);
      return;
    }
    await draftTemplateAction.run(async () => {
      let nextState: AppMutationResult | null = null;
      for (const result of results) {
        if (!result.ok) continue;
        nextState = await api.saveDraftTemplate(result.template);
        applyDraftTemplateMutation(nextState);
      }
      const first = results.find((result): result is Extract<CozeWorkflowTemplateConversionResult, { ok: true }> => result.ok) ?? null;
      setCozeImportResult(first);
      setCozeImportError('');
      if (first) setEditingId(first.template.id);
    }, { onError: (error) => setCozeImportError(error.message) });
  }

  function openEditor(template: DraftTemplate) {
    const generation = ++draftDetailGeneration.current;
    setDraft(cloneDraftTemplate(template));
    setEditingId(template.id);
    void draftTemplateAction.run(async () => {
      const detail = await api.getDraftTemplateDetail(template.id);
      if (generation === draftDetailGeneration.current && detail) {
        setTemplateDetails((current) => ({ ...current, [detail.id]: detail }));
        setDraft(cloneDraftTemplate(detail));
      }
    });
  }

  async function selectDraftBackgroundImage() {
    await draftTemplateAction.run(async () => {
      const imagePath = await api.selectLocalImage();
      if (!imagePath) return;
      setDraft((current) => (current ? { ...current, canvas: { ...current.canvas, backgroundImage: imagePath } } : current));
    });
  }

  function updateDraftImage(patch: Partial<DraftTemplate['image']>) {
    setDraft((current) => (current ? { ...current, image: { ...current.image, ...patch } } : current));
  }

  function updateDraftFrame(patch: Partial<DraftTemplate['frame']>) {
    setDraft((current) => (current ? { ...current, frame: { ...current.frame, ...patch } } : current));
  }

  function updateDraftTitle(patch: Partial<DraftTemplate['title']>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, ...patch } } : current));
  }

  function updateDraftSubtitle(patch: Partial<DraftTemplate['subtitle']>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, ...patch } } : current));
  }

  function updateDraftCaption(patch: Partial<DraftTemplate['caption']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, ...patch } } : current));
  }

  function updateDraftCaptionBackground(patch: Partial<DraftTemplate['caption']['background']>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, background: { ...current.caption.background, ...patch } } } : current));
  }

  function updateDraftCaptionWidth(value: number) {
    updateDraftCaption({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) });
  }

  function updateDraftDisclaimer(patch: Partial<DraftTemplate['disclaimer']>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, ...patch } } : current));
  }

  function updateDraftTitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, title: { ...current.title, border: { ...current.title.border, ...patch } } } : current));
  }

  function updateDraftSubtitleBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, subtitle: { ...current.subtitle, border: { ...current.subtitle.border, ...patch } } } : current));
  }

  function updateDraftCaptionBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, caption: { ...current.caption, border: { ...current.caption.border, ...patch } } } : current));
  }

  function updateDraftDisclaimerBorder(patch: Partial<DraftTextBorder>) {
    setDraft((current) => (current ? { ...current, disclaimer: { ...current.disclaimer, border: { ...current.disclaimer.border, ...patch } } } : current));
  }

  if (editingId && draft) {
    return (
      <div className="draft-template-page">
        <div className="editor-topbar">
          <button className="ghost-action" onClick={() => setEditingId(null)}>返回模板列表</button>
          <input className="template-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : draft)}>取消</button>
            <button className="primary-action slim" disabled={draftTemplateAction.busy} onClick={save}><Save size={15} />保存</button>
          </div>
        </div>
        <InlineActionFeedback feedback={draftTemplateAction.feedback} />

        <div className="draft-editor-shell focused">
          <section className="draft-stage">
            <div className="panel-title-row">
              <div>
                <h2>{draft.name}</h2>
                <span className="hint-text">{draft.canvas.ratio} · {draft.canvas.width}x{draft.canvas.height} · {draft.image.animation}</span>
              </div>
              <button className="ghost-action" disabled={draftTemplateAction.busy} onClick={() => copyTemplate(draft)}><Copy size={15} />复制</button>
            </div>
            <EditableDraftCanvas template={draft} selectedLayer={selectedLayer} animationPreview={animationPreview} onSelectLayer={handleDraftLayerSelection} onChange={setDraft} />
          </section>

          <section ref={draftControlsRef} className="panel draft-controls">
            <Accordion title="画布设置" open>
              <Segmented label="比例" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft(applyDraftCanvasRatio(draft, value))} />
              <Field label="尺寸"><input value={`${draft.canvas.width}x${draft.canvas.height}`} readOnly /></Field>
              <Field label="底色">
                <div className="draft-background-field with-swatch">
                  <input className="draft-background-swatch" type="color" value={normalizeColorInput(draft.canvas.backgroundColor)} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                  <input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                </div>
              </Field>
              <Field label="背景图">
                <div className="draft-background-field">
                  <input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} placeholder="留空 = 无背景图" />
                  <button className="ghost-action" type="button" disabled={draftTemplateAction.busy} onClick={selectDraftBackgroundImage}><FolderOpen size={14} />浏览</button>
                  <button className="ghost-action" type="button" onClick={() => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: '' } })}>清空</button>
                </div>
              </Field>
            </Accordion>
            <div data-draft-layer-panel="image">
              <Accordion title="图片区域" expanded={expandedLayerPanels.image} onExpandedChange={(expanded) => handleLayerPanelExpanded('image', expanded)}>
                <ToggleField label="显示" checked={draft.image.visible} onChange={(checked) => updateDraftImage({ visible: checked })} />
                <Segmented label="图片比例" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft(applyDraftImageRatio(draft, value))} />
                <Segmented label="适配" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => updateDraftImage({ fit: value as 'cover' | 'contain' })} />
                <Field label="坐标"><input value={`top ${draft.image.top.toFixed(2)}, height ${draft.image.height.toFixed(2)}`} readOnly /></Field>
                <RangeField label="垂直位置" min={-1} max={1} step={0.01} value={draft.image.top} onChange={(value) => updateDraftImage({ top: value })} />
                <RangeField label="高度占比" min={0} max={1} step={0.01} value={draft.image.height} onChange={(value) => updateDraftImage({ height: value })} />
                <AnimationPresetPicker label="动画效果" value={draft.image.animation} options={imageAnimations} previewValue={animationPreview} onPreview={setAnimationPreview} onChange={(value) => updateDraftImage({ animation: value })} />
              </Accordion>
            </div>
            <Accordion title="运镜">
              <Field label="运镜方式">
                <select value={draft.image.motion} onChange={(event) => updateDraftImage({ motion: event.target.value as DraftTemplate['image']['motion'] })}>
                  {draftImageMotions.map((option) => <option key={option.value || 'none'} value={option.value}>{option.label}</option>)}
                </select>
              </Field>
              <RangeField label="运镜强度" min={0} max={2} step={0.1} value={draft.image.motionStrength} onChange={(value) => updateDraftImage({ motionStrength: value })} />
            </Accordion>
            <Accordion title="分栏画框">
              <ToggleField label="启用画框" checked={draft.frame.enabled} onChange={(enabled) => updateDraftFrame({ enabled })} />
              <div className="draft-frame-color-grid">
                <ColorField label="顶部起始色" value={draft.frame.headerColor} onChange={(headerColor) => updateDraftFrame({ headerColor })} />
                <ColorField label="顶部结束色" value={draft.frame.headerColorEnd} onChange={(headerColorEnd) => updateDraftFrame({ headerColorEnd })} />
                <ColorField label="底部起始色" value={draft.frame.footerColor} onChange={(footerColor) => updateDraftFrame({ footerColor })} />
                <ColorField label="底部结束色" value={draft.frame.footerColorEnd} onChange={(footerColorEnd) => updateDraftFrame({ footerColorEnd })} />
              </div>
              <ColorField label="图片边框色" value={draft.frame.imageBorderColor} onChange={(imageBorderColor) => updateDraftFrame({ imageBorderColor })} />
              <RangeField label="图片边框宽度" min={0} max={120} step={1} value={draft.frame.imageBorderWidth} onChange={(imageBorderWidth) => updateDraftFrame({ imageBorderWidth })} />
              <Field label="边框方向">
                <select value={draft.frame.imageBorderSides} onChange={(event) => updateDraftFrame({ imageBorderSides: event.target.value as DraftTemplate['frame']['imageBorderSides'] })}>
                  <option value="all">四边</option>
                  <option value="horizontal">上下</option>
                  <option value="vertical">左右</option>
                </select>
              </Field>
            </Accordion>
            <div data-draft-layer-panel="title">
            <Accordion title="主标题" expanded={expandedLayerPanels.title} onExpandedChange={(expanded) => handleLayerPanelExpanded('title', expanded)}>
              <ToggleField label="显示" checked={draft.title.visible} onChange={(checked) => updateDraftTitle({ visible: checked })} />
              <Field label="文字"><input value={draft.title.text} onChange={(event) => updateDraftTitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.title.x.toFixed(2)}, ${draft.title.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.title.width} onChange={(value) => updateDraftTitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={1} max={120} step={1} value={draft.title.fontSize} onChange={(value) => updateDraftTitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.title.color} onChange={(value) => updateDraftTitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.title.alpha} onChange={(value) => updateDraftTitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.title.bold} onChange={(checked) => updateDraftTitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.title.underline} onChange={(checked) => updateDraftTitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.title.align)} onChange={(event) => updateDraftTitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.title.letterSpacing} onChange={(value) => updateDraftTitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.title.lineSpacing} onChange={(value) => updateDraftTitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.title.border} onChange={updateDraftTitleBorder} />
            </Accordion>
            </div>
            <div data-draft-layer-panel="subtitle">
            <Accordion title="副标题" expanded={expandedLayerPanels.subtitle} onExpandedChange={(expanded) => handleLayerPanelExpanded('subtitle', expanded)}>
              <ToggleField label="显示" checked={draft.subtitle.visible} onChange={(checked) => updateDraftSubtitle({ visible: checked })} />
              <Field label="文字"><input value={draft.subtitle.text} onChange={(event) => updateDraftSubtitle({ text: event.target.value })} /></Field>
              <Field label="坐标"><input value={`${draft.subtitle.x.toFixed(2)}, ${draft.subtitle.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.subtitle.width} onChange={(value) => updateDraftSubtitle({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={1} max={72} step={1} value={draft.subtitle.fontSize} onChange={(value) => updateDraftSubtitle({ fontSize: value })} />
              <ColorField label="颜色" value={draft.subtitle.color} onChange={(value) => updateDraftSubtitle({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.subtitle.alpha} onChange={(value) => updateDraftSubtitle({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.subtitle.bold} onChange={(checked) => updateDraftSubtitle({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.subtitle.underline} onChange={(checked) => updateDraftSubtitle({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.subtitle.align)} onChange={(event) => updateDraftSubtitle({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.subtitle.letterSpacing} onChange={(value) => updateDraftSubtitle({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.subtitle.lineSpacing} onChange={(value) => updateDraftSubtitle({ lineSpacing: value })} />
              <TextBorderControls border={draft.subtitle.border} onChange={updateDraftSubtitleBorder} />
            </Accordion>
            </div>
            <div data-draft-layer-panel="caption">
            <Accordion title="字幕" expanded={expandedLayerPanels.caption} onExpandedChange={(expanded) => handleLayerPanelExpanded('caption', expanded)}>
              <ToggleField label="显示" checked={draft.caption.visible} onChange={(checked) => updateDraftCaption({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.caption.x.toFixed(2)}, ${draft.caption.y.toFixed(2)}`} readOnly /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.caption.width} onChange={updateDraftCaptionWidth} />
              <RangeField label="字号" min={1} max={48} step={1} value={draft.caption.fontSize} onChange={(value) => updateDraftCaption({ fontSize: value })} />
              <ColorField label="颜色" value={draft.caption.color} onChange={(value) => updateDraftCaption({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.caption.alpha} onChange={(value) => updateDraftCaption({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.caption.bold} onChange={(checked) => updateDraftCaption({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.caption.underline} onChange={(checked) => updateDraftCaption({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.caption.align)} onChange={(event) => updateDraftCaption({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.caption.letterSpacing} onChange={(value) => updateDraftCaption({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.caption.lineSpacing} onChange={(value) => updateDraftCaption({ lineSpacing: value })} />
              <RangeField label="每行字数" min={1} max={80} step={1} value={draft.caption.maxCharsPerLine} onChange={(value) => updateDraftCaption({ maxCharsPerLine: value })} />
              <ColorField label="背景色" value={draft.caption.background.color} onChange={(value) => updateDraftCaptionBackground({ color: value })} />
              <RangeField label="背景透明度" min={0} max={1} step={0.05} value={draft.caption.background.alpha} onChange={(value) => updateDraftCaptionBackground({ alpha: value })} />
              <RangeField label="圆角" min={0} max={1} step={0.05} value={draft.caption.background.roundRadius} onChange={(value) => updateDraftCaptionBackground({ roundRadius: value })} />
              <TextBorderControls border={draft.caption.border} onChange={updateDraftCaptionBorder} />
            </Accordion>
            </div>
            <div data-draft-layer-panel="disclaimer">
            <Accordion title="免责声明" expanded={expandedLayerPanels.disclaimer} onExpandedChange={(expanded) => handleLayerPanelExpanded('disclaimer', expanded)}>
              <ToggleField label="显示" checked={draft.disclaimer.visible} onChange={(checked) => updateDraftDisclaimer({ visible: checked })} />
              <Field label="坐标"><input value={`${draft.disclaimer.x.toFixed(2)}, ${draft.disclaimer.y.toFixed(2)}`} readOnly /></Field>
              <Field label="文字"><input value={draft.disclaimer.text} onChange={(event) => updateDraftDisclaimer({ text: event.target.value })} /></Field>
              <RangeField label="文本框宽度" min={DRAFT_TEXT_WIDTH_MIN} max={DRAFT_TEXT_WIDTH_MAX} step={0.01} value={draft.disclaimer.width} onChange={(value) => updateDraftDisclaimer({ width: clamp(value, DRAFT_TEXT_WIDTH_MIN, DRAFT_TEXT_WIDTH_MAX) })} />
              <RangeField label="字号" min={1} max={40} step={1} value={draft.disclaimer.fontSize} onChange={(value) => updateDraftDisclaimer({ fontSize: value })} />
              <ColorField label="颜色" value={draft.disclaimer.color} onChange={(value) => updateDraftDisclaimer({ color: value })} />
              <RangeField label="透明度" min={0} max={1} step={0.05} value={draft.disclaimer.alpha} onChange={(value) => updateDraftDisclaimer({ alpha: value })} />
              <ToggleField label="加粗" checked={draft.disclaimer.bold} onChange={(checked) => updateDraftDisclaimer({ bold: checked })} />
              <ToggleField label="下划线" checked={draft.disclaimer.underline} onChange={(checked) => updateDraftDisclaimer({ underline: checked })} />
              <Field label="对齐">
                <select value={String(draft.disclaimer.align)} onChange={(event) => updateDraftDisclaimer({ align: Number(event.target.value) })}>
                  <option value="0">左对齐</option>
                  <option value="1">居中</option>
                  <option value="2">右对齐</option>
                </select>
              </Field>
              <RangeField label="字间距" min={0} max={20} step={1} value={draft.disclaimer.letterSpacing} onChange={(value) => updateDraftDisclaimer({ letterSpacing: value })} />
              <RangeField label="行间距" min={0} max={20} step={1} value={draft.disclaimer.lineSpacing} onChange={(value) => updateDraftDisclaimer({ lineSpacing: value })} />
              <TextBorderControls border={draft.disclaimer.border} onChange={updateDraftDisclaimerBorder} />
            </Accordion>
            </div>
            <Accordion title="音频设置">
              <Field label="旁白音量"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 音量"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
              <Field label="转场">
                <select value={draft.audio.transitionType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.transitions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="转场时长(ms)"><input type="number" value={draft.audio.transitionDurationMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionDurationMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡入(ms)"><input type="number" value={draft.audio.narrationFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡出(ms)"><input type="number" value={draft.audio.narrationFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡入(ms)"><input type="number" value={draft.audio.bgmFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡出(ms)"><input type="number" value={draft.audio.bgmFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="滤镜">
                <select value={draft.audio.filterType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, filterType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.filters.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="视频特效">
                <select value={draft.audio.videoEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, videoEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.videoEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="音频特效">
                <select value={draft.audio.audioEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, audioEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.audioEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
            </Accordion>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-template-page">
      <div className="panel-title-row draft-template-toolbar">
        <div>
          <h2>草稿模板</h2>
          <span className="hint-text">内置模板：默认竖屏、竖屏4:3、横屏16:9；自定义模板保存在本机。</span>
        </div>
        <div className="button-row">
          <button className="ghost-action" type="button" onClick={() => setCozeImportOpen(true)}><Upload size={15} />导入 Coze 模板</button>
          <button className="primary-action slim" aria-label="新建草稿模板" disabled={draftTemplateAction.busy} onClick={createTemplate}><Plus size={15} />新模板</button>
        </div>
      </div>
      <InlineActionFeedback feedback={draftTemplateAction.feedback} />

      {cozeImportOpen ? (
        <div className="coze-template-import-backdrop" onClick={() => setCozeImportOpen(false)}>
          <section className="panel coze-template-import-panel coze-template-import-dialog" role="dialog" aria-modal="true" aria-label="导入 Coze 模板" onClick={(event) => event.stopPropagation()}>
            <div className="panel-title-row">
              <div>
                <h3>导入 Coze 模板</h3>
                <span className="hint-text">粘贴每个视频下复制出的 Coze 工作流源码，转换成可编辑的草稿模板预设。</span>
              </div>
              <div className="button-row">
                <button className="ghost-action" type="button" onClick={previewCozeWorkflowTemplate}>预览转换</button>
                <button className="primary-action slim" type="button" disabled={draftTemplateAction.busy || !cozeWorkflowSource.trim()} onClick={saveCozeWorkflowTemplate}><Upload size={15} />导入 Coze 模板</button>
                <button className="ghost-action" type="button" disabled={draftTemplateAction.busy || !cozeWorkflowSource.trim()} onClick={saveAllCozeWorkflowTemplates}>全部导入</button>
                <button className="mini-button" type="button" onClick={() => setCozeImportOpen(false)}>关闭</button>
              </div>
            </div>
            <div className="coze-template-import-grid">
              <Field label="模板名称">
                <input value={cozeImportName} onChange={(event) => setCozeImportName(event.target.value)} placeholder="留空则使用 Coze workflowId" />
              </Field>
              <Field label="Coze 工作流源码">
                <textarea className="small-textarea coze-workflow-source" value={cozeWorkflowSource} onChange={(event) => setCozeWorkflowSource(event.target.value)} placeholder='粘贴 {"type":"coze-workflow-clipboard-data", ...}' />
              </Field>
            </div>
            {cozeImportError ? <p className="form-error">{cozeImportError}</p> : null}
            {cozeImportResults.length > 1 ? <span className="hint-text">已识别 {cozeImportResults.length} 个 Coze 工作流源码。</span> : null}
            {cozeImportResult ? (
              <div className="coze-import-preview">
                <strong>{cozeImportResult.template.name}</strong>
                <span>{cozeImportResult.workflowId} · {cozeImportResult.template.canvas.ratio} · {cozeImportResult.template.canvas.width}x{cozeImportResult.template.canvas.height}</span>
                <div>
                  <small>转换诊断</small>
                  <ul className="coze-diagnostics-list">
                    {cozeImportResult.diagnostics.slice(0, 8).map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${diagnostic.nodeId ?? index}`}>
                        <span>{diagnostic.level}</span>
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <section className="draft-template-gallery">
        {galleryTemplates.map((template) => (
          <article key={template.id} className="draft-template-card">
            <button className="draft-template-thumb" onClick={() => openEditor(template)} type="button" aria-label={`编辑 ${template.name}`}>
              <DraftTemplatePreview template={template} compact />
            </button>
            <div className="draft-template-meta">
              <div>
                <strong>{template.name}</strong>
                {template.isDefault ? <small>系统默认</small> : <small>本地自定义</small>}
              </div>
              <span>{template.canvas.ratio} · {template.canvas.width}x{template.canvas.height}</span>
              <span>图片 {template.image.ratio} · {template.image.fit} · {draftImageMotions.find((option) => option.value === template.image.motion)?.label ?? template.image.animation}</span>
            </div>
            <div className={`draft-template-actions${template.isDefault ? '' : ' has-delete'}`}>
              <button className="ghost-action" type="button" onClick={() => openEditor(template)}><LayoutTemplate size={15} />编辑</button>
              <button className="ghost-action" type="button" disabled={draftTemplateAction.busy} onClick={() => copyTemplate(template)}><Copy size={15} />复制</button>
              {!template.isDefault ? <button className="danger-action" type="button" aria-label={`删除自定义模板 ${template.name}`} disabled={draftTemplateAction.busy} onClick={() => setPendingDeleteTemplate(template)}><Trash2 size={15} />删除</button> : null}
            </div>
          </article>
        ))}
        <button className="draft-template-card new-template-card" aria-label="从默认模板新建草稿模板" disabled={draftTemplateAction.busy} onClick={createTemplate} type="button">
          <Plus size={24} />
          <strong>新模板</strong>
          <span>从默认竖屏复制一份本地配置</span>
        </button>
      </section>
      <ConfirmDialog
        open={Boolean(pendingDeleteTemplate)}
        title="删除自定义模板"
        description={`确定删除“${pendingDeleteTemplate?.name ?? ''}”吗？删除后不可恢复，引用它的历史任务将回退到默认模板。`}
        confirmLabel="删除模板"
        busy={draftTemplateAction.busy}
        destructive
        onConfirm={deleteTemplate}
        onCancel={() => setPendingDeleteTemplate(null)}
      />
    </div>
  );
}

export function resolveDraftTemplateDetail(summary: DraftTemplate, detail: DraftTemplate | null | undefined): DraftTemplate {
  return detail?.id === summary.id && detail.updatedAt === summary.updatedAt ? detail : summary;
}

function AnimationPresetPicker({
  label,
  value,
  options,
  previewValue,
  onPreview,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  previewValue: string | null;
  onPreview: (value: string | null) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field draft-animation-picker">
      <span>{label}</span>
      <div className="segmented" role="group" aria-label={label} onMouseLeave={() => onPreview(null)}>
        {options.map((option) => {
          const className = [option === value ? 'selected' : '', option === previewValue ? 'previewing' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={option}
              className={className}
              aria-pressed={option === value}
              onMouseEnter={() => onPreview(option)}
              onFocus={() => onPreview(option)}
              onBlur={() => onPreview(null)}
              onClick={() => onChange(option)}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <div className="draft-color-field">
        <input type="color" value={normalizeColorInput(value)} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function TextBorderControls({
  label,
  border,
  onChange,
}: {
  label?: string;
  border: DraftTextBorder;
  onChange: (patch: Partial<DraftTextBorder>) => void;
}) {
  return (
    <div className="draft-border-controls">
      {label ? <span className="field-title">{label}</span> : null}
      <div className="draft-inline-border-grid">
        <ColorField label="描边颜色" value={border.color} onChange={(value) => onChange({ color: value })} />
        <RangeField label="描边宽度" min={0} max={60} step={1} value={border.width} onChange={(value) => onChange({ width: value })} />
        <RangeField label="描边透明度" min={0} max={1} step={0.05} value={border.alpha} onChange={(value) => onChange({ alpha: value })} />
      </div>
    </div>
  );
}

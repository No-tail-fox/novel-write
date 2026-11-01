import { promptChannelOptions, selectWorkflowPrompt, workflowSlotChannels } from '../../shared/workflow-prompt-runtime';
import { loadDefaultPromptTemplates } from '../../shared/prompt-template-loader';
import type { PromptChannel } from '../../shared/types';
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Eye, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { CustomStyle, PromptTemplate, PromptStepTemplateType, PromptTemplateType } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { defaultCustomStyles } from '../../shared/config';
import { buildStoryTemplateTrackOptions } from '../../shared/prompt-templates';
import { useAsyncAction } from '../../ui/async-action';
import { useUnsavedChanges } from '../../app/workspace-navigation';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
import { Button, HoverPreview, SelectField, Tabs, TextField } from '../../ui';
import { ImageStyleSample } from '../image-style-preview/ImageStylePreview';
import './prompt-templates.css';
import type { ApplyMutationResult, RendererAppState as AppState } from '../../app/route-types';
import { promptTemplateTypeOptions } from '../../shared/editorial-options';
import {
  PromptTemplateEditor,
  independentPromptTemplateFields,
  promptTemplateStyleLabelList,
  promptTemplateTypeLabel,
} from './PromptTemplateEditor';

export function PromptTemplatesPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const [templateMode, setTemplateMode] = useState<'gallery' | 'detail' | 'image-detail'>('gallery');
  const [promptTemplateLibraryTab, setPromptTemplateLibraryTab] = useState<'story' | 'image'>('story');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<PromptTemplateType | 'all'>('all');
  const [templateTrackFilter, setTemplateTrackFilter] = useState('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<PromptChannel | 'all'>('all');
  const [imageDraft, setImageDraftState] = useState<CustomStyle | null>(state.customStyles[0] ? { ...state.customStyles[0] } : null);
  const imageDraftRef = useRef(imageDraft);
  const [savedImageDraft, setSavedImageDraft] = useState(imageDraft);
  const [imageTemplateAiPrompt, setImageTemplateAiPrompt] = useState('');
  const [imageTemplateAiStatus, setImageTemplateAiStatus] = useState('');
  const [imageTemplateAiGenerating, setImageTemplateAiGenerating] = useState(false);
  const [imageTemplatePreviewGenerating, setImageTemplatePreviewGenerating] = useState(false);
  const [baseImageTemplateId, setBaseImageTemplateId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    const queryMatches = !templateSearch.trim() || [template.name, template.description, template.slot ?? ''].join(' ').toLocaleLowerCase().includes(templateSearch.trim().toLocaleLowerCase());
    return queryMatches && typeMatches && trackMatches && (channelFilter === 'all' || (template.channel ?? 'story') === channelFilter || (template.channel === 'shared' && workflowSlotChannels(template.slot).includes(channelFilter)));
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const [draft, setDraftState] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const draftRef = useRef(draft);
  const [savedDraft, setSavedDraft] = useState(draft);
  const [templateJsonDraft, setTemplateJsonDraft] = useState('');
  const [imageTemplateJsonDraft, setImageTemplateJsonDraft] = useState('');
  const promptTemplateAction = useAsyncAction();
  const promptDetailGeneration = useRef(0);
  const { requestLeave } = useUnsavedChanges({
    id: 'prompt-template-editor',
    label: templateMode === 'image-detail' ? '图像模板' : '提示词模板',
    dirty: templateMode === 'detail'
      ? JSON.stringify(draft) !== JSON.stringify(savedDraft)
      : templateMode === 'image-detail' && JSON.stringify(imageDraft) !== JSON.stringify(savedImageDraft),
    busy: promptTemplateAction.busy,
    onSave: templateMode === 'image-detail' ? saveCustomStyleDraft : savePromptTemplateDraft,
    onDiscard: () => {
      if (templateMode === 'image-detail') setImageDraft(savedImageDraft ? structuredClone(savedImageDraft) : null);
      else setDraft(savedDraft ? structuredClone(savedDraft) : null);
    },
  });
  const promptTemplateTrackOptions = buildStoryTemplateTrackOptions(state.promptTemplates);
  const promptTemplateBindingTrackOptions =
    draft?.baseTrack && !promptTemplateTrackOptions.some(([id]) => id === draft.baseTrack)
      ? [...promptTemplateTrackOptions, [draft.baseTrack, draft.baseTrack, '当前模板赛道'] as [string, string, string]]
      : promptTemplateTrackOptions;

  useEffect(() => () => { promptDetailGeneration.current += 1; }, []);

  function setDraft(update: React.SetStateAction<PromptTemplate | null>) {
    const next = typeof update === 'function' ? update(draftRef.current) : update;
    draftRef.current = next;
    setDraftState(next);
  }

  function setImageDraft(update: React.SetStateAction<CustomStyle | null>) {
    const next = typeof update === 'function' ? update(imageDraftRef.current) : update;
    imageDraftRef.current = next;
    setImageDraftState(next);
  }

  function acceptPromptTemplate(template: PromptTemplate) {
    promptDetailGeneration.current += 1;
    setSelectedId(template.id);
    setSavedDraft(structuredClone(template));
    setDraft(structuredClone(template));
    setTemplateMode('detail');
  }

  function acceptImageTemplate(style: CustomStyle) {
    promptDetailGeneration.current += 1;
    setSavedImageDraft(structuredClone(style));
    setImageDraft(structuredClone(style));
    setTemplateMode('image-detail');
  }

  function openPromptTemplateDetail(template: PromptTemplate) {
    if (promptTemplateAction.busy) return;
    void requestLeave(async () => {
      const generation = ++promptDetailGeneration.current;
      await promptTemplateAction.run(async () => {
        const detail = await api.getPromptTemplateDetail(template.id);
        if (generation !== promptDetailGeneration.current) return;
        if (!detail) throw new Error('模板已不存在，请刷新模板库。');
        acceptPromptTemplate(detail);
        setTemplateJsonDraft('');
      });
    });
  }

  function openImageTemplateDetail(style: CustomStyle) {
    if (promptTemplateAction.busy) return;
    void requestLeave(() => {
      acceptImageTemplate(style);
      setBaseImageTemplateId(style.id);
      setImageTemplateAiStatus('');
    });
  }

  async function savePromptTemplateDraft(apply = true): Promise<boolean> {
    const submitted = draftRef.current;
    if (!submitted) return false;
    const generation = promptDetailGeneration.current;
    const templateToSave: PromptTemplate = {
      ...independentPromptTemplateFields(submitted),
      id: submitted.id,
      isBuiltin: submitted.isBuiltin,
      origin: submitted.isBuiltin ? 'system' : 'custom',
      builtinModified: submitted.isBuiltin ? true : undefined,
      enabled: apply,
      updatedAt: new Date().toISOString(),
    };
    const result = await promptTemplateAction.run(async () => {
      const mutation = await api.savePromptTemplate(templateToSave);
      applyState(mutation);
      if (mutation?.kind !== 'state-patch' || mutation.patch.kind !== 'prompt-template-upsert') return false;
      const saved = mutation.patch.template;
      const current = draftRef.current;
      if (generation !== promptDetailGeneration.current || current?.id !== submitted.id) return false;
      setSavedDraft(structuredClone(saved));
      setSelectedId(saved.id);
      if (JSON.stringify(current) !== JSON.stringify(submitted)) {
        setDraft({ ...independentPromptTemplateFields(current), id: saved.id, isBuiltin: saved.isBuiltin, origin: saved.origin, updatedAt: saved.updatedAt });
        return false;
      }
      setDraft(structuredClone(saved));
      return true;
    });
    return result.ok && result.value;
  }

  async function duplicateTemplate(template: PromptTemplate) {
    const generation = promptDetailGeneration.current;
    const currentDraft = draftRef.current;
    await promptTemplateAction.run(async () => {
      const detail = template.content ? template : await api.getPromptTemplateDetail(template.id);
      if (!detail) throw new Error('模板已不存在，请刷新模板库。');
      const copy = { ...independentPromptTemplateFields(detail), id: crypto.randomUUID(), name: `${detail.name} 副本`, isBuiltin: false, builtinModified: undefined, enabled: false, origin: 'custom' as const };
      applyState(await api.savePromptTemplate(copy));
      if (generation !== promptDetailGeneration.current || draftRef.current !== currentDraft) return;
      acceptPromptTemplate(copy);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function duplicate() {
    if (!draft) return;
    await duplicateTemplate(draft);
  }

  async function createPromptTemplate() {
    await promptTemplateAction.run(async () => {
      const defaults = await loadDefaultPromptTemplates();
      const base = defaults.find((item) => item.type === 'workflow' && (channelFilter === 'all' || workflowSlotChannels(item.slot).includes(channelFilter))) ?? defaults.find((item) => item.type === 'task')!;
      const template: PromptTemplate = {
        ...structuredClone(base), id: crypto.randomUUID(), name: '新建模板',
        channel: channelFilter === 'all' ? base.channel : channelFilter,
        isBuiltin: false, origin: 'custom', builtinModified: undefined, enabled: false,
        updatedAt: new Date().toISOString(),
      };
      acceptPromptTemplate(template);
      setSavedDraft(null);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function saveCustomStyleDraft(): Promise<boolean> {
    const submitted = imageDraftRef.current;
    if (!submitted) return false;
    const generation = promptDetailGeneration.current;
    const now = new Date().toISOString();
    const styleToSave = { ...submitted, updatedAt: now, createdAt: submitted.createdAt || now };
    const result = await promptTemplateAction.run(async () => {
      const mutation = await api.saveCustomStyle(styleToSave);
      applyState(mutation);
      if (mutation?.kind !== 'state-patch' || mutation.patch.kind !== 'custom-style-upsert') return false;
      const saved = mutation.patch.style;
      const current = imageDraftRef.current;
      if (generation !== promptDetailGeneration.current || current?.id !== submitted.id) return false;
      setSavedImageDraft(structuredClone(saved));
      if (JSON.stringify(current) !== JSON.stringify(submitted)) {
        setImageDraft({ ...current, updatedAt: saved.updatedAt, createdAt: saved.createdAt });
        return false;
      }
      setImageDraft(structuredClone(saved));
      setImageTemplateAiStatus('已保存图像模板。');
      return true;
    });
    return result.ok && result.value;
  }

  async function duplicateImageTemplate(style: CustomStyle) {
    const generation = promptDetailGeneration.current;
    const currentDraft = imageDraftRef.current;
    const now = new Date().toISOString();
    const copy = { ...style, id: crypto.randomUUID(), name: `${style.name} 副本`, createdAt: now, updatedAt: now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(copy));
      if (generation !== promptDetailGeneration.current || imageDraftRef.current !== currentDraft) return;
      acceptImageTemplate(copy);
      setImageTemplateAiStatus('已克隆图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function createImageTemplate() {
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
    const now = new Date().toISOString();
    const template: CustomStyle = {
      ...base,
      id: crypto.randomUUID(),
      name: '新建图像模板',
      tag: '自定义风格',
      shortName: '自定义',
      createdAt: now,
      updatedAt: now,
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(template));
      acceptImageTemplate(template);
      setImageTemplateAiStatus('');
      setTemplateMode('image-detail');
    });
  }

  function applyBaseImageTemplate() {
    if (!imageDraft) return;
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    if (!base) return;
    setImageDraft({
      ...imageDraft,
      tag: base.tag,
      shortName: base.shortName,
      prefix: base.prefix,
      suffix: base.suffix,
      negativePrompt: base.negativePrompt,
      allowColor: base.allowColor,
      description: base.description,
    });
    setImageTemplateAiStatus(`已套用系统风格：${base.name}`);
  }

  async function fillImageTemplateFromAiPrompt() {
    if (!imageDraft) return;
    const prompt = imageTemplateAiPrompt.trim();
    if (!prompt) {
      setImageTemplateAiStatus('请先输入风格描述。');
      return;
    }
    const base = state.customStyles.find((style) => style.id === baseImageTemplateId) ?? defaultCustomStyles.find((style) => style.id === baseImageTemplateId);
    const generation = promptDetailGeneration.current;
    const submitted = imageDraftRef.current;
    await promptTemplateAction.run(async () => {
      setImageTemplateAiGenerating(true);
      setImageTemplateAiStatus('正在生成字段...');
      try {
        const generated = await api.generateCustomStyleDraft({ prompt, baseStyle: base ?? imageDraft });
        if (generation !== promptDetailGeneration.current || imageDraftRef.current !== submitted) {
          setImageTemplateAiStatus('模板已继续编辑，本次生成未覆盖当前内容。');
          return;
        }
        setImageDraft({ ...imageDraft, ...generated, id: imageDraft.id, createdAt: imageDraft.createdAt });
        setImageTemplateAiStatus(`已生成字段：${generated.name || prompt}`);
      } finally {
        setImageTemplateAiGenerating(false);
      }
    }, { onError: (error) => setImageTemplateAiStatus(`生成失败：${error.message}`) });
  }

  async function generateImageTemplatePreview() {
    const submitted = imageDraftRef.current;
    if (!submitted || promptTemplateAction.busy) return;
    const generation = promptDetailGeneration.current;
    await promptTemplateAction.run(async () => {
      setImageTemplatePreviewGenerating(true);
      setImageTemplateAiStatus('正在使用当前图像模板生成示例图…');
      try {
        const generated = await api.generateCustomStylePreview(structuredClone(submitted));
        if (generation !== promptDetailGeneration.current || imageDraftRef.current !== submitted) {
          setImageTemplateAiStatus('模板已继续编辑，本次样图未覆盖当前内容。');
          return;
        }
        setImageDraft({ ...submitted, preview: generated.preview });
        setImageTemplateAiStatus('示例图已生成。保存修改后，各个画风选择入口都会显示这张样图。');
      } finally {
        setImageTemplatePreviewGenerating(false);
      }
    }, { onError: error => setImageTemplateAiStatus(`样图生成失败：${error.message}`) });
  }

  function exportPromptTemplateJson() {
    if (!draft) return;
    const json = JSON.stringify(draft, null, 2);
    setTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function exportImageTemplateJson() {
    if (!imageDraft) return;
    const json = JSON.stringify(imageDraft, null, 2);
    setImageTemplateJsonDraft(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  function resolveImportedTemplateId(imported: { id?: string }, exists: boolean): string {
    return imported.id && !exists ? imported.id : crypto.randomUUID();
  }

  async function importPromptTemplateJson() {
    await requestLeave(async () => { await promptTemplateAction.run(async () => {
      const imported = JSON.parse(templateJsonDraft) as PromptTemplate;
      const id = resolveImportedTemplateId(imported, state.promptTemplates.some((template) => template.id === imported.id));
      const next = { ...imported, id, isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      acceptPromptTemplate(next);
      setTemplateJsonDraft('');
    }); });
  }

  async function importImageTemplateJson() {
    await requestLeave(async () => { await promptTemplateAction.run(async () => {
      const imported = JSON.parse(imageTemplateJsonDraft) as CustomStyle;
      const now = new Date().toISOString();
      const id = resolveImportedTemplateId(imported, state.customStyles.some((style) => style.id === imported.id));
      const next: CustomStyle = {
        ...imported,
        id,
        createdAt: imported.createdAt || now,
        updatedAt: now,
      };
      applyState(await api.saveCustomStyle(next));
      acceptImageTemplate(next);
      setImageTemplateJsonDraft('');
    }); });
  }

  async function resetPromptTemplateLibrary() {
    await promptTemplateAction.run(async () => {
      applyState(await api.resetPromptTemplates());
    });
  }

  function updatePromptTemplateStepPrompt(type: PromptStepTemplateType, content: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        stepPrompts: {
          ...(current.stepPrompts ?? {}),
          [type]: content,
        },
      };
    });
  }

  function resetPromptTemplateStepPrompt(type: PromptStepTemplateType) {
    setDraft((current) => {
      if (!current?.stepPrompts) return current;
      const nextStepPrompts = { ...current.stepPrompts };
      delete nextStepPrompts[type];
      return {
        ...current,
        stepPrompts: Object.keys(nextStepPrompts).length > 0 ? nextStepPrompts : undefined,
      };
    });
  }

  if (templateMode === 'gallery') {
    return (
      <div className="prompt-template-gallery">
        <div className="panel-title-row prompt-template-gallery-toolbar">
          <div>
            <h2>提示词模板</h2>
            <p>管理各创作类别实际使用的提示词。系统默认不可删除，可修改或克隆；保存并应用后用于对应频道的新生成。</p>
          </div>
          <div className="button-row">
            <Button icon={<RotateCcw size={14} />} disabled={promptTemplateAction.busy} onClick={resetPromptTemplateLibrary}>
              重置
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} disabled={promptTemplateAction.busy} onClick={promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate}>
              新建模板
            </Button>
          </div>
        </div>
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        <Tabs className="prompt-template-tabs" label="提示词模板类型" value={promptTemplateLibraryTab}
          onChange={(value) => setPromptTemplateLibraryTab(value as 'story' | 'image')}
          items={[{ value: 'story', label: '创作提示词' }, { value: 'image', label: '图像模板' }]} />
        {promptTemplateLibraryTab === 'story' ? (
          <>
            <div className="template-filter-row">
              <TextField label="搜索提示词" placeholder="搜索名称或用途" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} />
              <SelectField label="创作频道" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as PromptChannel | 'all')}
                options={[{ value: 'all', label: '全部频道' }, ...promptChannelOptions]} />
              <SelectField label="类型筛选" value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}
                options={promptTemplateTypeOptions.map((type) => ({ value: type, label: promptTemplateTypeLabel(type) }))} />
              <SelectField label="赛道筛选" value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}
                options={[{ value: 'all', label: '全部赛道' }, ...promptTemplateTrackOptions.map(([id, label]) => ({ value: id, label }))]} />
            </div>
            <section className="prompt-template-list story-template-gallery">
              <div className="prompt-template-list-title">
                <strong>创作提示词（{state.promptTemplates.length}）</strong>
                <span>{filteredTemplates.length} 个匹配模板</span>
              </div>
              {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
                <article
                  className="prompt-template-row"
                  key={template.id}
                >
                  <Sparkles size={18} />
                  <div className="prompt-template-row-main">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>{promptChannelOptions.find((option) => option.value === (template.channel ?? 'story'))?.label} · {promptTemplateTypeLabel(template.type)} · {template.isBuiltin ? `系统默认 · 不可删除${template.builtinModified ? ' · 已修改' : ''}` : '自定义'}
                      {template.type === 'workflow' ? ` · ${template.enabled === false ? '未启用' : selectWorkflowPrompt(state.promptTemplates, template.slot!, template.channel ?? 'shared')?.id === template.id ? '当前生效' : '备用'}` : ''}
                      {template.type === 'task' ? ` · 默认画风：${promptTemplateStyleLabelList(template, state.customStyles).join('、') || '未设置'}` : ''}</small>
                  </div>
                  <div className="prompt-template-row-actions">
                    <Button density="compact" icon={<Eye size={14} />} disabled={promptTemplateAction.busy} onClick={() => openPromptTemplateDetail(template)}>
                      查看
                    </Button>
                    <Button density="compact" icon={<Copy size={14} />} disabled={promptTemplateAction.busy} onClick={() => void duplicateTemplate(template)}>
                      克隆
                    </Button>
                  </div>
                </article>
              )) : <EmptyState title="暂无匹配模板" />}
            </section>
          </>
        ) : (
          <section className="prompt-template-list image-template-gallery">
            <div className="prompt-template-list-title">
              <strong>图像模板（{state.customStyles.length}）</strong>
              <span>悬停预览完整样图，点“查看”编辑提示词</span>
            </div>
            {state.customStyles.map((style) => (
              <HoverPreview key={style.id} title={style.name} description={style.description} renderPreview={() => <ImageStyleSample style={style} />}>
              <article
                className="prompt-template-row"
                key={style.id}
              >
                <ImageStyleSample style={style} thumbnail />
                <div className="prompt-template-row-main">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                  <small>{style.tag} · {style.allowColor ? '彩色' : '黑白 / 单色'} · id: {style.id}</small>
                </div>
                <div className="prompt-template-row-actions">
                  <Button density="compact" icon={<Eye size={14} />} disabled={promptTemplateAction.busy} onClick={() => openImageTemplateDetail(style)}>
                    查看
                  </Button>
                  <Button density="compact" icon={<Copy size={14} />} disabled={promptTemplateAction.busy} onClick={() => void duplicateImageTemplate(style)}>
                    克隆
                  </Button>
                </div>
              </article>
              </HoverPreview>
            ))}
          </section>
        )}
      </div>
    );
  }

  return (
    <PromptTemplateEditor
      mode={templateMode}
      state={state}
      draft={draft}
      imageDraft={imageDraft}
      baseImageTemplateId={baseImageTemplateId}
      imageTemplateAiPrompt={imageTemplateAiPrompt}
      imageTemplateAiStatus={imageTemplateAiStatus}
      imageTemplateAiGenerating={imageTemplateAiGenerating}
      imageTemplateJsonDraft={imageTemplateJsonDraft}
      templateJsonDraft={templateJsonDraft}
      promptTemplateBindingTrackOptions={promptTemplateBindingTrackOptions}
      promptTemplateAction={promptTemplateAction}
      setTemplateMode={(mode) => void requestLeave(() => { promptDetailGeneration.current += 1; setTemplateMode(mode); })}
      setDraft={setDraft}
      setImageDraft={setImageDraft}
      setBaseImageTemplateId={setBaseImageTemplateId}
      setImageTemplateAiPrompt={setImageTemplateAiPrompt}
      setImageTemplateJsonDraft={setImageTemplateJsonDraft}
      setTemplateJsonDraft={setTemplateJsonDraft}
      savePromptTemplateDraft={async (apply = true) => { await savePromptTemplateDraft(apply); }}
      duplicate={duplicate}
      exportPromptTemplateJson={exportPromptTemplateJson}
      importPromptTemplateJson={importPromptTemplateJson}
      updatePromptTemplateStepPrompt={updatePromptTemplateStepPrompt}
      resetPromptTemplateStepPrompt={resetPromptTemplateStepPrompt}
      saveCustomStyleDraft={async () => { await saveCustomStyleDraft(); }}
      duplicateImageTemplate={duplicateImageTemplate}
      applyBaseImageTemplate={applyBaseImageTemplate}
      fillImageTemplateFromAiPrompt={fillImageTemplateFromAiPrompt}
      generateImageTemplatePreview={generateImageTemplatePreview}
      imageTemplatePreviewGenerating={imageTemplatePreviewGenerating}
      exportImageTemplateJson={exportImageTemplateJson}
      importImageTemplateJson={importImageTemplateJson}
    />
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Palette, Plus, RotateCcw, Sparkles } from 'lucide-react';
import type { CustomStyle, PromptTemplate, PromptStepTemplateType, PromptTemplateType } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { defaultCustomStyles } from '../../shared/config';
import { buildStoryTemplateTrackOptions } from '../../shared/prompt-templates';
import { useAsyncAction } from '../../ui/async-action';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
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
  const [selectedImageStyleId, setSelectedImageStyleId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const [imageDraft, setImageDraft] = useState<CustomStyle | null>(state.customStyles[0] ? { ...state.customStyles[0] } : null);
  const [imageTemplateAiPrompt, setImageTemplateAiPrompt] = useState('');
  const [imageTemplateAiStatus, setImageTemplateAiStatus] = useState('');
  const [imageTemplateAiGenerating, setImageTemplateAiGenerating] = useState(false);
  const [baseImageTemplateId, setBaseImageTemplateId] = useState(state.customStyles[0]?.id ?? defaultCustomStyles[0]?.id ?? '');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    return typeMatches && trackMatches;
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const selectedImageStyle = state.customStyles.find((style) => style.id === selectedImageStyleId) ?? state.customStyles[0] ?? defaultCustomStyles[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [templateJsonDraft, setTemplateJsonDraft] = useState('');
  const [imageTemplateJsonDraft, setImageTemplateJsonDraft] = useState('');
  const promptTemplateAction = useAsyncAction();
  const promptDetailGeneration = useRef(0);
  const promptTemplateTrackOptions = buildStoryTemplateTrackOptions(state.promptTemplates);
  const promptTemplateBindingTrackOptions =
    draft?.baseTrack && !promptTemplateTrackOptions.some(([id]) => id === draft.baseTrack)
      ? [...promptTemplateTrackOptions, [draft.baseTrack, draft.baseTrack, '当前模板赛道'] as [string, string, string]]
      : promptTemplateTrackOptions;

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);
  useEffect(() => setImageDraft(selectedImageStyle ? { ...selectedImageStyle } : null), [selectedImageStyle?.id]);

  function openPromptTemplateDetail(template: PromptTemplate) {
    const generation = ++promptDetailGeneration.current;
    setSelectedId(template.id);
    setDraft({ ...template });
    setTemplateJsonDraft('');
    setTemplateMode('detail');
    void promptTemplateAction.run(async () => {
      const detail = await api.getPromptTemplateDetail(template.id);
      if (generation === promptDetailGeneration.current && detail) setDraft({ ...detail });
    });
  }

  function openImageTemplateDetail(style: CustomStyle) {
    setSelectedImageStyleId(style.id);
    setImageDraft({ ...style });
    setBaseImageTemplateId(style.id);
    setImageTemplateAiStatus('');
    setTemplateMode('image-detail');
  }

  function handlePromptTemplateRowKeyDown(event: React.KeyboardEvent<HTMLElement>, template: PromptTemplate) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPromptTemplateDetail(template);
  }

  async function savePromptTemplateDraft() {
    if (!draft) return;
    const shouldForkTemplate = Boolean(draft.isBuiltin);
    const templateToSave: PromptTemplate = {
      ...independentPromptTemplateFields(draft),
      id: shouldForkTemplate ? crypto.randomUUID() : draft.id,
      isBuiltin: false,
      origin: 'custom',
      updatedAt: new Date().toISOString(),
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(templateToSave));
      setSelectedId(templateToSave.id);
      setDraft(templateToSave);
      setTemplateMode('detail');
    });
  }

  async function duplicateTemplate(template: PromptTemplate) {
    const copy = { ...independentPromptTemplateFields(template), id: crypto.randomUUID(), name: `${template.name} 副本`, isBuiltin: false, origin: 'custom' as const };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(copy));
      setSelectedId(copy.id);
      setDraft(copy);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function duplicate() {
    if (!draft) return;
    await duplicateTemplate(draft);
  }

  async function createPromptTemplate() {
    const baseTrack = templateTrackFilter === 'all' ? 'general-story' : templateTrackFilter;
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: '新建模板',
      type: 'task',
      description: '本地自定义提示词模板',
      content: '请基于 {{inputText}} 生成适合 {{track}} 的短视频内容。',
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      baseTrack,
      defaultStyles: ['photo-real'],
      defaultDraftTemplateId: state.draftTemplates[0]?.id ?? 'default-portrait-9-16',
      characterPolicy: 'follow-template',
      step3SkeletonModules: ['防台词文字'],
      referenceKind: 'none',
      origin: 'custom',
      marketTags: [],
    };
    await promptTemplateAction.run(async () => {
      applyState(await api.savePromptTemplate(template));
      setSelectedId(template.id);
      setDraft(template);
      setTemplateJsonDraft('');
      setTemplateMode('detail');
    });
  }

  async function saveCustomStyleDraft() {
    if (!imageDraft) return;
    const now = new Date().toISOString();
    const styleToSave = { ...imageDraft, updatedAt: now, createdAt: imageDraft.createdAt || now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(styleToSave));
      setSelectedImageStyleId(styleToSave.id);
      setImageDraft(styleToSave);
      setImageTemplateAiStatus('已保存图像模板。');
      setTemplateMode('image-detail');
    });
  }

  async function duplicateImageTemplate(style: CustomStyle) {
    const now = new Date().toISOString();
    const copy = { ...style, id: crypto.randomUUID(), name: `${style.name} 副本`, createdAt: now, updatedAt: now };
    await promptTemplateAction.run(async () => {
      applyState(await api.saveCustomStyle(copy));
      setSelectedImageStyleId(copy.id);
      setImageDraft(copy);
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
      setSelectedImageStyleId(template.id);
      setImageDraft(template);
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
    await promptTemplateAction.run(async () => {
      setImageTemplateAiGenerating(true);
      setImageTemplateAiStatus('正在生成字段...');
      try {
        const generated = await api.generateCustomStyleDraft({ prompt, baseStyle: base ?? imageDraft });
        setImageDraft({ ...imageDraft, ...generated, id: imageDraft.id, createdAt: imageDraft.createdAt });
        setImageTemplateAiStatus(`已生成字段：${generated.name || prompt}`);
      } finally {
        setImageTemplateAiGenerating(false);
      }
    }, { onError: (error) => setImageTemplateAiStatus(`生成失败：${error.message}`) });
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
    await promptTemplateAction.run(async () => {
      const imported = JSON.parse(templateJsonDraft) as PromptTemplate;
      const id = resolveImportedTemplateId(imported, state.promptTemplates.some((template) => template.id === imported.id));
      const next = { ...imported, id, isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      setSelectedId(next.id);
      setDraft(next);
      setTemplateMode('detail');
      setTemplateJsonDraft('');
    }, { onError: () => setTemplateJsonDraft('{"name":"自定义模板","type":"task","description":"请补充","content":"请补充提示词"}') });
  }

  async function importImageTemplateJson() {
    await promptTemplateAction.run(async () => {
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
      setSelectedImageStyleId(next.id);
      setImageDraft(next);
      setTemplateMode('image-detail');
      setImageTemplateJsonDraft('');
    }, { onError: () => setImageTemplateJsonDraft('{"name":"自定义图像模板","tag":"自定义","shortName":"自定义","prefix":"请补充","suffix":"请补充","negativePrompt":"请补充","allowColor":true,"description":"请补充"}') });
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
            <p>故事模板决定 AI 怎么写，图像模板决定画面怎么长。先浏览模板，点开后查看和编辑细节。</p>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={promptTemplateAction.busy} onClick={resetPromptTemplateLibrary}>
              <RotateCcw size={14} />
              重置
            </button>
            <button className="primary-action slim" disabled={promptTemplateAction.busy} onClick={promptTemplateLibraryTab === 'story' ? createPromptTemplate : createImageTemplate}>
              <Plus size={14} />
              新建模板
            </button>
          </div>
        </div>
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        <div className="prompt-template-tabs" role="tablist" aria-label="提示词模板类型">
          <button className={promptTemplateLibraryTab === 'story' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('story')}>故事模板</button>
          <button className={promptTemplateLibraryTab === 'image' ? 'chip active' : 'chip'} type="button" onClick={() => setPromptTemplateLibraryTab('image')}>图像模板</button>
        </div>
        {promptTemplateLibraryTab === 'story' ? (
          <>
            <div className="template-filter-row">
              <Field label="类型筛选">
                <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}>
                  {promptTemplateTypeOptions.map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                </select>
              </Field>
              <Field label="赛道筛选">
                <select value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}>
                  <option value="all">全部赛道</option>
                  {promptTemplateTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            <section className="prompt-template-list story-template-gallery">
              <div className="prompt-template-list-title">
                <strong>故事模板（{filteredTemplates.filter((template) => template.type === 'task').length}）</strong>
                <span>{filteredTemplates.length} 个匹配模板</span>
              </div>
              {filteredTemplates.length > 0 ? filteredTemplates.map((template) => (
                <article
                  className="prompt-template-row"
                  key={template.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openPromptTemplateDetail(template)}
                  onKeyDown={(event) => handlePromptTemplateRowKeyDown(event, template)}
                >
                  <Sparkles size={18} />
                  <div className="prompt-template-row-main">
                    <strong>{template.name}</strong>
                    <span>{template.description}</span>
                    <small>默认图像模板：{promptTemplateStyleLabelList(template, state.customStyles).join('、') || '未设置'} · id: {template.id}</small>
                  </div>
                  <div className="prompt-template-row-actions">
                    <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openPromptTemplateDetail(template); }}>
                      查看
                    </button>
                    <button className="ghost-action compact-action" disabled={promptTemplateAction.busy} onClick={(event) => { event.stopPropagation(); void duplicateTemplate(template); }}>
                      <Copy size={14} />
                      克隆
                    </button>
                  </div>
                </article>
              )) : <EmptyState title="暂无匹配模板" />}
            </section>
          </>
        ) : (
          <section className="prompt-template-list image-template-gallery">
            <div className="prompt-template-list-title">
              <strong>图像模板（{state.customStyles.length}）</strong>
              <span>管理 prefix、suffix、负面提示词和色彩模式</span>
            </div>
            {state.customStyles.map((style) => (
              <article
                className="prompt-template-row"
                key={style.id}
                role="button"
                tabIndex={0}
                onClick={() => openImageTemplateDetail(style)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openImageTemplateDetail(style);
                  }
                }}
              >
                <Palette size={18} />
                <div className="prompt-template-row-main">
                  <strong>{style.name}</strong>
                  <span>{style.description}</span>
                  <small>{style.tag} · {style.allowColor ? '彩色' : '黑白 / 单色'} · id: {style.id}</small>
                </div>
                <div className="prompt-template-row-actions">
                  <button className="ghost-action compact-action" onClick={(event) => { event.stopPropagation(); openImageTemplateDetail(style); }}>
                    查看
                  </button>
                  <button className="ghost-action compact-action" disabled={promptTemplateAction.busy} onClick={(event) => { event.stopPropagation(); void duplicateImageTemplate(style); }}>
                    <Copy size={14} />
                    克隆
                  </button>
                </div>
              </article>
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
      setTemplateMode={setTemplateMode}
      setDraft={setDraft}
      setImageDraft={setImageDraft}
      setBaseImageTemplateId={setBaseImageTemplateId}
      setImageTemplateAiPrompt={setImageTemplateAiPrompt}
      setImageTemplateJsonDraft={setImageTemplateJsonDraft}
      setTemplateJsonDraft={setTemplateJsonDraft}
      savePromptTemplateDraft={savePromptTemplateDraft}
      duplicate={duplicate}
      exportPromptTemplateJson={exportPromptTemplateJson}
      importPromptTemplateJson={importPromptTemplateJson}
      updatePromptTemplateStepPrompt={updatePromptTemplateStepPrompt}
      resetPromptTemplateStepPrompt={resetPromptTemplateStepPrompt}
      saveCustomStyleDraft={saveCustomStyleDraft}
      duplicateImageTemplate={duplicateImageTemplate}
      applyBaseImageTemplate={applyBaseImageTemplate}
      fillImageTemplateFromAiPrompt={fillImageTemplateFromAiPrompt}
      exportImageTemplateJson={exportImageTemplateJson}
      importImageTemplateJson={importImageTemplateJson}
    />
  );
}

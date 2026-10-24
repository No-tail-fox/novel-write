import React, { useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, ImagePlus, Plus, RotateCcw, Save, Sparkles, Upload } from 'lucide-react';
import type { CustomStyle, PromptTemplate, PromptStepTemplateType, PromptTemplateType } from '../../shared/types';
import { resolvePromptTemplateDefaultStyleId, resolvePromptTemplateDefaultStyleIds, selectStepPromptTemplate } from '../../shared/prompt-templates';
import { defaultCustomStyles } from '../../shared/config';
import { toggleArray } from '../tasks/task-formatters';
import { useAsyncAction } from '../../ui/async-action';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
import type { RendererAppState as AppState } from '../../app/route-types';
import { promptStepEditorDefinitions, promptTemplateReferenceOptions, promptTemplateStep3SkeletonOptions, promptTemplateTypeLabels, promptTemplateTypeOptions, promptTemplateVariableDefinitions, styleOptions, type PromptTemplateVariableScope } from '../../shared/editorial-options';
import type { TemplateOption } from '../../shared/prompt-templates';
import { ImageStylePicker, ImageStyleSelectedPreview } from '../image-style-preview/ImageStylePreview';
import { Button, CheckboxField, SelectField, TextAreaField, TextField } from '../../ui';

export interface PromptTemplateEditorProps {
  mode: 'detail' | 'image-detail';
  state: AppState;
  draft: PromptTemplate | null;
  imageDraft: CustomStyle | null;
  baseImageTemplateId: string;
  imageTemplateAiPrompt: string;
  imageTemplateAiStatus: string;
  imageTemplateAiGenerating: boolean;
  imageTemplateJsonDraft: string;
  templateJsonDraft: string;
  promptTemplateBindingTrackOptions: TemplateOption[];
  promptTemplateAction: ReturnType<typeof useAsyncAction>;
  setTemplateMode: (mode: 'gallery' | 'detail' | 'image-detail') => void;
  setDraft: React.Dispatch<React.SetStateAction<PromptTemplate | null>>;
  setImageDraft: React.Dispatch<React.SetStateAction<CustomStyle | null>>;
  setBaseImageTemplateId: (id: string) => void;
  setImageTemplateAiPrompt: (value: string) => void;
  setImageTemplateJsonDraft: (value: string) => void;
  setTemplateJsonDraft: (value: string) => void;
  savePromptTemplateDraft: () => Promise<void>;
  duplicate: () => Promise<void>;
  exportPromptTemplateJson: () => void;
  importPromptTemplateJson: () => Promise<void>;
  updatePromptTemplateStepPrompt: (type: PromptStepTemplateType, content: string) => void;
  resetPromptTemplateStepPrompt: (type: PromptStepTemplateType) => void;
  saveCustomStyleDraft: () => Promise<void>;
  duplicateImageTemplate: (style: CustomStyle) => Promise<void>;
  applyBaseImageTemplate: () => void;
  fillImageTemplateFromAiPrompt: () => Promise<void>;
  generateImageTemplatePreview: () => Promise<void>;
  imageTemplatePreviewGenerating: boolean;
  exportImageTemplateJson: () => void;
  importImageTemplateJson: () => Promise<void>;
}

export function PromptTemplateEditor({
  mode,
  state,
  draft,
  imageDraft,
  baseImageTemplateId,
  imageTemplateAiPrompt,
  imageTemplateAiStatus,
  imageTemplateAiGenerating,
  imageTemplateJsonDraft,
  templateJsonDraft,
  promptTemplateBindingTrackOptions,
  promptTemplateAction,
  setTemplateMode,
  setDraft,
  setImageDraft,
  setBaseImageTemplateId,
  setImageTemplateAiPrompt,
  setImageTemplateJsonDraft,
  setTemplateJsonDraft,
  savePromptTemplateDraft,
  duplicate,
  exportPromptTemplateJson,
  importPromptTemplateJson,
  updatePromptTemplateStepPrompt,
  resetPromptTemplateStepPrompt,
  saveCustomStyleDraft,
  duplicateImageTemplate,
  applyBaseImageTemplate,
  fillImageTemplateFromAiPrompt,
  generateImageTemplatePreview,
  imageTemplatePreviewGenerating,
  exportImageTemplateJson,
  importImageTemplateJson,
}: PromptTemplateEditorProps) {
  if (mode === 'image-detail') {
    return (
      <div className="prompt-template-detail">
        <section className="panel editor-panel">
          <InlineActionFeedback feedback={promptTemplateAction.feedback} />
          {imageDraft ? (
            <>
              <div className="panel-title-row prompt-template-detail-title">
                <div>
                  <Button variant="subtle" icon={<ArrowLeft size={15} />} onClick={() => setTemplateMode('gallery')}>返回模板库</Button>
                  <h2>查看图像模板 · {imageDraft.name}</h2>
                </div>
                <div className="button-row">
                  <Button icon={<Copy size={15} />} disabled={promptTemplateAction.busy} onClick={() => void duplicateImageTemplate(imageDraft)}>
                    克隆
                  </Button>
                  <Button icon={<Download size={15} />} onClick={exportImageTemplateJson}>
                    导出 JSON
                  </Button>
                  <Button icon={<Upload size={15} />} disabled={promptTemplateAction.busy} onClick={() => void importImageTemplateJson()}>
                    导入 JSON
                  </Button>
                  <Button variant="primary" icon={<Save size={15} />} disabled={promptTemplateAction.busy} onClick={saveCustomStyleDraft}>
                    保存修改
                  </Button>
                </div>
              </div>
              <div className="prompt-template-detail-stack">
                <ImageStyleSelectedPreview style={imageDraft} />
                <div className="button-row">
                  <Button icon={<ImagePlus size={15} />} disabled={promptTemplateAction.busy} onClick={() => void generateImageTemplatePreview()}>
                    {imageTemplatePreviewGenerating ? '正在生成示例图…' : '生成示例图'}
                  </Button>
                  <span className="hint-text">使用当前模板和已配置的图片模型，生成 1 张样图；完成后保存修改即可同步到各处。</span>
                </div>
                <section className="image-template-quick-card">
                  <div>
                    <span className="field-title">AI 快速生成</span>
                    <span className="hint-text">输入自然语言描述，自动填充下方图像模板字段。</span>
                  </div>
                  <TextAreaField label="风格描述" rows={3} value={imageTemplateAiPrompt} onChange={(event) => setImageTemplateAiPrompt(event.target.value)} placeholder="例如：赛博朋克雨夜街道，霓虹光影，未来都市" />
                  <div className="template-meta-grid">
                    <ImageStylePicker label="基于系统风格" value={baseImageTemplateId} onChange={setBaseImageTemplateId} styles={state.customStyles} />
                    <div className="button-row image-template-quick-actions">
                      <Button icon={<Copy size={15} />} onClick={applyBaseImageTemplate}>套用系统风格</Button>
                      <Button variant="primary" icon={<Sparkles size={15} />} disabled={imageTemplateAiGenerating} onClick={() => void fillImageTemplateFromAiPrompt()}>
                        {imageTemplateAiGenerating ? '生成中...' : '生成字段'}
                      </Button>
                    </div>
                  </div>
                  {imageTemplateAiStatus ? <div className="image-template-ai-status" aria-live="polite">{imageTemplateAiStatus}</div> : null}
                </section>

                <section className="prompt-template-settings-card">
                  <span className="field-title">手动填写字段</span>
                  <div className="image-template-field-grid">
                    <TextField label="名称" value={imageDraft.name} onChange={(event) => setImageDraft({ ...imageDraft, name: event.target.value })} />
                    <TextField label="标签" value={imageDraft.tag} onChange={(event) => setImageDraft({ ...imageDraft, tag: event.target.value })} />
                    <TextField label="简称" value={imageDraft.shortName} onChange={(event) => setImageDraft({ ...imageDraft, shortName: event.target.value })} />
                    <SelectField label="色彩模式" value={imageDraft.allowColor ? 'color' : 'mono'} onChange={(event) => setImageDraft({ ...imageDraft, allowColor: event.target.value === 'color' })}
                      options={[{ value: 'color', label: '彩色' }, { value: 'mono', label: '黑白 / 单色' }]} />
                  </div>
                  <TextAreaField label="前缀（prefix）" rows={3} value={imageDraft.prefix} onChange={(event) => setImageDraft({ ...imageDraft, prefix: event.target.value })} />
                  <TextAreaField label="后缀（suffix）" rows={3} value={imageDraft.suffix} onChange={(event) => setImageDraft({ ...imageDraft, suffix: event.target.value })} />
                  <TextAreaField label="负面提示词（negativePrompt）" rows={3} value={imageDraft.negativePrompt} onChange={(event) => setImageDraft({ ...imageDraft, negativePrompt: event.target.value })} />
                  <TextAreaField label="适用场景描述" rows={3} value={imageDraft.description} onChange={(event) => setImageDraft({ ...imageDraft, description: event.target.value })} />
                </section>
                <TextAreaField label="导入 / 导出 JSON" rows={5} value={imageTemplateJsonDraft} onChange={(event) => setImageTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴图像模板 JSON 后点击导入 JSON" />
              </div>
            </>
          ) : (
            <EmptyState title="暂无图像模板" />
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="prompt-template-detail">
      <section className="panel editor-panel">
        <InlineActionFeedback feedback={promptTemplateAction.feedback} />
        {draft ? (
          <>
            <div className="panel-title-row prompt-template-detail-title">
              <div>
                <Button variant="subtle" icon={<ArrowLeft size={15} />} onClick={() => setTemplateMode('gallery')}>返回模板库</Button>
                <h2>查看系统模板 · {draft.name}</h2>
              </div>
              <div className="button-row">
                <Button icon={<Copy size={15} />} disabled={promptTemplateAction.busy} onClick={duplicate}>
                  克隆
                </Button>
                <Button icon={<Download size={15} />} onClick={exportPromptTemplateJson}>
                  导出 JSON
                </Button>
                <Button icon={<Upload size={15} />} disabled={promptTemplateAction.busy} onClick={() => void importPromptTemplateJson()}>
                  导入 JSON
                </Button>
                <Button variant="primary" icon={<Save size={15} />} disabled={promptTemplateAction.busy} onClick={savePromptTemplateDraft}>
                  {draft.isBuiltin ? '保存为自定义模板' : '保存修改'}
                </Button>
              </div>
            </div>
            <div className="prompt-template-detail-stack">
              <section className="prompt-template-basics-card">
                <div className="template-meta-grid prompt-template-basics-grid">
                  <TextField label="模板名" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  <TextField label="描述（一句话说明这个模板的特点）" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  <SelectField label="模板类型" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}
                    options={promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => ({ value: type, label: promptTemplateTypeLabel(type) }))} />
                  <SelectField label="绑定赛道" value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}
                    options={[{ value: '', label: '无' }, ...promptTemplateBindingTrackOptions.map(([id, label]) => ({ value: id, label }))]} />
                </div>
                <ImageStylePicker label="默认画风" styles={promptTemplateStyleOptions(state.customStyles, draft)}
                  value={resolvePromptTemplateDefaultStyleId(draft, state.customStyles.map(style => style.id))}
                  onChange={id => setDraft({ ...draft, defaultStyles: [id] })} />
                {draft.type === 'task' ? (
                  <div className="prompt-template-default-style-pills">
                    <SelectField label="默认草稿模板" value={draft.defaultDraftTemplateId ?? 'default-portrait-9-16'}
                      onChange={(event) => setDraft({ ...draft, defaultDraftTemplateId: event.target.value })}
                      options={state.draftTemplates.map((template) => ({ value: template.id, label: template.name }))}
                      hint="新建任务选择赛道后，会同步草稿模板，并把 AI 出图比例同步为该草稿的图片比例。" />
                  </div>
                ) : null}
              </section>

              <section className="prompt-template-settings-card">
                <span className="field-title">设置内容</span>
                <div className="prompt-template-content-settings">
                  <div className="prompt-template-setting-block">
                    <SelectField label="主角档案" value={draft.characterPolicy ?? 'follow-template'}
                      onChange={(event) => setDraft({ ...draft, characterPolicy: event.target.value as PromptTemplate['characterPolicy'] })}
                      options={[{ value: 'follow-template', label: '跟随赛道' }, { value: 'force-extract', label: '强制提取' }, { value: 'force-skip', label: '强制跳过' }]}
                      hint="主角档案会影响 Step 3 是否保持人物身份、外貌、年代和叙事一致。" />
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>Step 3 骨架模块（可选线路）</strong>
                    <div className="prompt-template-skeleton-options" role="group" aria-label="Step 3 骨架模块">
                      {promptTemplateStep3SkeletonOptions.map((module) => (
                        <CheckboxField key={module} label={module} checked={(draft.step3SkeletonModules ?? []).includes(module)}
                          onChange={() => setDraft({ ...draft, step3SkeletonModules: toggleArray(draft.step3SkeletonModules ?? [], module) })} />
                      ))}
                    </div>
                    <small>勾选后 AI 助手会按用途生成对应骨架，已保存的 Step 3 prompt 文本不会自动改变。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <SelectField label="参考图类型" value={draft.referenceKind ?? 'none'}
                      onChange={(event) => setDraft({ ...draft, referenceKind: event.target.value as PromptTemplate['referenceKind'] })}
                      options={promptTemplateReferenceOptions.map(([value, label]) => ({ value, label }))}
                      hint="上传参考图时，Step 3 会按这里的类型决定人脸或产品一致性要求。" />
                  </div>
                </div>
                <div className="prompt-template-advanced-grid">
                  <TextField label="标签" value={(draft.marketTags ?? []).join('、')} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
                  {draft.type === 'task' ? (
                      <TextAreaField label="出图种子池 JSON"
                        className="prompt-template-seed-pools"
                        value={draft.imageSeedPoolsJson ?? ''}
                        onChange={(event) => setDraft({ ...draft, imageSeedPoolsJson: event.target.value })}
                        placeholder='{"scenes":["close-up","wide shot"],"moods":["warm","dramatic"]}'
                      />
                  ) : null}
                </div>
              </section>

              <span className="local-note">{draft.isBuiltin ? '系统模板保存后会生成自定义副本，原系统模板保持不变。' : '自定义模板保存会更新当前模板，历史任务和已绑定配置会继续使用这个模板。'}</span>

              {draft.type === 'task' ? (
                <section className="prompt-step-editor-list" aria-label="AI 步骤设置">
                  <div className="prompt-step-editor-heading">
                    <span className="field-title prompt-step-editor-section-title">步骤默认提示词</span>
                  </div>
                  <article className="prompt-step-editor-card" key="task-template-content">
                    <div className="prompt-step-editor-card-header">
                      <div>
                        <strong>任务总指令</strong>
                        <small>定义当前任务模板的整体目标、赛道语气和内容边界</small>
                      </div>
                    </div>
                    <PromptVariablePicker scope="task" value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                    <VariableAwareTextarea
                      label="任务总指令"
                      className="template-textarea prompt-step-editor-textarea"
                      value={draft.content}
                      onChange={(value) => setDraft({ ...draft, content: value })}
                      placeholder="输入 // 选择变量"
                      variables={promptTemplateVariablesForScope('task')}
                    />
                  </article>
                  {promptStepEditorDefinitions.map((step) => {
                    const hasOverride = promptTemplateHasStepPrompt(draft, step.type);
                    return (
                      <article className="prompt-step-editor-card" key={step.type}>
                        <div className="prompt-step-editor-card-header">
                          <div>
                            <strong>{step.label}</strong>
                            <small>{step.hint}</small>
                          </div>
                          <Button icon={<RotateCcw size={15} />} disabled={!hasOverride} onClick={() => resetPromptTemplateStepPrompt(step.type)}>
                            继承全局
                          </Button>
                        </div>
                        {(step.type === 'review' || step.type === 'rewrite') ? (
                          <PromptVariablePicker
                            scope={step.type}
                            value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                            onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          />
                        ) : null}
                        <VariableAwareTextarea
                          label={step.label}
                          className="template-textarea prompt-step-editor-textarea"
                          value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                          onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          placeholder="输入 // 选择变量"
                          variables={promptTemplateVariablesForScope(step.type)}
                        />
                      </article>
                    );
                  })}
                </section>
              ) : (
                <section className="prompt-template-settings-card">
                  <div className="prompt-template-section-heading">
                    <span className="field-title">提示词内容</span>
                  </div>
                  <PromptVariablePicker scope={draft.type} value={draft.content} onChange={(value) => setDraft({ ...draft, content: value })} />
                  <VariableAwareTextarea
                    label="提示词内容"
                    className="template-textarea"
                    value={draft.content}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                    placeholder="输入 // 选择变量"
                    variables={promptTemplateVariablesForScope(draft.type)}
                  />
                </section>
              )}
            </div>
            <TextAreaField label="导入 / 导出 JSON" rows={5} value={templateJsonDraft} onChange={(event) => setTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴故事模板 JSON 后点击导入 JSON" />
          </>
        ) : (
          <EmptyState title="暂无模板" />
        )}
      </section>
    </div>
  );
}

function insertPromptVariable(value: string, key: string, cursor: number): { value: string; cursor: number } {
  const token = `{{${key}}}`;
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const triggerIndex = before.lastIndexOf('//');
  if (triggerIndex >= 0 && before.slice(triggerIndex).trim() === '//') {
    const nextValue = `${value.slice(0, triggerIndex)}${token}${after}`;
    return { value: nextValue, cursor: triggerIndex + token.length };
  }
  const prefix = before.endsWith(' ') || before.endsWith('\n') || before.length === 0 ? '' : ' ';
  const nextValue = `${before}${prefix}${token}${after}`;
  return { value: nextValue, cursor: before.length + prefix.length + token.length };
}

function promptTemplateVariablesForScope(scope: PromptTemplateVariableScope) {
  return promptTemplateVariableDefinitions.filter((item) => item.scopes.includes(scope));
}

function appendPromptVariable(value: string, key: string): string {
  return insertPromptVariable(value, key, value.length).value;
}

function PromptVariablePicker({
  scope,
  value,
  onChange,
}: {
  scope: PromptTemplateVariableScope;
  value: string;
  onChange: (value: string) => void;
}) {
  const variables = promptTemplateVariablesForScope(scope);
  return (
    <>
      <span className="field-title">变量</span>
      <span className="hint-text">点击插入当前步骤可用变量；每个提示词输入框也可输入 // 选择变量。</span>
      <div className="variable-chip-row">{variables.map((item) => (
        <Button
          className="prompt-template-variable-chip"
          icon={<Plus size={14} />}
          key={item.key}
          title={`插入 {{${item.key}}}: ${item.description}`}
          onClick={() => onChange(appendPromptVariable(value, item.key))}
        >
          <span>{item.label}</span>
          <code className="prompt-variable-token">{`{{${item.key}}}`}</code>
          <small>{item.description}</small>
        </Button>
      ))}</div>
    </>
  );
}

function VariableAwareTextarea({
  label,
  value,
  onChange,
  className,
  placeholder,
  variables,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  variables: typeof promptTemplateVariableDefinitions;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  function syncSuggestState(nextValue: string, cursor: number | null) {
    const beforeCursor = nextValue.slice(0, cursor ?? nextValue.length);
    setSuggestOpen(beforeCursor.endsWith('//'));
  }

  function onVariableInsert(key: string) {
    const cursor = textareaRef.current?.selectionStart ?? value.length;
    const next = insertPromptVariable(value, key, cursor);
    onChange(next.value);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  return (
    <div className="prompt-variable-editor">
      <TextAreaField
        label={label}
        textarea={{ ref: textareaRef }}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncSuggestState(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => { if (event.key === 'Escape') setSuggestOpen(false); }}
      />
      {suggestOpen ? (
        <div className="prompt-variable-suggest" role="region" aria-label="可插入变量">
          {variables.map((item) => (
            <Button key={item.key} icon={<Plus size={14} />} onMouseDown={(event) => event.preventDefault()} onClick={() => onVariableInsert(item.key)}>
              <span>{item.label}</span>
              <code>{`{{${item.key}}}`}</code>
              <small>英文变量 · {item.description}</small>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function independentPromptTemplateFields(template: PromptTemplate): PromptTemplate {
  const copy = { ...template };
  delete copy.baseTemplateId;
  return copy;
}

function promptTemplateHasStepPrompt(template: PromptTemplate, type: PromptStepTemplateType): boolean {
  return Object.prototype.hasOwnProperty.call(template.stepPrompts ?? {}, type);
}

function promptTemplateStepPromptValue(template: PromptTemplate, templates: PromptTemplate[], type: PromptStepTemplateType): string {
  if (promptTemplateHasStepPrompt(template, type)) return template.stepPrompts?.[type] ?? '';
  return selectStepPromptTemplate(templates, type)?.content ?? '';
}

export function promptTemplateTypeLabel(type: PromptTemplateType | 'all'): string {
  return promptTemplateTypeLabels[type];
}

function promptTemplateStyleOptions(styles: CustomStyle[], template: PromptTemplate): CustomStyle[] {
  const byId = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style]));
  resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).forEach((id) => {
    if (!byId.has(id)) {
      const option = styleOptions.find(([styleId]) => styleId === id);
      if (option) {
        byId.set(id, {
          id,
          name: option[1],
          tag: option[2],
          shortName: option[1],
          prefix: option[1],
          suffix: option[2],
          negativePrompt: '',
          allowColor: id !== 'black-white',
          description: option[2],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  });
  return [...byId.values()];
}

export function promptTemplateStyleLabelList(template: PromptTemplate, styles: CustomStyle[]): string[] {
  const styleNames = new Map([...defaultCustomStyles, ...styles].map((style) => [style.id, style.name]));
  return resolvePromptTemplateDefaultStyleIds(template, styles.map((style) => style.id)).map((id) => styleNames.get(id) ?? styleLabel(id, styles));
}

function styleLabel(id: string, styles: CustomStyle[] = defaultCustomStyles): string {
  return [...defaultCustomStyles, ...styles].find((style) => style.id === id)?.name ?? styleOptions.find(([styleId]) => styleId === id)?.[1] ?? id;
}

export function buildImageStyleDraftFromPrompt(prompt: string, base: CustomStyle): Pick<CustomStyle, 'name' | 'tag' | 'shortName' | 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor' | 'description'> {
  const normalized = prompt.trim() || base.name;
  const tags = splitListInput(normalized).slice(0, 4);
  const name = tags[0] || normalized.slice(0, 12) || base.name;
  return {
    name,
    tag: tags.length ? tags.join('、') : base.tag,
    shortName: name.slice(0, 4),
    prefix: [normalized, base.prefix].filter(Boolean).join('，'),
    suffix: base.suffix || '高质量，清晰细节，电影级构图',
    negativePrompt: base.negativePrompt || '模糊，噪点，过曝，低质量，水印，文字',
    allowColor: !/黑白|单色|mono/i.test(normalized) && base.allowColor,
    description: `适合${normalized}题材。`,
  };
}

function splitListInput(value: string): string[] {
  return value
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

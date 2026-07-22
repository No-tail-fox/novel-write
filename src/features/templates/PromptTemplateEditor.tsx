import React, { useRef, useState } from 'react';
import { Copy, FileJson, Save } from 'lucide-react';
import type { CustomStyle, PromptTemplate, PromptStepTemplateType, PromptTemplateType } from '../../shared/types';
import { resolvePromptTemplateDefaultStyleId, resolvePromptTemplateDefaultStyleIds, selectStepPromptTemplate } from '../../shared/prompt-templates';
import { defaultCustomStyles } from '../../shared/config';
import { toggleArray } from '../tasks/task-formatters';
import { useAsyncAction } from '../../ui/async-action';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { EmptyState } from '../../components/EmptyState';
import type { RendererAppState as AppState } from '../../app/route-types';
import { promptStepEditorDefinitions, promptTemplateReferenceOptions, promptTemplateStep3SkeletonOptions, promptTemplateTypeLabels, promptTemplateTypeOptions, promptTemplateVariableDefinitions, styleOptions, type PromptTemplateVariableScope } from '../../shared/editorial-options';
import type { TemplateOption } from '../../shared/prompt-templates';

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
                  <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                  <h2>查看图像模板 · {imageDraft.name}</h2>
                </div>
                <div className="button-row">
                  <button className="ghost-action" onClick={() => void duplicateImageTemplate(imageDraft)}>
                    <Copy size={15} />
                    克隆
                  </button>
                  <button className="ghost-action" onClick={exportImageTemplateJson}>
                    <FileJson size={15} />
                    导出 JSON
                  </button>
                  <button className="ghost-action" onClick={() => void importImageTemplateJson()}>
                    <FileJson size={15} />
                    导入 JSON
                  </button>
                  <button className="primary-action slim" onClick={saveCustomStyleDraft}>
                    <Save size={15} />
                    保存
                  </button>
                </div>
              </div>
              <div className="prompt-template-detail-stack">
                <section className="image-template-quick-card">
                  <div>
                    <span className="field-title">AI 快速生成</span>
                    <span className="hint-text">输入自然语言描述，自动填充下方图像模板字段。</span>
                  </div>
                  <Field label="风格描述">
                    <textarea className="small-textarea" value={imageTemplateAiPrompt} onChange={(event) => setImageTemplateAiPrompt(event.target.value)} placeholder="例如：赛博朋克雨夜街道，霓虹光影，未来都市" />
                  </Field>
                  <div className="template-meta-grid">
                    <Field label="基于系统风格">
                      <select value={baseImageTemplateId} onChange={(event) => setBaseImageTemplateId(event.target.value)}>
                        {state.customStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                      </select>
                    </Field>
                    <div className="button-row image-template-quick-actions">
                      <button className="ghost-action" type="button" onClick={applyBaseImageTemplate}>套用系统风格</button>
                      <button className="primary-action slim" type="button" disabled={imageTemplateAiGenerating} onClick={() => void fillImageTemplateFromAiPrompt()}>
                        {imageTemplateAiGenerating ? '生成中...' : '生成字段'}
                      </button>
                    </div>
                  </div>
                  {imageTemplateAiStatus ? <div className="image-template-ai-status" aria-live="polite">{imageTemplateAiStatus}</div> : null}
                </section>

                <section className="prompt-template-settings-card">
                  <span className="field-title">手动填写字段</span>
                  <div className="image-template-field-grid">
                    <Field label="名称">
                      <input value={imageDraft.name} onChange={(event) => setImageDraft({ ...imageDraft, name: event.target.value })} />
                    </Field>
                    <Field label="标签">
                      <input value={imageDraft.tag} onChange={(event) => setImageDraft({ ...imageDraft, tag: event.target.value })} />
                    </Field>
                    <Field label="简称">
                      <input value={imageDraft.shortName} onChange={(event) => setImageDraft({ ...imageDraft, shortName: event.target.value })} />
                    </Field>
                    <Field label="色彩模式">
                      <select value={imageDraft.allowColor ? 'color' : 'mono'} onChange={(event) => setImageDraft({ ...imageDraft, allowColor: event.target.value === 'color' })}>
                        <option value="color">彩色</option>
                        <option value="mono">黑白 / 单色</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="前缀（prefix）">
                    <textarea className="small-textarea" value={imageDraft.prefix} onChange={(event) => setImageDraft({ ...imageDraft, prefix: event.target.value })} />
                  </Field>
                  <Field label="后缀（suffix）">
                    <textarea className="small-textarea" value={imageDraft.suffix} onChange={(event) => setImageDraft({ ...imageDraft, suffix: event.target.value })} />
                  </Field>
                  <Field label="负面提示词（negativePrompt）">
                    <textarea className="small-textarea" value={imageDraft.negativePrompt} onChange={(event) => setImageDraft({ ...imageDraft, negativePrompt: event.target.value })} />
                  </Field>
                  <Field label="适用场景描述">
                    <textarea className="small-textarea" value={imageDraft.description} onChange={(event) => setImageDraft({ ...imageDraft, description: event.target.value })} />
                  </Field>
                </section>
                <Field label="导入 / 导出 JSON">
                  <textarea className="small-textarea" value={imageTemplateJsonDraft} onChange={(event) => setImageTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴图像模板 JSON 后点击导入 JSON" />
                </Field>
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
                <button className="ghost-action compact-action" onClick={() => setTemplateMode('gallery')}>返回模板库</button>
                <h2>查看系统模板 · {draft.name}</h2>
              </div>
              <div className="button-row">
                <button className="ghost-action" onClick={duplicate}>
                  <Copy size={15} />
                  克隆
                </button>
                <button className="ghost-action" onClick={exportPromptTemplateJson}>
                  <FileJson size={15} />
                  导出 JSON
                </button>
                <button className="ghost-action" onClick={() => void importPromptTemplateJson()}>
                  <FileJson size={15} />
                  导入 JSON
                </button>
                <button className="primary-action slim" onClick={savePromptTemplateDraft}>
                  <Save size={15} />
                  {draft.isBuiltin ? '保存为自定义模板' : '保存修改'}
                </button>
              </div>
            </div>
            <div className="prompt-template-detail-stack">
              <section className="prompt-template-basics-card">
                <div className="template-meta-grid prompt-template-basics-grid">
                  <Field label="模板名">
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </Field>
                  <Field label="描述（一句话说明这个模板的特点）">
                    <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  </Field>
                  <Field label="模板类型">
                    <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}>
                      {promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => <option key={type} value={type}>{promptTemplateTypeLabel(type)}</option>)}
                    </select>
                  </Field>
                  <Field label="绑定赛道">
                    <select value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}>
                      <option value="">无</option>
                      {promptTemplateBindingTrackOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="prompt-template-default-style-pills">
                  <span className="field-title">默认画风</span>
                  <div className="chip-row">
                    {promptTemplateStyleOptions(state.customStyles, draft).map((style) => (
                      <button
                        className={resolvePromptTemplateDefaultStyleId(draft, state.customStyles.map((customStyle) => customStyle.id)) === style.id ? 'chip active' : 'chip'}
                        type="button"
                        key={style.id}
                        onClick={() => setDraft({ ...draft, defaultStyles: [style.id] })}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>
                {draft.type === 'task' ? (
                  <div className="prompt-template-default-style-pills">
                    <span className="field-title">默认草稿模板</span>
                    <div className="chip-row">
                      {state.draftTemplates.map((template) => (
                        <button
                          className={(draft.defaultDraftTemplateId ?? 'default-portrait-9-16') === template.id ? 'chip active' : 'chip'}
                          type="button"
                          key={template.id}
                          onClick={() => setDraft({ ...draft, defaultDraftTemplateId: template.id })}
                        >
                          {template.name}
                        </button>
                      ))}
                    </div>
                    <small>新建任务选择赛道后，会同步草稿模板，并把 AI 出图比例同步为该草稿的图片比例。</small>
                  </div>
                ) : null}
              </section>

              <section className="prompt-template-settings-card">
                <span className="field-title">设置内容</span>
                <div className="prompt-template-content-settings">
                  <div className="prompt-template-setting-block">
                    <strong>主角档案</strong>
                    <div className="chip-row">
                      {(['follow-template', 'force-extract', 'force-skip'] as const).map((policy) => (
                        <button className={draft.characterPolicy === policy ? 'chip active' : 'chip'} type="button" key={policy} onClick={() => setDraft({ ...draft, characterPolicy: policy })}>
                          {policy === 'force-extract' ? '强制提取' : policy === 'force-skip' ? '强制跳过' : '跟随赛道'}
                        </button>
                      ))}
                    </div>
                    <small>主角档案会影响 Step 3 是否保持人物身份、外貌、年代和叙事一致。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>Step 3 骨架模块（可选线路）</strong>
                    <div className="chip-row">
                      {promptTemplateStep3SkeletonOptions.map((module) => (
                        <button
                          className={(draft.step3SkeletonModules ?? []).includes(module) ? 'chip active' : 'chip'}
                          type="button"
                          key={module}
                          onClick={() => setDraft({ ...draft, step3SkeletonModules: toggleArray(draft.step3SkeletonModules ?? [], module) })}
                        >
                          {module}
                        </button>
                      ))}
                    </div>
                    <small>勾选后 AI 助手会按用途生成对应骨架，已保存的 Step 3 prompt 文本不会自动改变。</small>
                  </div>
                  <div className="prompt-template-setting-block">
                    <strong>参考图类型</strong>
                    <div className="chip-row">
                      {promptTemplateReferenceOptions.map(([value, label]) => (
                        <button className={(draft.referenceKind ?? 'none') === value ? 'chip active' : 'chip'} type="button" key={value} onClick={() => setDraft({ ...draft, referenceKind: value })}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <small>上传参考图时，Step 3 会按这里的类型决定人脸或产品一致性要求。</small>
                  </div>
                </div>
                <div className="prompt-template-advanced-grid">
                  <Field label="标签">
                    <input value={(draft.marketTags ?? []).join('、')} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
                  </Field>
                  {draft.type === 'task' ? (
                    <Field label="出图种子池 JSON">
                      <textarea
                        className="small-textarea prompt-template-seed-pools"
                        value={draft.imageSeedPoolsJson ?? ''}
                        onChange={(event) => setDraft({ ...draft, imageSeedPoolsJson: event.target.value })}
                        placeholder='{"scenes":["close-up","wide shot"],"moods":["warm","dramatic"]}'
                      />
                    </Field>
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
                          <button className="ghost-action compact-action" type="button" disabled={!hasOverride} onClick={() => resetPromptTemplateStepPrompt(step.type)}>
                            继承全局
                          </button>
                        </div>
                        {(step.type === 'review' || step.type === 'rewrite') ? (
                          <PromptVariablePicker
                            scope={step.type}
                            value={promptTemplateStepPromptValue(draft, state.promptTemplates, step.type)}
                            onChange={(value) => updatePromptTemplateStepPrompt(step.type, value)}
                          />
                        ) : null}
                        <VariableAwareTextarea
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
                    className="template-textarea"
                    value={draft.content}
                    onChange={(value) => setDraft({ ...draft, content: value })}
                    placeholder="输入 // 选择变量"
                    variables={promptTemplateVariablesForScope(draft.type)}
                  />
                </section>
              )}
            </div>
            <Field label="导入 / 导出 JSON">
              <textarea className="small-textarea" value={templateJsonDraft} onChange={(event) => setTemplateJsonDraft(event.target.value)} placeholder="导出后会填入这里；也可粘贴故事模板 JSON 后点击导入 JSON" />
            </Field>
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
        <button
          className="chip prompt-template-variable-chip"
          type="button"
          key={item.key}
          title={`插入 {{${item.key}}}: ${item.description}`}
          onClick={() => onChange(appendPromptVariable(value, item.key))}
        >
          <span>{item.label}</span>
          <code className="prompt-variable-token">{`{{${item.key}}}`}</code>
          <small>{item.description}</small>
        </button>
      ))}</div>
    </>
  );
}

function VariableAwareTextarea({
  value,
  onChange,
  className,
  placeholder,
  variables,
}: {
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
      <textarea
        ref={textareaRef}
        className={className}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          syncSuggestState(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => syncSuggestState(event.currentTarget.value, event.currentTarget.selectionStart)}
      />
      {suggestOpen ? (
        <div className="prompt-variable-suggest">
          {variables.map((item) => (
            <button type="button" key={item.key} onMouseDown={(event) => event.preventDefault()} onClick={() => onVariableInsert(item.key)}>
              <span>{item.label}</span>
              <code>{`{{${item.key}}}`}</code>
              <small>英文变量 · {item.description}</small>
            </button>
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

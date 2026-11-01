import React from 'react';
import { ArrowLeft, Copy, RotateCcw, Save } from 'lucide-react';
import { Button, SelectField, TextAreaField, TextField } from '../../ui';
import type { PromptChannel, PromptTemplate } from '../../shared/types';
import type { RendererAppState } from '../../app/route-types';
import { workflowPromptCatalog } from '../../shared/workflow-prompt-catalog';
import { promptChannelOptions, selectWorkflowPrompt, workflowSlot, workflowSlotChannels } from '../../shared/workflow-prompt-runtime';
import { loadDefaultPromptTemplates } from '../../shared/prompt-template-loader';

export function WorkflowPromptEditor({ draft, state, setDraft, busy, feedback, onBack, onSave, onClone }: {
  draft: PromptTemplate; state: RendererAppState;
  setDraft: React.Dispatch<React.SetStateAction<PromptTemplate | null>>;
  busy: boolean; feedback: React.ReactNode; onBack: () => void; onSave: (apply?: boolean) => Promise<void>; onClone: () => Promise<void>;
}) {
  const slotChangeGeneration = React.useRef(0);
  React.useEffect(() => () => { slotChangeGeneration.current += 1; }, []);
  const slot = workflowSlot(draft.slot);
  const active = selectWorkflowPrompt(state.promptTemplates, draft.slot ?? '', draft.channel ?? 'shared');
  async function changeSlot(id: string) {
    const generation = ++slotChangeGeneration.current;
    const defaults = await loadDefaultPromptTemplates();
    const base = defaults.find((template) => template.slot === id);
    if (base && generation === slotChangeGeneration.current) setDraft((current) => current?.id === draft.id ? { ...current, slot: id, channel: current.channel && workflowSlotChannels(id).includes(current.channel) ? current.channel : base.channel, baseTrack: base.baseTrack, content: base.content } : current);
  }
  async function restoreSource() {
    const defaults = await loadDefaultPromptTemplates();
    const base = defaults.find((template) => template.slot === draft.slot);
    if (base) setDraft((current) => current?.id === draft.id && current.slot === draft.slot ? { ...current, content: base.content } : current);
  }
  return <div className="prompt-template-detail"><section className="panel editor-panel">
    {feedback}
    <div className="panel-title-row prompt-template-detail-title">
      <div><Button variant="subtle" icon={<ArrowLeft size={15} />} onClick={onBack}>返回模板库</Button><h2>编辑提示词 · {draft.name}</h2></div>
      <div className="button-row">
        <Button icon={<RotateCcw size={15} />} disabled={busy} onClick={() => void restoreSource()}>恢复源码原文</Button>
        <Button icon={<Copy size={15} />} disabled={busy} onClick={() => void onClone()}>克隆</Button>
        {!draft.isBuiltin ? <Button disabled={busy} onClick={() => void onSave(false)}>保存为备用</Button> : null}
        <Button variant="primary" icon={<Save size={15} />} disabled={busy} onClick={() => void onSave()}>保存并应用</Button>
      </div>
    </div>
    <div className="prompt-template-detail-stack">
      <section className="prompt-template-basics-card">
        <div className="template-meta-grid prompt-template-basics-grid">
          <TextField label="模板名" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <TextField label="描述" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          <SelectField label="提示词用途" value={draft.slot ?? ''} disabled={draft.isBuiltin} onChange={(event) => void changeSlot(event.target.value)}
            options={workflowPromptCatalog.map((entry) => ({ value: entry.slot, label: entry.name }))}
            hint="用途决定生成时调用的位置。切换用途会载入该用途的源码原文。" />
          <SelectField label="生效频道" value={draft.channel ?? 'shared'} disabled={draft.isBuiltin}
            onChange={(event) => setDraft({ ...draft, channel: event.target.value as PromptChannel })}
            options={promptChannelOptions.filter((option) => workflowSlotChannels(draft.slot).includes(option.value))} />
        </div>
        <p>{draft.isBuiltin ? '系统默认模板不可删除，修改会保留。' : '自定义模板按用途和频道应用。'}同一用途、同一频道以最近保存并应用的模板为准，频道专用规则优先于公共规则。</p>
        <p>当前应用：{active?.name ?? '源码默认'}。保存后用于下一次生成，已有成片需重新生成对应步骤。</p>
      </section>
      <section className="prompt-template-settings-card">
        <span className="field-title">现有提示词原文</span>
        <p>来源：{slot?.source}。动态变量由原生成流程提供，请保留当前用途需要的结构和输出要求。</p>
        {slot && Object.keys(slot.variables).length > 0 ? <div className="workflow-prompt-variables">
          {Object.entries(slot.variables).map(([key, description]) => <span key={key}><code>{`{{${key}}}`}</code> {description}</span>)}
        </div> : null}
        <TextAreaField label="提示词内容" rows={22} className="template-textarea" value={draft.content}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </section>
    </div>
  </section></div>;
}

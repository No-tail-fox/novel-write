import { useRef, useState } from 'react';
import { Button, Dialog, TextAreaField } from '../../ui';
import { useAsyncAction } from '../../ui/async-action';
import { planCodeVideoSource, codeVideoCondenseInstructions } from '../../shared/code-video-source-plan';
import { editorialShotVoiceProvider, parseEditorialCollagePipelineData, type EditorialCollagePipelineData } from '../../shared/editorial-collage';
import type { VoxProductionSettings } from '../../shared/vox-production';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { ApplyMutationResult } from '../../app/route-types';
import type { ProjectModels } from '../../shared/types';

/** Preparation creates separate drafts only. Production always requires another reviewed start. */
export function CodeVideoSourceDialog({ document, settings, api, projectModels, applyState, onClose, onReview }: {
  document: EditorialCollagePipelineData; settings: VoxProductionSettings; api: StoryDreamApi;
  projectModels?: ProjectModels; applyState: ApplyMutationResult; onClose(): void; onReview(id: string): void;
}) {
  const policy = settings.codeVideo!;
  const source = document.sourceText || document.beats.flatMap(beat => beat.subtitleCues.map(cue => cue.text)).join('\n');
  const plan = planCodeVideoSource(source, policy);
  const action = useAsyncAction();
  const [proposal, setProposal] = useState('');
  const [drafts, setDrafts] = useState<{ id: string; title: string }[]>([]);
  const slots = useRef<{ id: string; title: string; configured: boolean }[]>([]);
  const condensed = policy.longTextMode === 'condense';
  const proposalPlan = /[\p{L}\p{N}]/u.test(proposal) ? planCodeVideoSource(proposal, policy) : null;
  const [creationStarted, setCreationStarted] = useState(false);
  const completed = drafts.length === (condensed ? 1 : plan.segments.length);

  async function condense() {
    await action.run(async () => {
      const result = await api.composeResearchCopy({ projectId: document.id, codeVideoCondense: { targetDurationSeconds: policy.targetDurationSeconds }, channel: 'editorial-collage', intent: 'refine', keyword: document.title,
        extraRequirements: codeVideoCondenseInstructions(policy.targetDurationSeconds), selectedSources: [{ source: 'user-draft', title: '原始文案', content: source }], useBuiltinKnowledge: false });
      setProposal(result.copy);
    });
  }
  async function createDrafts() {
    await action.run(async () => {
      setCreationStarted(true);
      const texts = condensed ? [proposal] : plan.segments.map(segment => segment.text);
      for (let index = 0; index < texts.length; index++) {
        let slot = slots.current[index];
        if (!slot) {
          const title = `${document.title} · ${condensed ? '精简稿' : `第 ${index + 1}/${texts.length} 段`}`;
          const mutation = await api.createEditorialCollage({ title, sourceText: texts[index], ratio: document.ratio, durationMs: 'auto', productionRoute: 'lemo', projectModels, writingStyleId: document.writingStyleId, writingRequirements: document.writingRequirements });
          if (!mutation || mutation.kind !== 'task-upsert') throw new Error('未返回新草稿，请在项目列表检查创建结果。');
          slot = { id: mutation.task.id, title, configured: false };
          slots.current[index] = slot;
          applyState(mutation);
        }
        if (!slot.configured) {
          const task = await api.getTaskDetail(slot.id);
          if (!task) throw new Error('草稿已创建但暂时无法读取，请重试。');
          const created = parseEditorialCollagePipelineData(task.pipelineData);
          const voice = document.beats.flatMap(beat => beat.shots)[0];
          const configured = { ...created, productionSettings: { ...settings, lockedShotIds: [] }, beats: created.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot => ({ ...shot, voiceId: voice?.voiceId, voiceProvider: voice ? editorialShotVoiceProvider(document, voice) : undefined, voiceLabel: voice?.voiceLabel, subtitleStyle: voice?.subtitleStyle })) })) };
          applyState(await api.saveEditorialCollage({ id: slot.id, expectedUpdatedAt: created.updatedAt, document: configured }));
          slot.configured = true;
          setDrafts(slots.current.filter(item => item.configured).map(({ id, title }) => ({ id, title })));
        }
      }
    });
  }
  return <Dialog open title="制作前准备长文案" onOpenChange={open => { if (!open && !action.busy) onClose(); }} actions={<>
    <Button disabled={action.busy} onClick={onClose}>{drafts.length ? '完成，稍后审核' : '返回编辑'}</Button>
    {!completed && <Button variant="primary" disabled={action.busy || (condensed && (!proposalPlan || proposalPlan.requiresAction))} onClick={() => void createDrafts()}>{action.busy ? '处理中…' : creationStarted ? '继续创建剩余草稿' : condensed ? '保存精简稿供审核' : `拆分并创建 ${plan.segments.length} 个草稿`}</Button>}
  </>}>
    <p>目标 {policy.targetDurationSeconds} 秒；原稿估算 {Math.ceil(plan.estimatedDurationMs / 1000)} 秒。{condensed ? '精简后先审核文案，再保存为独立草稿。' : '按原文顺序完整拆分为独立项目。'}原项目保留，草稿不会自动配音或制作。</p>
    {condensed ? <>
      <p>AI 精简会使用本项目的文案模型发起一次付费请求；不会自动重试。结果可手动修改。</p>
      <Button disabled={action.busy || creationStarted} onClick={() => void condense()}>{proposal ? '重新请求 AI 精简' : '请求 AI 精简'}</Button>
      <TextAreaField label="精简文案审核" value={proposal} disabled={action.busy || creationStarted} onChange={(_, data) => setProposal(data.value)} />
      {proposalPlan && <p role="status">估算 {Math.ceil(proposalPlan.estimatedDurationMs / 1000)} 秒{proposalPlan.requiresAction ? '，仍超过目标，请继续编辑后保存。' : '，可保存为审核草稿。'}</p>}
    </> : <details><summary>查看 {plan.segments.length} 段原文</summary>{plan.segments.map(segment => <section key={segment.index}><h4>第 {segment.index} 段 · 约 {Math.ceil(segment.estimatedDurationMs / 1000)} 秒</h4><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{segment.text}</p></section>)}</details>}
    {action.feedback && <p role="alert">{action.feedback.message} 已创建的草稿保留，可继续处理或从项目列表打开。</p>}
    {drafts.length > 0 && <section aria-label="待审核草稿"><p role="status">已创建 {drafts.length} 个草稿，请逐个检查文案和分镜后开始制作。</p>{drafts.map(draft => <p key={draft.id}><Button disabled={action.busy} onClick={() => onReview(draft.id)}>审核 {draft.title}</Button></p>)}</section>}
  </Dialog>;
}

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftTemplatesPage } from '../src/features/templates/DraftTemplatesPage';
import { PromptTemplatesPage } from '../src/features/templates/PromptTemplatesPage';
import { WorkspaceLeaveDialog, WorkspaceNavigationProvider, useWorkspaceNavigation } from '../src/app/workspace-navigation';
import { StoryDreamProvider } from '../src/ui';
import { draftTemplates } from '../src/shared/templates';
import { defaultConfig, defaultCustomStyles } from '../src/shared/config';
import { fallbackEffectCatalog } from '../src/shared/editorial-options';
import type { AppMutationResult, CustomStyle, DraftTemplate, PromptTemplate } from '../src/shared/types';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';

const story: PromptTemplate = {
  id: 'story-a', name: 'Story A', type: 'task', description: 'Test story', content: 'Original body',
  isBuiltin: false, origin: 'custom', updatedAt: '2026-09-06T00:00:00.000Z', baseTrack: 'general-story',
};
const draft = { ...structuredClone(draftTemplates[0]), id: 'draft-a', name: 'Draft A', isDefault: false };
const style = { ...structuredClone(defaultCustomStyles[0]), id: 'style-a', name: 'Style A' };
const initial = { config: defaultConfig, promptTemplates: [story], draftTemplates: [draft], customStyles: [style] } as RendererAppState;
const controls = {
  delayDetail: false, delaySave: false, failSave: false, saved: [] as unknown[],
  pendingDetails: [] as Array<() => void>, pendingSaves: [] as Array<() => void>,
  releaseDetails() { this.delayDetail = false; this.pendingDetails.splice(0).forEach((resolve) => resolve()); },
  releaseSaves() { this.delaySave = false; this.pendingSaves.splice(0).forEach((resolve) => resolve()); },
};
async function saveGate(value: unknown) {
  if (controls.delaySave) await new Promise<void>((resolve) => controls.pendingSaves.push(resolve));
  if (controls.failSave) throw new Error('Fixture save failed');
  controls.saved.push(structuredClone(value));
}
async function detailGate() {
  if (controls.delayDetail) await new Promise<void>((resolve) => controls.pendingDetails.push(resolve));
}
const api = {
  async getDraftTemplateDetail() { await detailGate(); return structuredClone(draft); },
  async getPromptTemplateDetail() { await detailGate(); return structuredClone(story); },
  async getJianyingEffectCatalog() { return fallbackEffectCatalog; },
  async saveDraftTemplate(value: DraftTemplate) { await saveGate(value); return { kind: 'state-patch', patch: { kind: 'draft-template-upsert', template: structuredClone(value) } }; },
  async savePromptTemplate(value: PromptTemplate) { await saveGate(value); return { kind: 'state-patch', patch: { kind: 'prompt-template-upsert', template: structuredClone(value) } }; },
  async saveCustomStyle(value: CustomStyle) { await saveGate(value); return { kind: 'state-patch', patch: { kind: 'custom-style-upsert', style: structuredClone(value) } }; },
} as unknown as StoryDreamApi;

function Host({ mode }: { mode: 'draft' | 'prompt' }) {
  const [state, setState] = useState(initial);
  const [left, setLeft] = useState(false);
  const navigation = useWorkspaceNavigation();
  function applyState(result: AppMutationResult | null) {
    if (result?.kind !== 'state-patch') return;
    const patch = result.patch;
    setState((current) => {
      if (patch.kind === 'draft-template-upsert') return { ...current, draftTemplates: [...current.draftTemplates.filter((item) => item.id !== patch.template.id), patch.template] };
      if (patch.kind === 'prompt-template-upsert') return { ...current, promptTemplates: [...current.promptTemplates.filter((item) => item.id !== patch.template.id), patch.template] };
      if (patch.kind === 'custom-style-upsert') return { ...current, customStyles: [...current.customStyles.filter((item) => item.id !== patch.style.id), patch.style] };
      return current;
    });
  }
  return <>
    <button data-testid="leave" onClick={() => void navigation.requestLeave(() => { setLeft(true); })}>Leave</button>
    <output data-testid="dirty">{String(navigation.dirty)}</output>
    {left ? <div data-testid="destination">Destination</div> : mode === 'draft'
      ? <DraftTemplatesPage api={api} state={state} applyState={applyState} />
      : <PromptTemplatesPage api={api} state={state} applyState={applyState} />}
    <WorkspaceLeaveDialog />
  </>;
}

const query = new URLSearchParams(location.search);
if (query.has('delayDetail')) controls.delayDetail = true;
const mode = query.get('mode') === 'draft' ? 'draft' : 'prompt';
Object.assign(window, { templateQA: controls });
createRoot(document.getElementById('root')!).render(
  <StoryDreamProvider theme="light"><WorkspaceNavigationProvider><Host mode={mode} /></WorkspaceNavigationProvider></StoryDreamProvider>,
);

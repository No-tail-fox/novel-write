import { describe, expect, it } from 'vitest';
import { applyMotionComicScriptProposal, motionComicScriptProposeSchema, motionComicScriptAdoptSchema, type MotionComicScriptProposal } from '../src/shared/motion-comic-script-proposal';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
const script: MotionComicScriptDraft = { title: '来信', logline: '收到来信', characters: [], props: [], sceneAssets: [{ key: 'room', label: '房间', description: '室内', prompt: '室内门口', continuityNotes: '门在左侧' }], scenes: [{ key: 'room', title: '来信', summary: '信件到来', locationKey: 'room', actIndex: 1, actTitle: '开端', actBoundaryReason: '来信', beats: [{ key: 'one', kind: 'action', text: '开门', sourceUnitIds: ['S1'] }] }] };
const proposal: MotionComicScriptProposal = { requestId: 'request', requestFingerprint: 'request-hash', baseProjectUpdatedAt: '2026-11-12T00:00:00.000Z', baseScriptHash: 'script-hash', promptVersion: 'single-beat-text-v1', id: 'p', projectId: 'project', taskId: 'task', baseRevision: 3, inputFingerprint: 'input', sceneKey: 'room', beatKey: 'one', instruction: '细化动作', originalText: '开门', proposedText: '她握住门把，缓缓推开门。', status: 'ready', provider: 'fixture', model: 'fixture', createdAt: '2026-11-12T00:00:00.000Z' };
const context = { projectId: 'project', taskId: 'task', revision: 3, inputFingerprint: 'input' };
describe('script proposal application contract', () => {
  it('requires revision, request identity and stable keys, and rejects renderer supplied patches on adoption', () => {
    const base = { id: 'project', taskId: 'task', outputRevision: 3, expectedUpdatedAt: proposal.baseProjectUpdatedAt };
    const request = { ...base, sceneKey: 'room', beatKey: 'one', instruction: '细化动作', requestId: 'r' };
    expect(motionComicScriptProposeSchema.safeParse(request).success).toBe(true);
    expect(motionComicScriptProposeSchema.safeParse({ ...request, arbitraryPath: 'scenes.0' }).success).toBe(false);
    expect(motionComicScriptProposeSchema.safeParse({ ...request, requestId: '' }).success).toBe(false);
    expect(motionComicScriptAdoptSchema.safeParse({ ...base, proposalId: 'p' }).success).toBe(true);
    expect(motionComicScriptAdoptSchema.safeParse({ ...base, proposalId: 'p', proposedText: '伪造' }).success).toBe(false);
  });
  it('changes only targeted text and leaves source evidence and baseline untouched', () => {
    const next = applyMotionComicScriptProposal(script, proposal, context);
    expect(next.scenes[0].beats[0]).toEqual({ ...script.scenes[0].beats[0], text: proposal.proposedText });
    expect(script.scenes[0].beats[0].text).toBe('开门');
    expect(proposal.status).toBe('ready');
  });
  it('rejects stale revision, identity, fingerprint and already consumed proposals', () => {
    for (const patch of [{ revision: 4 }, { taskId: 'other' }, { projectId: 'other' }, { inputFingerprint: 'new' }]) expect(() => applyMotionComicScriptProposal(script, proposal, { ...context, ...patch })).toThrow('STALE');
    expect(() => applyMotionComicScriptProposal(script, { ...proposal, status: 'applied' }, context)).toThrow('NOT_READY');
  });
  it('rejects oversized historical proposals without changing the current draft', () => {
    expect(() => applyMotionComicScriptProposal(script, { ...proposal, proposedText: '字'.repeat(2001) }, context)).toThrow();
    expect(script.scenes[0].beats[0].text).toBe('开门');
  });
  it('rejects changed, missing and ambiguous targets without guessing a nearby beat', () => {
    const changed = structuredClone(script); changed.scenes[0].beats[0].text = '人工修改';
    expect(() => applyMotionComicScriptProposal(changed, proposal, context)).toThrow('TARGET_CHANGED');
    expect(() => applyMotionComicScriptProposal(script, { ...proposal, beatKey: 'missing' }, context)).toThrow('TARGET_CHANGED');
    const duplicate = structuredClone(script); duplicate.scenes[0].beats.push({ ...duplicate.scenes[0].beats[0] });
    expect(() => applyMotionComicScriptProposal(duplicate, proposal, context)).toThrow('TARGET_CHANGED');
  });
});

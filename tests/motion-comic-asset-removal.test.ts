import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject, type MotionComicPipelineData } from '../src/shared/motion-comic';
import type { DirectorBatchRecord } from '../src/shared/director-batch-persistence';
import { planMotionComicAssetRemoval, referenceJobFor } from '../src/features/motion-comic/motion-comic-asset-removal';

function project(): MotionComicPipelineData {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'removal', title: '删除测试', premise: '测试', now: '2026-09-05T00:00:00.000Z' }), '第一集');
  document.characters = [{
    id: 'nezha', name: '哪吒', role: '主角', identityPrompt: '莲花重塑', personality: '', voiceNotes: '',
    looks: ['战前', '战后'].map((label, index) => ({
      id: `look-${index}`, characterId: 'nezha', label, appearancePrompt: '', wardrobe: '', continuityNotes: '', referenceAssetVersionIds: [], pinned: false,
    })),
  }];
  document.sceneAssets = [
    { id: 'sea', label: '东海', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] },
    { id: 'sky', label: '陈塘关', description: '', prompt: '', continuityNotes: '', referenceAssetVersionIds: [] },
  ];
  document.props = [
    { id: 'spear', label: '火尖枪', description: '', prompt: '', referenceAssetVersionIds: [] },
    { id: 'ring', label: '乾坤圈', description: '', prompt: '', referenceAssetVersionIds: [] },
  ];
  const shot = document.episodes[0].scenes[0].shots[0];
  shot.characterLookIds = ['look-0'];
  shot.sceneAssetId = 'sea';
  shot.propAssetIds = ['spear'];
  return document;
}

describe('asset removal', () => {
  it('deletes an unreferenced look and keeps the character', () => {
    const plan = planMotionComicAssetRemoval(project(), { kind: 'look', characterId: 'nezha', lookId: 'look-1' });
    expect(plan.blocker).toBeNull();
    expect(plan.next?.characters[0].looks.map((look) => look.id)).toEqual(['look-0']);
  });

  it('refuses to delete the last remaining look', () => {
    const document = project();
    planFirst(document);
    document.characters[0].looks = document.characters[0].looks.filter((look) => look.id === 'look-0');
    const plan = planMotionComicAssetRemoval(document, { kind: 'look', characterId: 'nezha', lookId: 'look-0' });
    expect(plan.next).toBeNull();
    expect(plan.blocker?.message).toContain('至少保留一个造型');
  });

  it('blocks deletion while a shot still binds the look and never rebinds the shot', () => {
    const document = project();
    const plan = planMotionComicAssetRemoval(document, { kind: 'look', characterId: 'nezha', lookId: 'look-0' });
    expect(plan.next).toBeNull();
    expect(plan.blocker?.message).toContain('1 个镜头');
    expect(document.episodes[0].scenes[0].shots[0].characterLookIds).toEqual(['look-0']);
  });

  it('blocks deleting a character that a shot binds through any of its looks', () => {
    const plan = planMotionComicAssetRemoval(project(), { kind: 'character', characterId: 'nezha' });
    expect(plan.next).toBeNull();
    expect(plan.blocker?.kind).toBe('shot');
  });

  it('blocks deletion while a dialogue cue already has generated voice', () => {
    const document = project();
    document.episodes[0].scenes[0].shots[0].characterLookIds = [];
    document.episodes[0].dialogueCues = [{ ...document.episodes[0].dialogueCues[0], characterId: 'nezha', voiceAssetVersionId: 'voice-1' }];
    const plan = planMotionComicAssetRemoval(document, { kind: 'character', characterId: 'nezha' });
    expect(plan.next).toBeNull();
    expect(plan.blocker?.message).toContain('配音');
  });

  it('removes an unused character together with its series binding', () => {
    const document = project();
    document.episodes[0].scenes[0].shots[0].characterLookIds = [];
    document.series.characterIds = ['nezha'];
    const plan = planMotionComicAssetRemoval(document, { kind: 'character', characterId: 'nezha' });
    expect(plan.next?.characters).toEqual([]);
    expect(plan.next?.series.characterIds).toEqual([]);
  });

  it('refuses to delete a scene or prop that a shot still references', () => {
    const document = project();
    expect(planMotionComicAssetRemoval(document, { kind: 'scene', sceneAssetId: 'sea' }).blocker?.kind).toBe('shot');
    expect(planMotionComicAssetRemoval(document, { kind: 'prop', propAssetId: 'spear' }).blocker?.kind).toBe('shot');
  });

  it('deletes an unused scene and prop and keeps stable ids consistent', () => {
    const document = project();
    document.series.sceneAssetIds = ['sea', 'sky'];
    document.series.propAssetIds = ['spear', 'ring'];
    const scenePlan = planMotionComicAssetRemoval(document, { kind: 'scene', sceneAssetId: 'sky' });
    expect(scenePlan.next?.sceneAssets.map((item) => item.id)).toEqual(['sea']);
    expect(scenePlan.next?.series.sceneAssetIds).toEqual(['sea']);
    const propPlan = planMotionComicAssetRemoval(document, { kind: 'prop', propAssetId: 'ring' });
    expect(propPlan.next?.props.map((item) => item.id)).toEqual(['spear']);
    expect(propPlan.next?.series.propAssetIds).toEqual(['spear']);
  });

  it('reports unknown targets instead of silently succeeding', () => {
    const plan = planMotionComicAssetRemoval(project(), { kind: 'scene', sceneAssetId: 'ghost' });
    expect(plan.next).toBeNull();
    expect(plan.blocker?.message).toContain('已不存在');
  });
});

describe('reference job state', () => {
  type FixtureNode = Partial<NonNullable<DirectorBatchRecord['nodes'][number]['reference']>> & { status?: DirectorBatchRecord['nodes'][number]['status'] };
  const batch = (patch: Partial<DirectorBatchRecord>, node: FixtureNode = {}): DirectorBatchRecord => ({
    id: 'batch-1', status: 'running', nodes: [{
      id: 'node-1', status: node.status ?? 'running', reference: { target: { kind: 'look', id: 'look-0' }, submissionState: 'submitted', applyState: 'pending', ...node } as unknown as DirectorBatchRecord['nodes'][number]['reference'],
    }], plan: { purpose: 'reference-generation' }, ...patch,
  } as unknown as DirectorBatchRecord);

  it('reports nothing when the target has no live batch', () => {
    expect(referenceJobFor(project(), 'look:look-0', [])).toBeNull();
  });

  it('reports queued, running and unknown states from the authoritative batch', () => {
    expect(referenceJobFor(project(), 'look:look-0', [batch({ status: 'queued' })])?.label).toContain('队列');
    const running = referenceJobFor(project(), 'look:look-0', [batch({})]);
    expect(running?.label).toContain('正在生成');
    expect(running?.progress).toBe(0);
    expect(referenceJobFor(project(), 'look:look-0', [batch({}, { submissionState: 'unknown' })])?.detail).toContain('不会自动重发');
  });

  it('ignores other targets and applied nodes', () => {
    expect(referenceJobFor(project(), 'look:look-1', [batch({})])).toBeNull();
    expect(referenceJobFor(project(), 'look:look-0', [batch({ status: 'completed' }, { status: 'completed', submissionState: 'resolved', applyState: 'applied' })])).toBeNull();
  });
});

function planFirst(document: MotionComicPipelineData) {
  document.episodes[0].scenes[0].shots[0].characterLookIds = ['look-1'];
}

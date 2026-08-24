import { describe, expect, it } from 'vitest';
import {
  appendEditorialBeat,
  createEditorialCollageDraft,
  createEditorialCollageStarterPlan,
  editorialCollageReady,
  moveEditorialBeat,
  parseEditorialCollagePipelineData,
  removeEditorialBeat,
  validateEditorialCollagePipeline,
  type EditorialCollageBeat,
} from '@shared/editorial-collage';

function beat(overrides: Partial<EditorialCollageBeat> = {}): EditorialCollageBeat {
  return {
    id: 'beat-1',
    index: 1,
    title: 'Hook',
    narration: 'A short claim.',
    startMs: 0,
    durationMs: 2_000,
    shots: [{
      id: 'shot-1',
      beatId: 'beat-1',
      durationMs: 2_000,
      renderStrategy: 'deterministic-layers',
      scenePrompt: 'A paper collage board',
      motionPrompt: 'A gentle push in',
      layers: [
        { id: 'layer-bg', label: 'Board', kind: 'background', source: 'generated-image', zIndex: 0, depth: -0.06, assetVersionId: 'asset-bg', motion: [{ atMs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }] },
        { id: 'layer-subject', label: 'Subject', kind: 'subject', source: 'generated-image', zIndex: 1, depth: 0.1, assetVersionId: 'asset-subject', motion: [{ atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }] },
      ],
      camera: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: 2_000, x: 0.5, y: 0.5, zoom: 1.06 }],
      subtitleCueIds: ['cue-1', 'cue-2'],
    }],
    subtitleCues: [
      { id: 'cue-1', startMs: 0, endMs: 800, text: 'A short' },
      { id: 'cue-2', startMs: 800, endMs: 1_800, text: 'claim.' },
    ],
    ...overrides,
  };
}

describe('editorial collage workflow contract', () => {
  it('creates a draft without pretending that it is renderable', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-1', title: 'Coffee', now: '2026-08-17T00:00:00.000Z' });
    expect(draft.workflowKind).toBe('editorial-collage');
    expect(validateEditorialCollagePipeline(draft)).toEqual([]);
    expect(editorialCollageReady(draft)).toBe(false);
  });

  it('keeps multiple subtitle cues under one visual beat', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-1', title: 'Coffee' });
    const plan = {
      ...draft,
      beats: [beat()],
      selectedStyleId: 'style-1',
      costApprovedAt: '2026-08-17T00:00:00.000Z',
      styleCandidates: [{ id: 'style-1', label: 'Swiss', prompt: 'Swiss collage', selected: true }],
      assets: [
        { id: 'asset-bg', assetId: 'background', kind: 'image' as const, createdAt: draft.createdAt },
        { id: 'asset-subject', assetId: 'subject', kind: 'image' as const, createdAt: draft.createdAt },
      ],
    };
    expect(validateEditorialCollagePipeline(plan, { ready: true })).toEqual([]);
    expect(plan.beats[0].subtitleCues).toHaveLength(2);
    expect(editorialCollageReady(plan)).toBe(true);
  });

  it('rejects unsorted camera keyframes, overlong shots, and missing paid approval', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-1', title: 'Coffee' });
    const invalid = {
      ...draft,
      estimatedCost: 0.42,
      beats: [{ ...beat(), durationMs: 16_000, shots: [{ ...beat().shots[0], durationMs: 16_000, camera: [{ atMs: 1_000, x: 0.5, y: 0.5, zoom: 1 }, { atMs: 0, x: 0.5, y: 0.5, zoom: 1 }] }] }],
      selectedStyleId: 'style-1',
      styleCandidates: [{ id: 'style-1', label: 'Swiss', prompt: 'Swiss collage', selected: true }],
    };
    const issues = validateEditorialCollagePipeline(invalid, { ready: true });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['beats[0].shots[0].durationMs', 'beats[0].shots[0].camera[1].atMs', 'costApprovedAt']));
    expect(editorialCollageReady(invalid)).toBe(false);
  });

  it('builds a strict 30-second starter timeline without coupling visual beats to subtitle cues', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-starter', title: 'Why coffee changed cities', now: '2026-08-17T00:00:00.000Z' });
    const starter = createEditorialCollageStarterPlan(
      draft,
      '咖啡馆不只卖饮料。它改变了人们交换消息的方式。报纸、交易和公共讨论在同一张桌边发生。最后，城市拥有了新的公共空间。',
      '2026-08-17T00:00:01.000Z',
    );

    expect(starter.timeline?.durationMs).toBe(30_000);
    expect(starter.beats).toHaveLength(4);
    expect(starter.beats.flatMap((item) => item.subtitleCues).length).toBeGreaterThan(starter.beats.length);
    expect(editorialCollageReady(starter)).toBe(true);
    expect(parseEditorialCollagePipelineData(JSON.stringify(starter))).toEqual(starter);
    expect(() => parseEditorialCollagePipelineData({ ...starter, unexpected: true })).toThrow(/EDITORIAL_COLLAGE_INVALID_DATA/u);
  });

  it('adds, reorders and removes editable beats while keeping one continuous timeline', () => {
    const starter = createEditorialCollageStarterPlan(
      createEditorialCollageDraft({ id: 'vox-structure', title: 'Editable VOX', now: '2026-08-24T00:00:00.000Z' }),
      '钩子。背景。证据。结论。',
      '2026-08-24T00:00:01.000Z',
    );
    const added = appendEditorialBeat(starter, { id: 'beat-extra', title: '补充证据', durationMs: 5_000, now: '2026-08-24T00:00:02.000Z' });
    expect(added.beats).toHaveLength(5);
    expect(added.timeline?.durationMs).toBe(35_000);
    const moved = moveEditorialBeat(added, 'beat-extra', -1);
    expect(moved.beats.map((item) => item.id)).toEqual(['beat-1', 'beat-2', 'beat-3', 'beat-extra', 'beat-4']);
    expect(moved.beats.map((item) => item.index)).toEqual([1, 2, 3, 4, 5]);
    expect(validateEditorialCollagePipeline(moved)).toEqual([]);
    const removed = removeEditorialBeat(moved, 'beat-3');
    expect(removed.beats).toHaveLength(4);
    expect(removed.beats.at(-1)?.startMs).toBe(17_000);
    expect(validateEditorialCollagePipeline(removed)).toEqual([]);
  });

  it('builds configurable 45-second and 60-second VOX structures from the source text', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-flexible', title: 'Flexible VOX', now: '2026-08-24T00:00:00.000Z' });
    const standard = createEditorialCollageStarterPlan(draft, '一。二。三。四。五。六。', '2026-08-24T00:00:01.000Z', { beatCount: 6, totalDurationMs: 45_000 });
    expect(standard.beats).toHaveLength(6);
    expect(standard.timeline?.durationMs).toBe(45_000);
    expect(standard.beats[0]).toMatchObject({ title: '钩子', durationMs: 3_000 });
    expect(standard.beats.at(-1)?.title).toBe('结论');
    expect(validateEditorialCollagePipeline(standard)).toEqual([]);

    const extended = createEditorialCollageStarterPlan(draft, '一。二。三。四。五。六。七。八。', '2026-08-24T00:00:01.000Z', { beatCount: 8, totalDurationMs: 60_000 });
    expect(extended.beats).toHaveLength(8);
    expect(extended.timeline?.durationMs).toBe(60_000);
    expect(validateEditorialCollagePipeline(extended)).toEqual([]);
  });
});

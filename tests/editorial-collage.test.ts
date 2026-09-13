import { describe, expect, it } from 'vitest';
import {
  createEditorialCollageDraft,
  createEditorialCollageStarterPlan,
  editorialCollageReady,
  insertEditorialShot,
  mergeEditorialShots,
  parseEditorialCollagePipelineData,
  removeEditorialShot,
  reorderEditorialShot,
  reorderEditorialLayer,
  setEditorialLayerVisibility,
  updateEditorialCameraKeyframe,
  editEditorialShotMotion,
  editorialCameraPreset,
  rebuildEditorialTimeline,
  splitEditorialShot,
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
    const plan = rebuildEditorialTimeline({
      ...draft,
      beats: [beat()],
      selectedStyleId: 'style-1',
      costApprovedAt: '2026-08-17T00:00:00.000Z',
      styleCandidates: [{ id: 'style-1', label: 'Swiss', prompt: 'Swiss collage', selected: true }],
      assets: [
        { id: 'asset-bg', assetId: 'background', kind: 'image' as const, createdAt: draft.createdAt },
        { id: 'asset-subject', assetId: 'subject', kind: 'image' as const, createdAt: draft.createdAt },
      ],
    });
    expect(validateEditorialCollagePipeline(plan, { ready: true })).toEqual([]);
    expect(plan.beats[0].subtitleCues).toHaveLength(2);
    expect(editorialCollageReady(plan)).toBe(true);
  });

  it('edits layer order, visibility, and camera keyframes on the persisted shot', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-motion', title: 'Motion' });
    const source = rebuildEditorialTimeline({ ...draft, beats: [beat()], assets: ['asset-bg', 'asset-subject'].map((id) => ({ id, assetId: id, kind: 'image' as const, createdAt: draft.createdAt })) });
    const moved = editEditorialShotMotion(source, 'shot-1', { kind: 'layer-order', layerId: 'layer-bg', direction: 'up' });
    expect(moved.beats[0].shots[0].layers.find((layer) => layer.id === 'layer-bg')?.zIndex).toBe(1);
    expect(moved.beats[0].shots[0].layers.find((layer) => layer.id === 'layer-subject')?.zIndex).toBe(0);
    const hidden = editEditorialShotMotion(moved, 'shot-1', { kind: 'layer-visibility', layerId: 'layer-subject', visible: false });
    expect(hidden.beats[0].shots[0].layers.find((layer) => layer.id === 'layer-subject')?.visible).toBe(false);
    const edited = editEditorialShotMotion(hidden, 'shot-1', { kind: 'camera-frame', index: 1, patch: { x: 0.42, zoom: 1.12 } });
    expect(edited.beats[0].shots[0].camera[1]).toMatchObject({ x: 0.42, zoom: 1.12 });
    expect(edited.timeline?.clips[0].assetVersionIds).toEqual(['asset-bg']);
    expect(source.beats[0].shots[0].camera[1].zoom).toBe(1.06);
    expect(source.beats[0].shots[0].layers[0].zIndex).toBe(0);
    expect(validateEditorialCollagePipeline(edited)).toEqual([]);
    expect(parseEditorialCollagePipelineData(JSON.stringify(edited))).toEqual(edited);
    expect(setEditorialLayerVisibility(edited, 'shot-1', 'layer-subject', true).timeline?.clips[0].assetVersionIds).toEqual(['asset-bg', 'asset-subject']);
  });

  it('moves equal-z layers, rejects invalid camera data, and protects video-mode history', () => {
    const shot = beat().shots[0];
    shot.layers.forEach((layer) => { layer.zIndex = 0; });
    const draft = createEditorialCollageDraft({ id: 'vox-boundaries', title: 'Motion boundaries' });
    const source = rebuildEditorialTimeline({ ...draft, beats: [beat({ shots: [shot] })] });
    const moved = reorderEditorialLayer(source, shot.id, 'layer-bg', 'up');
    expect(moved.beats[0].shots[0].layers.map((layer) => layer.zIndex)).toEqual([1, 0]);
    expect(reorderEditorialLayer(moved, shot.id, 'layer-bg', 'up')).toBe(moved);
    for (const patch of [{ zoom: NaN }, { zoom: 0 }, { x: 11 }, { atMs: 2001 }]) {
      expect(() => updateEditorialCameraKeyframe(source, shot.id, 0, patch)).toThrow();
    }
    const video = { ...source, beats: [beat({ shots: [{ ...shot, renderStrategy: 'living-poster' }] })] };
    expect(() => editEditorialShotMotion(video, shot.id, { kind: 'camera-frame', index: 0, patch: { zoom: 1.2 } })).toThrow('请切换到本地关键帧');
    expect(video.beats[0].shots[0].camera).toEqual(shot.camera);
    expect(editorialCameraPreset(2000, '固定机位')).toEqual([{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }, { atMs: 2000, x: 0.5, y: 0.5, zoom: 1 }]);
  });

  it('inserts interpolated frames, edits layer transforms, and preserves endpoint clocks', () => {
    const source = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'frames', title: 'Frames' }), '一。二。三。四。');
    const shot = source.beats[0].shots[0];
    const layerId = shot.layers[0].id;
    const atMs = Math.round(shot.durationMs / 2);
    let next = editEditorialShotMotion(source, shot.id, { kind: 'insert-frame', atMs });
    const camera = next.beats[0].shots[0].camera;
    expect(camera).toHaveLength(3);
    expect(camera[1].zoom).toBeCloseTo((shot.camera[0].zoom + shot.camera[1].zoom) / 2);
    next = editEditorialShotMotion(next, shot.id, { kind: 'insert-frame', layerId, atMs });
    next = editEditorialShotMotion(next, shot.id, { kind: 'layer-frame', layerId, index: 1, patch: { x: 0.3, scale: 1.4, rotation: -12, opacity: 0.7, atMs: atMs + 1 } });
    expect(next.beats[0].shots[0].layers[0].motion[1]).toMatchObject({ x: 0.3, scale: 1.4, rotation: -12, opacity: 0.7, atMs: atMs + 1 });
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'layer-frame', layerId, index: 1, patch: { opacity: 2 } })).toThrow();
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'camera-frame', index: 1, patch: { atMs: 0 } })).toThrow('相邻关键帧');
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'insert-frame', atMs })).toThrow('已有关键帧');
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'remove-frame', index: 0 })).toThrow('首尾关键帧');
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'camera-frame', index: 0, patch: { atMs: 1 } })).toThrow('首尾关键帧');
    expect(() => editEditorialShotMotion(next, shot.id, { kind: 'layer-frame', layerId, index: 0.5, patch: { x: 0.2 } })).toThrow();
    next = editEditorialShotMotion(next, shot.id, { kind: 'remove-frame', layerId, index: 1 });
    expect(next.beats[0].shots[0].layers[0].motion).toEqual(shot.layers[0].motion);
    expect(validateEditorialCollagePipeline(next)).toEqual([]);
    expect(parseEditorialCollagePipelineData(JSON.stringify(next))).toEqual(next);
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

  it.each([15_000, 30_000, 60_000] as const)('supports an editable %s ms starter duration while keeping shots and cues aligned', (durationMs) => {
    const draft = createEditorialCollageDraft({ id: `vox-starter-${durationMs}`, title: '可编辑时长' });
    const starter = createEditorialCollageStarterPlan(draft, '钩子。背景。证据。结论。', '2026-08-17T00:00:00.000Z', durationMs);
    expect(starter.timeline?.durationMs).toBe(durationMs);
    expect(starter.beats.flatMap((beat) => beat.shots).every((shot) => shot.durationMs <= 15_000)).toBe(true);
    expect(validateEditorialCollagePipeline(starter)).toEqual([]);
    expect(starter.beats.flatMap((beat) => beat.shots).reduce((sum, shot) => sum + shot.durationMs, 0)).toBe(durationMs);
  });

  it('retains every long-form source sentence in the persisted document and starter cues', () => {
    const sourceText = Array.from({ length: 240 }, (_, index) => `第${index + 1}段提供完整事实与上下文。`).join('');
    const starter = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'vox-long-form', title: '长文完整性' }), sourceText, '2026-08-17T00:00:00.000Z', 'auto');
    expect(starter.sourceText).toBe(sourceText);
    expect(starter.beats.flatMap((beat) => beat.narration).join('')).toContain('第240段提供完整事实与上下文。');
    expect(starter.beats.flatMap((beat) => beat.narration).join('')).toContain('第1段提供完整事实与上下文。');
    expect(starter.beats.flatMap((beat) => beat.narration).join('').replace(/\s+/gu, '')).toBe(sourceText);
    const cues = starter.beats.flatMap((beat) => beat.subtitleCues);
    expect(cues.every((cue) => [...cue.text].length <= 18)).toBe(true);
    expect(cues.map((cue) => cue.text).join('').replace(/\s+/gu, '')).toBe(sourceText);
    expect(parseEditorialCollagePipelineData(JSON.stringify(starter)).sourceText).toBe(sourceText);
  });

  it('uses the completed video asset as the authoritative living-poster timeline source', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-video', title: 'Living poster', now: '2026-08-17T00:00:00.000Z' });
    const videoShot = {
      ...beat().shots[0],
      renderStrategy: 'living-poster' as const,
      videoAssetVersionId: 'asset-video',
      videoJobId: 'job-video',
      voiceAssetVersionId: 'asset-voice',
    };
    const plan = rebuildEditorialTimeline({
      ...draft,
      selectedStyleId: 'style-1',
      styleCandidates: [{ id: 'style-1', label: 'Swiss', prompt: 'Swiss collage', selected: true }],
      beats: [{ ...beat(), shots: [videoShot] }],
      assets: [
        { id: 'asset-bg', assetId: 'background', kind: 'image', createdAt: draft.createdAt },
        { id: 'asset-subject', assetId: 'subject', kind: 'image', createdAt: draft.createdAt },
        { id: 'asset-video', assetId: 'shot-video-shot-1', kind: 'video', localPath: 'C:/managed/shot-1.mp4', providerJobId: 'job-video', createdAt: draft.createdAt },
        { id: 'asset-voice', assetId: 'shot-voice-shot-1', kind: 'audio', localPath: 'C:/managed/shot-1.wav', createdAt: draft.createdAt },
      ],
      providerJobs: [{
        id: 'job-video', workflowKind: 'editorial-collage', nodeId: 'shot-1', providerId: 'video-provider', model: 'i2v-model', capability: 'image-to-video', status: 'completed', inputHash: 'hash', idempotencyKey: 'vox-video:shot-1:hash:1', estimatedCost: 0, attempt: 1, createdAt: draft.createdAt, updatedAt: draft.createdAt,
      }],
    });

    expect(editorialCollageReady(plan)).toBe(true);
    expect(plan.timeline?.clips[0]).toMatchObject({ source: 'ai-video', assetVersionIds: ['asset-video'] });
    expect(plan.timeline?.audioAssetVersionIds).toEqual(['asset-voice']);
  });

  it('rejects failed, wrongly owned, and mismatched living-poster video references', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-invalid-video', title: 'Invalid video', now: '2026-08-17T00:00:00.000Z' });
    const invalid = rebuildEditorialTimeline({
      ...draft,
      selectedStyleId: 'style-1',
      styleCandidates: [{ id: 'style-1', label: 'Swiss', prompt: 'Swiss collage', selected: true }],
      beats: [{
        ...beat(),
        shots: [{ ...beat().shots[0], renderStrategy: 'living-poster', videoAssetVersionId: 'asset-video', videoJobId: 'job-video' }],
      }],
      assets: [
        { id: 'asset-bg', assetId: 'background', kind: 'image', createdAt: draft.createdAt },
        { id: 'asset-subject', assetId: 'subject', kind: 'image', createdAt: draft.createdAt },
        { id: 'asset-video', assetId: 'shot-video-shot-1', kind: 'video', localPath: 'C:/managed/shot-1.mp4', providerJobId: 'other-job', createdAt: draft.createdAt },
      ],
      providerJobs: [{
        id: 'job-video', workflowKind: 'editorial-collage', nodeId: 'other-shot', providerId: 'video-provider', model: 'i2v-model', capability: 'image-to-video', status: 'failed', inputHash: 'hash', idempotencyKey: 'invalid', estimatedCost: 0, attempt: 1, createdAt: draft.createdAt, updatedAt: draft.createdAt, error: 'provider failed',
      }],
    });

    const issues = validateEditorialCollagePipeline(invalid, { ready: true });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      'assets[2].providerJobId',
      'beats[0].shots[0].videoJobId',
      'beats[0].shots[0].videoAssetVersionId',
    ]));
    expect(editorialCollageReady(invalid)).toBe(false);
  });

  it('detects a stale timeline after changing a shot motion engine', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-stale', title: 'Stale timeline' });
    const starter = createEditorialCollageStarterPlan(draft, '一。二。三。四。');
    const stale = {
      ...starter,
      beats: starter.beats.map((item, index) => index === 0 ? {
        ...item,
        shots: item.shots.map((shot) => ({ ...shot, renderStrategy: 'living-poster' as const })),
      } : item),
    };

    expect(validateEditorialCollagePipeline(stale).map((issue) => issue.path)).toContain('timeline');
  });

  it('supports structural shot edits without losing the authoritative timeline', () => {
    const draft = createEditorialCollageDraft({ id: 'vox-edits', title: '结构编辑' });
    const starter = createEditorialCollageStarterPlan(draft, '钩子。背景。证据。结论。');
    const beatId = starter.beats[1].id;
    const inserted = insertEditorialShot(starter, beatId, 0);
    expect(inserted.beats[1].shots).toHaveLength(2);
    expect(inserted.timeline?.durationMs).toBe(33_000);
    expect(validateEditorialCollagePipeline(inserted)).toEqual([]);

    const reordered = reorderEditorialShot(inserted, inserted.beats[1].shots[1].id, 0);
    expect(reordered.beats[1].shots[0].id).toBe(inserted.beats[1].shots[1].id);
    expect(reordered.timeline?.clips.map((clip) => clip.shotId)).toEqual(reordered.beats.flatMap((beat) => beat.shots).map((shot) => shot.id));

    const split = splitEditorialShot(starter, starter.beats[0].shots[0].id, 1_000);
    expect(split.beats[0].shots).toHaveLength(2);
    expect(split.beats[0].durationMs).toBe(3_000);
    expect(split.beats[0].subtitleCues.every((cue) => cue.startMs >= 0 && cue.endMs <= 3_000)).toBe(true);
    expect(split.beats[0].subtitleCues.some((cue) => cue.startMs === 1_000)).toBe(true);
    expect(split.timeline?.durationMs).toBe(30_000);
    expect(validateEditorialCollagePipeline(split)).toEqual([]);

    expect(() => splitEditorialShot({ ...starter, beats: starter.beats.map((beat, index) => index === 0 ? { ...beat, shots: [{ ...beat.shots[0], renderStrategy: 'living-poster' as const }] } : beat) }, starter.beats[0].shots[0].id, 1_000)).toThrow(/EDITORIAL_SPLIT_VIDEO_SHOT/u);

    const merged = mergeEditorialShots(split, split.beats[0].shots[0].id, split.beats[0].shots[1].id);
    expect(merged.beats[0].shots).toHaveLength(1);
    expect(merged.beats[0].shots[0].durationMs).toBe(3_000);
    expect(validateEditorialCollagePipeline(merged)).toEqual([]);

    const removed = removeEditorialShot(inserted, inserted.beats[1].shots[0].id);
    expect(removed.beats[1].shots).toHaveLength(1);
    expect(removed.timeline?.durationMs).toBe(30_000);
    expect(validateEditorialCollagePipeline(removed)).toEqual([]);
  });
});

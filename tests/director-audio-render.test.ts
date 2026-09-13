import { describe, expect, it } from 'vitest';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { createEditorialCollageDraft, rebuildEditorialTimeline } from '../src/shared/editorial-collage';

describe('director multi-track audio render projection', () => {
  it('resolves timeline clips to local scene-relative mixer inputs', () => {
    const draft = createEditorialCollageDraft({ id: 'audio-render', title: '音轨', ratio: '16:9', now: '2026-01-01T00:00:00.000Z' });
    const document = rebuildEditorialTimeline({
      ...draft,
      beats: [{
        id: 'beat-1', index: 1, title: '镜头', narration: '对白', startMs: 0, durationMs: 1_000,
        subtitleCues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: '对白' }],
        shots: [{
          id: 'shot-1', beatId: 'beat-1', durationMs: 1_000, renderStrategy: 'deterministic-layers', scenePrompt: 'scene', motionPrompt: 'motion',
          layers: [{ id: 'layer', label: '画面', kind: 'background', source: 'generated-image', zIndex: 0, depth: 0, assetVersionId: 'image', motion: [{ atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }] }],
          camera: [{ atMs: 0, x: 0.5, y: 0.5, zoom: 1 }], subtitleCueIds: ['cue-1'], voiceAssetVersionId: undefined,
        }],
      }],
      assets: [{ id: 'image', assetId: 'image', kind: 'image', localPath: 'C:/image.png', createdAt: draft.createdAt },
        { id: 'voice', assetId: 'voice', kind: 'audio', localPath: 'C:/voice.wav', createdAt: draft.createdAt }],
      timeline: undefined,
    });
    const withAudio = { ...document, timeline: { ...document.timeline!, audioAssetVersionIds: ['voice'], audioClips: [{ id: 'clip-1', shotId: 'shot-1', assetVersionId: 'voice', trackType: 'dialogue' as const, startMs: 120, sourceStartMs: 40, sourceDurationMs: 500, gainDb: -2 }] } };
    const [scene] = buildDirectorRenderScenes(withAudio);
    expect(scene.audioPath).toBe('');
    expect(scene.audioClips).toMatchObject([{ id: 'clip-1', path: 'C:/voice.wav', startMs: 120, sourceStartMs: 40, durationMs: 500, gainDb: -2 }]);
  });
});

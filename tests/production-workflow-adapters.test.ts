import { describe, expect, it } from 'vitest';
import {
  projectHtmlVideoTaskToProductionDocument,
  projectStandardTaskToProductionDocument,
  type HtmlVideoTaskProjectionInput,
  type StandardTaskProjectionInput,
} from '@shared/production-workflow-adapters';
import { createHtmlVideoPipelineData } from '@shared/html-video-workflow';

describe('production workflow adapters', () => {
  it('projects standard scenes, selected visuals, narration, and independent subtitle cues', () => {
    const input: StandardTaskProjectionInput = {
      task: standardTask(),
      snapshot: {
        updatedAt: '2026-08-17T02:00:00.000Z',
        artifact: {
          scenes: [
            { id: 1, cap: 'Hook', descPrompt: 'A city map', durationMs: 4_000, segments: [{ id: 1, text: 'First', durationMs: 1_500 }, { id: 2, text: 'Second', durationMs: 2_500 }] },
            { id: 2, cap: 'Proof', descPrompt: 'A public square', durationMs: 6_000 },
          ],
          imagePrompts: [
            { sceneId: 1, cap: 'Hook', prompt: 'Map prompt', negativePrompt: '', style: 'editorial', ratio: '9:16', characterProfile: '' },
            { sceneId: 2, cap: 'Proof', prompt: 'Square prompt', negativePrompt: '', style: 'editorial', ratio: '9:16', characterProfile: '' },
          ],
          subtitles: {
            cues: [
              { index: 1, sceneId: 1, segmentId: 1, startMs: 0, endMs: 1_500, text: 'First' },
              { index: 2, sceneId: 1, segmentId: 2, startMs: 1_500, endMs: 4_000, text: 'Second' },
              { index: 3, startMs: 4_500, endMs: 9_500, text: 'Proof cue' },
            ],
            srt: '',
          },
        },
        assets: {
          cover: [],
          images: [
            { sceneId: 1, path: 'I:\\task\\scene-1.png' },
            { sceneId: 2, path: 'I:\\task\\scene-2.png' },
          ],
          videos: [{
            sceneId: 1,
            path: 'I:\\task\\scene-1.mp4',
            source: 'ai-video',
            originalName: 'scene-1.mp4',
            durationMs: 4_000,
            width: 1080,
            height: 1920,
            trimStartMs: 0,
            fit: 'cover',
            muted: true,
            providerId: 'atlas',
            model: 'omni-v1',
            remoteTaskId: 'remote-1',
            estimatedCost: 0.35,
            license: 'provider-terms',
          }],
          imageErrors: [],
          narration: [
            { sceneId: 1, path: 'I:\\task\\scene-1.mp3' },
            { sceneId: 2, path: 'I:\\task\\scene-2.mp3' },
          ],
        },
      },
    };
    const before = JSON.stringify(input);

    const document = projectStandardTaskToProductionDocument(input);

    expect(document.workflowKind).toBe('standard');
    expect(document.source).toMatchObject({ taskId: 'task-standard', readOnly: true });
    expect(document.shots).toHaveLength(2);
    expect(document.shots[0].segmentIds).toHaveLength(2);
    expect(document.shots[0].subtitleCueIds).toHaveLength(2);
    expect(document.shots[1].subtitleCueIds).toHaveLength(1);
    expect(document.subtitleCues).toHaveLength(3);
    expect(document.timeline?.clips).toHaveLength(2);
    expect(document.timeline?.clips[0]).toMatchObject({ startMs: 0, durationMs: 4_000, source: 'ai-video' });
    expect(document.timeline?.clips[1]).toMatchObject({ startMs: 4_000, durationMs: 6_000, source: 'deterministic' });
    expect(document.timeline?.clips[0].assetVersionIds[0]).toContain('-video-v-');
    expect(document.timeline?.audioAssetVersionIds).toHaveLength(2);
    expect(document.providerJobs).toHaveLength(1);
    expect(document.providerJobs[0]).toMatchObject({ providerId: 'atlas', model: 'omni-v1', estimatedCost: 0.35 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('projects HTML compositions into globally timed deterministic clips', () => {
    const pipeline = createHtmlVideoPipelineData('第一幕。\n\n第二幕。', { maxScenes: 2, ratio: '16:9', foreground: true });
    pipeline.assets = [
      { sceneIndex: 1, kind: 'bg', slot: 0, src: 'I:\\html\\scene-1-bg.png' },
      { sceneIndex: 1, kind: 'fg', slot: 0, src: 'I:\\html\\scene-1-fg.png', transparency: 'transparent' },
      { sceneIndex: 2, kind: 'bg', slot: 0, src: 'I:\\html\\scene-2-bg.png' },
    ];
    pipeline.voices = [
      { sceneIndex: 1, src: 'I:\\html\\scene-1.mp3', durationSec: 4 },
      { sceneIndex: 2, src: 'I:\\html\\scene-2.mp3', durationSec: 6 },
    ];
    pipeline.compositions = [
      composition(1, 4, [{ id: 'caption-1', text: '第一幕', startSec: 0.25, durationSec: 1.5 }]),
      composition(2, 6, [{ id: 'caption-2', text: '第二幕', startSec: 0.5, durationSec: 2 }]),
    ];
    pipeline.output = { path: 'I:\\html\\final.mp4', sizeBytes: 42, durationSec: 10 };
    const input: HtmlVideoTaskProjectionInput = {
      task: { ...standardTask(), id: 'task-html', taskType: 'html-video', title: 'HTML story', ratio: '16:9', pipelineData: JSON.stringify(pipeline) },
    };
    const before = input.task.pipelineData;

    const document = projectHtmlVideoTaskToProductionDocument(input);

    expect(document.workflowKind).toBe('html-video');
    expect(document.source).toMatchObject({ taskId: 'task-html', readOnly: true, revision: pipeline.revision });
    expect(document.ratio).toBe('16:9');
    expect(document.scenes.map((scene) => [scene.durationMs, scene.durationSource])).toEqual([[4_000, 'composition'], [6_000, 'composition']]);
    expect(document.scenes[0].captionTexts).toEqual(pipeline.scenes[0].captions);
    expect(document.timeline?.durationMs).toBe(10_000);
    expect(document.timeline?.clips.map((clip) => clip.startMs)).toEqual([0, 4_000]);
    expect(document.subtitleCues.map((cue) => [cue.startMs, cue.endMs])).toEqual([[250, 1_750], [4_500, 6_500]]);
    expect(document.scenes[0].layerAssetVersionIds).toHaveLength(3);
    expect(document.timeline?.audioAssetVersionIds).toHaveLength(2);
    expect(document.assets.some((asset) => asset.localPath === 'I:\\html\\final.mp4')).toBe(true);
    expect(input.task.pipelineData).toBe(before);
  });

  it('keeps unfinished HTML scene durations pending instead of inventing timing', () => {
    const pipeline = createHtmlVideoPipelineData('Only one scene.', { maxScenes: 1, ratio: '9:16' });
    const document = projectHtmlVideoTaskToProductionDocument({
      task: { ...standardTask(), id: 'task-html-pending', taskType: 'html-video', pipelineData: JSON.stringify(pipeline) },
    });

    expect(document.scenes).toHaveLength(1);
    expect(document.scenes[0]).toMatchObject({ durationMs: 0, durationSource: 'pending' });
    expect(document.scenes[0].captionTexts).toEqual(pipeline.scenes[0].captions);
    expect(document.timeline).toMatchObject({ durationMs: 0, audioAssetVersionIds: [] });
  });
});

function standardTask(): StandardTaskProjectionInput['task'] {
  return {
    id: 'task-standard',
    title: 'Standard story',
    ratio: '9:16',
    createdAt: '2026-08-17T00:00:00.000Z',
    completedAt: '2026-08-17T01:00:00.000Z',
  };
}

function composition(
  index: number,
  durationSec: number,
  captions: Array<{ id: string; text: string; startSec: number; durationSec: number }>,
) {
  return {
    index,
    durationSec,
    canvas: { w: 1920, h: 1080 },
    audio: { src: `I:\\html\\scene-${index}.mp3`, durationSec },
    background: { src: `I:\\html\\scene-${index}-bg.png` },
    captions,
    htmlPath: `I:\\html\\scene-${index}.html`,
    thumbnailPath: `I:\\html\\scene-${index}.png`,
  };
}

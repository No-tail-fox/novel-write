import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { productionAudioClipGainAtTime, sliceProductionAudioClip, type ProductionAudioClip } from '../src/shared/production-audio';
import { motionComicVideoInputHash } from '../src/shared/motion-comic-video';
import { motionComicPreviewAudioClips, motionComicShotUsesNativeAudio } from '../src/features/motion-comic/motion-comic-audio-preview';
import { toLocalAssetUrl } from '../src/features/tasks/task-formatters';

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, index: 0, effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: value }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
import { DirectorAudioClip, type DirectorPreviewAudioClip } from '../src/features/director-desk/DirectorAudioPreview';

const now = '2026-09-18T00:00:00.000Z';
function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'audio-parity', title: 'Audio parity', premise: 'A local audio regression.', now }), 'Episode', now);
  const episode = document.episodes[0];
  const shot = episode.scenes.flatMap(scene => scene.shots)[1];
  shot.durationMs = 8000;
  shot.renderStrategy = 'image-motion';
  shot.dialogueCueIds = [];
  shot.voiceAssetVersionId = 'tone';
  shot.firstFrameAssetVersionId = 'image';
  const owner = episode.timeline.clips.find(clip => clip.shotId === shot.id)!;
  owner.durationMs = 8000;
  document.assets.push(
    { id: 'image', assetId: 'image', kind: 'image', localPath: 'C:/fixture/image.png', createdAt: now },
    { id: 'tone', assetId: 'tone', kind: 'audio', localPath: 'C:/fixture/tone.wav', durationMs: 8000, createdAt: now },
  );
  const clip: ProductionAudioClip = { id: 'tone-clip', assetVersionId: 'tone', shotId: shot.id, trackType: 'music', startMs: owner.startMs, durationMs: 8000, sourceStartMs: 0, sourceDurationMs: 8000, gainDb: 0, fadeInMs: 4000, fadeOutMs: 0 };
  episode.timeline.audioClips = [clip];
  return { document, episode, shot, clip, startMs: owner.startMs };
}

function transportGain(clip: DirectorPreviewAudioClip, timeMs: number) {
  hooks.refs = []; hooks.index = 0; hooks.effects = [];
  const gain = { value: -1 };
  const audio = { currentTime: 0, paused: true, play: vi.fn(async () => undefined), pause: vi.fn() };
  vi.stubGlobal('AudioContext', class {
    destination = {};
    createGain() { return { gain, connect: vi.fn() }; }
    createMediaElementSource() { return { connect: (node: unknown) => node }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  });
  DirectorAudioClip({ clip, timeMs, playing: true, muted: false, onError: vi.fn() });
  hooks.refs[0].current = audio;
  hooks.effects[1]();
  return { gain: gain.value, sourceTime: audio.currentTime };
}

afterEach(() => vi.unstubAllGlobals());

describe('motion comic preview/export audio behavior', () => {
  it('retains the original 4s fade clock after splitting an 8s source at 2s', () => {
    const { document, episode, shot, clip, startMs } = fixture();
    const first = sliceProductionAudioClip(clip, startMs, startMs + 2000, startMs + 8000)!;
    const second = { ...sliceProductionAudioClip(clip, startMs + 2000, startMs + 8000, startMs + 8000)!, id: 'second' };
    episode.timeline.audioClips = [first, second];
    const preview = motionComicPreviewAudioClips(episode, shot, document).find(item => item.id === 'second')!;
    const exported = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })[0].audioClips!.find(item => item.id === 'second')!;
    expect(preview.fadeEnvelope).toEqual({ offsetMs: 2000, durationMs: 8000, fadeInMs: 4000, fadeOutMs: 0 });
    expect(preview.url).toBe(toLocalAssetUrl(exported.path));
    expect(preview.startMs - startMs).toBe(exported.startMs);
    for (const field of ['sourceStartMs', 'sourceDurationMs', 'durationMs', 'gainDb', 'fadeInMs', 'fadeOutMs', 'fadeEnvelope'] as const) {
      expect(preview[field]).toEqual(exported[field]);
    }
    for (const [elapsed, expected] of [[0, 0.5], [1000, 0.75], [2000, 1], [5999, 1], [6000, 0]]) {
      expect(productionAudioClipGainAtTime(preview, preview.startMs + elapsed)).toBeCloseTo(expected, 10);
      expect(productionAudioClipGainAtTime(exported, exported.startMs + elapsed)).toBeCloseTo(expected, 10);
      if (expected > 0) {
        expect(transportGain(preview, preview.startMs + elapsed)).toEqual({ gain: expected, sourceTime: (2000 + elapsed) / 1000 });
      }
    }
    // Negative control: dropping the envelope reproduces the pre-fix preview error.
    expect(productionAudioClipGainAtTime({ ...preview, fadeEnvelope: undefined }, preview.startMs)).toBe(0);
    expect(productionAudioClipGainAtTime({ ...preview, fadeEnvelope: undefined }, preview.startMs + 1000)).toBe(0.5);
  });

  it.each(['native', 'audio-driven'] as const)('restores authored speech after switching a %s video to image-motion', (audioMode) => {
    const { document, episode, shot, clip, startMs } = fixture();
    shot.renderStrategy = 'remote-video';
    shot.videoProduction = { version: 1, referenceMode: audioMode === 'audio-driven' ? 'references' : 'frames', audioMode, referenceAudioAssetVersionIds: ['tone'] };
    if (audioMode === 'audio-driven') {
      const owners = [
        ...document.characters.flatMap(character => character.looks).filter(look => shot.characterLookIds.includes(look.id)),
        ...document.sceneAssets.filter(scene => scene.id === shot.sceneAssetId),
        ...document.props.filter(prop => shot.propAssetIds.includes(prop.id)),
      ];
      for (const owner of owners) {
        const id = `reference-${owner.id}`;
        owner.referenceAssetVersionIds = [id];
        document.assets.push({ id, assetId: id, kind: 'image', localPath: `C:/fixture/${id}.png`, selected: true, pinned: true, createdAt: now });
      }
    }
    shot.videoAssetVersionId = 'video'; shot.videoJobId = 'video-job';
    episode.timeline.audioClips = ['dialogue', 'narration', 'ambience'].map(trackType => ({ ...clip, id: trackType, trackType: trackType as ProductionAudioClip['trackType'], fadeInMs: 0 }));
    document.assets.push({ id: 'video', assetId: 'video', kind: 'video', localPath: 'C:/fixture/video.mp4', providerJobId: 'video-job', durationMs: 8000, createdAt: now });
    document.providerJobs.push({ id: 'video-job', workflowKind: 'motion-comic', nodeId: shot.id, episodeId: episode.id, providerId: 'local', model: 'fixture', capability: 'image-to-video', status: 'completed', inputHash: motionComicVideoInputHash(document, shot, 'local', 'fixture'), idempotencyKey: 'fixture', estimatedCost: 0, attempt: 1, createdAt: now, updatedAt: now });
    const before = motionComicPreviewAudioClips(episode, shot, document);
    const beforeExport = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })[0].audioClips!;
    expect(before.map(item => item.id)).toEqual([`native-${shot.id}`, 'ambience']);
    expect(before.map(item => item.id)).toEqual(beforeExport.map(item => item.id));
    expect(before.map(item => item.url)).toEqual(beforeExport.map(item => toLocalAssetUrl(item.path)));

    // Strategy edits clear selected video but deliberately retain video production settings.
    shot.renderStrategy = 'image-motion';
    shot.videoAssetVersionId = undefined; shot.videoJobId = undefined;
    expect(shot.videoProduction.audioMode).toBe(audioMode);
    expect(motionComicShotUsesNativeAudio(shot)).toBe(false);
    const preview = motionComicPreviewAudioClips(episode, shot, document);
    const exported = buildDirectorRenderScenes(document, episode.id, { shotIds: [shot.id] })[0].audioClips!;
    expect(preview.map(item => item.id)).toEqual(['dialogue', 'narration', 'ambience']);
    expect(preview.map(item => item.id)).toEqual(exported.map(item => item.id));
    for (const [index, item] of preview.entries()) {
      expect(item.url).toBe(toLocalAssetUrl(exported[index].path));
      expect(item.startMs - startMs).toBe(exported[index].startMs);
      expect(transportGain(item, item.startMs).gain).toBe(1);
      expect(productionAudioClipGainAtTime(exported[index], exported[index].startMs)).toBe(1);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, rebuildEditorialTimeline, splitEditorialShot } from '../src/shared/editorial-collage';
import { fitEditorialNarrationTiming, prepareEditorialNarrationForRender } from '../src/shared/editorial-narration-timing';
import { applyEditorialVoiceRecord } from '../src/features/director-desk/director-generation';
import { hashSubtitleAlignment, hashSubtitleText } from '../src/shared/audio-alignment';
import { measureProductionNarrationAlignment } from '../src/shared/production-audio-alignment';
import type { VoiceLabRecord } from '../src/shared/types';

function fixture() {
  const data = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'speech-timing', title: '城市与草原' }), '城市的早晨已经到来。草原的歌声继续流传。', undefined, 'auto');
  const durations = [9364, 10026];
  let cursor = 0;
  data.beats = data.beats.map((beat, index) => {
    const durationMs = durations[index];
    const shot = beat.shots[0];
    const start = cursor; cursor += durationMs;
    data.assets.push({ id: `voice-${index}`, assetId: `voice-${index}`, kind: 'audio', localPath: `I:/fixture/voice-${index}.wav`, durationMs: [8280, 10440][index], createdAt: data.createdAt });
    return { ...beat, startMs: start, durationMs, shots: [{ ...shot, durationMs, voiceAssetVersionId: `voice-${index}`, camera: shot.camera.map(frame => ({ ...frame, atMs: Math.round(frame.atMs / shot.durationMs * durationMs) })), layers: shot.layers.map(layer => ({ ...layer, motion: layer.motion.map(frame => ({ ...frame, atMs: Math.round(frame.atMs / shot.durationMs * durationMs) })) })) }], subtitleCues: [{ ...beat.subtitleCues[0], startMs: start, endMs: cursor }] };
  });
  return rebuildEditorialTimeline(data);
}

describe('VOX measured narration timing', () => {
  it('removes estimate gaps, retains the entire recording and shifts every later shot and cue', () => {
    const source = fixture();
    const before = structuredClone(source);
    const next = fitEditorialNarrationTiming(source);
    const shots = next.beats.flatMap(beat => beat.shots);
    expect(shots.map(shot => shot.durationMs)).toEqual([8458, 10625]);
    expect(next.timeline!.audioClips!.map(clip => [clip.startMs, clip.durationMs])).toEqual([[0, 8280], [8458, 10440]]);
    expect(next.beats.map(beat => [beat.startMs, beat.durationMs])).toEqual([[0, 8458], [8458, 10625]]);
    expect(next.beats.map(beat => [beat.subtitleCues[0].startMs, beat.subtitleCues[0].endMs])).toEqual([[0, 8280], [8458, 18898]]);
    expect(shots.every(shot => shot.camera.at(-1)!.atMs === shot.durationMs)).toBe(true);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
    expect(fitEditorialNarrationTiming(next)).toBe(next);
    expect(source).toEqual(before);
  });

  it('repairs the old automatically clipped narration, while retaining independent sounds and their offsets', () => {
    const source = fixture();
    const shot = source.beats[1].shots[0];
    source.timeline!.audioClips = [{ id: `narration-clip-${shot.id}`, shotId: shot.id, assetVersionId: 'voice-1', trackType: 'narration', startMs: 9364, durationMs: 10026, sourceStartMs: 0, sourceDurationMs: 10440, sourceMediaDurationMs: 10440 },
      { id: 'sound', shotId: shot.id, assetVersionId: 'voice-0', trackType: 'sfx', startMs: 9564, durationMs: 300, sourceStartMs: 100, sourceDurationMs: 300, gainDb: -6 }];
    const next = fitEditorialNarrationTiming(source);
    expect(next.timeline!.audioClips!.find(clip => clip.id === `narration-clip-${shot.id}`)).toMatchObject({ startMs: 8458, durationMs: 10440, sourceDurationMs: 10440 });
    expect(next.timeline!.audioClips!.find(clip => clip.id === 'sound')).toMatchObject({ startMs: 8658, sourceStartMs: 100, durationMs: 300, gainDb: -6 });
  });

  it('leaves intentionally trimmed and split speech alone and keeps true timestamps at their local offsets', () => {
    const source = fixture();
    const cue = source.beats[1].subtitleCues[0];
    cue.endMs = cue.startMs + 1040;
    cue.tokens = [{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }];
    cue.alignmentSource = 'manual'; cue.textHash = hashSubtitleText(cue.text); cue.alignmentFingerprint = hashSubtitleAlignment(cue);
    const next = fitEditorialNarrationTiming(source);
    const shifted = next.beats[1].subtitleCues[0];
    expect(shifted.endMs - shifted.startMs).toBe(1040);
    expect(shifted.tokens![0].startMs).toBe(8458);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
    const split = splitEditorialShot(next, next.beats[0].shots[0].id, 2000);
    const fitted = fitEditorialNarrationTiming(split);
    expect(fitted.beats[0]).toEqual(split.beats[0]);
    expect(fitted.timeline!.audioClips!.filter(clip => split.beats[0].shots.some(shot => shot.id === clip.shotId))).toEqual(split.timeline!.audioClips!.filter(clip => split.beats[0].shots.some(shot => shot.id === clip.shotId)));
  });

  it('fits freshly generated voices and ignores stale generation responses', () => {
    const source = fixture();
    const shot = source.beats[1].shots[0];
    const record = { id: 'new-voice', text: '草原的歌声继续流传。', voiceId: 'voice', voiceLabel: '配音', speed: 1, provider: 'minimax', audioPath: 'I:/fixture/new.wav', status: 'generated', createdAt: source.createdAt, finishedAt: source.createdAt, errorMessage: '' } as VoiceLabRecord;
    const next = applyEditorialVoiceRecord(source, shot.id, record, 'speech', undefined, true, 10440);
    expect(next.beats[1].shots[0].durationMs).toBe(10625);
    expect(next.timeline!.audioClips!.find(clip => clip.shotId === shot.id)?.durationMs).toBe(10440);
    const stale = applyEditorialVoiceRecord(source, shot.id, record, 'speech', undefined, false, 10440);
    expect(stale.beats).toEqual(source.beats);
  });

  it('re-probes old selected audio before export and never uses the estimate when measuring fails', async () => {
    const source = fixture();
    source.assets.forEach(asset => { delete asset.durationMs; });
    const paths: string[] = [];
    const next = await prepareEditorialNarrationForRender(source, async path => { paths.push(path); return path.endsWith('0.wav') ? 8280 : 10440; });
    expect(paths).toHaveLength(2);
    expect(next.timeline!.audioClips!.at(-1)!.durationMs).toBe(10440);
    await expect(prepareEditorialNarrationForRender(source, async () => NaN)).rejects.toThrow('DURATION_INVALID');
    source.assets[1].durationMs = 16000;
    expect(() => fitEditorialNarrationTiming(source)).toThrow('NARRATION_TOO_LONG');
  });

  it('recognizes a full recording after decoder precision changes and preserves both video routes', async () => {
    const source = fitEditorialNarrationTiming(fixture());
    const shot = source.beats[1].shots[0];
    shot.renderStrategy = 'living-poster'; shot.videoAssetVersionId = 'video'; shot.videoJobId = 'video-job'; shot.keyframeAssetVersionId = 'keyframe';
    const next = await prepareEditorialNarrationForRender(source, async path => path.endsWith('0.wav') ? 8280 : 10442);
    expect(next.beats[1].shots[0]).toMatchObject({ renderStrategy: 'living-poster', videoAssetVersionId: 'video', videoJobId: 'video-job', keyframeAssetVersionId: 'keyframe' });
    expect(next.timeline!.audioClips!.find(clip => clip.shotId === shot.id)).toMatchObject({ durationMs: 10442, sourceDurationMs: 10442, sourceMediaDurationMs: 10442 });
    expect(next.beats[0].shots[0].renderStrategy).toBe('deterministic-layers');
  });

  it('detects the actual 282 ms and 414 ms overflows even when they are less than 15 percent', () => {
    const result = measureProductionNarrationAlignment([7350, 10026].map((durationMs, index) => ({ id: `shot-${index}`, durationMs, subtitleCues: [{ text: '保留完整尾句', startMs: 0, endMs: durationMs }], audioAssetVersionIds: [`voice-${index}`] })), new Map([['voice-0', { durationMs: 7632 }], ['voice-1', { durationMs: 10440 }]]));
    expect(result.status).toBe('failed');
    expect(result.samples.map(sample => sample.status)).toEqual(['mismatch', 'mismatch']);
    expect(result.samples[1].detail).toContain('截掉尾音');
  });
});

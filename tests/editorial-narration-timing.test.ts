import { describe, expect, it } from 'vitest';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, rebuildEditorialTimeline, splitEditorialShot } from '../src/shared/editorial-collage';
import { fitEditorialNarrationTiming, prepareEditorialNarrationForRender } from '../src/shared/editorial-narration-timing';
import { applyEditorialVoiceRecord, editorialVoiceInput } from '../src/features/director-desk/director-generation';
import { hashSubtitleAlignment, hashSubtitleText } from '../src/shared/audio-alignment';
import { measureProductionNarrationAlignment } from '../src/shared/production-audio-alignment';
import { productionAudioClipGainAtTime } from '../src/shared/production-audio';
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
  it.each([['连续语句还没有说完', 8291], ['这里是分句，', 8416], ['这里是句末。', 8458]] as const)('uses punctuation-aware tail padding: %s', (text, durationMs) => {
    const source = fixture();
    source.beats[0].subtitleCues[0].text = text;
    expect(fitEditorialNarrationTiming(source).beats[0].shots[0].durationMs).toBe(durationMs);
  });
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
    source.assets[1].durationMs = 17000;
    const repaired = fitEditorialNarrationTiming(source);
    expect(repaired.beats[1].shots).toHaveLength(2);
    expect(repaired.timeline!.audioClips!.filter(clip => clip.assetVersionId === 'voice-1').reduce((ms, clip) => ms + clip.sourceDurationMs!, 0)).toBe(17000);
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
  it.each([14950, 17000, 31000, 47000])('automatically splits %i ms without losing speech, text or later timing', measured => {
    const source = fixture(); source.assets[0].durationMs = measured;
    source.beats[0].shots[0].cuePlan = undefined;
    source.beats[0].subtitleCues[0].text = '城市的早晨已经到来，街道上的人们开始新的一天。';
    const before = structuredClone(source), original = source.beats[0].shots[0];
    const text = source.beats[0].subtitleCues[0].text;
    const next = fitEditorialNarrationTiming(source), parts = next.beats[0].shots;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].id).toBe(original.id);
    expect(parts.every(s => s.durationMs >= 800 && s.durationMs <= 15000)).toBe(true);
    expect(parts.slice(1).every(s => s.transitionIn?.type === 'cut')).toBe(true);
    expect(next.beats[0].subtitleCues.map(c => c.text).join('')).toBe(text);
    expect(next.beats[0].subtitleCues.every(c => !/^[，。！？、；：]/u.test(c.text))).toBe(true);
    const clips = next.timeline!.audioClips!.filter(c => c.assetVersionId === 'voice-0').sort((a,b) => a.startMs - b.startMs);
    expect(clips).toHaveLength(parts.length);
    expect(clips.reduce((ms,c) => ms + c.sourceDurationMs!,0)).toBe(measured);
    let cursor = 0;
    for (const clip of clips) {
      expect(clip.sourceStartMs).toBe(cursor); expect(clip.startMs).toBe(cursor);
      cursor += clip.sourceDurationMs!;
    }
    expect(next.beats[1].startMs).toBe(next.beats[0].durationMs);
    expect(next.beats[1].subtitleCues[0].startMs).toBe(next.beats[1].startMs);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
    expect(fitEditorialNarrationTiming(next)).toBe(next);
    expect(source.beats[0].shots).toEqual(before.beats[0].shots);
  });

  it('keeps measured word boundaries when splitting and moves later measured words together', () => {
    const source = fixture(); source.assets[0].durationMs = 17000;
    const cue = source.beats[0].subtitleCues[0]; cue.endMs = 17000;
    source.beats[0].shots[0].cuePlan = undefined;
    cue.text = '第一句话。第二句话。';
    cue.tokens = [{ text: '第一句话。', startMs: 0, endMs: 8000 }, { text: '第二句话。', startMs: 9000, endMs: 17000 }];
    cue.alignmentSource = 'provider'; cue.textHash = hashSubtitleText(cue.text); cue.alignmentFingerprint = hashSubtitleAlignment(cue);
    const next = fitEditorialNarrationTiming(source), cues = next.beats[0].subtitleCues;
    expect(next.beats[0].shots[0].durationMs).toBe(8000);
    expect(cues.map(c => c.text)).toEqual(['第一句话。', '第二句话。']);
    expect(cues.flatMap(c => c.tokens!)).toEqual(cue.tokens);
    expect(cues.every(c => c.alignmentSource === 'provider')).toBe(true);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
    expect(fitEditorialNarrationTiming(next)).toBe(next);
  });

  it('subdivides a provider sentence token exceeding one shot instead of leaving a child without its text', () => {
    const source = fixture(); source.assets[0].durationMs = 17000;
    const cue = source.beats[0].subtitleCues[0]; cue.endMs = 17000;
    cue.tokens = [{ text: cue.text, startMs: 0, endMs: 17000 }]; cue.alignmentSource = 'provider';
    cue.textHash = hashSubtitleText(cue.text); cue.alignmentFingerprint = hashSubtitleAlignment(cue);
    const next = fitEditorialNarrationTiming(source);
    expect(next.beats[0].shots.every(s => s.subtitleCueIds.length > 0)).toBe(true);
    expect(next.beats[0].subtitleCues.map(c => c.text).join('')).toBe(cue.text);
    expect(next.beats[0].subtitleCues.every(c => !c.tokens)).toBe(true);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
  });

  it('preserves sound offsets and fades across the seam, including a silent continuation after the recording', () => {
    const source = fixture(), shot = source.beats[0].shots[0];
    const sound = { id: 'long-sound', shotId: shot.id, assetVersionId: 'voice-1', trackType: 'sfx' as const, startMs: 1000, durationMs: 20000, sourceStartMs: 0, sourceDurationMs: 20000, sourceMediaDurationMs: 20000, gainDb: -6, fadeInMs: 12000, fadeOutMs: 12000 };
    source.assets[1].durationMs = 20000; source.beats[1].shots[0].voiceAssetVersionId = undefined;
    source.timeline!.audioClips = [sound];
    const next = fitEditorialNarrationTiming(source), sounds = next.timeline!.audioClips!.filter(c => c.trackType === 'sfx');
    expect(sounds.reduce((ms,c) => ms+c.sourceDurationMs!,0)).toBe(20000);
    for (let at = 1001; at < 21000; at += 127) {
      expect(sounds.reduce((gain,c) => gain+productionAudioClipGainAtTime(c,at),0)).toBeCloseTo(productionAudioClipGainAtTime(sound,at),10);
    }
    const silent = next.beats[0].shots.filter(s => !next.timeline!.audioClips!.some(c => c.shotId === s.id && c.trackType === 'narration'));
    expect(silent.length).toBeGreaterThan(0);
    expect(silent.every(s => !s.voiceAssetVersionId)).toBe(true);
    expect(fitEditorialNarrationTiming(next)).toBe(next);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
  });

  it('creates durable source slices for an old project without a timeline and stays stable on a second export', async () => {
    const source = fixture(); source.timeline = undefined;
    const next = await prepareEditorialNarrationForRender(source, async p => p.endsWith('0.wav') ? 17000 : 10440);
    expect(next.beats[0].shots).toHaveLength(2);
    expect(next.timeline!.audioClips!.filter(c => c.assetVersionId === 'voice-0').reduce((ms,c) => ms+c.sourceDurationMs!,0)).toBe(17000);
    expect(parseEditorialCollagePipelineData(next)).toEqual(next);
    const again = await prepareEditorialNarrationForRender(next, async p => p.endsWith('0.wav') ? 17000 : 10440);
    expect(again).toBe(next);
  });

});


describe('regenerated split narration', () => {
  it('purchases one complete text and replaces every child slice without dropping the tail', () => {
    const source = fixture(); source.assets.find(a => a.id === 'voice-0')!.durationMs = 30000;
    const split = fitEditorialNarrationTiming(source), root = split.beats[0].shots[0];
    const group = split.beats[0].shots.filter(s => s.narrationSplit?.sourceShotId === root.id);
    expect(group.length).toBeGreaterThan(1);
    for (const shot of group) { shot.camera = [{ ...shot.camera[0], atMs: shot.durationMs }]; }
    const input = editorialVoiceInput(split, root.id, { provider: 'minimax', voiceId: 'voice', voiceLabel: '配音', speed: 1 });
    expect(input.text).toBe(source.beats[0].subtitleCues.map(c => c.text).join(''));
    expect(input.cueIds).toHaveLength(group.flatMap(s => s.subtitleCueIds).length);
    const record = { id: 'replacement-voice', text: input.text, voiceId: 'voice', voiceLabel: '配音', speed: 1, provider: 'minimax', audioPath: 'I:/fixture/replacement.wav', status: 'generated', createdAt: source.createdAt, finishedAt: source.createdAt, errorMessage: '' } as VoiceLabRecord;
    const received = applyEditorialVoiceRecord(split, root.id, record, 'speech', input, true, 21000, false);
    expect(() => parseEditorialCollagePipelineData(received)).not.toThrow();
    const next = fitEditorialNarrationTiming(received, [root.id]);
    const ids = new Set(group.map(s => s.id));
    const clips = next.timeline!.audioClips!.filter(c => c.trackType === 'narration' && ids.has(c.shotId!)).sort((a,b) => a.startMs - b.startMs);
    expect(clips).toHaveLength(group.length);
    expect(new Set(clips.map(c => c.assetVersionId)).size).toBe(1);
    expect(clips[0].assetVersionId).not.toBe('voice-0');
    expect(clips.reduce((sum,c) => sum + c.sourceDurationMs!, 0)).toBe(21000);
    expect(clips[0].sourceStartMs).toBe(0);
    for (let i=1;i<clips.length;i++) expect(clips[i].sourceStartMs).toBe(clips[i-1].sourceStartMs! + clips[i-1].sourceDurationMs!);
    for (const shot of next.beats[0].shots) {
      expect(shot.camera.every(f => f.atMs <= shot.durationMs)).toBe(true);
      expect(shot.layers.every(l => l.motion.every(f => f.atMs <= shot.durationMs))).toBe(true);
    }
    expect(next.sourceText).toBe(split.sourceText);
    expect(next.beats[0].subtitleCues.map(c => c.text)).toEqual(split.beats[0].subtitleCues.map(c => c.text));
    expect(next.assets.some(a => a.id === 'voice-0')).toBe(true);
    expect(() => parseEditorialCollagePipelineData(next)).not.toThrow();
    expect(fitEditorialNarrationTiming(next)).toEqual(next);
  });
  it.each(['trim', 'offset', 'mute', 'extra'])('preserves manual %s edits and rejects unsafe automatic retiming', kind => {
    const source = fixture(); source.assets[0].durationMs = 30000;
    const split = fitEditorialNarrationTiming(source), root = split.beats[0].shots[0];
    const clip = split.timeline!.audioClips!.find(c => c.shotId === root.id && c.trackType === 'narration')!;
    if (kind === 'trim') { clip.sourceStartMs = 100; clip.sourceDurationMs! -= 100; clip.durationMs! -= 100; }
    if (kind === 'offset') clip.startMs += 100;
    if (kind === 'mute') clip.muted = true;
    if (kind === 'extra') split.timeline!.audioClips!.push({ ...clip, id: 'manual-layer' });
    const originalClips = structuredClone(split.timeline!.audioClips);
    const input = editorialVoiceInput(split, root.id, { provider: 'minimax', voiceId: 'voice', voiceLabel: '配音', speed: 1 });
    const record = { id: 'replacement-voice', text: input.text, voiceId: 'voice', voiceLabel: '配音', speed: 1, provider: 'minimax', audioPath: 'I:/fixture/replacement.wav', status: 'generated', createdAt: source.createdAt, finishedAt: source.createdAt, errorMessage: '' } as VoiceLabRecord;
    const received = applyEditorialVoiceRecord(split, root.id, record, 'speech', input, true, 21000, false);
    expect(received.timeline!.audioClips).toEqual(originalClips);
    expect(received.assets.length).toBeGreaterThan(split.assets.length);
    expect(() => fitEditorialNarrationTiming(received, [root.id])).toThrow('EDITORIAL_NARRATION_SPLIT_MANUAL_EDIT');
    expect(received.timeline!.audioClips).toEqual(originalClips);
  });

});

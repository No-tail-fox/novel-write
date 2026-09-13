import { describe, expect, it } from 'vitest';
import { alignSubtitleCue } from '../src/shared/audio-alignment';
import { alignDirectorSubtitleCueFromTimestampFile, estimateDirectorSubtitleCue, updateDirectorSubtitleCue, type DirectorSubtitleDocument } from '../src/shared/director-subtitles';
import {
  createEditorialCollageDraft,
  createEditorialCollageStarterPlan,
  editorialCollageSaveInputSchema,
  parseEditorialCollagePipelineData,
  rebuildEditorialTimeline,
} from '../src/shared/editorial-collage';
import {
  createMotionComicDraft,
  createMotionComicStarterProject,
  motionComicSaveInputSchema,
  parseMotionComicPipelineData,
} from '../src/shared/motion-comic';
import type { ProductionSubtitleCue } from '../src/shared/production-workflow';
import { productionAudioClipsForShot } from '../src/shared/production-audio';

const now = '2026-09-07T00:00:00.000Z';
const firstCueId = 'target-cue-1';
const secondCueId = 'target-cue-2';
const workflows = ['editorial-collage', 'motion-comic'] as const;

describe('VOX explicit speech invalidation', () => {
  it('detaches both speech lanes on text edits, preserves sound design and other shots, and cannot fall back to stale narration', () => {
    const { document, shotId } = voxAudioFixture();
    const before = structuredClone(document);
    const retained = document.timeline!.audioClips!.filter((clip) => clip.shotId !== shotId || !['dialogue', 'narration'].includes(clip.trackType));
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { text: '这一句需要新的旁白。' });
    const shot = next.beats[1].shots[0];
    expect(shot.voiceAssetVersionId).toBeUndefined();
    expect(next.timeline!.audioClips).toEqual(retained);
    expect(next.timeline!.audioAssetVersionIds).not.toContain('voice-cue-1');
    // The aggregate asset remains valid for the other shot, never this shot.
    expect(next.timeline!.audioAssetVersionIds).toContain('voice-aggregate');
    expect(productionAudioClipsForShot(next.timeline, shot)?.map((clip) => clip.trackType)).toEqual(['music', 'sfx']);
    expect(next.assets).toBe(document.assets);
    expect(next.providerJobs).toBe(document.providerJobs);
    expect(document).toEqual(before);
    expect(parseEditorialCollagePipelineData(JSON.stringify(next))).toEqual(next);
  });

  it('changes only subtitle visibility timing without moving or cropping full-shot narration', () => {
    const { document, shotId, startMs } = voxAudioFixture();
    const cue = cueById(document, firstCueId);
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { startMs: startMs + 100, endMs: cue.endMs - 100 });
    expect(cueById(next, firstCueId)).toMatchObject({ startMs: startMs + 100, endMs: cue.endMs - 100 });
    expect(cueById(next, firstCueId).tokens).toBeUndefined();
    expect(next.timeline).toBe(document.timeline);
    expect(next.timeline!.audioClips).toBe(document.timeline!.audioClips);
    expect(next.beats[1].shots[0]).toBe(document.beats[1].shots[0]);
    const speech = productionAudioClipsForShot(next.timeline, next.beats[1].shots[0])![0];
    expect(speech).toMatchObject({ startMs, durationMs: document.beats[1].shots[0].durationMs, sourceStartMs: 75 });
    expect(parseEditorialCollagePipelineData(JSON.stringify(next))).toEqual(next);
  });

  it('invalidates sibling alignment tied to the same stale full-shot recording', () => {
    const { document, shotId } = voxAudioFixture();
    document.beats[1].subtitleCues = document.beats[1].subtitleCues.map((cue) => alignSubtitleCue(cue, {
      source: 'estimated', timestamps: [], audioAssetVersionId: 'voice-aggregate', voiceId: 'voice-target', voiceSpeed: 1,
    }));
    const sibling = cueById(document, secondCueId);
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { text: '重新录制整段旁白。' });
    const updated = cueById(next, secondCueId);
    expect(updated).toMatchObject({ text: sibling.text, startMs: sibling.startMs, endMs: sibling.endMs, styleRef: sibling.styleRef });
    expect(updated.audioAssetVersionId).toBeUndefined();
    expect(updated.tokens).toBeUndefined();
    expect(updated.alignmentFingerprint).toBeUndefined();
    expect(next.beats[0]).toBe(document.beats[0]);
    expect(parseEditorialCollagePipelineData(JSON.stringify(next))).toEqual(next);
  });

  it('removes the last explicit speech lane without resurrecting a legacy aggregate fallback', () => {
    const { document, shotId } = voxAudioFixture();
    document.timeline!.audioClips = document.timeline!.audioClips!.filter((clip) => clip.shotId === shotId && clip.trackType === 'narration');
    const next = updateDirectorSubtitleCue(rebuildEditorialTimeline(document), shotId, firstCueId, { text: '' });
    expect(next.timeline!.audioClips).toBeUndefined();
    expect(next.timeline!.audioAssetVersionIds).not.toContain('voice-aggregate');
    expect(next.beats[1].shots[0].voiceAssetVersionId).toBeUndefined();
    expect(productionAudioClipsForShot(next.timeline, next.beats[1].shots[0])).toBeUndefined();
    expect(parseEditorialCollagePipelineData(JSON.stringify(next))).toEqual(next);
  });
});

describe.each(workflows)('%s Director subtitles', (workflow) => {
  it('round-trips old cue-only documents without adding alignment fields', () => {
    const document = legacyDocument(workflow);
    if (document.workflowKind === 'motion-comic') {
      document.assets.push({ id: 'legacy-audio', assetId: 'legacy-audio', kind: 'audio', createdAt: now });
      document.episodes[0].dialogueCues[0].voiceAssetVersionId = 'legacy-audio';
    }
    const reopened = parseDocument(JSON.stringify(document), workflow);
    expect(reopened).toEqual(document);
    expect(allCues(reopened).every((cue) => !Object.prototype.hasOwnProperty.call(cue, 'tokens'))).toBe(true);
    expect(allCues(reopened).every((cue) => !Object.prototype.hasOwnProperty.call(cue, 'audioAssetVersionId'))).toBe(true);
  });

  it('edits one sentence, detaches its old speech, and retains all historical assets and jobs', () => {
    const { document, shotId } = fixture(workflow);
    const before = structuredClone(document);
    const sibling = cueById(document, secondCueId);
    const shot = shotById(document, shotId);
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { text: '第一句已经修改。' });
    const edited = cueById(next, firstCueId);
    expect(edited.text).toBe('第一句已经修改。');
    for (const field of ['tokens', 'alignmentSource', 'textHash', 'alignmentFingerprint', 'audioAssetVersionId', 'voiceAssetVersionId']) {
      expect(edited).not.toHaveProperty(field);
    }
    expect(cueById(next, secondCueId)).toBe(sibling);
    expect(shotById(next, shotId).voiceAssetVersionId).toBeUndefined();
    expect(next.assets).toBe(document.assets);
    expect(next.providerJobs).toBe(document.providerJobs);
    expect(next.updatedAt).toBe(document.updatedAt);
    expect(document).toEqual(before);
    expect(timelineOf(next).audioAssetVersionIds).not.toContain('voice-aggregate');
    expect(timelineOf(next).audioAssetVersionIds).not.toContain('voice-cue-1');
    expect(timelineOf(next).audioAssetVersionIds).toContain('voice-other');
    if (next.workflowKind === 'editorial-collage' && 'scenePrompt' in shot) {
      expect(next.beats[1].narration).toBe('第一句已经修改。 第二句保持独立。');
      expect(next.beats[1].shots[0].scenePrompt).toBe(shot.scenePrompt);
      expect(next.beats[1].shots[0].motionPrompt).toBe(shot.motionPrompt);
    } else if (next.workflowKind === 'motion-comic' && 'prompt' in shot) {
      expect(shotById(next, shotId)).toMatchObject({ prompt: shot.prompt, motionPrompt: shot.motionPrompt });
      expect(timelineOf(next).audioAssetVersionIds).toContain('voice-cue-2');
      expect(timelineOf(next).clips.find((clip) => clip.shotId === shotId)?.assetVersionIds).not.toContain('voice-aggregate');
    }
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it('allows two successive independent sentence edits without overwriting the first edit', () => {
    const { document, shotId } = fixture(workflow);
    const first = updateDirectorSubtitleCue(document, shotId, firstCueId, { text: '只修改第一句。' });
    const second = updateDirectorSubtitleCue(first, shotId, secondCueId, { text: '再修改第二句。' });
    expect(cueById(second, firstCueId)).toBe(cueById(first, firstCueId));
    expect(cueById(second, secondCueId).text).toBe('再修改第二句。');
    expect(allCues(second).filter((cue) => cue.id !== firstCueId && cue.id !== secondCueId)).toEqual(
      allCues(document).filter((cue) => cue.id !== firstCueId && cue.id !== secondCueId),
    );
    if (second.workflowKind === 'editorial-collage') expect(second.beats[1].narration).toBe('只修改第一句。 再修改第二句。');
  });

  it('invalidates timing metadata on range edits while retaining audio and the sibling cue', () => {
    const { document, shotId, startMs } = fixture(workflow);
    const first = cueById(document, firstCueId);
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { startMs: startMs + 20, endMs: first.endMs - 20 });
    expect(cueById(next, firstCueId)).toMatchObject({ startMs: startMs + 20, endMs: first.endMs - 20, audioAssetVersionId: 'voice-cue-1' });
    expect(cueById(next, firstCueId)).not.toHaveProperty('tokens');
    expect(shotById(next, shotId)).toBe(shotById(document, shotId));
    expect(timelineOf(next)).toBe(timelineOf(document));
    expect(cueById(next, secondCueId)).toBe(cueById(document, secondCueId));
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it('changes or clears style without invalidating words or audio, and preserves no-op identity', () => {
    const { document, shotId } = fixture(workflow);
    const first = cueById(document, firstCueId);
    expect(updateDirectorSubtitleCue(document, shotId, firstCueId, {})).toBe(document);
    expect(updateDirectorSubtitleCue(document, shotId, firstCueId, { text: first.text })).toBe(document);
    const next = updateDirectorSubtitleCue(document, shotId, firstCueId, { styleRef: 'yellow-highlight' });
    expect(cueById(next, firstCueId)).toEqual({ ...first, styleRef: 'yellow-highlight' });
    expect(cueById(next, firstCueId).tokens).toBe(first.tokens);
    expect(shotById(next, shotId)).toBe(shotById(document, shotId));
    expect(timelineOf(next)).toBe(timelineOf(document));
    const cleared = updateDirectorSubtitleCue(next, shotId, firstCueId, { styleRef: undefined });
    expect(cueById(cleared, firstCueId)).not.toHaveProperty('styleRef');
    expect(cueById(cleared, firstCueId).alignmentFingerprint).toBe(first.alignmentFingerprint);
  });

  it('explicitly estimates the selected cue in its nonzero global range and keeps the sibling unchanged', () => {
    const { document, shotId, startMs } = fixture(workflow);
    const first = cueById(document, firstCueId);
    first.alignmentSource = 'provider';
    const next = estimateDirectorSubtitleCue(document, shotId, firstCueId);
    const estimated = cueById(next, firstCueId);
    expect(startMs).toBeGreaterThan(0);
    expect(estimated.alignmentSource).toBe('estimated');
    expect(estimated.tokens?.[0].startMs).toBe(first.startMs);
    expect(estimated.tokens?.at(-1)?.endMs).toBe(first.endMs);
    expect(estimated.audioAssetVersionId).toBe('voice-cue-1');
    expect(estimated.voiceId).toBe('voice-target');
    expect(estimated.voiceSpeed).toBe(1);
    expect(cueById(next, secondCueId)).toBe(cueById(document, secondCueId));
    expect(timelineOf(next)).toBe(timelineOf(document));
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it.each(workflows)('imports local timestamp files for %s without changing sibling cues', (workflow) => {
    const { document, shotId } = fixture(workflow);
    const cue = cueById(document, firstCueId);
    const payload = JSON.stringify({ words: [{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }] });
    const result = alignDirectorSubtitleCueFromTimestampFile(document, shotId, firstCueId, payload, 'whisper.json');
    expect(result.issues).toEqual([]);
    expect(cueById(result.document, firstCueId).alignmentSource).toBe('whisper');
    expect(cueById(result.document, firstCueId).tokens).toEqual([{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }]);
    expect(cueById(result.document, secondCueId)).toBe(cueById(document, secondCueId));
  });

  it('supports an explicitly empty cue without inventing words or retaining stale audio', () => {
    const { document, shotId } = fixture(workflow);
    const emptied = updateDirectorSubtitleCue(document, shotId, firstCueId, { text: '' });
    const estimated = estimateDirectorSubtitleCue(emptied, shotId, firstCueId);
    expect(cueById(estimated, firstCueId)).toMatchObject({ text: '', tokens: [], alignmentSource: 'estimated' });
    expect(cueById(estimated, firstCueId).audioAssetVersionId).toBeUndefined();
    expect(parseDocument(JSON.stringify(estimated), workflow)).toEqual(estimated);
  });

  it.each([0.25, 1000.5])('estimates a %s ms fractional cue without changing its stored global range', (duration) => {
    const { document, shotId, startMs } = fixture(workflow);
    const edited = updateDirectorSubtitleCue(document, shotId, firstCueId, { startMs: startMs + 0.25, endMs: startMs + 0.25 + duration });
    const next = estimateDirectorSubtitleCue(edited, shotId, firstCueId);
    const cue = cueById(next, firstCueId);
    expect(cue.startMs).toBe(startMs + 0.25);
    expect(cue.endMs).toBe(startMs + 0.25 + duration);
    expect(cue.tokens?.[0].startMs).toBe(cue.startMs);
    expect(cue.tokens?.at(-1)?.endMs).toBe(cue.endMs);
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it('uses legacy dialogue audio or shot audio when estimating an unaligned old cue', () => {
    const { document, shotId } = fixture(workflow);
    const first = cueById(document, firstCueId);
    delete first.tokens;
    delete first.alignmentSource;
    delete first.textHash;
    delete first.alignmentFingerprint;
    delete first.audioAssetVersionId;
    const next = estimateDirectorSubtitleCue(document, shotId, firstCueId);
    expect(cueById(next, firstCueId).audioAssetVersionId).toBe(workflow === 'motion-comic' ? 'voice-cue-1' : 'voice-aggregate');
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it('keeps an audio timeline reference still consumed by another shot', () => {
    const value = fixture(workflow);
    let document = value.document;
    const otherShot = document.workflowKind === 'editorial-collage' ? document.beats[0].shots[0] : document.episodes[0].scenes[0].shots[0];
    otherShot.voiceAssetVersionId = 'voice-aggregate';
    if (document.workflowKind === 'editorial-collage') document = rebuildEditorialTimeline(document);
    const next = updateDirectorSubtitleCue(document, value.shotId, firstCueId, { text: '本镜头配音已失效。' });
    expect(timelineOf(next).audioAssetVersionIds).toContain('voice-aggregate');
    expect(shotById(next, otherShot.id)).toBe(otherShot);
    expect(shotById(next, value.shotId).voiceAssetVersionId).toBeUndefined();
    expect(parseDocument(JSON.stringify(next), workflow)).toEqual(next);
  });

  it('refuses identity or audio injection through a cue update', () => {
    const { document, shotId } = fixture(workflow);
    expect(() => updateDirectorSubtitleCue(document, shotId, firstCueId, { id: 'forged-id' } as never)).toThrow('DIRECTOR_SUBTITLE_INVALID_UPDATE');
    expect(() => updateDirectorSubtitleCue(document, shotId, firstCueId, { audioAssetVersionId: 'forged-audio' } as never)).toThrow('DIRECTOR_SUBTITLE_INVALID_UPDATE');
  });

  it('rejects cross-shot cues, missing shots, and missing clip membership without mutating the project', () => {
    const { document, shotId } = fixture(workflow);
    const otherCue = allCues(document).find((cue) => cue.id !== firstCueId && cue.id !== secondCueId)!;
    const before = structuredClone(document);
    expect(() => updateDirectorSubtitleCue(document, shotId, otherCue.id, { text: '错误镜头' })).toThrow('DIRECTOR_SUBTITLE_NOT_OWNED');
    expect(() => estimateDirectorSubtitleCue(document, shotId, otherCue.id)).toThrow('DIRECTOR_SUBTITLE_NOT_OWNED');
    expect(() => updateDirectorSubtitleCue(document, 'missing-shot', firstCueId, { text: '错误镜头' })).toThrow('DIRECTOR_SUBTITLE_SHOT_NOT_FOUND');
    expect(document).toEqual(before);
    timelineOf(document).clips.find((clip) => clip.shotId === shotId)!.subtitleCueIds = [];
    expect(() => estimateDirectorSubtitleCue(document, shotId, firstCueId)).toThrow('DIRECTOR_SUBTITLE_NOT_OWNED');
  });

  it.each(['before-clip', 'after-clip', 'zero-duration', 'NaN', 'infinite', 'negative'] as const)('rejects %s cue timing', (invalid) => {
    const { document, shotId, startMs, endMs } = fixture(workflow);
    const before = structuredClone(document);
    const update = invalid === 'before-clip' ? { startMs: startMs - 1 }
      : invalid === 'after-clip' ? { endMs: endMs + 1 }
        : invalid === 'zero-duration' ? { endMs: cueById(document, firstCueId).startMs }
          : { startMs: invalid === 'NaN' ? Number.NaN : invalid === 'infinite' ? Number.POSITIVE_INFINITY : -1 };
    expect(() => updateDirectorSubtitleCue(document, shotId, firstCueId, update)).toThrow(/DIRECTOR_SUBTITLE_(OUTSIDE_SHOT|INVALID_UPDATE)/u);
    expect(document).toEqual(before);
  });

  it('round-trips all canonical alignment fields through strict save and parse contracts', () => {
    const { document } = fixture(workflow);
    const first = cueById(document, firstCueId);
    first.sourceId = 'narration-source';
    first.tokens![0].id = 'provider-token-1';
    first.tokens![0].confidence = 0.91;
    const input = { id: document.id, expectedUpdatedAt: document.updatedAt, document };
    const saved = workflow === 'editorial-collage' ? editorialCollageSaveInputSchema.parse(input) : motionComicSaveInputSchema.parse(input);
    expect(saved.document).toEqual(document);
    expect(parseDocument(JSON.stringify(saved.document), workflow)).toEqual(document);
  });

  it('refuses a persisted cue outside its owning clip even when it stays inside the episode or beat', () => {
    const { document, shotId, startMs, endMs } = fixture(workflow);
    const first = cueById(document, firstCueId);
    delete first.tokens;
    delete first.textHash;
    delete first.alignmentFingerprint;
    if (document.workflowKind === 'editorial-collage') {
      const beat = document.beats[1];
      const shot = beat.shots[0];
      const half = shot.durationMs / 2;
      shot.durationMs = half;
      shot.camera = shot.camera.map((frame) => ({ ...frame, atMs: Math.min(frame.atMs, half) }));
      shot.layers = shot.layers.map((layer) => ({ ...layer, motion: layer.motion.map((frame) => ({ ...frame, atMs: Math.min(frame.atMs, half) })) }));
      shot.subtitleCueIds = [firstCueId];
      const otherShot = { ...shot, id: 'second-shot-in-beat', subtitleCueIds: [secondCueId] };
      beat.shots.push(otherShot);
      cueById(document, secondCueId).shotId = otherShot.id;
      document.timeline = rebuildEditorialTimeline(document).timeline;
      first.endMs = endMs;
    } else {
      first.startMs = startMs - 1;
    }
    expect(() => parseDocument(JSON.stringify(document), workflow)).toThrow(/owning shot timeline clip/u);
    expect(() => estimateDirectorSubtitleCue(document, shotId, firstCueId)).toThrow('DIRECTOR_SUBTITLE_OUTSIDE_SHOT');
  });

  it.each([
    ['zero word duration', (cue: ProductionSubtitleCue) => { cue.tokens![0].endMs = cue.tokens![0].startMs; }],
    ['word before cue', (cue: ProductionSubtitleCue) => { cue.tokens![0].startMs = cue.startMs - 1; }],
    ['word after cue', (cue: ProductionSubtitleCue) => { cue.tokens!.at(-1)!.endMs = cue.endMs + 1; }],
    ['overlapping words', (cue: ProductionSubtitleCue) => { cue.tokens![1].startMs = cue.tokens![0].startMs; }],
    ['partial text coverage', (cue: ProductionSubtitleCue) => { cue.tokens!.pop(); }],
    ['wrong word text', (cue: ProductionSubtitleCue) => { cue.tokens![0].text = 'wrong'; }],
    ['empty word list', (cue: ProductionSubtitleCue) => { cue.tokens = []; }],
    ['invalid confidence', (cue: ProductionSubtitleCue) => { cue.tokens![0].confidence = 1.1; }],
    ['stale text hash', (cue: ProductionSubtitleCue) => { cue.textHash = 'stale-hash'; }],
    ['stale fingerprint', (cue: ProductionSubtitleCue) => { cue.alignmentFingerprint = 'stale-fingerprint'; }],
    ['unknown cue field', (cue: ProductionSubtitleCue) => { Object.assign(cue, { forged: true }); }],
    ['unknown token field', (cue: ProductionSubtitleCue) => { Object.assign(cue.tokens![0], { forged: true }); }],
  ] as const)('rejects persisted %s', (_label, corrupt) => {
    const { document } = fixture(workflow);
    corrupt(cueById(document, firstCueId));
    expect(() => parseDocument(JSON.stringify(document), workflow)).toThrow(/INVALID_DATA/u);
  });
});

function legacyDocument(workflow: typeof workflows[number]): DirectorSubtitleDocument {
  return workflow === 'editorial-collage'
    ? createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'subtitle-editorial', title: '城市与咖啡', now }), '咖啡馆改变了城市。消息和报纸在这里汇集。人们交换观点。公共生活由此改变。', now)
    : createMotionComicStarterProject(createMotionComicDraft({ id: 'subtitle-comic', title: '雨夜来信', premise: '女孩收到一封来自未来的信。', now }), '第一集', now);
}

function voxAudioFixture() {
  const value = fixture('editorial-collage');
  if (value.document.workflowKind !== 'editorial-collage') throw new Error('Expected VOX fixture.');
  const document = value.document;
  const shot = document.beats[1].shots[0];
  const other = document.beats[0].shots[0];
  document.assets.push(...['music-source', 'effect-source'].map((id) => ({ id, assetId: id, kind: 'audio' as const, createdAt: now })));
  document.timeline!.audioClips = [
    { id: 'full-shot-narration', assetVersionId: 'voice-aggregate', shotId: shot.id, trackType: 'narration', startMs: value.startMs, durationMs: shot.durationMs, sourceStartMs: 75, gainDb: -2 },
    { id: 'muted-shot-speech', assetVersionId: 'voice-cue-1', shotId: shot.id, trackType: 'dialogue', startMs: value.startMs, durationMs: shot.durationMs / 2, muted: true },
    { id: 'authored-music', assetVersionId: 'music-source', shotId: shot.id, trackType: 'music', startMs: value.startMs, durationMs: shot.durationMs, gainDb: -12, fadeInMs: 300 },
    { id: 'authored-effect', assetVersionId: 'effect-source', shotId: shot.id, trackType: 'sfx', startMs: value.startMs + 50, durationMs: 500, sourceStartMs: 20 },
    { id: 'other-shot-speech', assetVersionId: 'voice-aggregate', shotId: other.id, trackType: 'narration', startMs: 0, durationMs: other.durationMs },
  ];
  return { ...value, document: rebuildEditorialTimeline(document) };
}

function fixture(workflow: typeof workflows[number]) {
  let document = legacyDocument(workflow);
  const targetShot = document.workflowKind === 'editorial-collage' ? document.beats[1].shots[0] : document.episodes[0].scenes[0].shots[1];
  const clip = timelineOf(document).clips.find((item) => item.shotId === targetShot.id)!;
  const startMs = clip.startMs;
  const endMs = clip.startMs + clip.durationMs;
  const cueTexts = ['第一句保持独立。', '第二句保持独立。'];
  const cues = cueTexts.map((text, index) => alignSubtitleCue({
    id: index === 0 ? firstCueId : secondCueId,
    shotId: targetShot.id,
    text,
    startMs: startMs + index * clip.durationMs / 2,
    endMs: startMs + (index + 1) * clip.durationMs / 2,
  }, { source: 'estimated', timestamps: [], audioAssetVersionId: `voice-cue-${index + 1}`, voiceId: 'voice-target', voiceSpeed: 1, styleRef: 'white-outline' }));
  document.assets.push(...['voice-aggregate', 'voice-cue-1', 'voice-cue-2', 'voice-other'].map((id) => ({ id, assetId: id, kind: 'audio' as const, createdAt: now })));
  document.providerJobs.push({ id: 'historical-voice-job', workflowKind: workflow, nodeId: targetShot.id, providerId: 'local-fixture', model: 'fixture', capability: 'text-to-speech', status: 'completed', inputHash: 'old-input', idempotencyKey: 'old-job', estimatedCost: 0, actualCost: 0, attempt: 1, createdAt: now, updatedAt: now });
  targetShot.voiceAssetVersionId = 'voice-aggregate';
  targetShot.voiceId = 'voice-target';
  targetShot.voiceSpeed = 1;
  if (document.workflowKind === 'editorial-collage') {
    const beat = document.beats[1];
    beat.subtitleCues = cues;
    beat.narration = cueTexts.join(' ');
    beat.shots[0].subtitleCueIds = cues.map((cue) => cue.id);
    document.beats[0].shots[0].voiceAssetVersionId = 'voice-other';
    document = rebuildEditorialTimeline(document);
  } else {
    const episode = document.episodes[0];
    const characterId = document.characters[0].id;
    episode.dialogueCues = [...episode.dialogueCues.filter((cue) => cue.shotId !== targetShot.id), ...cues.map((cue, index) => ({ ...cue, shotId: targetShot.id, characterId, emotion: '坚定', voiceAssetVersionId: `voice-cue-${index + 1}` }))];
    episode.scenes[0].shots[1].dialogueCueIds = cues.map((cue) => cue.id);
    episode.scenes[0].shots[0].voiceAssetVersionId = 'voice-other';
    clip.subtitleCueIds = cues.map((cue) => cue.id);
    clip.assetVersionIds.push('voice-aggregate');
    episode.timeline.audioAssetVersionIds = ['voice-aggregate', 'voice-cue-1', 'voice-cue-2', 'voice-other'];
  }
  return { document, shotId: targetShot.id, startMs, endMs };
}

function allCues(document: DirectorSubtitleDocument): ProductionSubtitleCue[] {
  return document.workflowKind === 'editorial-collage' ? document.beats.flatMap((beat) => beat.subtitleCues) : document.episodes.flatMap((episode) => episode.dialogueCues);
}

function cueById(document: DirectorSubtitleDocument, id: string): ProductionSubtitleCue {
  return allCues(document).find((cue) => cue.id === id)!;
}

function shotById(document: DirectorSubtitleDocument, id: string) {
  return (document.workflowKind === 'editorial-collage' ? document.beats.flatMap((beat) => beat.shots) : document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots))).find((shot) => shot.id === id)!;
}

function timelineOf(document: DirectorSubtitleDocument) {
  return document.workflowKind === 'editorial-collage' ? document.timeline! : document.episodes[0].timeline;
}

function parseDocument(value: string, workflow: typeof workflows[number]): DirectorSubtitleDocument {
  return workflow === 'editorial-collage' ? parseEditorialCollagePipelineData(value) : parseMotionComicPipelineData(value);
}

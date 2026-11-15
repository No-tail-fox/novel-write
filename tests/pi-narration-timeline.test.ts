import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeDocument, nativeSettings } from './lemo-native.fixture';
import { rebuildEditorialTimeline, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { stagePiNarrationTimeline, requestPiNarrationPauses } from '../electron/pi-narration-timeline';

async function fixture(locked = false) {
  const root = await mkdtemp(join(tmpdir(), 'pi-narration-'));
  const audio = join(root, 'voice.wav');
  const wav = Buffer.alloc(44 + 16000 * 2 * 30);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(audio, wav);
  let document = nativeDocument();
  const shots = document.beats.flatMap(b => b.shots);
  document.assets.push({ id: 'voice', assetId: 'voice', kind: 'audio', localPath: audio, durationMs: 30000, createdAt: document.createdAt });
  shots.forEach(shot => { shot.voiceAssetVersionId = 'voice'; });
  if (locked) document.productionRun = { version: 1, id: 'run', status: 'completed', authoringVersion: 3, settings: nativeSettings({ narration: true, lockedShotIds: [shots[0].id] }), sourceHash: '', runtimeIdentity: 'test', nodes: [], createdAt: document.createdAt, updatedAt: document.updatedAt };
  document = parseEditorialCollagePipelineData(rebuildEditorialTimeline(document));
  const resolveAudioPath = vi.fn(async () => audio);
  const input = { document, resolveAudioPath, stateRoot: join(root, 'private'), outputDirectory: join(root, 'material'), allowNarrationPauses: true, targetDurationSeconds: 30 };
  return { root, audio, document, input, resolveAudioPath, request: (requested: unknown) => requestPiNarrationPauses({ stateRoot: input.stateRoot, document, requested }) };
}

describe('Pi production narration staging', () => {
  it('stages real production cues and immutable WAV bytes, splits source at exact film boundary without stretching', async () => {
    const f = await fixture();
    try {
      const original = structuredClone(f.document);
      const staged = await stagePiNarrationTimeline(f.input);
      expect(staged.cues.map(c => c.startMs)).toEqual(f.document.beats.flatMap(b => b.subtitleCues).map(c => c.startMs));
      expect(staged.materials[0]).toMatchObject({ assetVersionId: 'voice', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(await readFile(staged.audioSlices[0].path)).toEqual(await readFile(f.audio));
      const cue = staged.cues.find(c => c.sentenceEnd)!;
      expect(cue).toBeDefined();
      const requested = [{ afterCueId: cue.id, ms: 500, reason: 'Hold for comprehension' }];
      const next = await f.request(requested);
      expect(next.durationMs).toBe(staged.durationMs + 500);
      for (const before of staged.cues) expect(next.cues.find(c => c.id === before.id)).toEqual({ ...before, startMs: before.startMs + (before.startMs >= cue.endMs ? 500 : 0), endMs: before.endMs + (before.startMs >= cue.endMs ? 500 : 0) });
      expect(next.audioSlices.reduce((n, s) => n + s.durationMs, 0)).toBe(staged.audioSlices.reduce((n, s) => n + s.durationMs, 0));
      for (const slice of next.audioSlices) {
        const before = staged.audioSlices.find(s => s.path === slice.path && slice.sourceStartMs! >= s.sourceStartMs! && slice.sourceStartMs! < s.sourceStartMs! + s.durationMs);
        expect(before).toBeDefined();
      }
      expect(next.integration.status).toBe('external-timeline-required');
      expect(f.document).toEqual(original);
      expect((await f.request(requested)).acceptedChanges).toBe(1);
      expect((await stagePiNarrationTimeline(f.input)).baselineHash).toBe(staged.baselineHash);
      expect(f.resolveAudioPath).toHaveBeenCalledOnce();
      expect(JSON.parse(await readFile(staged.baselinePath, 'utf8')).base.durationMs).toBe(staged.durationMs);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('splits a continuous source at an interior sentence boundary with exact source offsets', async () => {
    const f = await fixture();
    try {
      const beat = f.document.beats[0], cue = beat.subtitleCues[0];
      const mid = Math.floor((cue.startMs + cue.endMs) / 2);
      beat.subtitleCues.splice(0, 1, { ...cue, text: 'First sentence.', endMs: mid }, { ...cue, id: cue.id + '-second', text: 'Second sentence.', startMs: mid });
      const shot = beat.shots.find(s => s.subtitleCueIds.includes(cue.id))!;
      shot.subtitleCueIds.push(cue.id + '-second');
      f.document = parseEditorialCollagePipelineData(rebuildEditorialTimeline(f.document)); f.input.document = f.document;
      const staged = await stagePiNarrationTimeline(f.input);
      const next = await requestPiNarrationPauses({ stateRoot: f.input.stateRoot, document: f.document, requested: [{ afterCueId: cue.id, ms: 500, reason: 'Sentence hold' }] });
      const original = staged.audioSlices[0];
      expect(next.audioSlices.slice(0, 2)).toEqual([
        { ...original, durationMs: mid - original.startMs },
        { ...original, startMs: mid + 500, sourceStartMs: (original.sourceStartMs ?? 0) + mid - original.startMs, durationMs: original.startMs + original.durationMs - mid },
      ]);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('replaces the whole set from original baseline, allows replay at max three, and persists across calls', async () => {
    const f = await fixture();
    try {
      const staged = await stagePiNarrationTimeline(f.input), cue = staged.cues.find(c => c.sentenceEnd)!;
      const set = (ms: number) => [{ afterCueId: cue.id, ms, reason: 'Timing' }];
      await f.request(set(200)); await f.request(set(300));
      const last = await f.request(set(400));
      expect(last.acceptedChanges).toBe(3); expect(last.durationMs).toBe(staged.durationMs + 400);
      expect((await f.request(set(400))).acceptedChanges).toBe(3);
      await expect(f.request(set(500))).rejects.toThrow('NARRATION_PAUSE_CHANGE_LIMIT');
      expect(JSON.parse(await readFile(last.timelinePath, 'utf8')).durationMs).toBe(last.durationMs);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('protects reserved locks, source edits, and material tampering', async () => {
    const f = await fixture(true);
    try {
      const staged = await stagePiNarrationTimeline(f.input);
      expect(staged.lockedWindows).toHaveLength(1);
      await expect(f.request([{ afterCueId: null, ms: 200, reason: 'Lead' }])).rejects.toThrow('NARRATION_PAUSE_LOCKED_WINDOW');
      const cue = staged.cues.filter(c => c.sentenceEnd && c.endMs >= staged.lockedWindows[0].endMs)[0];
      const shifted = await f.request([{ afterCueId: cue.id, ms: 200, reason: 'After lock' }]);
      expect(shifted.lockedWindows).toEqual(staged.lockedWindows);
      expect(shifted.cues.filter(c => c.endMs <= staged.lockedWindows[0].endMs)).toEqual(staged.cues.filter(c => c.endMs <= staged.lockedWindows[0].endMs));
      f.document.title += ' edited';
      await expect(f.request([])).rejects.toThrow('PI_NARRATION_BASELINE_INPUT_CHANGED');
      f.document.title = f.input.document.title.replace(' edited', '');
      await chmod(staged.audioSlices[0].path, 0o600); await writeFile(staged.audioSlices[0].path, 'corrupted');
      await expect(f.request([])).rejects.toThrow('PI_NARRATION_MATERIAL_MISMATCH');
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  it('does not attest a wrapped subtitle as a sentence and enforces allow context', async () => {
    const f = await fixture();
    try {
      const beat = f.document.beats[0], first = beat.subtitleCues[0], mid = Math.floor((first.startMs + first.endMs) / 2);
      const words = first.text.replace(/[。.!?！？]/gu, '');
      const left = words.slice(0, 2), right = words.slice(2);
      beat.subtitleCues.splice(0, 1, { ...first, text: left, endMs: mid }, { ...first, id: first.id + '-wrap', text: right, startMs: mid });
      const shot = beat.shots.find(s => s.subtitleCueIds.includes(first.id))!; shot.subtitleCueIds.splice(shot.subtitleCueIds.indexOf(first.id) + 1, 0, first.id + '-wrap');
      f.document = parseEditorialCollagePipelineData(rebuildEditorialTimeline(f.document)); f.input.document = f.document;
      const staged = await stagePiNarrationTimeline(f.input);
      expect(staged.cues[0].sentenceEnd).toBe(false);
      await expect(requestPiNarrationPauses({ stateRoot: f.input.stateRoot, document: f.document, requested: [{ afterCueId: first.id, ms: 200, reason: 'Wrap' }] })).rejects.toThrow('NARRATION_PAUSE_NOT_SENTENCE_BOUNDARY');
    } finally { await rm(f.root, { recursive: true, force: true }); }
    const disabled = await fixture();
    try {
      await stagePiNarrationTimeline({ ...disabled.input, allowNarrationPauses: false });
      await expect(disabled.request([])).rejects.toThrow('NARRATION_PAUSES_DISABLED');
    } finally { await rm(disabled.root, { recursive: true, force: true }); }
  });
});

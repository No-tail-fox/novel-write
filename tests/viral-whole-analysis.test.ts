import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteTranscript, runWholeReferenceAnalysis, type WholeReferenceOptions } from '../src/shared/viral-whole-analysis';
import { readReferenceManifest, readReferencePart, resolveReferenceMedia, type ReferenceIndexPointer } from '../src/shared/viral-reference-store';
import { ReferenceRequestLedger, authorizeReferenceRequestRetries } from '../src/shared/viral-reference-requests';
import { validateReferenceDocument } from '../src/shared/viral-reference';
import type { ViralAnalysisRecord } from '../src/shared/types';
import { parseViralAnalysisResult } from '../src/shared/viral-result';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture(durationMs = 125000, hasAudio = false) {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-whole-run-'));
  directories.push(directory);
  const source = join(directory, 'source.mp4');
  await writeFile(source, 'test-video');
  const record: ViralAnalysisRecord = {
    id: 'whole-test', url: '', platform: 'unknown', title: '测试原片', status: 'running', currentStage: 'queued', progress: 0, runGeneration: 1,
    settings: { track: '', style: '', ratio: '9:16', templateId: '', analysisMode: 'deep', maxAnalysisRequests: 100 },
    resultPath: '', videoPath: source, errorMessage: '', createdAt: new Date().toISOString(), startedAt: null, completedAt: null, lastHeartbeatAt: null,
    checkpoint: { runGeneration: 1, downloaded: { videoPath: source, provider: 'local-import', normalizedUrl: '', usedCookieSource: 'none',
      source: { kind: 'local', platform: 'unknown', url: '', normalizedUrl: '', downloadProvider: 'local-import', usedCookieSource: 'none', videoPath: source,
        coverPath: '', title: '测试原片', author: '', duration: durationMs / 1000, stats: { likes: null, comments: null, shares: null } } } },
  };
  let pointer: ReferenceIndexPointer | undefined;
  const visual = vi.fn(async () => [{ track: 'shot' as const, text: '主体居中。', state: 'observed' as const, presence: 'present' as const },
    { track: 'transition' as const, text: '不应把静帧差异当连续运动。', state: 'observed' as const, presence: 'present' as const }]);
  const options: WholeReferenceOptions = {
    workDir: directory, resumeFrom: record.checkpoint,
    providers: { fingerprint: 'test-model-v1', visualMode: 'frames', analyzeVisual: visual },
    publishIndex: async (revision, next) => { expect(revision).toBe(pointer?.revision ?? 0); pointer = next; record.referenceIndex = next; },
    persistCheckpoint: async checkpoint => { record.checkpoint = checkpoint; },
    scan: vi.fn(async () => ({ probe: { durationMs, width: 320, height: 180, fps: 24, hasAudio }, sourceSha256: 'a'.repeat(64), candidateBoundariesMs: [10000, 50000].filter(time => time < durationMs), scanVersion: 'decoded-scene-v1' as const })),
    extractWindow: vi.fn(async (_path, _workdir, window) => {
      const frame = join(directory, `${window.id}.jpg`);
      const clip = join(directory, `${window.id}.mp4`);
      const audio = join(directory, `${window.id}.wav`);
      await writeFile(frame, 'frame'); await writeFile(clip, 'video');
      if (hasAudio) await writeFile(audio, 'audio');
      return { frames: [{ mediaId: `${window.id}-frame`, path: frame, timeMs: window.coreRange.startMs }], videoPath: clip, audioPath: hasAudio ? audio : undefined };
    }),
  };
  return { directory, record, options, visual, pointer: () => pointer! };
}

describe('whole-video decomposition runner', () => {
  it('covers a 125 second source with independent reports and zero paid requests when resumed', async () => {
    const f = await fixture();
    const result = await runWholeReferenceAnalysis(f.record, f.options);
    expect(result.partial).toBe(true);
    expect(result.result.recreationState).toBe('not-requested');
    expect(parseViralAnalysisResult(result.result).schemaVersion).toBe(2);
    expect(() => parseViralAnalysisResult({ ...result.result, referenceAnalysisRef: undefined })).toThrow();
    const manifest = await readReferenceManifest(f.directory, f.pointer());
    const parts = await Promise.all(manifest.parts.map(part => readReferencePart(f.directory, manifest, part.partId)));
    expect(validateReferenceDocument(manifest, parts)).toEqual([]);
    expect(manifest.parts.at(-1)?.coreRange.endMs).toBe(125000);
    expect(manifest.coverageSummary.find(track => track.track === 'shot')).toMatchObject({ inferredMs: 125000, observedMs: 0 });
    expect(manifest.coverageSummary.find(track => track.track === 'layer-motion')?.notAnalyzedMs).toBe(125000);
    expect(manifest.coverageSummary.find(track => track.track === 'music')).toMatchObject({ observedMs: 125000, absentMs: 125000 });
    expect((await resolveReferenceMedia(f.directory, 'source')).path).toBeTruthy();
    const calls = f.visual.mock.calls.length;
    await runWholeReferenceAnalysis(f.record, { ...f.options, resumeFrom: f.record.checkpoint });
    expect(f.visual).toHaveBeenCalledTimes(calls);
    expect(JSON.parse(await readFile(result.resultPath, 'utf8')).referenceAnalysisRef.revision).toBeGreaterThan(0);
  });

  it('persists the completed unit and leaves the remainder pending at the global request budget', async () => {
    const f = await fixture(61000);
    f.record.settings.maxAnalysisRequests = 1;
    await expect(runWholeReferenceAnalysis(f.record, f.options)).rejects.toThrow('VIRAL_REFERENCE_BUDGET');
    const manifest = await readReferenceManifest(f.directory, f.pointer());
    expect(manifest.coverageSummary.find(track => track.track === 'shot')?.inferredMs).toBe(10000);
    f.record.settings.maxAnalysisRequests = 20;
    await runWholeReferenceAnalysis(f.record, { ...f.options, resumeFrom: f.record.checkpoint });
    expect(f.visual).toHaveBeenCalledTimes(4);
  });

  it('does not infer music from ASR and adds the core offset exactly once', async () => {
    const f = await fixture(61000, true);
    f.options.providers.transcribe = vi.fn(async () => [{ text: '这是一句解说。', start: 1, end: 2, words: [] }]);
    await runWholeReferenceAnalysis(f.record, f.options);
    const manifest = await readReferenceManifest(f.directory, f.pointer());
    expect(manifest.coverageSummary.find(track => track.track === 'music')?.notAnalyzedMs).toBe(61000);
    const parts = await Promise.all(manifest.parts.map(part => readReferencePart(f.directory, manifest, part.partId)));
    const transcript = parts.flatMap(part => part.transcript);
    expect(transcript.map(segment => segment.range?.startMs)).toEqual([1000, 11000, 41000, 51000]);
  });

  it('retains missing timestamp quality instead of inventing alignment', () => {
    const actual = absoluteTranscript([{ text: '没有时间戳', start: 0, end: 0, words: [] }], { startMs: 30000, endMs: 60000 }, 'unit');
    expect(actual[0]).toMatchObject({ range: null, timingQuality: 'missing' });
  });

  it('completes all tracks only with the corresponding real media capabilities', async () => {
    const f = await fixture(1000, true);
    f.options.providers.visualMode = 'video';
    f.options.providers.analyzeVisual = vi.fn(async input => {
      expect(input.videoPath).toBeTruthy();
      return (['narrative', 'shot', 'onscreen-text', 'transition', 'layer-motion', 'rhythm', 'av-sync'] as const)
        .map(track => ({ track, text: '已依据提供的媒体观察此维度。', state: 'observed' as const, presence: 'present' as const }));
    });
    f.options.providers.transcribe = vi.fn(async () => [{ text: '测试解说', start: 0, end: 0.9, words: [] }]);
    f.options.providers.analyzeAudio = vi.fn(async input => {
      expect(input.audioPath).toBeTruthy();
      return (['music', 'sfx'] as const).map(track => ({ track, text: '已听取片段，未发现此声音。', state: 'observed' as const, presence: 'absent' as const }));
    });
    const result = await runWholeReferenceAnalysis(f.record, f.options);
    expect(result.partial).toBe(false);
    const manifest = await readReferenceManifest(f.directory, f.pointer());
    expect(manifest.coverageState).toBe('complete');
    expect(manifest.coverageSummary.find(item => item.track === 'av-sync')?.inferredMs).toBe(1000);
  });

  it('reuses successful independent requests when enabling another media capability', async () => {
    const f = await fixture(1000, true);
    f.options.providers.fingerprints = { visual: 'unchanged-visual', audio: 'audio-v1', transcribe: 'stt-v1' };
    await runWholeReferenceAnalysis(f.record, f.options);
    expect(f.visual).toHaveBeenCalledTimes(1);
    f.options.providers.fingerprint = 'test-model-v2-audio-enabled';
    f.options.providers.analyzeAudio = vi.fn(async () => [{ track: 'music' as const, text: '背景音乐持续播放。', state: 'observed' as const, presence: 'present' as const }]);
    await runWholeReferenceAnalysis(f.record, { ...f.options, resumeFrom: f.record.checkpoint });
    expect(f.visual).toHaveBeenCalledTimes(1);
    expect(f.options.providers.analyzeAudio).toHaveBeenCalledTimes(1);
  });

  it('blocks resubmission after an unknown outcome until explicit review and counts both attempts', async () => {
    const f = await fixture(1000);
    const call = vi.fn().mockRejectedValueOnce(new Error('network disconnected')).mockResolvedValue({ ok: true });
    const ledger = new ReferenceRequestLedger(f.directory, 3);
    await expect(ledger.run({ id: 'request' }, call)).rejects.toThrow('REQUEST_REVIEW');
    await expect(ledger.run({ id: 'request' }, call)).rejects.toThrow('REQUEST_REVIEW');
    expect(call).toHaveBeenCalledTimes(1);
    expect(await authorizeReferenceRequestRetries(f.directory)).toBe(1);
    await expect(ledger.run({ id: 'request' }, call)).resolves.toEqual({ ok: true });
    await expect(ledger.run({ id: 'request' }, call)).resolves.toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(2);
    await expect(new ReferenceRequestLedger(f.directory, 2).run({ id: 'second' }, call)).rejects.toThrow('BUDGET');
  });
});

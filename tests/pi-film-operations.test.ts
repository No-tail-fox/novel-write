import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('electron', () => ({ BrowserWindow: {}, session: {}, utilityProcess: {} }));
import { createPiFilmOperations, type PiFilmOperationsOptions } from '../electron/pi-film-operations';
import { createPiToolRouter } from '../electron/pi-agent-tool-router';
import { piProductionPaths } from '../electron/pi-production-paths';
import { nativeDocument, nativeSettings } from './lemo-native.fixture';
import { rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import type { VoxProductionNode } from '../src/shared/vox-production';

type SessionOptions = Parameters<NonNullable<PiFilmOperationsOptions['sessionFactory']>>[0];
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const node = { id: 'pi-segment:1', kind: 'agent-segment', status: 'running', attempt: 1, paid: true, dependencies: [] } as VoxProductionNode;
async function fixture(lifecycle: (o: SessionOptions, call: (name: string, input?: unknown) => Promise<any>) => Promise<void>, overrides: { unknown?: boolean; durable?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-operations-')); roots.push(root);
  const library = join(root, 'library'); await mkdir(library);
  let d = nativeDocument();
  d.productionRun = { version: 1, id: 'run', authoringVersion: 4, status: 'running', settings: nativeSettings({ narration: false, codeVideo: newCodeVideoPolicy() }), sourceHash: '', runtimeIdentity: 'test', nodes: [], createdAt: d.createdAt, updatedAt: d.updatedAt };
  d = rebuildEditorialTimeline(d);
  const paths = piProductionPaths(root, 'run');
  const factory = vi.fn(async (o: SessionOptions) => {
    const sessionFile = join(o.stateRoot, 'sessions', 'session.jsonl');
    await mkdir(join(o.stateRoot, 'sessions'), { recursive: true });
    if (overrides.durable !== false) await writeFile(sessionFile, '{"type":"session"}\n');
    const router = createPiToolRouter({ ...o, receiptDirectory: join(o.stateRoot, 'tools') }); let id = 0;
    return { sessionFile, prompt: async () => lifecycle(o, (name, input = {}) => router.execute(name, input, 'call-' + ++id)),
      compact: vi.fn(), abort: vi.fn(), close: vi.fn(), summary: () => ({ forwardedRequests: 1, blockedRequests: 0, requests: 1, received: overrides.unknown ? 0 : 1, rejected: 0, unknown: overrides.unknown ? 1 : 0, usageUnknown: 0, blocked: !!overrides.unknown }) };
  });
  const options: PiFilmOperationsOptions = { library: { upstreamRoot: library, threeRoot: root, pythonRoot: root, cacheDir: root }, work: root, workerPath: 'unused', starterPackRoot: root,
    config: {} as PiFilmOperationsOptions['config'], capabilities: { images: false } as PiFilmOperationsOptions['capabilities'], pricing: { inputPerMillion: 1, outputPerMillion: 1 }, resolveAudioPath: async () => { throw new Error('No speech expected'); }, sessionFactory: factory };
  return { root, paths, d, factory, options };
}
const treatment = 'Three structures. Chosen choice. Logline. Emotional arc. Shot list. Beat sheet. Cue map. Sound design. Caption design. Benchmark: a named reference film. Differs from the demo in subject, palette, camera and sound. ' + 'A complete treatment with concrete creative decisions. '.repeat(5);

describe('Pi film production assembly', () => {
  it('stops naturally, checkpoints durable session, and recovers without model replay', async () => {
    const f = await fixture(async (_o, call) => {
      await call('write_file', { path: 'index.html', text: '<html>film</html>' });
      await expect(call('finish', { technicalPassed: true })).rejects.toThrow();
      await expect(call('finish')).rejects.toThrow('PI_FINISH_EVIDENCE_REQUIRED');
    });
    const ops = createPiFilmOperations(f.options), original = structuredClone(f.d);
    const result = await ops.piSegment(f.d, node);
    expect(result.piFilm).toMatchObject({ phase: 'paused', segment: 1, completedModelRequests: 1, sessionRef: 'sessions/session.jsonl' });
    expect(result.piFilm!.actualDurationSeconds).toBe(f.d.timeline!.durationMs / 1000);
    expect(f.d).toEqual(original);
    expect(await ops.recoverPiSegment(f.d, node)).toEqual(result);
    expect(f.factory).toHaveBeenCalledOnce();
    expect(await ops.recoverPiSegment(f.d, { ...node, id: 'pi-segment:2' })).toBeUndefined();
  });
  it.each([{ unknown: true, error: 'PI_RECONCILIATION_REQUIRED' }, { durable: false, error: 'ENOENT' }])('does not save unresolved or non-durable completion: $error', async ({ error, ...overrides }) => {
    const f = await fixture(async () => {}, overrides), ops = createPiFilmOperations(f.options);
    await expect(ops.piSegment(f.d, node)).rejects.toThrow(error);
    expect(await ops.recoverPiSegment(f.d, node)).toBeUndefined();
  });
  it('allows missing entry until authored and rejects arbitrary execution tools', async () => {
    const f = await fixture(async (o, call) => {
      expect(Object.keys(o.operations)).not.toContain('run_python');
      expect(Object.keys(o.operations)).not.toContain('render_score');
      expect(await call('inspect_treatment')).toMatchObject({ exists: false });
      await call('write_file', { path: 'TREATMENT.md', text: treatment.replace('Benchmark: a named reference film. Differs from the demo in subject, palette, camera and sound. ', '') });
      expect(await call('inspect_treatment')).toMatchObject({ exists: true, structuralPassed: false, missing: ['benchmark', 'differs-from-demo'] });
      await call('write_file', { path: 'TREATMENT.md', text: treatment });
      expect(await call('inspect_treatment')).toMatchObject({ structuralPassed: true, missing: [] });
      await expect(call('run_python', { code: 'print(1)' })).rejects.toThrow('PI_TOOL_NOT_AVAILABLE');
      await expect(call('write_file', { path: 'material/narration/cues.json', text: '{}' })).rejects.toThrow();
    });
    await createPiFilmOperations(f.options).piSegment(f.d, node);
  });
  it('accepts only current host evidence, rejects stale reviews and blocks the next billing admission', async () => {
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(async (o, call) => {
      await call('write_file', { path: 'TREATMENT.md', text: treatment });
      await call('write_file', { path: 'index.html', text: '<html>film</html>' });
      await call('write_file', { path: 'audio/mix.json', text: JSON.stringify({ version: 1, stems: {}, duck: { under: 'narration', attackMs: 10, releaseMs: 100 }, silences: [], transitions: [] }) });
      await call('look_proof'); await call('review_frames'); await call('review_frames'); await call('reading_check'); await call('audio_check'); await call('render_preview');
      await call('write_file', { path: 'index.html', text: '<html>revised film</html>' });
      await expect(call('finish')).rejects.toThrow('PI_FINISH_EVIDENCE_REQUIRED');
      await call('review_frames'); await call('review_frames'); await call('reading_check'); await call('audio_check'); await call('render_preview');
      expect(await call('finish')).toEqual({ accepted: true, visuallyReviewed: false, humanReviewed: false });
      await expect(o.beforeSubmit!()).rejects.toThrow('PI_FINISH_ACCEPTED');
    });
    const browserRoot = join(f.root, 'browser'); await mkdir(browserRoot); await writeFile(join(browserRoot, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '123' }] }));
    f.options.hostServices = {
      runtime: vi.fn(async () => ({ playwrightCorePath: browserRoot, nodePath: '', browsersPath: '', ffmpegPath: '', ffmpegDir: '' })), stageRenderRoot: vi.fn(async () => f.root),
      review: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const frames = await Promise.all(o.times.map(async (time: number, i: number) => { const path = join(o.outputDir, i + '.png'); await writeFile(path, 'image'); return { path, time, sha256: 'a'.repeat(64) }; })); return { version: 1, technicalPassed: true, readingPassed: false, aestheticReview: false, page: {}, stills: { frames } } as any; }),
      readcheck: vi.fn(async () => ({ readingPassed: true, modes: [{ texts: [] }] } as any)),
      preview: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const outputPath = join(o.outputDir, 'preview.mp4'); await writeFile(outputPath, 'video'); return { outputPath, receipt: { technicalPassed: true, engine: 'upstream-video.mjs' } } as any; }),
      master: vi.fn(async (input, o) => { const outputPath = join(o.outputDir, 'master.wav'); await writeFile(outputPath, 'audio'); return { outputPath, stems: [], onsets: [], narration: [], silenceMeasurements: [], master: { durationSeconds: input.durationSeconds, sampleRate: 48000, channels: 2, nonFiniteSamples: 0, peakAmplitude: .5 } } as any; }),
    };
    const ops = createPiFilmOperations(f.options);
    const result = await ops.piSegment(f.d, node);
    expect(await ops.piAudioMaster(result, node)).toEqual(result);
    await writeFile(join(f.paths.project, 'index.html'), '<html>changed after checkpoint</html>');
    await expect(ops.piAudioMaster(result, node)).rejects.toThrow('PI_AUDIO_MASTER_STALE');
    expect(result.piFilm).toMatchObject({ phase: 'ready', evidence: { contactSheetPasses: 2, visuallyReviewed: false, humanReviewed: false, technicalPassed: true, readingPassed: true, audioPassed: true }, audioMaster: { path: 'audio/master.wav' } });
    expect(JSON.parse(await readFile(join(f.paths.narration, 'cues.json'), 'utf8')).durationMs).toBe(f.d.timeline!.durationMs);
    expect(f.options.hostServices.review).toHaveBeenCalledTimes(5);
  });
  it('counts a visual review only when frames were actually shown to the model', async () => {
    const shown: any[] = [];
    let finished: any;
    const f = await fixture(async (_o, call) => {
      await call('write_file', { path: 'TREATMENT.md', text: treatment });
      await call('write_file', { path: 'index.html', text: '<html>film</html>' });
      await call('write_file', { path: 'audio/mix.json', text: JSON.stringify({ version: 1, stems: {}, duck: { under: 'narration', attackMs: 10, releaseMs: 100 }, silences: [], transitions: [] }) });
      await call('look_proof'); shown.push(await call('review_frames')); shown.push(await call('review_frames'));
      await call('reading_check'); await call('audio_check'); await call('render_preview');
      finished = await call('finish');
    });
    f.options.capabilities = { images: true } as PiFilmOperationsOptions['capabilities'];
    const browserRoot = join(f.root, 'browser'); await mkdir(browserRoot); await writeFile(join(browserRoot, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '123' }] }));
    f.options.hostServices = {
      runtime: vi.fn(async () => ({ playwrightCorePath: browserRoot, nodePath: '', browsersPath: '', ffmpegPath: '', ffmpegDir: '' })), stageRenderRoot: vi.fn(async () => f.root),
      review: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const frames = await Promise.all(o.times.map(async (time: number, i: number) => { const path = join(o.outputDir, i + '.png'); await writeFile(path, 'image'); return { path, time, sha256: 'a'.repeat(64) }; })); return { version: 1, technicalPassed: true, readingPassed: false, aestheticReview: false, page: {}, stills: { frames } } as any; }),
      readcheck: vi.fn(async () => ({ readingPassed: true, modes: [{ texts: [] }] } as any)),
      preview: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const outputPath = join(o.outputDir, 'preview.mp4'); await writeFile(outputPath, 'video'); return { outputPath, receipt: { technicalPassed: true, engine: 'upstream-video.mjs' } } as any; }),
      master: vi.fn(async (input, o) => { const outputPath = join(o.outputDir, 'master.wav'); await writeFile(outputPath, 'audio'); return { outputPath, stems: [], onsets: [], narration: [], silenceMeasurements: [], master: { durationSeconds: input.durationSeconds, sampleRate: 48000, channels: 2, nonFiniteSamples: 0, peakAmplitude: .5 } } as any; }),
    };
    const result = await createPiFilmOperations(f.options).piSegment(f.d, node);
    for (const receipt of shown) {
      expect(receipt.content).toHaveLength(9);
      expect(receipt.content.filter((part: any) => part.type === 'image')).toHaveLength(8);
      expect(JSON.parse(receipt.content[0].text).framesShownToModel).toBe(8);
    }
    expect(finished).toEqual({ accepted: true, visuallyReviewed: true, humanReviewed: false });
    expect(result.piFilm!.evidence).toMatchObject({ visuallyReviewed: true, humanReviewed: false, contactSheetPasses: 2 });
  });
  it('requires a look proof in the first segment and keeps it across later source edits', async () => {
    let finished: any, proofReceipt: any;
    const f = await fixture(async (_o, call) => {
      await call('write_file', { path: 'TREATMENT.md', text: treatment });
      await call('write_file', { path: 'index.html', text: '<html>film</html>' });
      await call('write_file', { path: 'audio/mix.json', text: JSON.stringify({ version: 1, stems: {}, duck: { under: 'narration', attackMs: 10, releaseMs: 100 }, silences: [], transitions: [] }) });
      const evidence = async () => { await call('review_frames'); await call('review_frames'); await call('reading_check'); await call('audio_check'); await call('render_preview'); };
      await evidence();
      await expect(call('finish')).rejects.toThrow('PI_FINISH_EVIDENCE_REQUIRED');
      proofReceipt = await call('look_proof');
      await call('write_file', { path: 'index.html', text: '<html>revised film</html>' });
      await evidence();
      finished = await call('finish');
    });
    const browserRoot = join(f.root, 'browser'); await mkdir(browserRoot); await writeFile(join(browserRoot, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '123' }] }));
    f.options.hostServices = {
      runtime: vi.fn(async () => ({ playwrightCorePath: browserRoot, nodePath: '', browsersPath: '', ffmpegPath: '', ffmpegDir: '' })), stageRenderRoot: vi.fn(async () => f.root),
      review: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const frames = await Promise.all(o.times.map(async (time: number, i: number) => { const path = join(o.outputDir, i + '.png'); await writeFile(path, 'image'); return { path, time, sha256: 'a'.repeat(64) }; })); return { version: 1, technicalPassed: true, readingPassed: false, aestheticReview: false, page: {}, stills: { frames } } as any; }),
      readcheck: vi.fn(async () => ({ readingPassed: true, modes: [{ texts: [] }] } as any)),
      preview: vi.fn(async o => { await mkdir(o.outputDir, { recursive: true }); const outputPath = join(o.outputDir, 'preview.mp4'); await writeFile(outputPath, 'video'); return { outputPath, receipt: { technicalPassed: true, engine: 'upstream-video.mjs' } } as any; }),
      master: vi.fn(async (input, o) => { const outputPath = join(o.outputDir, 'master.wav'); await writeFile(outputPath, 'audio'); return { outputPath, stems: [], onsets: [], narration: [], silenceMeasurements: [], master: { durationSeconds: input.durationSeconds, sampleRate: 48000, channels: 2, nonFiniteSamples: 0, peakAmplitude: .5 } } as any; }),
    };
    await createPiFilmOperations(f.options).piSegment(f.d, node);
    const proof = JSON.parse(proofReceipt.content[0].text);
    expect(proof).toMatchObject({ lookProofRecorded: true, framesShownToModel: 0 });
    expect(proof.stills.frames).toHaveLength(3);
    expect(proof.note).toContain('proves nothing about the look');
    expect(finished).toEqual({ accepted: true, visuallyReviewed: false, humanReviewed: false });
    expect(f.options.hostServices.review).toHaveBeenCalledTimes(5);
  });
});

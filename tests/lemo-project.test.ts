import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { assembleLemoProject, lemoProjectFiles, type LemoProject } from '../src/shared/creative-animation/native-project';
import type { VoxProductionSettings, VoxProductionNode } from '../src/shared/vox-production';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { VoxProductionService } from '../electron/vox-production-service';
import { validateLemoFile, lemoTruncationDiagnostic } from '../electron/lemo-project-runtime';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { LEMO_FILE_MAX_TOKENS } from '../src/shared/creative-animation/native-film';
import { compileLemoNative } from '../electron/lemo-native-compiler';
import { buildVoxProductionNodes } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import type { ImageLabRecord } from '../src/shared/types';

const sourceFor = (id: string) => id === 'shared' ? 'return {calls: []};' : id === 'director'
  ? 'return {render(t){ for(const scene of Object.values(scenes)) scene.render(t); }, texts(t){return Object.values(scenes).flatMap(s=>s.texts(t));}};'
  : 'return {render(t){shared.calls.push(t);}, texts(t){return [];}};';
const author = () => vi.fn(async (_prompt: string, _style: string, id: string) => ({ text: sourceFor(id), raw: sourceFor(id), requestId: 'provider-' + id, finishReason: 'stop', usage: { completion_tokens: 100 } }));
const finished = (h: ReturnType<typeof nativeHarness>) => expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
const film = (h: ReturnType<typeof nativeHarness>) => h.get().creativeFilms!.find(f => f.id === h.get().productionRun!.filmId)!;

describe('Lemo multi-file continuous-film authoring', () => {
  it('reserves code headroom after reasoning and reports the actual exhausted token budget', () => {
    expect(LEMO_FILE_MAX_TOKENS - 11521).toBeGreaterThan(12000);
    const diagnostic = lemoTruncationDiagnostic({ text: 'const palette = {', raw: '', requestId: 'budget', finishReason: 'length',
      usage: { completion_tokens: 12000, completion_tokens_details: { reasoning_tokens: 11521, text_tokens: 479 } } });
    expect(diagnostic).toContain('12000'); expect(diagnostic).toContain('11521'); expect(diagnostic).toContain('479');
    expect(diagnostic).toContain('增加输出预算');
  });
  it('checkpoints partial streamed source while preserving unknown status across restart and reconcile', async () => {
    let disconnected = true;
    const authorFilmFile = vi.fn(async (_p: string, _s: string, id: string) => {
      if (disconnected) throw new LlmTextInterruptedError({ text: 'const partial = {', raw: '', requestId: 'server-stream-id', usage: { completion_tokens: 18 } }, Error('socket disconnected'));
      return { text: sourceFor(id), raw: '', requestId: 'new-' + id, finishReason: 'stop' };
    });
    const h = nativeHarness({ authorFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'shared')?.status).toBe('unknown');
    expect(film(h).project?.files[0]).toMatchObject({ source: 'const partial = {', status: 'invalid', attempts: [{ providerRequestId: 'server-stream-id', interrupted: true }] });
    const restarted = new VoxProductionService(h.store, async () => h.runtime); await restarted.restore();
    await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'reconcile' });
    expect(h.get().productionRun?.message).toContain('最终结果待核对');
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'shared')?.status).toBe('unknown');
    await expect(restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    expect(authorFilmFile).toHaveBeenCalledTimes(1);
    disconnected = false;
    await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'retry-unknown', nodeId: 'film-code:shared' });
    await restarted.idle(h.get().id); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'shared', 'scene-1', 'director']);
    expect(film(h).project?.files[0].attempts[0].source).toBe('const partial = {');
  });
  it('keeps the legacy graph but versions new tasks and checkpoints files independently', async () => {
    const authorFilmFile = author(), h = nativeHarness({ authorFilmFile });
    await h.start(); await h.idle(); finished(h);
    expect(h.get().productionRun?.authoringVersion).toBe(2);
    expect(JSON.parse(authorFilmFile.mock.calls[0][0]).textLayout.minimumFontSizePx).toBe(24);
    const directorPrompt = JSON.parse(authorFilmFile.mock.calls.find(c => c[2] === 'director')![0]);
    expect(directorPrompt.input.timeline.flatMap((w: { cues: unknown[] }) => w.cues)).toHaveLength(h.get().beats.flatMap(b => b.subtitleCues).length);
    expect(directorPrompt.captions.owner).toBe('scene');
    expect(directorPrompt.captions.director).toContain('Do not draw captions again');
    expect(h.calls.indexOf('film-sample-finalize')).toBeLessThan(h.calls.indexOf('film-director'));
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'director']);
    expect(film(h).project?.files.every(f => f.status === 'valid' && f.attempts[0].providerRequestId)).toBe(true);
    expect(film(h).source.match(/window\.render\s*=/g)).toHaveLength(1);
    const ids = new Set(h.get().beats.flatMap(b => b.shots.map(s => s.animation?.native?.filmId)));
    expect([...ids]).toEqual([film(h).id]); expect(h.errors).toEqual([]);
    expect(buildVoxProductionNodes(nativeDocument(), nativeSettings()).filter(n => n.kind === 'film-code')).toHaveLength(1);
  });
  it('retains truncated source and completion metadata as a known failure, then reuses earlier successful files', async () => {
    let truncate = true;
    const authorFilmFile = vi.fn(async (_prompt: string, _style: string, id: string) => ({ text: id === 'scene-1' && truncate ? 'const unfinished = {' : sourceFor(id), raw: '', requestId: 'partial-id', finishReason: id === 'scene-1' && truncate ? 'length' : 'stop', usage: { completion_tokens: 12000 } }));
    const h = nativeHarness({ authorFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'scene-1')?.status).toBe('failed');
    const partial = film(h).project!.files.find(f => f.id === 'scene-1')!;
    expect(partial).toMatchObject({ status: 'invalid', source: 'const unfinished = {' });
    expect(partial.attempts[0]).toMatchObject({ providerRequestId: 'partial-id', finishReason: 'length', usage: { completion_tokens: 12000 } });
    expect(h.get().productionRun?.nodes.some(n => n.status === 'unknown')).toBe(false);
    expect(h.receipts.size).toBeGreaterThan(1);
    truncate = false;
    await h.service.restore();
    await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await h.idle(); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'scene-1', 'director']);
    expect(film(h).project!.files.find(f => f.id === 'scene-1')!.attempts).toHaveLength(2);
  });
  it('does not automatically repeat an ambiguous transport failure', async () => {
    const authorFilmFile = vi.fn(async () => { throw new Error('socket disconnected'); });
    const h = nativeHarness({ authorFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'shared')?.status).toBe('unknown');
    await expect(h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    expect(authorFilmFile).toHaveBeenCalledTimes(1);
  });
  it('checks the first continuous scene before dispatching later scene generation', async () => {
    const d = nativeDocument(); const first = d.beats[0].shots[0];
    d.beats[0].shots = Array.from({ length: 17 }, (_, i) => ({ ...structuredClone(first), id: 'shot-' + i, durationMs: first.durationMs }));
    d.beats = [d.beats[0]]; d.beats[0].durationMs = first.durationMs * 17; d.beats[0].subtitleCues = []; d.beats[0].shots = d.beats[0].shots.map(s => ({...s, subtitleCueIds: []}));
    let previews = 0;
    const authorFilmFile = author();
    const h = nativeHarness({ authorFilmFile, previewCode: async () => { previews++; throw new Error('CREATIVE_CONTENT: subtitle missing'); } }, d);
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed'); expect(previews).toBe(2);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'shared', 'scene-1']);
    expect(film(h).project?.diagnostic).toContain('subtitle missing');
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'scene-2')?.status).toBe('pending');
  });
  it('rechecks saved code without paid requests and resumes after the browser passes', async () => {
    let broken = true;
    const authorFilmFile = author(), previewCode = vi.fn(async () => { if (broken) throw new Error('CREATIVE_EMPTY_FRAME: host failure'); return ['verified.jpg']; });
    const h = nativeHarness({ authorFilmFile, previewCode });
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    const count = authorFilmFile.mock.calls.length;
    const input = { id: h.get().id, runId: h.get().productionRun!.id, action: 'recheck-code' as const };
    await expect(h.service.control(input)).rejects.toThrow('LEMO_PROJECT_FAILED');
    expect(h.get().productionRun?.status).toBe('failed');
    expect(authorFilmFile).toHaveBeenCalledTimes(count);
    const stale = h.get();
    stale.productionRun!.nodes.push({ id: 'film-sample-repair:shared:edit:2', kind: 'film-edit', fileId: 'shared', editSession: 'film-sample-repair:shared', editRound: 2, dependencies: ['film-sample'], status: 'failed', paid: true, attempt: 1, error: 'retained failed batch' });
    h.set(stale);
    const savedAttempts = film(h).project!.files.map(f => f.attempts);
    broken = false;
    await h.service.control(input);
    expect(h.get().productionRun?.status).toBe('paused');
    expect(h.get().productionRun?.nodes.filter(n => n.status === 'failed')).toEqual([]);
    expect(h.get().productionRun?.nodes.some(n => n.id === 'film-sample-repair:shared:edit:2')).toBe(false);
    expect(film(h).project!.files.map(f => f.attempts)).toEqual(savedAttempts);
    expect(film(h).project?.repairFileIds).toEqual([]);
    expect(film(h).error).toBeUndefined();
    expect(authorFilmFile).toHaveBeenCalledTimes(count);
    await h.service.control({ ...input, action: 'resume' }); await h.idle(); finished(h);
    expect(authorFilmFile.mock.calls.slice(count).map(c => c[2])).toEqual(['director']);
  });
  it('targets the failed scene and director, not unrelated files, after full-film review', async () => {
    let failed = false;
    const authorFilmFile = author(); const h = nativeHarness({ authorFilmFile, previewCode: async d => {
      const f = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!;
      if (f.source.includes('director=await') && !failed) { failed = true; throw new Error('CREATIVE_LAYOUT: title overflow'); }
      return ['frame.jpg'];
    } });
    await h.start(); await h.idle(); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'director', 'scene-1', 'director']);
    expect(film(h).project?.repairFileIds).toEqual([]);
  });

  it('recovers a retained failed response after checkpoint succeeded but the document save was interrupted', async () => {
    let broken = true;
    const authorFilmFile = vi.fn(async (_p: string, _s: string, id: string) => ({ text: broken ? 'return {' : sourceFor(id), raw: '', requestId: 'retained-response', finishReason: broken ? 'length' : 'stop' }));
    const h = nativeHarness({ authorFilmFile }); const save = h.store.save; let interrupt = true;
    h.store.save = async d => {
      if (interrupt && d.productionRun?.status === 'failed') { interrupt = false; throw Error('simulated disk save failure'); }
      return save(d);
    };
    await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'shared')?.status).toBe('unknown');
    const restarted = new VoxProductionService(h.store, async () => h.runtime);
    await restarted.restore();
    await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'reconcile' });
    expect(h.get().productionRun?.nodes.find(n => n.fileId === 'shared')?.status).toBe('failed');
    expect(film(h).project?.files[0].attempts[0].providerRequestId).toBe('retained-response');
    broken = false;
    await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' });
    await restarted.idle(h.get().id); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'shared', 'scene-1', 'director']);
  });
  it('reopens only affected repair files after repeated final-review failure and resumes after a fresh service starts', async () => {
    let broken = true;
    const authorFilmFile = author(); const h = nativeHarness({ authorFilmFile, previewCode: async d => {
      if (broken && d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!.source.includes('director=await')) throw Error('CREATIVE_LAYOUT: repeated overflow');
      return ['frame.jpg'];
    } });
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    expect(h.get().productionRun?.nodes.filter(n => n.kind === 'film-repair' && n.status === 'failed').map(n => n.fileId)).toEqual(['scene-1', 'director']);
    const restarted = new VoxProductionService(h.store, async () => h.runtime);
    broken = false; await restarted.restore();
    await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await restarted.idle(h.get().id); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'director', 'scene-1', 'director', 'scene-1', 'director']);
  });
  it('authors remaining scene files only after the sample passes and keeps one film for all 17 windows', async () => {
    const d = nativeDocument(), first = d.beats[0].shots[0];
    d.beats = [d.beats[0]]; d.beats[0].subtitleCues = [];
    d.beats[0].shots = Array.from({ length: 17 }, (_, i) => ({ ...structuredClone(first), id: 'window-' + i, subtitleCueIds: [] }));
    d.beats[0].durationMs = first.durationMs * 17;
    const authorFilmFile = author(), h = nativeHarness({ authorFilmFile }, d);
    await h.start(); await h.idle(); finished(h);
    expect(authorFilmFile.mock.calls.map(c => c[2])).toEqual(['shared', 'scene-1', 'scene-2', 'scene-3', 'director']);
    expect(h.calls.indexOf('film-sample-finalize')).toBeLessThan(h.calls.lastIndexOf('film-scene'));
    expect(new Set(h.get().beats[0].shots.map(s => s.animation?.native?.filmId)).size).toBe(1);
    expect(film(h).project?.files.find(f => f.id === 'scene-3')?.shotIds).toEqual(['window-16']);
  });
  it('drops the old material manifest before reserving a fresh plan', async () => {
    let fresh = false;
    const preflight = vi.fn(async (_d: EditorialCollagePipelineData, _s: VoxProductionSettings, pending?: readonly VoxProductionNode[]) => {
      if (fresh) expect(pending?.some(n => n.materialId === 'old-tree')).toBe(false);
    });
    const planFilm = vi.fn(async () => ({ treatment: '以树荫作为城市热岛的视觉论点，以连续镜头展示道路吸热和绿地降温的机制，所有场景都沿用同一条完整时间轴。', materials: fresh ? [] : [{ id: 'old-tree', kind: 'generated', description: 'tree' }] }));
    const h = nativeHarness({ preflight, planFilm, authorFilmFile: author() });
    await h.start(); await h.idle();
    expect(h.get().productionRun?.message).toContain('LEMO_MATERIAL_DISABLED');
    fresh = true;
    await h.start(nativeSettings({ authoring: { mode: 'ai-code', styleId: 'watercolor', brief: '使用代码绘制树木，不需要图片' } }));
    await h.idle(); finished(h);
    expect(planFilm).toHaveBeenCalledTimes(2);
    expect(h.get().productionRun?.nodes.some(n => n.materialId === 'old-tree')).toBe(false);
  });
  it('selects the first editable window as the sample when earlier windows are locked', () => {
    const d = nativeDocument(), first = d.beats[0].shots[0];
    d.beats = [{ ...d.beats[0], shots: Array.from({ length: 17 }, (_, i) => ({ ...first, id: 'window-' + i })) }];
    const settings = nativeSettings({ lockedShotIds: Array.from({ length: 8 }, (_, i) => 'window-' + i) });
    const files = lemoProjectFiles(d.beats[0].shots.filter(s => !settings.lockedShotIds.includes(s.id)).map(s => s.id));
    expect(files[1].shotIds).toEqual(Array.from({ length: 8 }, (_, i) => 'window-' + (i + 8)));
    const nodes = buildVoxProductionNodes(d, settings, LEMO_NATIVE_ENGINE, 2);
    expect(nodes.filter(n => n.kind === 'film-scene').map(n => n.fileId)).toEqual(['scene-1', 'scene-2']);
    expect(nodes.find(n => n.id === 'compile:window-0')?.dependencies).toEqual([]);
  });
  it('has bounded scene groups and a topologically ordered graph, including sample gates', () => {
    const d = nativeDocument(), s = d.beats[0].shots[0]; d.beats[0].shots = Array.from({length: 500}, (_, i) => ({...s, id: 's-' + i}));
    const nodes = buildVoxProductionNodes(d, nativeSettings(), LEMO_NATIVE_ENGINE, 2);
    expect(nodes.filter(n => n.kind === 'film-scene')).toHaveLength(63);
    expect(nodes.every((n, i) => n.dependencies.every(dep => nodes.findIndex(p => p.id === dep) < i))).toBe(true);
    expect(nodes.some(n => ['animation', 'code', 'image'].includes(n.kind))).toBe(false);
  });
});

describe('independent material preparation', () => {
  const treatment = '以树荫和吸热街道形成连续的视觉比较，完整保留批准文案的内容和已有旁白结构，用所选材质表现光照和温度机制。';
  it('stops at the material gate before voices and code if the plan needs disabled image generation', async () => {
    const authorFilmFile = author(); const h = nativeHarness({ authorFilmFile, planFilm: async () => ({ treatment, materials: [{ id: 'tree', kind: 'generated', description: 'tree illustration' }] }) });
    await h.start(); await h.idle();
    expect(h.get().productionRun?.message).toContain('LEMO_MATERIAL_DISABLED'); expect(authorFilmFile).not.toHaveBeenCalled();
    expect(h.get().productionRun?.nodes.some(n => n.materialId === 'tree')).toBe(true);
  });
  it('requires real evidence for kino montage rather than silently substituting generated drawings', async () => {
    const authorFilmFile = author(); const h = nativeHarness({ authorFilmFile, planFilm: async () => ({ treatment, materials: [] }) });
    await h.start(nativeSettings({ authoring: { mode: 'ai-code', styleId: 'kino-montage' } })); await h.idle();
    expect(h.get().productionRun?.message).toContain('LEMO_EVIDENCE_REQUIRED'); expect(authorFilmFile).not.toHaveBeenCalled();
  });

  it('preflights dynamically planned images and releases both capacity reservations on failure', async () => {
    const releaseInitial = vi.fn(), releaseMaterials = vi.fn();
    const preflight = vi.fn(async (_d: EditorialCollagePipelineData, _s: VoxProductionSettings, pending?: readonly VoxProductionNode[]) => pending?.some(n => n.materialId) ? releaseMaterials : releaseInitial);
    const h = nativeHarness({ preflight, authorFilmFile: author(), planFilm: async () => ({ treatment, materials: [{ id: 'tree', kind: 'generated', description: 'tree' }] }), image: async () => { throw Error('Image provider API error (400): rejected'); } });
    await h.start(nativeSettings({ generateImages: true })); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    expect(preflight).toHaveBeenCalledTimes(2); expect(releaseInitial).toHaveBeenCalledTimes(1); expect(releaseMaterials).toHaveBeenCalledTimes(1);
    expect(h.get().productionRun?.nodes.find(n => n.materialId)?.status).toBe('failed');
  });
  it.each(['missing-file', 'missing-source', 'generated-evidence'])('blocks unusable evidence before voice or code: %s', async scenario => {
    const temp = await mkdtemp(join(tmpdir(), 'lemo-evidence-'));
    try {
      const imagePath = join(temp, 'evidence.png'); if (scenario !== 'missing-file') await writeFile(imagePath, 'fixture');
      const d = nativeDocument();
      d.assets.push({ id: 'evidence', assetId: 'evidence', kind: 'image', localPath: imagePath, provider: 'local-import', createdAt: '2026-10-28T00:00:00.000Z', ...(scenario === 'generated-evidence' ? { providerJobId: 'generated' } : {}) });
      if (scenario === 'generated-evidence') d.providerJobs.push({ id: 'generated', workflowKind: 'editorial-collage', nodeId: 'material', providerId: 'gpt_image', model: 'test', capability: 'text-to-image', status: 'completed', inputHash: 'test', idempotencyKey: 'test', estimatedCost: 0, attempt: 1, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' });
      const authorFilmFile = author(), h = nativeHarness({ authorFilmFile, planFilm: async () => ({ treatment, materials: [{ id: 'evidence', kind: 'evidence', description: 'source photo', assetId: 'evidence' }] }) }, d);
      await h.start(nativeSettings({ authoring: {mode: 'ai-code', styleId: 'kino-montage'}, archives: scenario === 'missing-source' ? [] : [{ assetVersionId: 'evidence', source: 'Public archive fixture', license: 'CC0' }] })); await h.idle();
      expect(h.get().productionRun?.message).toContain(scenario === 'missing-file' ? 'LEMO_MATERIAL_MISSING' : 'LEMO_EVIDENCE_SOURCE'); expect(authorFilmFile).not.toHaveBeenCalled();
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  it('creates a material receipt/binding without adding a per-shot image layer, and reuses it after file failure', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'lemo-material-'));
    try {
      const imagePath = join(temp, 'tree.png'); await writeFile(imagePath, Buffer.from('offline-fixture'));
      const image = vi.fn(async () => ({ id: 'material-record', createdAt: '2026-10-28T00:00:00.000Z', status: 'generated', imagePath, prompt: 'tree', style: '', referenceImagePath: '', upstreamTaskId: null, finishedAt: '2026-10-28T00:00:00.000Z', provider: 'gpt_image', referenceImagePaths: [], ratio: '16:9', resolution: '1K', quality: 'medium', smartMode: 'text-to-image', errorMessage: '' } as ImageLabRecord));
      let broken = true;
      const authorFilmFile = vi.fn(async (_p: string, _s: string, id: string) => ({ text: broken ? 'return {' : sourceFor(id), raw: '', requestId: 'r' }));
      const h = nativeHarness({ image, authorFilmFile, planFilm: async () => ({ treatment, materials: [{ id: 'tree', kind: 'generated', description: 'tree illustration' }] }) });
      await h.start(nativeSettings({ generateImages: true })); await h.idle();
      expect(film(h).project?.bindings.tree, h.get().productionRun?.message).toBe('image-asset-material-record'); expect(image).toHaveBeenCalledTimes(1);
      expect(h.get().assets.find(a => a.id === film(h).project?.bindings.tree)?.sha256).toHaveLength(64);
      expect(h.get().beats.flatMap(b => b.shots.flatMap(s => s.layers)).some(l => l.assetVersionId === 'image-asset-material-record')).toBe(false);
      broken = false; await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await h.idle(); finished(h);
      expect(image).toHaveBeenCalledTimes(1); expect(film(h).assetIds).toContain('image-asset-material-record');
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
});

describe('factory assembly integrity and continuous time', () => {
  it('accepts and executes hoisted helpers declared after the complete factory return', async () => {
    const source = 'return {render, texts}; function render(t){return twice(t);} function texts(t){return [{text:String(t)}];} function twice(t){return 2*t;}';
    expect(() => validateLemoFile(source, 'scene')).not.toThrow();
    const factory = vm.runInNewContext('(async function(){' + source + '})');
    const api = await factory();
    expect(api.render(3)).toBe(6);
    expect(api.texts(4)).toEqual([{text: '4'}]);
    expect(() => validateLemoFile('return {draw}; function draw(){return 7;}', 'shared')).not.toThrow();
  });
  it.each(['const unreachable=1;', 'class Unreachable {}', 'draw();', 'if (true) { return {}; }'])('rejects executable statements after the factory return: %s', tail => {
    expect(() => validateLemoFile('return {render(){},texts(){}}; ' + tail, 'scene')).toThrow('LEMO_FILE_INCOMPLETE');
  });
  it('identifies unreachable initialization precisely, including a second trailing return', () => {
    const source = 'return {fields}; const fields={radial(){}}; return {fields};';
    expect(() => validateLemoFile(source, 'shared')).toThrow('const fields=');
    expect(() => validateLemoFile(source, 'shared')).toThrow('移到最终 return');
    expect(() => validateLemoFile('const fields={}; return {fields}; function draw(){};', 'shared')).not.toThrow();
  });
  it('still rejects truncated hoisted helpers and missing scene APIs', () => {
    expect(() => validateLemoFile('return {render, texts}; function render(){} function texts(){', 'scene')).toThrow('LEMO_');
    expect(() => validateLemoFile('return {render}; function render(){}', 'scene')).toThrow('LEMO_FILE_CONTRACT');
  });
  it.each(['return {', 'const x = 1;', 'return {render(){}};'])('rejects incomplete scene factories: %s', source => expect(() => validateLemoFile(source, 'scene')).toThrow('LEMO_'));
  it.each([false, true])('passes absolute nonsequential time through the visible canvas (sample=%s) and safely embeds literals', async sample => {
    const project: LemoProject = { version: 2, materials: [], bindings: {}, files: lemoProjectFiles(['shot']), repairFileIds: [], samplePaths: [] };
    project.files = project.files.map(f => ({...f, status: 'valid', source: f.id === 'shared' ? 'return {calls: []};' : f.id === 'director' ? 'return {render(t){ scenes["scene-1"].render(t); }, texts(t){return scenes["scene-1"].texts(t);}};' : 'return {render(t){globalThis.lastTime=t;input.canvas.getContext("2d").fillRect(t);},texts(t){return [{text:input.script, t}];}};' }));
    const html = assembleLemoProject(project, { canvas: {width: 1280, height: 720}, script: '</script><script>throw Error("injected")</script>' }, 3000, sample);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    const compiled = compileLemoNative(html).compiled;
    const draws: number[] = [];
    const stage = { style: {}, dataset: {}, width: 0, height: 0, getContext: () => ({ fillRect: (t: number) => draws.push(t) }) };
    const mounted: unknown[] = [];
    const context = vm.createContext({ window: {LemoHost: {require:()=>({}), fail: (e: Error)=>{throw e;}}, LEMO_ASSETS:{}}, document: { createElement: () => stage, body: { style: {}, appendChild: (canvas: unknown) => mounted.push(canvas) }, fonts: { ready: Promise.resolve() } } });
    vm.runInContext(compiled.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1], context);
    await new Promise(resolve => setImmediate(resolve));
    expect(context.window.READY).toBe(true);
    expect(mounted).toEqual([stage]);
    expect([stage.width, stage.height]).toEqual([1280, 720]);
    for (const t of [2.9, 0, 1.2, 2.9]) { context.window.render(t); expect(context.lastTime).toBe(t); expect(context.window.TEXTS(t)[0].t).toBe(t); }
    expect(context.window.TEXTS(0)[0].text).toContain('</script>');
    expect(draws).toEqual([2.9, 0, 1.2, 2.9]);
  });
});

it('rechecks a completed native project without re-authoring and invalidates old delivery checks',async()=>{
  const authorFilmFile=author(),previewCode=vi.fn(async()=>['checked.jpg']);
  const h=nativeHarness({authorFilmFile,previewCode});await h.start();await h.idle();finished(h);
  const calls=authorFilmFile.mock.calls.length;
  await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'recheck-code'});
  expect(h.get().productionRun!.status).toBe('paused');
  expect(authorFilmFile).toHaveBeenCalledTimes(calls);
  expect(h.get().productionRun!.nodes.filter(n=>['compile','render','verify'].includes(n.kind)).every(n=>n.status==='pending')).toBe(true);
  await h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'resume'});await h.idle();finished(h);
  expect(authorFilmFile).toHaveBeenCalledTimes(calls);
});
it('routes new Canvas state failures in a completed project to the existing repair workflow',async()=>{
  let broken=false;
  const authorFilmFile=author(),h=nativeHarness({authorFilmFile,previewCode:async()=>{if(broken)throw Error('LEMO_CANVAS_STATE: missing restore');return ['checked.jpg'];}});
  await h.start();await h.idle();finished(h);const calls=authorFilmFile.mock.calls.length;broken=true;
  await expect(h.service.control({id:h.get().id,runId:h.get().productionRun!.id,action:'recheck-code'})).rejects.toThrow(/LEMO_CANVAS_STATE/);
  expect(h.get().productionRun!.status).toBe('failed');expect(film(h).project!.repairFileIds).toContain('scene-1');
  expect(authorFilmFile).toHaveBeenCalledTimes(calls);
  expect(h.get().productionRun!.nodes.find(n=>n.kind==='render')!.status).toBe('pending');
});

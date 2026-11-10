import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeHarness, nativeSettings } from './lemo-native.fixture';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { lemoMaterialContext } from '../electron/lemo-upstream-production';
import { buildLemoUpstreamNodes } from '../src/shared/lemo-upstream-graph';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { LEMO_AGENT_MAX_TURNS, lemoAgentBudgetExhausted, lemoAgentMaxTokens, lemoAgentMaxTurns, lemoAgentProgressText, lemoUpstreamFilmSchema, lemoUsageFromResponse } from '../src/shared/creative-animation/upstream-agent';
import { lemoAgentBudgetResume, voxProductionSettingsSchema } from '../src/shared/vox-production';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoxProductionNode } from '../src/shared/vox-production';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const source = '```json\n{"tool":"write_file","path":"index.html"}\n```\n```html\n<div>test-only mock</div>\n```';
const finish = '{"tool":"finish","notes":"检查收到的三个真实帧窗口，主体构图和文字位置一致，没有裁切；审美意见独立于技术检查。"}';
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'lemo-production-')); roots.push(root);
  const model = vi.fn<LemoAgentOptions['model']>(async request => {
    const text = [source, '{"tool":"review_frames"}', finish][(request.step - 1) % 3];
    return { text, raw: text, requestId: 'mock', finishReason: 'stop' };
  });
  const options = (d: EditorialCollagePipelineData, node: VoxProductionNode): LemoAgentOptions => ({ root: join(root, d.productionRun!.id), upstreamRoot: resolve('vendor/lemo-upstream'), turn: Number(node.fileId), requestId: node.requestId, retryOfRequestId: node.retryOfRequestId,
    maxTurns: lemoAgentMaxTurns(d.productionRun!.settings.agentMaxTurns),
    context: { runId: d.productionRun!.id, styleId: 'brick-toy', brief: d.sourceText ?? "", durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080 }, model,
    review: async (directory, outputDir, times) => {
      await mkdir(outputDir, { recursive: true });
      const frames = await Promise.all(times.map(async (time, i) => { const path = join(outputDir, i + '.png'); await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex')); return { time, path }; }));
      return { revision: LEMO_UPSTREAM_REVISION, entry: directory, durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false };
    } });
  const h = nativeHarness({ upstreamStep: async (d, n) => ({ ...d, upstreamFilm: await stepLemoUpstreamAgent(options(d, n)) }),
    recoverUpstreamStep: async (d, n) => { const film = await recoverLemoUpstreamAgentTurn(join(root, d.productionRun!.id), Number(n.fileId)); return film ? { ...d, upstreamFilm: film } : undefined; } });
  return { ...h, model, root, options };
}
describe('version 3 production scheduler (offline, not a generated film)', () => {
  it('extends one paid node per turn and isolates a new run from the old completed Agent', async () => {
    const h = await harness(); await h.start(); await h.idle();
    const first = h.get(); expect(first.productionRun?.status, first.productionRun?.message).toBe('completed');
    expect(first.productionRun?.authoringVersion).toBe(3); expect(h.model).toHaveBeenCalledTimes(3);
    expect(first.productionRun?.nodes.filter(n => n.kind === 'film-edit')).toHaveLength(3);
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed'); expect(h.model).toHaveBeenCalledTimes(6);
    expect(h.get().upstreamFilm?.directory).not.toBe(first.upstreamFilm?.directory);
    expect(await readFile(join(first.upstreamFilm!.directory, 'index.html'), 'utf8')).toContain('test-only');
    expect(h.errors).toEqual([]);
  });
  it('pauses after a round and resumes without buying a completed round again', async () => {
    const h = await harness(); let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), held = new Promise<void>(r => { release = r; });
    h.model.mockImplementationOnce(async () => { enter(); await held; return { text: source, raw: source, requestId: 'mock', finishReason: 'stop' }; });
    const run = await h.start(); await entered;
    await h.service.control({ id: h.get().id, runId: run.id, action: 'pause' }); release(); await h.idle();
    expect(h.get().productionRun?.status).toBe('paused'); expect(h.model).toHaveBeenCalledTimes(1);
    await h.service.control({ id: h.get().id, runId: run.id, action: 'resume' }); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed'); expect(h.model).toHaveBeenCalledTimes(3);
  });
  it('classifies an explicit rejection as retryable, but stops on an unknown request', async () => {
    const h = await harness(); h.model.mockRejectedValueOnce(new Error('LLM API error (400) at step 1 test: Bad Request'));
    const run = await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.kind === 'film-edit')?.status).toBe('failed');
    h.model.mockRejectedValueOnce(new Error('socket disconnected after submit'));
    await h.service.control({ id: h.get().id, runId: run.id, action: 'resume' }); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.kind === 'film-edit')?.status).toBe('unknown');
    await expect(h.service.control({ id: h.get().id, runId: run.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
    expect(h.model).toHaveBeenCalledTimes(2);
  });
  it('recovers a saved Agent turn when the scheduler checkpoint is missing', async () => {
    const h = await harness(); const original = h.runtime.execute; let crash = true;
    h.runtime.execute = async (d, n) => { const result = await original(d, n); if (n.kind === 'film-edit' && crash) { crash = false; throw new Error('simulated checkpoint crash'); } return result; };
    const run = await h.start(); await h.idle();
    // G-7: the saved Agent turn is recovered automatically; the paid turn is not bought again.
    expect(run.id).toBe(h.get().productionRun?.id);
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed'); expect(h.model).toHaveBeenCalledTimes(3);
  });
  it('never labels budget exhaustion as success', async () => {
    const h = await harness();
    h.model.mockImplementation(async () => ({ text: '{"tool":"list_files","scope":"project"}', raw: '', requestId: 'mock', finishReason: 'stop' }));
    await h.start(); await h.idle(); expect(h.model).toHaveBeenCalledTimes(LEMO_AGENT_MAX_TURNS);
    expect(h.get().productionRun?.status).toBe('failed'); expect(h.get().upstreamFilm?.status).toBe('authoring');
    expect(h.calls).not.toContain('render');
    // L-4: the default limit stops with the explicit, resumable limit code instead of a generic failure.
    expect(h.get().productionRun?.message).toMatch(/^LEMO_AGENT_TURN_LIMIT: Lemo Agent 已用完 64 \/ 64 轮/);
    expect(h.get().productionRun?.nodes.find(n => n.kind === 'film-finalize')?.status).toBe('failed');
  });
  it('honours a per-project turn limit, records usage and resumes after the limit is raised (L-4)', async () => {
    const h = await harness();
    h.model.mockImplementation(async () => ({ text: '{"tool":"list_files","scope":"project"}', raw: '', requestId: 'mock', finishReason: 'stop', usage: { prompt_tokens: 1000, completion_tokens: 50 } }));
    const run = await h.start(nativeSettings({ agentMaxTurns: 8 })); await h.idle();
    expect(h.model).toHaveBeenCalledTimes(8);
    const stopped = h.get();
    expect(stopped.productionRun?.status).toBe('failed');
    expect(stopped.productionRun?.message).toMatch(/^LEMO_AGENT_TURN_LIMIT: Lemo Agent 已用完 8 \/ 8 轮/);
    expect(summarizeErrorMessage(stopped.productionRun!.message!)).toContain('轮数上限');
    expect(stopped.upstreamFilm).toMatchObject({ turn: 8, status: 'authoring', usage: { inputTokens: 8000, outputTokens: 400, reportedTurns: 8 } });
    expect(lemoAgentProgressText(stopped.upstreamFilm, stopped.productionRun!.settings)).toBe('原生 Agent 第 8 / 8 轮 · 已用 8,400 tokens（输入 8,000 / 输出 400）');
    // The user raises the limit in project settings (saved, not started) and presses "重试失败步骤".
    h.set({ ...stopped, productionSettings: { ...stopped.productionSettings!, agentMaxTurns: 10 } });
    h.model.mockImplementation(async request => {
      const text = [source, '{"tool":"review_frames"}', finish][(request.step - 1) % 3];
      return { text, raw: text, requestId: 'mock', finishReason: 'stop' };
    });
    const resumed = await h.service.control({ id: h.get().id, runId: run.id, action: 'resume' });
    expect(resumed.id).toBe(run.id); expect(resumed.settings.agentMaxTurns).toBe(10);
    await h.idle();
    // Completed paid turns are reused; only turns 9 and 10 are bought.
    expect(h.model).toHaveBeenCalledTimes(10);
    expect(h.get().upstreamFilm?.turn).toBe(10);
    expect(h.get().productionRun?.message).toMatch(/LEMO_AGENT_TURN_LIMIT: Lemo Agent 已用完 10 \/ 10 轮/);
    expect(h.get().upstreamFilm?.usage?.reportedTurns).toBe(8);
  });
  it('stops on the optional token budget with its own resumable code (L-4)', async () => {
    const h = await harness();
    h.model.mockImplementation(async () => ({ text: '{"tool":"list_files","scope":"project"}', raw: '', requestId: 'mock', finishReason: 'stop', usage: { input_tokens: 40_000, output_tokens: 1_000, cache_read_input_tokens: 9_000 } }));
    await h.start(nativeSettings({ agentMaxTokens: 100_000 })); await h.idle();
    expect(h.model).toHaveBeenCalledTimes(2);
    expect(h.get().productionRun?.message).toMatch(/^LEMO_AGENT_TOKEN_LIMIT: Lemo Agent 已用 100,000 tokens，达到预算 100,000/);
    expect(summarizeErrorMessage(h.get().productionRun!.message!)).toContain('Token 预算');
  });
  it('keeps old projects and in-flight journals on the historical defaults (L-4)', () => {
    const legacy = voxProductionSettingsSchema.parse(nativeSettings());
    expect(legacy).not.toHaveProperty('agentMaxTurns'); expect(legacy).not.toHaveProperty('agentMaxTokens');
    expect(lemoAgentMaxTurns(legacy.agentMaxTurns)).toBe(LEMO_AGENT_MAX_TURNS); expect(lemoAgentMaxTokens(legacy.agentMaxTokens)).toBeUndefined();
    expect(() => voxProductionSettingsSchema.parse(nativeSettings({ agentMaxTurns: 4 }))).toThrow();
    expect(() => voxProductionSettingsSchema.parse(nativeSettings({ agentMaxTurns: 161 }))).toThrow();
    expect(() => voxProductionSettingsSchema.parse(nativeSettings({ agentMaxTokens: 10 }))).toThrow();
    // Old films without usage stay valid; turn counts up to the configurable maximum are accepted.
    const film = { version: 1, runId: 'r', styleId: 'brick-toy', directory: 'd', turn: 64, status: 'authoring', sourceHash: 'h', lastTool: 'x', message: '' };
    expect(lemoUpstreamFilmSchema.parse(film)).not.toHaveProperty('usage');
    expect(lemoUpstreamFilmSchema.parse({ ...film, turn: 160 }).turn).toBe(160);
    expect(lemoAgentBudgetExhausted(lemoUpstreamFilmSchema.parse(film), {})).toBe('turns');
    expect(lemoAgentBudgetExhausted({ ...lemoUpstreamFilmSchema.parse(film), status: 'ready' }, {})).toBeUndefined();
    expect(lemoUsageFromResponse(undefined)).toBeUndefined(); expect(lemoUsageFromResponse({ total_tokens: 5 })).toBeUndefined();
    expect(lemoUsageFromResponse({ prompt_tokens: 3, completion_tokens: 2 })).toEqual({ inputTokens: 3, outputTokens: 2 });
    const run = { settings: nativeSettings() } as Parameters<typeof lemoAgentBudgetResume>[0];
    expect(lemoAgentBudgetResume(run, undefined)).toBe(run);
    expect(lemoAgentBudgetResume(run, { agentMaxTurns: 96 }).settings.agentMaxTurns).toBe(96);
    expect(lemoAgentBudgetResume({ ...run, settings: { ...run.settings, agentMaxTokens: 100_000 } }, {}).settings).not.toHaveProperty('agentMaxTokens');
  });
  it('uses the native video with real subtitle windows and invalidates outputs on source changes', async () => {
    const h = await harness(); await h.start(); await h.idle(); const d = h.get();
    expect(() => buildDirectorRenderScenes(d)).toThrow('LEMO_PICTURE_REQUIRED');
    const scenes = buildDirectorRenderScenes(d, undefined, { upstreamVideoPath: 'fixture-only-native.mp4' });
    const last = d.timeline!.clips.at(-1)!;
    const selected = buildDirectorRenderScenes(d, undefined, { shotIds: [last.shotId], upstreamVideoPath: 'fixture-only-native.mp4' });
    expect(selected).toHaveLength(1); expect(selected[0].videoStartMs).toBe(last.startMs);
    expect(scenes).toHaveLength(d.timeline!.clips.length);
    scenes.forEach((scene, i) => {
      expect(scene.preserveSourcePicture).toBe(true);
      expect(scene.videoPath).toBe('fixture-only-native.mp4'); expect(scene.videoStartMs).toBe(d.timeline!.clips[i].startMs);
      expect(scene.transitionIn).toEqual({ type: 'cut', durationMs: 0 }); expect(scene.layers).toEqual([]); expect(scene.subtitleCues?.length).toBeGreaterThan(0);
    });
    const before = directorDocumentRenderFingerprint(d); d.upstreamFilm!.message = 'non-render progress';
    expect(directorDocumentRenderFingerprint(d)).toBe(before); d.upstreamFilm!.sourceHash = 'changed';
    expect(directorDocumentRenderFingerprint(d)).not.toBe(before);
  });
  it('offers a real skip for an unknown Agent illustration and passes it to the Agent turn (L-2b)', async () => {
    const seen: VoxProductionNode[] = [];
    const h = nativeHarness({ upstreamStep: async (_d, n) => { seen.push(structuredClone(n)); throw new Error(seen.length === 1 ? 'LEMO_IMAGE_REQUEST_UNKNOWN: Agent 申请的插画已提交但结果未知 (socket hang up)' : 'socket disconnected'); } });
    const run = await h.start(); await h.idle();
    const node = h.get().productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    expect(node.status).toBe('unknown');
    expect(summarizeErrorMessage(node.error!)).toBe('Agent 插画请求已发出但结果未知，可能已计费，不会自动重发');
    await h.service.control({ id: h.get().id, runId: run.id, action: 'skip-unknown-image', nodeId: node.id }); await h.idle();
    expect(seen[1]).toMatchObject({ id: node.id, skipImage: true, retryOfRequestId: node.requestId });
    // Skip is only offered for unknown illustration turns; other unknown steps keep retry/confirm only.
    await expect(h.service.control({ id: h.get().id, runId: run.id, action: 'skip-unknown-image', nodeId: node.id })).rejects.toThrow('VOX_PRODUCTION_STALE');
  });
  it('keeps earlier paid node hashes stable when later files change', async () => {
    const h = await harness(); await h.start(); await h.idle(); const d = h.get(); const n = d.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    const before = h.runtime.input(d, n); d.upstreamFilm!.sourceHash = 'later source'; d.upstreamFilm!.turn++;
    expect(h.runtime.input(d, n)).toEqual(before);
    const exhausted = { ...d, upstreamFilm: { ...d.upstreamFilm!, turn: LEMO_AGENT_MAX_TURNS, status: 'authoring' as const } };
    expect(buildLemoUpstreamNodes(exhausted, nativeSettings()).some(n => n.kind === 'film-finalize')).toBe(true);
    // L-4: the graph follows the per-run limit; budget fields never change a paid node's input hash.
    const turns = (settings: ReturnType<typeof nativeSettings>, turn: number) => buildLemoUpstreamNodes({ ...d, upstreamFilm: { ...d.upstreamFilm!, turn, status: 'authoring' as const } }, settings).filter(n => n.kind === 'film-edit').length;
    expect(turns(nativeSettings(), 63)).toBe(64); expect(turns(nativeSettings(), 64)).toBe(64);
    expect(turns(nativeSettings({ agentMaxTurns: 8 }), 8)).toBe(8); expect(turns(nativeSettings({ agentMaxTurns: 8 }), 12)).toBe(12);
    expect(turns(nativeSettings({ agentMaxTurns: 100 }), 64)).toBe(65);
    const budgeted = { ...d, productionRun: { ...d.productionRun!, settings: { ...d.productionRun!.settings, agentMaxTurns: 100, agentMaxTokens: 1_000_000 } } };
    for (const node of d.productionRun!.nodes) expect(h.runtime.input(budgeted, node)).toEqual(h.runtime.input(d, node));
  });
  it('marks new runs as material-channel runs and binds turn inputs to imported files', async () => {
    const h = await harness(); await h.start(); await h.idle(); const d = h.get();
    expect(d.productionRun?.assetChannel).toBe(1);
    const n = d.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    const before = JSON.stringify(h.runtime.input(d, n));
    const withArchive = { ...d, productionRun: { ...d.productionRun!, settings: { ...d.productionRun!.settings, archives: [{ assetVersionId: 'x', source: 's', license: 'l' }] } } };
    expect(JSON.stringify(h.runtime.input(withArchive, n))).not.toBe(before);
    const legacy = { ...d, productionRun: { ...d.productionRun!, assetChannel: undefined } };
    expect(h.runtime.input(legacy, n)).not.toHaveProperty('archives');
  });
  it('builds the material context: ordered ids, file hashes, provider and host checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-material-')); roots.push(root);
    const photo = join(root, 'p.jpg'); await writeFile(photo, 'photo');
    const doc = (settings: Record<string, unknown>, assets: unknown[] = []) => ({ assets, productionRun: { settings: { presetId: 'paper-explainer', authoring: { mode: 'ai-code', styleId: 'brick-toy' }, archives: [], ...settings } } }) as unknown as EditorialCollagePipelineData;
    const media = { probe: vi.fn(), frames: vi.fn(), thumbnail: vi.fn() };
    const empty = await lemoMaterialContext(doc({}), undefined);
    expect(empty).toEqual({ context: {}, assetHost: undefined, images: undefined });
    const archived = doc({ archives: [{ assetVersionId: 'img', source: '馆藏', license: 'CC0', description: '码头' }] }, [{ id: 'img', assetId: 'img', kind: 'image', localPath: photo, prompt: 'p.jpg' }]);
    const material = await lemoMaterialContext(archived, { media: async () => media });
    expect(material.context.assets).toEqual([expect.objectContaining({ id: 'a01', kind: 'image', description: '码头', source: '馆藏', license: 'CC0' })]);
    expect(material.assetHost?.files).toEqual({ a01: photo });
    await expect(lemoMaterialContext(archived, undefined)).rejects.toThrow('LEMO_ASSET_CHANNEL');
    await expect(lemoMaterialContext(doc({ agentImages: { enabled: true, maxImages: 3 } }), { media: async () => media })).rejects.toThrow('LEMO_IMAGE_PROVIDER');
    await expect(lemoMaterialContext(doc({ agentImages: { enabled: true, maxImages: 3 }, authoring: { mode: 'ai-code', styleId: 'newsreel' } }), { media: async () => media })).rejects.toThrow('LEMO_IMAGE_DENIED');
    const images = { provider: 'p', generate: vi.fn(), isRejection: () => false };
    expect((await lemoMaterialContext(doc({ agentImages: { enabled: true, maxImages: 3 } }), { media: async () => media, images })).context).toEqual({ imageGeneration: { maxImages: 3 } });
    await rm(photo);
    await expect(lemoMaterialContext(archived, { media: async () => media })).rejects.toThrow('LEMO_ASSET_MISSING');
  });
});

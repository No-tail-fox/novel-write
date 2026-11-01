import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeHarness, nativeSettings } from './lemo-native.fixture';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { buildLemoUpstreamNodes } from '../src/shared/lemo-upstream-graph';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { LEMO_AGENT_MAX_TURNS } from '../src/shared/creative-animation/upstream-agent';
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
    const run = await h.start(); await h.idle(); expect(h.model).toHaveBeenCalledTimes(1);
    await h.service.control({ id: h.get().id, runId: run.id, action: 'reconcile' });
    expect(h.get().upstreamFilm?.turn).toBe(1);
    await h.service.control({ id: h.get().id, runId: run.id, action: 'resume' }); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed'); expect(h.model).toHaveBeenCalledTimes(3);
  });
  it('never labels budget exhaustion as success', async () => {
    const h = await harness();
    h.model.mockImplementation(async () => ({ text: '{"tool":"list_files","scope":"project"}', raw: '', requestId: 'mock', finishReason: 'stop' }));
    await h.start(); await h.idle(); expect(h.model).toHaveBeenCalledTimes(LEMO_AGENT_MAX_TURNS);
    expect(h.get().productionRun?.status).toBe('failed'); expect(h.get().upstreamFilm?.status).toBe('authoring');
    expect(h.calls).not.toContain('render');
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
  it('keeps earlier paid node hashes stable when later files change', async () => {
    const h = await harness(); await h.start(); await h.idle(); const d = h.get(); const n = d.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    const before = h.runtime.input(d, n); d.upstreamFilm!.sourceHash = 'later source'; d.upstreamFilm!.turn++;
    expect(h.runtime.input(d, n)).toEqual(before);
    const exhausted = { ...d, upstreamFilm: { ...d.upstreamFilm!, turn: LEMO_AGENT_MAX_TURNS, status: 'authoring' as const } };
    expect(buildLemoUpstreamNodes(exhausted, nativeSettings()).some(n => n.kind === 'film-finalize')).toBe(true);
  });
});

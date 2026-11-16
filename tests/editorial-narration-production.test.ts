import { installNativeCanvasTextTracker } from '../src/shared/creative-animation/native-canvas-text-tracker';
import { installNativeCanvasStateGuard } from '../src/shared/creative-animation/native-canvas-state';
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeDocument, nativePictureDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { VoxProductionService } from '../electron/vox-production-service';
import { buildVoxProductionNodes, voxProductionSettings } from '../src/shared/vox-production';
import { fitEditorialNarrationTiming, prepareEditorialNarrationForRender } from '../src/shared/editorial-narration-timing';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import type { VoxProductionOperations } from '../electron/vox-production-runtime';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
describe('durable automatic narration repair', () => {
  it.each(['after-voice', 'after-timing', 'before-save'])('continues Vox at %s without repeating paid generation', async stage => {
    const directory = await mkdtemp(join(tmpdir(), 'vox-narration-repair-'));
    const entered = deferred(), release = deferred();
    try {
      const path = join(directory, 'saved-media.wav'); await writeFile(path, 'local saved media fixture');
      const initial = nativeDocument();
      const originalShots = initial.beats.flatMap(b => b.shots);
      const speech = vi.fn<VoxProductionOperations['speech']>(async (input, requestId) => ({ durationMs: 17000, record: { id: requestId, text: input.text, provider: input.provider, voiceId: input.voiceId, voiceLabel: input.voiceLabel, speed: input.speed, audioPath: path, status: 'generated', errorMessage: '', createdAt: initial.createdAt, finishedAt: initial.createdAt } }));
      const image = vi.fn<VoxProductionOperations['image']>(async (input, requestId) => ({ id: requestId, prompt: input.prompt, ratio: input.ratio, style: '', provider: 'gpt_image', imagePath: path, status: 'generated', errorMessage: '', resolution: '1K', smartMode: 'text-to-image', referenceImagePaths: [], referenceImagePath: '', upstreamTaskId: null, createdAt: initial.createdAt, finishedAt: initial.createdAt }));
      const plan = vi.fn(async () => ({ shots: originalShots.map(s => ({ id: s.id, title: '城市热岛', scenePrompt: 'Continuous urban street and tree shade' })) }));
      const h = nativeHarness({ plan, image, speech, cutout: async () => ({ outputPath: path, metadata: { method: 'green-key', quality: 'passed', transparentFraction: .6, foregroundFraction: .4, edgeFraction: .05 } }) }, initial);
      const execute = h.runtime.execute, save = h.store.save;
      let gated = false, saveInterrupted = false;
      h.runtime.execute = async (d, n) => {
        if (n.kind === 'timing') {
          const voice = d.productionRun!.nodes.find(v => v.id === 'voice:' + n.shotId);
          if (voice) {
            expect(voice.status).toBe('completed');
            const saved = h.get(), shot = saved.beats.flatMap(b => b.shots).find(s => s.id === n.shotId)!;
            expect(saved.assets.find(a => a.id === shot.voiceAssetVersionId)?.durationMs).toBe(17000);
          }
        }
        const next = await execute(d, n);
        if (!gated && (stage === 'after-voice' && n.kind === 'voice' || stage === 'after-timing' && n.kind === 'timing')) { gated = true; entered.resolve(); await release.promise; }
        return next;
      };
      h.store.save = async d => {
        if (stage === 'before-save' && !saveInterrupted && d.beats.flatMap(b => b.shots).length > originalShots.length && d.productionRun?.nodes.some(n => n.kind === 'timing' && n.status === 'completed')) {
          saveInterrupted = true; throw new Error('local save interrupted after repair checkpoint');
        }
        return save(d);
      };
      const run = await h.start(voxProductionSettings());
      if (stage !== 'before-save') {
        await Promise.race([entered.promise, h.idle().then(() => { throw new Error(h.get().productionRun?.message ?? 'did not enter repair phase'); })]);
        await h.service.control({ id: initial.id, runId: run.id, action: 'pause' }); release.resolve();
      }
      await h.idle();
      const paused = h.get(); expect(paused.productionRun?.status).toBe(stage === 'before-save' ? 'failed' : 'paused');
      const successful = paused.productionRun!.nodes.filter(n => n.paid && n.status === 'completed').map(n => n.requestId);
      const restarted = new VoxProductionService(h.store, async () => h.runtime, error => h.errors.push(error));
      await restarted.restore();
      await restarted.control({ id: initial.id, runId: run.id, action: 'resume' }); await restarted.idle(initial.id);
      const result = h.get(), nodes = result.productionRun!.nodes;
      expect(result.productionRun, result.productionRun?.message).toMatchObject({ status: 'completed' });
      expect(result.beats.flatMap(b => b.shots)).toHaveLength(originalShots.length * 2);
      expect(nodes.filter(n => n.kind === 'voice')).toHaveLength(originalShots.length);
      expect(speech).toHaveBeenCalledTimes(originalShots.length);
      expect(image).toHaveBeenCalledTimes(originalShots.flatMap(s => s.layers.filter(l => l.visible !== false && !l.content)).length);
      expect(plan).toHaveBeenCalledOnce();
      expect(successful.every(id => nodes.some(n => n.requestId === id && n.status === 'completed'))).toBe(true);
      expect(nodes.every(n => n.attempt === 1 || stage === 'before-save' && n.kind === 'timing' && n.attempt === 2)).toBe(true);
      expect(nodes.flatMap(n => n.dependencies).every(id => nodes.some(n => n.id === id))).toBe(true);
      for (const shot of originalShots) {
        const assetId = result.beats.flatMap(b => b.shots).find(s => s.id === shot.id)!.voiceAssetVersionId;
        expect(result.timeline!.audioClips!.filter(c => c.assetVersionId === assetId && c.trackType === 'narration').reduce((ms,c) => ms+c.sourceDurationMs!,0)).toBe(17000);
      }

      expect(h.errors).toEqual([]);
    } finally { release.resolve(); await rm(directory, { recursive: true, force: true }); }
  });

  it.each([4000, 17000])('exports an existing native film with %i ms measured speech without rewriting its source', async measured => {
    const source = nativePictureDocument();
    const parent = source.beats[0].shots[0], original = parent.animation!.native!;
    const filmSource = source.creativeFilms!.map(f => f.source);
    source.assets.push({ id: 'old-voice', assetId: 'old-voice', kind: 'audio', localPath: 'I:/fixture/old.wav', createdAt: source.createdAt });
    parent.voiceAssetVersionId = 'old-voice';
    const repaired = await prepareEditorialNarrationForRender(source, async () => measured);
    expect(parseEditorialCollagePipelineData(repaired)).toEqual(repaired);
    expect(repaired.creativeFilms!.map(f => f.source)).toEqual(filmSource);
    const scenes = buildDirectorRenderScenes(repaired);
    const ids = new Set(repaired.beats[0].shots.map(s => s.id));
    const parts = scenes.filter(s => ids.has(s.id));
    expect(parts).toHaveLength(measured > 15000 ? 2 : 1);
    expect(parts.reduce((ms,s) => ms + s.animation!.native!.sourceDurationMs!, 0)).toBeCloseTo(original.durationMs);
    const code = await transform(await readFile('src/features/vox-animation/lemo-native-runtime.ts', 'utf8'), { loader: 'ts', format: 'cjs' });
    let cursor = original.startMs;
    for (const scene of parts) {
      const native = scene.animation!.native!;
      expect(native.startMs).toBeCloseTo(cursor);
      expect(native.durationMs).toBe(scene.durationMs);
      const render = vi.fn();
      const window: { addEventListener: () => void; render: typeof render; LemoHost?: { install(input: unknown): void }; __tl?: { seek(seconds: number): Promise<void> } } = { addEventListener() {}, render };
      runInNewContext(code.code, {
        window, exports: {}, module: { exports: {} }, require: (id: string) => { if (id.endsWith('native-canvas-state')) return { installNativeCanvasStateGuard }; if (id.endsWith('native-canvas-text-tracker')) return { installNativeCanvasTextTracker }; if (id === 'three' || id.endsWith('lemo-native-core/lib.js')) return {}; throw new Error('Unmapped VM import: ' + id); },
        document: { fonts: { ready: Promise.resolve() }, images: [] },
        parent: { postMessage() {} }, CanvasRenderingContext2D: class { fillText() {} strokeText() {} save() {} restore() {} },
        requestAnimationFrame: (callback: (time: number) => void) => { queueMicrotask(() => callback(0)); return 1; },
      });
      window.LemoHost!.install({ animation: scene.animation, durationMs: scene.durationMs, cues: [] });
      for (const fraction of [0, .75, .25, 1, 0]) {
        await window.__tl!.seek(scene.durationMs / 1000 * fraction);
        expect(render).toHaveBeenLastCalledWith(expect.closeTo((native.startMs + native.sourceDurationMs! * fraction) / 1000, 5));
      }
      cursor += native.sourceDurationMs!;
    }
    expect(cursor).toBeCloseTo(original.startMs + original.durationMs);
  });

  it('inherits edit locks and has no missing timing dependencies in v3', () => {
    const d = nativeDocument(), parent = d.beats[0].shots[0];
    d.assets.push({ id: 'long-voice', assetId: 'long-voice', kind: 'audio', durationMs: 17000, createdAt: d.createdAt }); parent.voiceAssetVersionId = 'long-voice';
    const repaired = fitEditorialNarrationTiming(d), settings = nativeSettings({ narration: true, lockedShotIds: [parent.id] });
    const nodes = buildVoxProductionNodes(repaired, settings, LEMO_NATIVE_ENGINE, 3);
    const continuations = repaired.beats.flatMap(b => b.shots).filter(s => s.narrationSplit?.sourceShotId === parent.id);
    expect(continuations).toHaveLength(2);
    expect(nodes.filter(n => n.kind === 'voice').every(n => !continuations.some(s => s.id === n.shotId))).toBe(true);
    for (const shot of continuations) {
      expect(nodes.find(n => n.id === 'timing:' + shot.id)?.dependencies).toEqual(shot.id === parent.id ? [] : ['timing:' + parent.id]);
    }
    expect(nodes.filter(n => n.kind === 'compile' && continuations.some(s => s.id === n.shotId)).every(n => !n.dependencies.length)).toBe(true);
    expect(nodes.flatMap(n => n.dependencies).every(id => nodes.some(n => n.id === id))).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeDocument, nativePictureDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { stepLemoUpstreamAgent, recoverLemoUpstreamAgentTurn, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { assertLemoLockedShotsRenderable, lemoProductionContext } from '../electron/lemo-upstream-production';
import { buildLemoUpstreamNodes } from '../src/shared/lemo-upstream-graph';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { allocateHtmlVideoSceneFrameCounts } from '../src/shared/html-video';
import { allocateLemoWindowFrames, lemoLockedPictureShotIds, lemoReservedWindows, lemoReservedWindowsBrief, lemoSplicePlan } from '../src/shared/lemo-locked-shots';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';
import type { VoxProductionNode, VoxProductionSettings } from '../src/shared/vox-production';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** Minimal shape for the pure planner: shots in order plus their timeline starts. */
function timelineDoc(durations: number[], locked: string[] = [], authoringVersion?: 3) {
  let at = 0;
  const shots = durations.map((durationMs, i) => ({ id: 's' + i, durationMs, subtitleCueIds: [] }));
  const clips = shots.map(shot => { const clip = { shotId: shot.id, startMs: at }; at += shot.durationMs; return clip; });
  return { workflowKind: 'editorial-collage', beats: [{ shots }], timeline: { clips, durationMs: at },
    productionRun: { authoringVersion, settings: { lockedShotIds: locked } } } as unknown as EditorialCollagePipelineData;
}

describe('L-3 locked-shot window plan (pure, 24 fps)', () => {
  it('allocates frame-exact windows with the compositor arithmetic', () => {
    // 1.001 s → 24.024 → 24; 2.043 s → 49.032 → 49; 4.126 s → 99.024 → 99; 5.626 s → 135.024 → 135.
    expect(allocateLemoWindowFrames([1001, 1042, 2083, 1500])).toEqual([24, 25, 50, 36]);
    for (const durations of [[1001, 1042, 2083, 1500], [333, 334, 333, 4170, 41.7], [15000], [2500, 2500, 2500, 7500]]) {
      expect(allocateLemoWindowFrames(durations)).toEqual(allocateHtmlVideoSceneFrameCounts(durations.map(ms => ms / 1000), 24));
    }
    const plan = lemoSplicePlan(timelineDoc([1001, 1042, 2083, 1500], ['s1', 's3']));
    expect(plan).toMatchObject({ fps: 24, totalFrames: 135, durationMs: 5626 });
    expect(plan.segments.map(s => [s.shotId, s.source, s.startFrame, s.frameCount])).toEqual([
      ['s0', 'agent', 0, 24], ['s1', 'locked', 24, 25], ['s2', 'agent', 49, 50], ['s3', 'locked', 99, 36]]);
    // Splicing never changes the frame budget: the same plan without locks has identical windows.
    expect(lemoSplicePlan(timelineDoc([1001, 1042, 2083, 1500])).segments.map(s => [s.startFrame, s.frameCount]))
      .toEqual(plan.segments.map(s => [s.startFrame, s.frameCount]));
    expect(lemoReservedWindows(timelineDoc([1001, 1042, 2083, 1500], ['s1']))).toEqual([{ shotId: 's1', startMs: 1001, endMs: 2043, frames: [24, 49] }]);
  });
  it('inherits a lock through narration continuations and stays empty without locks', () => {
    const d = timelineDoc([1000, 1000, 1000], ['s0']);
    (d.beats[0].shots[1] as { narrationSplit?: unknown }).narrationSplit = { sourceShotId: 's0', sourceStartMs: 1000 };
    expect(lemoReservedWindows(d)?.map(w => w.shotId)).toEqual(['s0', 's1']);
    expect(lemoReservedWindows(timelineDoc([1000, 1000]))).toBeUndefined();
    expect(lemoReservedWindowsBrief(timelineDoc([1000, 1000]))).toBeUndefined();
    expect(lemoLockedPictureShotIds(timelineDoc([1000], ['s0']))).toEqual(new Set());
    expect(lemoLockedPictureShotIds(timelineDoc([1000], ['s0'], 3))).toEqual(new Set(['s0']));
  });
});

describe('L-3 runs without locks keep historical graphs, contexts and hashes', () => {
  it('builds the identical v3 graph and Agent brief when nothing is locked', () => {
    const d = nativeDocument(), settings = nativeSettings({ narration: true });
    const shots = d.beats.flatMap(b => b.shots);
    const expected = shots.flatMap(shot => {
      const text = d.beats.flatMap(b => b.subtitleCues).filter(c => shot.subtitleCueIds.includes(c.id)).map(c => c.text).join(' ');
      const voice = /[\p{L}\p{N}]/u.test(text) && !shot.narrationSplit;
      return [...(voice ? [['voice:' + shot.id, []]] : []), ['timing:' + shot.id, voice ? ['voice:' + shot.id] : []]];
    });
    expect(buildLemoUpstreamNodes(d, settings).map(n => [n.id, n.dependencies])).toEqual([...expected,
      ['upstream-turn:1', shots.map(s => 'timing:' + s.id)], ['upstream-ready', ['upstream-turn:1']], ['render', ['upstream-ready']], ['verify', ['render']]]);
    const run = { ...d, productionRun: { id: 'run-1', settings } } as unknown as EditorialCollagePipelineData;
    const { brief } = lemoProductionContext(run);
    // The exact pre-L-3 brief formula.
    expect(brief).toBe([d.title, d.sourceText, settings.authoring?.brief ?? '',
      'Approved narration and absolute timeline in milliseconds; keep the wording and respect all cue windows:',
      JSON.stringify({ cues: d.beats.flatMap(b => b.subtitleCues), shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: s.title, direction: s.scenePrompt, durationMs: s.durationMs, startMs: d.timeline?.clips.find(c => c.shotId === s.id)?.startMs }))) }),
      'Sourced facts (do not invent data): ' + JSON.stringify(settings.data),
      'Imported archive descriptions (do not invent evidence or unavailable media): ' + JSON.stringify(settings.archives)].join('\n'));
    const locked = lemoProductionContext({ ...run, productionRun: { ...run.productionRun!, settings: { ...settings, lockedShotIds: [shots[1].id] } } });
    expect(locked.brief.startsWith(brief + '\n')).toBe(true);
    expect(locked.brief).toContain('Reserved locked-shot windows');
    expect(locked.brief).toContain(`"shotId":"${shots[1].id}"`);
  });
  it('adds no voice for a locked shot and gates it with a local compile node', () => {
    const d = nativeDocument(), shots = d.beats.flatMap(b => b.shots), target = shots[0];
    const nodes = buildLemoUpstreamNodes(d, nativeSettings({ narration: true, lockedShotIds: [target.id] }));
    expect(nodes.some(n => n.id === 'voice:' + target.id)).toBe(false);
    expect(nodes.find(n => n.id === 'compile:' + target.id)).toMatchObject({ kind: 'compile', shotId: target.id, dependencies: [], paid: false });
    expect(nodes.find(n => n.id === 'render')!.dependencies).toEqual(['upstream-ready', 'compile:' + target.id]);
  });
});

const source = '```json\n{"tool":"write_file","path":"index.html"}\n```\n```html\n<div>test-only mock</div>\n```';
const finish = '{"tool":"finish","notes":"检查收到的三个真实帧窗口，主体构图和文字位置一致，没有裁切；审美意见独立于技术检查。"}';
async function upstreamHarness(initial: EditorialCollagePipelineData, preflight?: (d: EditorialCollagePipelineData, s: VoxProductionSettings, pending?: VoxProductionNode[]) => void) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-locked-')); roots.push(root);
  const model = vi.fn<LemoAgentOptions['model']>(async request => {
    const text = [source, '{"tool":"review_frames"}', finish][(request.step - 1) % 3];
    return { text, raw: text, requestId: 'mock', finishReason: 'stop' };
  });
  const options = (d: EditorialCollagePipelineData, node: VoxProductionNode): LemoAgentOptions => ({ root: join(root, d.productionRun!.id), upstreamRoot: resolve('vendor/lemo-upstream'), turn: Number(node.fileId), requestId: node.requestId,
    context: { runId: d.productionRun!.id, styleId: 'brick-toy', brief: d.sourceText ?? '', durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080 }, model,
    review: async (directory, outputDir, times) => {
      await mkdir(outputDir, { recursive: true });
      const frames = await Promise.all(times.map(async (time, i) => { const path = join(outputDir, i + '.png'); await writeFile(path, Buffer.from('89504e470d0a1a0a', 'hex')); return { time, path }; }));
      return { revision: LEMO_UPSTREAM_REVISION, entry: directory, durationSeconds: d.timeline!.durationMs / 1000, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false };
    } });
  return nativeHarness({ upstreamStep: async (d, n) => ({ ...d, upstreamFilm: await stepLemoUpstreamAgent(options(d, n)) }),
    recoverUpstreamStep: async (d, n) => { const film = await recoverLemoUpstreamAgentTurn(join(root, d.productionRun!.id), Number(n.fileId)); return film ? { ...d, upstreamFilm: film } : undefined; },
    ...(preflight ? { preflight } : {}) }, initial);
}
/** The same rule main.ts applies before claiming any paid step. */
const mainPreflight = (d: EditorialCollagePipelineData, s: VoxProductionSettings, pending?: VoxProductionNode[]) => {
  const upstream = (pending ?? []).some(n => n.id.startsWith('upstream-turn:')) || d.productionRun?.authoringVersion === 3;
  if (upstream && s.lockedShotIds.length) assertLemoLockedShotsRenderable(d, s);
};
const producedNativeDocument = nativePictureDocument;

describe('L-3 preflight: no blanket refusal; unrenderable locks fail early', () => {
  it('main.ts calls the renderability check instead of refusing every locked v3 run', async () => {
    const main = await readFile(resolve(__dirname, '..', 'electron', 'main.ts'), 'utf8');
    expect(main).not.toContain('LEMO_LOCKED_SHOTS:');
    expect(main).toContain('if ((upstream || usePi) && settings.lockedShotIds.length) assertLemoLockedShotsRenderable(document, settings);');
  });
  it('rejects a locked shot that has no per-shot picture with LEMO_LOCKED_SHOT_UNRENDERABLE before any paid step', async () => {
    const d = nativeDocument(), target = d.beats[0].shots[0];
    expect(() => assertLemoLockedShotsRenderable(d, nativeSettings({ lockedShotIds: [target.id] }))).toThrow(/^LEMO_LOCKED_SHOT_UNRENDERABLE: .*镜头 1/);
    expect(() => assertLemoLockedShotsRenderable(d, nativeSettings())).not.toThrow();
    const h = await upstreamHarness(d, mainPreflight);
    await expect(h.start(nativeSettings({ lockedShotIds: [target.id] }))).rejects.toThrow('LEMO_LOCKED_SHOT_UNRENDERABLE');
    expect(h.get().productionRun).toBeUndefined(); expect(h.calls).toEqual([]);
  });
  it('rejects a locked native shot whose frame rate would change the 24 fps film clock', async () => {
    const produced = await producedNativeDocument(), target = produced.beats[0].shots[0];
    expect(() => assertLemoLockedShotsRenderable(produced, nativeSettings({ lockedShotIds: [target.id] }))).not.toThrow();
    const fast = structuredClone(produced); fast.creativeFilms!.forEach(film => { film.fps = 30; });
    expect(() => assertLemoLockedShotsRenderable(fast, nativeSettings({ lockedShotIds: [target.id] }))).toThrow(/LEMO_LOCKED_SHOT_UNRENDERABLE: .*24 fps/);
  });
});

describe('L-3 mixed v3 run (offline scheduler, mocked Agent; not a generated film)', () => {
  it('keeps the locked shot, renders it by its own path and splices it into the Agent picture on exact windows', async () => {
    const produced = await producedNativeDocument(), locked = produced.beats[0].shots[0];
    const h = await upstreamHarness(produced, mainPreflight);
    const settings = nativeSettings({ lockedShotIds: [locked.id] });
    await h.start(settings); await h.idle();
    const d = h.get();
    expect(d.productionRun?.status, d.productionRun?.message).toBe('completed');
    expect(d.productionRun?.authoringVersion).toBe(3);
    expect(d.beats[0].shots[0]).toEqual(locked);
    expect(d.productionRun!.nodes.find(n => n.id === 'compile:' + locked.id)?.status).toBe('completed');
    expect(h.calls).toContain('compile');
    // The paid turn input binds the reserved windows only because this run has locks.
    const turn = d.productionRun!.nodes.find(n => n.kind === 'film-edit')!;
    expect(h.runtime.input(d, turn)).toMatchObject({ reserved: lemoReservedWindows(d) });
    const unlocked = { ...d, productionRun: { ...d.productionRun!, settings: { ...d.productionRun!.settings, lockedShotIds: [] } } };
    expect(h.runtime.input(unlocked, turn)).not.toHaveProperty('reserved');
    expect(directorDocumentRenderFingerprint(unlocked)).not.toBe(directorDocumentRenderFingerprint(d));
    expect(directorDocumentRenderFingerprint(unlocked)).toBe(directorDocumentRenderFingerprint({ ...unlocked, productionRun: { ...unlocked.productionRun!, authoringVersion: undefined } }));

    const scenes = buildDirectorRenderScenes(d, undefined, { upstreamVideoPath: 'fixture-only-native.mp4' });
    const plan = lemoSplicePlan(d);
    expect(scenes.map(s => s.id)).toEqual(plan.segments.map(s => s.shotId));
    expect(plan.segments.filter(s => s.source === 'locked').map(s => s.shotId)).toEqual([locked.id]);
    expect(plan.segments.filter(s => s.source === 'agent').length).toBeGreaterThan(0);
    scenes.forEach((scene, i) => {
      expect(scene.durationMs).toBe(plan.segments[i].durationMs);
      expect(scene.transitionIn).toEqual({ type: 'cut', durationMs: 0 });
      if (plan.segments[i].source === 'locked') {
        expect(scene.renderStrategy).toBe('remotion'); expect(scene.animation?.code.engine).toBe('lemo-native'); expect(scene.videoPath).toBeUndefined();
      } else {
        expect(scene).toMatchObject({ renderStrategy: 'living-poster', preserveSourcePicture: true, videoPath: 'fixture-only-native.mp4', videoStartMs: plan.segments[i].startMs });
      }
    });
    expect(scenes.reduce((sum, s) => sum + s.durationMs, 0)).toBe(d.timeline!.durationMs);
    expect(allocateHtmlVideoSceneFrameCounts(scenes.map(s => s.durationMs / 1000), 24)).toEqual(plan.segments.map(s => s.frameCount));
    // Per-shot checks may render a locked shot alone; Agent-owned shots still require the verified film picture.
    expect(buildDirectorRenderScenes(d, undefined, { shotIds: [locked.id] })).toHaveLength(1);
    expect(() => buildDirectorRenderScenes(d)).toThrow('LEMO_PICTURE_REQUIRED');
    expect(() => buildDirectorRenderScenes(d, undefined, { shotIds: [d.beats.flatMap(b => b.shots)[1].id] })).toThrow('LEMO_PICTURE_REQUIRED');
  });
});

const pythonRoot = resolve(__dirname, '..', 'vendor', 'python');
const binaries = join(pythonRoot, 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
const ffmpeg = existsSync(binaries) ? readdirSync(binaries).filter(name => /^ffmpeg.*\.exe$/i.test(name)).sort().map(name => join(binaries, name)).pop() : undefined;
function run(args: string[]) {
  const result = spawnSync(ffmpeg!, ['-hide_banner', '-y', ...args], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('ffmpeg failed: ' + result.stderr.toString());
  return result;
}
describe.skipIf(!(process.platform === 'win32' && ffmpeg))('L-3 splice windows with real ffmpeg (vendor imageio_ffmpeg)', () => {
  it('per-window segments of the planned frame counts concatenate into the exact Agent frame budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-splice-')); roots.push(root);
    const plan = lemoSplicePlan(timelineDoc([1001, 1042, 2083, 1500], ['s1', 's3']));
    const list: string[] = [];
    for (const [i, segment] of plan.segments.entries()) {
      const path = join(root, `w${i}.mp4`); list.push(`file '${path.replaceAll('\\', '/')}'`);
      // Agent windows are blue, locked windows red; every segment is encoded alone like a compositor scene.
      run(['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${segment.source === 'locked' ? 'red' : 'blue'}:s=64x36:r=24`, '-frames:v', String(segment.frameCount),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1', path]);
    }
    await writeFile(join(root, 'list.txt'), list.join('\n'), 'utf8');
    const out = join(root, 'spliced.mp4');
    run(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(root, 'list.txt'), '-c', 'copy', out]);
    const counted = run(['-i', out, '-map', '0:v', '-f', 'null', '-']).stderr.toString();
    expect(Number([...counted.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1])).toBe(plan.totalFrames);
    const red = (frame: number) => {
      const pixel = run(['-loglevel', 'error', '-i', out, '-vf', `select=eq(n\\,${frame}),scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']).stdout;
      return pixel[0] > 150 && pixel[2] < 100;
    };
    for (const segment of plan.segments) {
      const first = segment.startFrame, last = segment.startFrame + segment.frameCount - 1;
      expect([red(first), red(last)]).toEqual(segment.source === 'locked' ? [true, true] : [false, false]);
    }
  }, 120_000);
});

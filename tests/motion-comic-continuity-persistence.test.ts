import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { RawFrame } from '../src/shared/frame-hash';
import {
  buildMotionComicShotContinuityAdvice,
  currentMotionComicShotContinuityAdvice,
  motionComicContinuityBadgeText,
  motionComicContinuityLevel,
  motionComicPreviousShot,
  motionComicShotContinuityAdviceSchema,
  type MotionComicShotContinuityAdvice,
} from '../src/shared/motion-comic-continuity';
import {
  createMotionComicDraft,
  createMotionComicStarterProject,
  parseMotionComicPipelineData,
  type MotionComicPipelineData,
} from '../src/shared/motion-comic';
import { DirectorContinuityBadge } from '../src/features/director-desk/DirectorContinuityBadge';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { resolveFinalFilmFfmpeg } from '../electron/final-film-gate-runner';
import { continuityFrameArgs, rawFrameFromDump, sampleMotionComicCutFrames } from '../electron/motion-comic-continuity-probe';

vi.mock('../src/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ui')>(),
  Drawer: ({ children }: { children: ReactNode }) => createElement('aside', { 'data-ssr-inspector': true }, children),
}));

function frame(paint: (x: number, y: number) => number, size = 32): RawFrame {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const value = paint(x, y);
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  return { data, width: size, height: size };
}

const leftBright = frame((x) => (x < 16 ? 220 : 30));
const topBright = frame((_x, y) => (y < 16 ? 220 : 30));
const now = '2026-11-10T00:00:00.000Z';
const binaries = await resolveFinalFilmFfmpeg({ ffprobePath: null, pythonRoot: join(process.cwd(), 'vendor', 'python') }).catch(() => null);

function project(): MotionComicPipelineData {
  return createMotionComicStarterProject(createMotionComicDraft({ id: 'continuity', title: '衔接', premise: '雨夜来信。', ratio: '9:16', now }), '第一集', now);
}

function advice(overrides: Partial<MotionComicShotContinuityAdvice> = {}): MotionComicShotContinuityAdvice {
  return { ...buildMotionComicShotContinuityAdvice({
    previousLastFrame: leftBright, firstFrame: leftBright,
    videoAssetVersionId: 'video-2', previousShotId: 'shot-1', previousVideoAssetVersionId: 'video-1', computedAt: now,
  }), ...overrides };
}

describe('motion-comic continuity advice persistence (C-2)', () => {
  it('scores a cut into an advisory three-level record', () => {
    const same = advice();
    expect(same).toMatchObject({ version: 1, advisory: true, method: 'perceptual-hash', score: 1, level: 'good', ahashDistance: 0, dhashDistance: 0 });
    const jump = buildMotionComicShotContinuityAdvice({
      previousLastFrame: leftBright, firstFrame: topBright,
      videoAssetVersionId: 'video-2', previousShotId: 'shot-1', previousVideoAssetVersionId: 'video-1', computedAt: now,
    });
    expect(jump.level).toBe('jump');
    expect(jump.score).toBeLessThan(0.6);
    expect([motionComicContinuityLevel(0.75), motionComicContinuityLevel(0.7), motionComicContinuityLevel(0.59), motionComicContinuityLevel(Number.NaN)])
      .toEqual(['good', 'fair', 'jump', 'jump']);
    expect(['good', 'fair', 'jump'].map((level) => motionComicContinuityBadgeText(level as 'good')))
      .toEqual(['衔接：好（仅供参考）', '衔接：一般（仅供参考）', '衔接：跳变（仅供参考）']);
  });

  it('round-trips the optional field and leaves old documents untouched', () => {
    const original = project();
    const serializedOld = JSON.parse(JSON.stringify(original));
    const parsedOld = parseMotionComicPipelineData(serializedOld);
    expect(parsedOld).toEqual(parseMotionComicPipelineData(JSON.parse(JSON.stringify(original))));
    const oldShots = parsedOld.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
    expect(oldShots.length).toBeGreaterThan(1);
    expect(oldShots.every((shot) => !('continuityAdvice' in shot))).toBe(true);
    expect(JSON.stringify(parsedOld)).not.toContain('continuityAdvice');

    const withAdvice = JSON.parse(JSON.stringify(original)) as MotionComicPipelineData;
    const target = withAdvice.episodes[0].scenes.flatMap((scene) => scene.shots)[1];
    target.continuityAdvice = advice({ previousShotId: withAdvice.episodes[0].scenes.flatMap((scene) => scene.shots)[0].id });
    const reparsed = parseMotionComicPipelineData(JSON.parse(JSON.stringify(withAdvice)));
    expect(reparsed.episodes[0].scenes.flatMap((scene) => scene.shots)[1].continuityAdvice).toEqual(target.continuityAdvice);

    expect(motionComicShotContinuityAdviceSchema.safeParse({ ...advice(), level: 'perfect' }).success).toBe(false);
    expect(motionComicShotContinuityAdviceSchema.safeParse({ ...advice(), advisory: false }).success).toBe(false);
    expect(motionComicShotContinuityAdviceSchema.safeParse({ ...advice(), extra: 1 }).success).toBe(false);
  });

  it('only surfaces advice that still matches the currently selected videos of both shots', () => {
    const shot1 = { id: 'shot-1', videoAssetVersionId: 'video-1' };
    const shot2 = { id: 'shot-2', videoAssetVersionId: 'video-2', continuityAdvice: advice() };
    const episode = (first: object, second: object) => ({ scenes: [{ shots: [first] }, { shots: [second] }] }) as never;
    expect(motionComicPreviousShot(episode(shot1, shot2), 'shot-2')?.id).toBe('shot-1');
    expect(motionComicPreviousShot(episode(shot1, shot2), 'shot-1')).toBeUndefined();
    expect(currentMotionComicShotContinuityAdvice(episode(shot1, shot2), shot2)?.level).toBe('good');
    expect(currentMotionComicShotContinuityAdvice(episode(shot1, shot2), { ...shot2, videoAssetVersionId: 'video-3' })).toBeUndefined();
    expect(currentMotionComicShotContinuityAdvice(episode({ ...shot1, videoAssetVersionId: 'video-9' }, shot2), shot2)).toBeUndefined();
    expect(currentMotionComicShotContinuityAdvice(episode(shot1, { ...shot2, continuityAdvice: undefined }), { ...shot2, continuityAdvice: undefined })).toBeUndefined();
  });

  it('renders the advisory badge in the workbench shot cards (SSR)', () => {
    expect(renderToStaticMarkup(createElement(DirectorContinuityBadge, {}))).toBe('');
    const badge = renderToStaticMarkup(createElement(DirectorContinuityBadge, { advice: { level: 'jump', score: 0.41 } }));
    expect(badge).toContain('衔接：跳变（仅供参考）');
    expect(badge).toContain('is-jump');
    expect(badge).toContain('41%');

    const props: ComponentProps<typeof DirectorDeskWorkspace> = {
      mode: 'motion-comic', projectTitle: '雨夜来信', projectMeta: '', episodeTitle: '第 1 集', stageLabel: '镜头生成',
      selectedShotId: 'a', dirty: false, providerConnected: true,
      shots: [
        { id: 'a', index: 1, title: '镜头一', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '' },
        { id: 'b', index: 2, title: '镜头二', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', continuityAdvice: { level: 'fair', score: 0.66 } },
      ],
      onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
    };
    const markup = renderToStaticMarkup(createElement(DirectorDeskWorkspace, props));
    expect(markup).toContain('衔接：一般（仅供参考）');
    expect(markup.match(/director-continuity-badge/gu)?.length ?? 0).toBeGreaterThanOrEqual(1);
    const without = renderToStaticMarkup(createElement(DirectorDeskWorkspace, { ...props, shots: props.shots.map(({ continuityAdvice: _omit, ...shot }) => shot) }));
    expect(without).not.toContain('director-continuity-badge');
  });

  it('wires the computation into shot-video generation without blocking it', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../electron/motion-comic-shot-video.ts', import.meta.url), 'utf8');
    const start = source.indexOf('async function generateMotionComicShotVideo');
    const end = source.indexOf('\n  return { generateMotionComicShotVideo };', start);
    const generator = source.slice(start, end);
    const normalized = generator.indexOf('normalizeSceneVideo(generated.path');
    expect(generator.indexOf('const cutFrames = await sampleShotCutFrames(')).toBeGreaterThan(normalized);
    expect(generator.indexOf('const cutFrames = await sampleShotCutFrames(')).toBeLessThan(generator.indexOf('const latestTask = await database.getTaskDetail', normalized));
    expect(generator).toContain('const continuityAdvice = stale ? undefined : shotContinuityAdvice(cutFrames, latestEpisode, shot.id, assetId);');
    expect(generator).toContain('videoAssetVersionId: assetId, continuityAdvice }');
    expect(generator.indexOf('await sweepTaskResumableParts(taskWorkDir(task));')).toBeLessThan(generator.indexOf('const generated = resumableJob'));
    const page = await readFile(new URL('../src/features/motion-comic/MotionComicPage.tsx', import.meta.url), 'utf8');
    expect(page).toContain('currentMotionComicShotContinuityAdvice(episode, shot)');
  });
});

describe('ffmpeg edge-frame sampling (C-2)', () => {
  const temp: string[] = [];
  afterAll(async () => { for (const dir of temp) await rm(dir, { recursive: true, force: true }).catch(() => undefined); });

  it('picks the first frame of a raw dump or the last one', () => {
    const one = 32 * 32 * 4;
    const dump = new Uint8Array(one * 3);
    dump.fill(1, 0, one); dump.fill(3, one * 2);
    expect(rawFrameFromDump(dump, 'first')?.data[0]).toBe(1);
    expect(rawFrameFromDump(dump, 'last')?.data[0]).toBe(3);
    expect(rawFrameFromDump(new Uint8Array(10), 'last')).toBeUndefined();
  });

  it('returns undefined instead of throwing when inputs or ffmpeg are unusable', async () => {
    expect(await sampleMotionComicCutFrames({ previousVideoPath: 'missing-a.mp4', videoPath: 'missing-b.mp4', ffmpegPath: join(tmpdir(), 'no-such-ffmpeg.exe') })).toBeUndefined();
  });

  it.skipIf(!binaries)('samples the previous last frame and the new first frame from real videos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opc-continuity-ffmpeg-'));
    temp.push(dir);
    const make = (name: string, first: 'top' | 'left', second: 'top' | 'left') => {
      const box = (kind: 'top' | 'left') => (kind === 'top' ? 'x=0:y=0:w=64:h=32' : 'x=0:y=0:w=32:h=64');
      const output = join(dir, name);
      const result = spawnSync(binaries!.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=0x1e1e1e:s=64x64:d=1:r=10',
        '-f', 'lavfi', '-i', 'color=c=0x1e1e1e:s=64x64:d=1:r=10',
        '-filter_complex', `[0:v]drawbox=${box(first)}:color=0xdcdcdc:t=fill[a];[1:v]drawbox=${box(second)}:color=0xdcdcdc:t=fill[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]`,
        '-map', '[v]', '-c:v', 'mpeg4', '-q:v', '2', output,
      ], { windowsHide: true, timeout: 60_000 });
      expect(result.status, String(result.stderr)).toBe(0);
      return output;
    };
    // Previous shot ends on "left"; the new shot starts on "left" and ends on "top".
    const previous = make('previous.mp4', 'top', 'left');
    const next = make('next.mp4', 'left', 'top');
    const frames = await sampleMotionComicCutFrames({ previousVideoPath: previous, videoPath: next, ffmpegPath: binaries!.ffmpegPath });
    expect(frames).toBeDefined();
    const ids = { videoAssetVersionId: 'v2', previousShotId: 's1', previousVideoAssetVersionId: 'v1', computedAt: now };
    expect(buildMotionComicShotContinuityAdvice({ ...frames!, ...ids }).level).toBe('good');
    const swapped = await sampleMotionComicCutFrames({ previousVideoPath: next, videoPath: next, ffmpegPath: binaries!.ffmpegPath });
    expect(buildMotionComicShotContinuityAdvice({ ...swapped!, ...ids }).level).toBe('jump');
  }, 120_000);

  it('asks ffmpeg to keep overwriting one frame of the final second, never a single tail frame', () => {
    const last = continuityFrameArgs('in.mp4', 'last', 'out.rgba');
    expect(last.slice(last.indexOf('-sseof'), last.indexOf('-sseof') + 2)).toEqual(['-sseof', '-1']);
    expect(last).not.toContain('-frames:v');
    expect(last.slice(-5)).toEqual(['-f', 'image2', '-update', '1', 'out.rgba']);
    expect(continuityFrameArgs('in.mp4', 'first', 'out.rgba')).toContain('-frames:v');
    const full = continuityFrameArgs('in.mp4', 'last-full', 'out.rgba');
    expect(full).not.toContain('-sseof');
    expect(full.slice(-5)).toEqual(['-f', 'image2', '-update', '1', 'out.rgba']);
  });

  /**
   * Time-varying fixtures (not solid colour): the composition changes only in the final frames, and
   * libx264 with one GOP + B-frames forces a real decode-from-keyframe seek.
   */
  function timeVaryingClip(dir: string, name: string, input: {
    durationSec: number;
    fps?: number;
    /** Frame index from which the "left" composition replaces "top". */
    switchAtFrame: number;
    /** Extra audio seconds beyond the video stream (container longer than video). */
    audioTailSec?: number;
  }): string {
    const fps = input.fps ?? 10;
    const output = join(dir, name);
    const top = 'x=0:y=0:w=64:h=32';
    const left = 'x=0:y=0:w=32:h=64';
    const audio = input.audioTailSec ? ['-f', 'lavfi', '-i', `sine=f=440:d=${input.durationSec + input.audioTailSec}`] : [];
    const result = spawnSync(binaries!.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=64x64:d=${input.durationSec}:r=${fps}`,
      ...audio,
      '-vf', [
        'hue=s=0', 'eq=contrast=0.15:brightness=-0.25',
        `drawbox=${top}:color=0xdcdcdc:t=fill:enable='lt(n,${input.switchAtFrame})'`,
        `drawbox=${left}:color=0xdcdcdc:t=fill:enable='gte(n,${input.switchAtFrame})'`,
        'format=yuv420p',
      ].join(','),
      '-c:v', 'libx264', '-g', '600', '-bf', '2', '-pix_fmt', 'yuv420p',
      ...(input.audioTailSec ? ['-c:a', 'aac'] : []),
      output,
    ], { windowsHide: true, timeout: 60_000 });
    expect(result.status, String(result.stderr)).toBe(0);
    return output;
  }

  /** Mean luma of the top-right quadrant minus the bottom-left one: >0 for "top", <0 for "left". */
  function layout(frame: RawFrame): 'top' | 'left' {
    const luma = (x0: number, y0: number) => {
      let sum = 0;
      for (let y = y0; y < y0 + 12; y += 1) for (let x = x0; x < x0 + 12; x += 1) sum += frame.data[(y * frame.width + x) * 4];
      return sum / 144;
    };
    return luma(18, 2) > luma(2, 18) ? 'top' : 'left';
  }

  it.skipIf(!binaries)('scores against the true last frame when only the final frames of the previous shot change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opc-continuity-tail-'));
    temp.push(dir);
    // 3 s @ 10 fps: frames 0–26 "top", only the final 3 frames (27–29) "left". The first frame of the
    // final second (frame 20) is still "top", so a single-frame `-sseof -1` grab would pick the wrong one.
    const previous = timeVaryingClip(dir, 'previous.mp4', { durationSec: 3, switchAtFrame: 27 });
    const startsLeft = timeVaryingClip(dir, 'starts-left.mp4', { durationSec: 2, switchAtFrame: 0 });
    const startsTop = timeVaryingClip(dir, 'starts-top.mp4', { durationSec: 2, switchAtFrame: 15 });
    const ids = { videoAssetVersionId: 'v2', previousShotId: 's1', previousVideoAssetVersionId: 'v1', computedAt: now };

    const continuous = await sampleMotionComicCutFrames({ previousVideoPath: previous, videoPath: startsLeft, ffmpegPath: binaries!.ffmpegPath });
    expect(continuous).toBeDefined();
    expect(layout(continuous!.previousLastFrame)).toBe('left');
    expect(layout(continuous!.firstFrame)).toBe('left');
    expect(buildMotionComicShotContinuityAdvice({ ...continuous!, ...ids }).level).toBe('good');

    const cut = await sampleMotionComicCutFrames({ previousVideoPath: previous, videoPath: startsTop, ffmpegPath: binaries!.ffmpegPath });
    expect(layout(cut!.firstFrame)).toBe('top');
    expect(buildMotionComicShotContinuityAdvice({ ...cut!, ...ids }).level).toBe('jump');

    // Evidence for the regression this guards: the single-frame variant really returns the stale frame.
    const single = join(dir, 'single.rgba');
    const wrong = spawnSync(binaries!.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-1', '-i', previous,
      '-map', '0:v:0', '-an', '-vf', 'scale=32:32:flags=area,format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', single,
    ], { windowsHide: true, timeout: 60_000 });
    expect(wrong.status, String(wrong.stderr)).toBe(0);
    expect(layout(rawFrameFromDump(await readFile(single), 'first')!)).toBe('top');
  }, 120_000);

  it.skipIf(!binaries)('handles clips shorter than one second and containers whose audio outlasts the video', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opc-continuity-edge-'));
    temp.push(dir);
    const startsLeft = timeVaryingClip(dir, 'starts-left.mp4', { durationSec: 1, switchAtFrame: 0 });
    // 0.5 s: the -1 s tail window starts before zero.
    const short = timeVaryingClip(dir, 'short.mp4', { durationSec: 0.5, switchAtFrame: 4 });
    // Video ends at 2 s ("left" only in its last 2 frames) but AAC runs to 4 s: the tail window holds no video.
    const longAudio = timeVaryingClip(dir, 'long-audio.mp4', { durationSec: 2, switchAtFrame: 18, audioTailSec: 2 });
    for (const previous of [short, longAudio]) {
      const frames = await sampleMotionComicCutFrames({ previousVideoPath: previous, videoPath: startsLeft, ffmpegPath: binaries!.ffmpegPath });
      expect(frames, previous).toBeDefined();
      expect(layout(frames!.previousLastFrame)).toBe('left');
    }
  }, 120_000);
});

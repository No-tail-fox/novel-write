import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
import { rawFrameFromDump, sampleMotionComicCutFrames } from '../electron/motion-comic-continuity-probe';

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
});

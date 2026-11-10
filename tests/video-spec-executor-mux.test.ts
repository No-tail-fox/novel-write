/**
 * 统一执行器运行时的真实 ffmpeg 集成测试：still 场景片段 → 音频时间线 → 封装成片 → 成片复检。
 * 不涉及 Electron 采集（CaptureHost 需要真实窗口）。没有随应用打包的 ffmpeg 时跳过。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveFinalFilmFfmpeg } from '../electron/final-film-gate-runner';
import { runVideoSpecExecutorForProject } from '../electron/video-spec-executor-runtime';
import { createVideoSpec } from '../src/shared/video-spec';
import { allocateFrameCounts } from '../src/shared/video-spec';

const pythonRoot = join(resolve(__dirname, '..'), 'vendor', 'python');
const found = await resolveFinalFilmFfmpeg({ pythonRoot, ffprobePath: null });
const ffmpegPath = found?.ffmpegPath ?? null;
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true })));
});

function ffmpeg(args: string[]) {
  const result = spawnSync(ffmpegPath!, ['-hide_banner', '-y', ...args], { windowsHide: true, encoding: 'utf8' });
  return result;
}

describe.skipIf(!ffmpegPath)('video-spec executor runtime with the bundled ffmpeg', () => {
  it('renders still scenes, the audio timeline and a bt709-tagged H.264/AAC film with the exact frame count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vs-executor-'));
    dirs.push(dir);
    const make = (name: string, args: string[]) => {
      const path = join(dir, name);
      const result = ffmpeg([...args, path]);
      expect(result.status, result.stderr).toBe(0);
      return path;
    };
    make('red.png', ['-f', 'lavfi', '-i', 'color=c=red:s=64x36', '-frames:v', '1']);
    make('blue.png', ['-f', 'lavfi', '-i', 'color=c=blue:s=64x36', '-frames:v', '1']);
    const voiceMs: Record<string, number> = { a: 1210, b: 870 };
    const voices: Record<string, string> = {
      a: make('vo a.wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.21:sample_rate=24000', '-ac', '1']),
      b: make('vo-b.wav', ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.87:sample_rate=24000', '-ac', '1']),
    };

    const spec = createVideoSpec({
      route: 'html',
      canvas: { width: 320, height: 180, fps: 24 },
      scenes: [
        { id: 'a', durationFrames: 24, adapter: { kind: 'still', imageRef: 'red.png' }, narration: { text: '红色' } },
        { id: 'b', durationFrames: 24, adapter: { kind: 'still', imageRef: 'blue.png' }, narration: { text: '蓝色' } },
      ],
      outputs: [{ kind: 'mp4', path: 'out/film.mp4' }],
    });
    const synthesized: string[] = [];
    const result = await runVideoSpecExecutorForProject({ videoSpecVersion: 1 }, spec, {
      workDir: join(dir, 'work'),
      pythonRoot,
      checkpointPath: join(dir, 'work', 'checkpoint.json'),
      resolveSourcePath: ref => resolve(dir, ref),
      synthesizeVoice: async request => {
        synthesized.push(request.sceneId);
        return { ref: voices[request.sceneId], durationMs: voiceMs[request.sceneId] };
      },
      gate: { reportPath: null },
    });

    expect(result.failures).toEqual([]);
    expect(result.status).toBe('completed');
    expect(synthesized.sort()).toEqual(['a', 'b']);
    const totalFrames = allocateFrameCounts([1210, 870], 24).reduce((sum, count) => sum + count, 0);
    expect(result.spec!.durationFrames).toBe(totalFrames);
    expect(result.filmRef).toBe(join(dir, 'out', 'film.mp4'));
    expect(result.gate?.advisory).toBe(true);
    expect(result.gate?.status, result.gate?.summary).toBe('passed');

    // 帧数与色彩标签
    const probe = ffmpeg(['-i', result.filmRef!, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
    expect(probe.stderr).toMatch(/Video: h264.*yuv420p\(tv, bt709\/bt709\/iec61966-2-1/u);
    expect(probe.stderr).toMatch(/Audio: aac/u);
    const frames = /frame=\s*(\d+)/u.exec(probe.stderr.split('\n').reverse().find(line => /frame=/u.test(line)) ?? '');
    expect(Number(frames?.[1])).toBe(totalFrames);

    // 用检查点恢复：所有节点都已完成，不再调用 TTS
    const resumed = await runVideoSpecExecutorForProject({ videoSpecVersion: 1 }, spec, {
      workDir: join(dir, 'work'), pythonRoot, checkpointPath: join(dir, 'work', 'checkpoint.json'), resolveSourcePath: ref => resolve(dir, ref),
      synthesizeVoice: async () => { throw new Error('should not be called'); }, gate: { reportPath: null },
    });
    expect(resumed.status).toBe('completed');
  }, 120_000);
});

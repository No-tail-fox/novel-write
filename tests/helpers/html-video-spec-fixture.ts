/**
 * O-3 测试夹具：在一个受信任的临时任务目录里准备一个“配音 / 生图已完成”的 HTML 视频任务（全部本地生成，不联网）。
 * e2e（假采集）与真实 Electron 冒烟共用。
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureHtmlVideoTaskWorkDir, type HtmlVideoMediaProbeResult, type HtmlVideoTaskDirectoryIdentity } from '../../electron/html-video-runtime';
import { resolveFinalFilmFfmpeg } from '../../electron/final-film-gate-runner';
import { createHtmlVideoPipelineData } from '../../src/shared/html-video-workflow';
import type { HtmlVideoRenderInput } from '../../src/shared/html-video-runner';
import type { HtmlVideoAsset, HtmlVideoJobConfig, HtmlVideoPipelineDataV2, HtmlVideoVoiceClip } from '../../src/shared/types';

const run = promisify(execFile);

export const SPEC_FIXTURE_STORAGE_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef';
export const SPEC_FIXTURE_COPY = '第一段文案，讲一个故事的开头。\n\n第二段文案，故事继续发展。\n\n第三段文案，故事走向结局。';
export const SPEC_FIXTURE_VOICE_SECONDS = [2, 1.5, 1];

export async function resolveTestFfmpeg(): Promise<string | null> {
  const resolved = await resolveFinalFilmFfmpeg({ pythonRoot: join(process.cwd(), 'vendor', 'python'), ffprobePath: null }).catch(() => null);
  return resolved?.ffmpegPath ?? null;
}

export async function ffmpeg(ffmpegPath: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  const result = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { stdout: result.stdout, stderr: result.stderr.toString('utf8') };
}

/** `ffmpeg -i` 探测（不依赖 ffprobe）：时长、画面尺寸、有无音视频流。 */
export function createFfmpegProbe(ffmpegPath: string) {
  return async (_root: string, path: string): Promise<HtmlVideoMediaProbeResult> => {
    const stderr = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-i', path], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
      .then(result => String(result.stderr), (error: { stderr?: string }) => String(error.stderr ?? ''));
    const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(stderr);
    const video = /Stream #[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})/u.exec(stderr);
    return {
      duration: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : undefined,
      hasAudio: /Stream #[^\n]*Audio:/u.test(stderr),
      hasVideo: Boolean(video),
      width: video ? Number(video[1]) : undefined,
      height: video ? Number(video[2]) : undefined,
    } as HtmlVideoMediaProbeResult;
  };
}

export interface SpecTaskFixture {
  trustedRoot: string;
  taskDirectory: HtmlVideoTaskDirectoryIdentity;
  workDir: string;
  state: HtmlVideoPipelineDataV2;
  input: HtmlVideoRenderInput;
  bgmPath: string;
}

export async function prepareSpecTaskFixture(options: {
  ffmpegPath: string;
  trustedRoot: string;
  config?: HtmlVideoJobConfig;
  cover?: boolean;
  /** 背景图颜色（ffmpeg 颜色名或 0xRRGGBB），每个场景一个。 */
  backgroundColors?: string[];
}): Promise<SpecTaskFixture> {
  const taskDirectory = await ensureHtmlVideoTaskWorkDir(options.trustedRoot, 'storydream', SPEC_FIXTURE_STORAGE_KEY);
  const workDir = taskDirectory.workDir.canonicalPath;
  await mkdir(join(workDir, 'audio'), { recursive: true });
  await mkdir(join(workDir, 'images'), { recursive: true });
  const state = createHtmlVideoPipelineData(SPEC_FIXTURE_COPY, {
    maxScenes: 3, ratio: '9:16', transitionType: 'fade', bgmVolume: 'soft', ...options.config,
  }) as HtmlVideoPipelineDataV2;
  state.videoSpecVersion = 1;
  const scenes = state.scenes.slice(0, 3);
  const colors = options.backgroundColors ?? ['0x203040', '0x402030', '0x304020'];
  const voices: HtmlVideoVoiceClip[] = [];
  const assets: HtmlVideoAsset[] = [];
  for (const [index, scene] of scenes.entries()) {
    const voicePath = join(workDir, 'audio', `voice-${scene.index}.wav`);
    await ffmpeg(options.ffmpegPath, ['-f', 'lavfi', '-i', `sine=frequency=${330 + index * 110}:duration=${SPEC_FIXTURE_VOICE_SECONDS[index]}:sample_rate=48000`, '-af', 'volume=0.5', '-ac', '1', voicePath]);
    const bgPath = join(workDir, 'images', `bg-${scene.index}.png`);
    await ffmpeg(options.ffmpegPath, ['-f', 'lavfi', '-i', `color=c=${colors[index]}:s=360x640`, '-frames:v', '1', bgPath]);
    const durationSec = SPEC_FIXTURE_VOICE_SECONDS[index];
    voices.push({
      sceneIndex: scene.index, src: voicePath, durationSec, text: scene.narration,
      captionCues: [
        { text: `字幕${scene.index}甲`, startSec: 0, endSec: durationSec / 2, source: 'tts', confidence: 1 },
        { text: `字幕${scene.index}乙`, startSec: durationSec / 2, endSec: durationSec, source: 'tts', confidence: 1 },
      ],
    });
    assets.push({ sceneIndex: scene.index, kind: 'bg', slot: 0, src: bgPath, prompt: scene.background.prompt } as HtmlVideoAsset);
  }
  const bgmPath = join(workDir, 'bgm.wav');
  await ffmpeg(options.ffmpegPath, ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.4:duration=14:sample_rate=48000', '-ac', '2', bgmPath]);
  let coverAsset: HtmlVideoRenderInput['coverAsset'];
  if (options.cover) {
    const coverPath = join(workDir, 'cover.png');
    await ffmpeg(options.ffmpegPath, ['-f', 'lavfi', '-i', 'color=c=red:s=360x640', '-frames:v', '1', coverPath]);
    const bytes = await readFile(coverPath);
    coverAsset = {
      version: 1, revision: 1, mode: 'auto', path: coverPath, sizeBytes: (await stat(coverPath)).size, width: 360, height: 640,
      mimeType: 'image/png', sha256: createHash('sha256').update(bytes).digest('hex'), ratio: '9:16',
    } as unknown as HtmlVideoRenderInput['coverAsset'];
  }
  const input: HtmlVideoRenderInput = {
    scenes: structuredClone(scenes),
    assets,
    voices,
    compositions: [],
    ...(coverAsset ? { coverAsset } : {}),
    config: state.config,
  } as unknown as HtmlVideoRenderInput;
  return { trustedRoot: options.trustedRoot, taskDirectory, workDir, state, input, bgmPath };
}

/** 取第 n 帧缩到 w×h 的 RGB 像素。 */
export async function frameRgb(ffmpegPath: string, film: string, frame: number, size = { width: 1, height: 1 }): Promise<Buffer> {
  const { stdout } = await ffmpeg(ffmpegPath, ['-i', film, '-vf', `select=eq(n\\,${frame}),scale=${size.width}:${size.height}:flags=area`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return stdout;
}

export async function filmFacts(ffmpegPath: string, film: string): Promise<{ frames: number; videoLine: string; audioLine: string }> {
  const { stderr } = await ffmpeg(ffmpegPath, ['-i', film, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
  const frames = [...stderr.matchAll(/frame=\s*(\d+)/gu)].pop();
  return {
    frames: frames ? Number(frames[1]) : -1,
    videoLine: /Stream #[^\n]*Video:[^\n]*/u.exec(stderr)?.[0] ?? '',
    audioLine: /Stream #[^\n]*Audio:[^\n]*/u.exec(stderr)?.[0] ?? '',
  };
}

/** 一段时间内的音频 RMS（dBFS）。 */
export async function audioRmsDb(ffmpegPath: string, film: string, startS: number, durationS: number): Promise<number> {
  const { stderr } = await ffmpeg(ffmpegPath, ['-ss', String(startS), '-t', String(durationS), '-i', film, '-vn', '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-']);
  const overall = stderr.slice(stderr.lastIndexOf('Overall'));
  const match = /RMS level dB:\s*(-?[\d.]+|-inf)/u.exec(overall);
  return !match || match[1] === '-inf' ? -Infinity : Number(match[1]);
}

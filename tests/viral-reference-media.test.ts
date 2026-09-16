import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '@shared/process-runner';
import {
  buildReferenceScanChunks,
  extractReferenceWindow,
  parseReferenceFfmpegHeader,
  parseReferenceFfprobe,
  parseReferenceSceneBoundaries,
  probeReferenceMedia,
  referenceWindowFrameTimes,
  referenceObservationFrameTimes,
  resolveReferenceFfmpeg,
  scanReferenceMedia,
} from '@shared/viral-reference-media';

describe('reference media metadata and time ownership', () => {
  it('reads rational FPS, rotated dimensions, and audio from ffprobe', () => {
    expect(parseReferenceFfprobe(JSON.stringify({
      format: { duration: '125.125' },
      streams: [
        { codec_type: 'video', width: 100, height: 100, disposition: { attached_pic: 1 } },
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', side_data_list: [{ rotation: -90 }] },
        { codec_type: 'audio' },
      ],
    }))).toEqual({ durationMs: 125_125, width: 1080, height: 1920, fps: 30000 / 1001, hasAudio: true });
  });

  it('supports the bundled FFmpeg header when ffprobe is absent', () => {
    const header = [
      'Duration: 01:02:03.45, start: 0.000000, bitrate: 2988 kb/s',
      'Stream #0:0: Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 29.97 fps, 30 tbr',
      'displaymatrix: rotation of -90.00 degrees',
      'Stream #0:1: Audio: aac (LC), 48000 Hz, stereo',
    ].join('\n');
    expect(parseReferenceFfmpegHeader(header)).toEqual({ durationMs: 3_723_450, width: 1080, height: 1920, fps: 29.97, hasAudio: true });
    expect(() => parseReferenceFfmpegHeader('Invalid data found when processing input')).toThrow();
    expect(() => parseReferenceFfprobe('{"streams":[]}')).toThrow();
  });

  it('owns all 125 seconds exactly once and carries pre-boundary context', () => {
    const chunks = buildReferenceScanChunks(125_000);
    expect(chunks).toEqual([
      { startMs: 0, endMs: 30_000, readStartMs: 0 },
      { startMs: 30_000, endMs: 60_000, readStartMs: 29_000 },
      { startMs: 60_000, endMs: 90_000, readStartMs: 59_000 },
      { startMs: 90_000, endMs: 120_000, readStartMs: 89_000 },
      { startMs: 120_000, endMs: 125_000, readStartMs: 119_000 },
    ]);
    expect(chunks.reduce((sum, chunk) => sum + chunk.endMs - chunk.startMs, 0)).toBe(125_000);
    expect(parseReferenceSceneBoundaries(
      'frame:0 pts:0 pts_time:0.5\nframe:1 pts:10 pts_time:1\nframe:2 pts:20 pts_time:1.000\nframe:3 pts:30 pts_time:2.5\nframe:4 pts:40 pts_time:31',
      chunks[1]!,
    )).toEqual([30_000, 31_500]);
  });

  it('always samples four ordered timestamps inside the requested interval', () => {
    expect(referenceWindowFrameTimes({ startMs: 120_000, endMs: 125_000 }, 25)).toEqual([120_000, 121_653, 123_307, 124_960]);
    expect(referenceWindowFrameTimes({ startMs: 0, endMs: 1 }, 25)).toEqual([0, 0, 0, 0]);
    expect(() => referenceWindowFrameTimes({ startMs: 5, endMs: 2 }, 25)).toThrow();
    const shortShot = { id: 'dense-shot', coreRange: { startMs: 2000, endMs: 2100 }, contextRange: { startMs: 1000, endMs: 3100 } };
    expect(referenceObservationFrameTimes(shortShot, 25).filter(time => time >= 2000 && time < 2100)).toHaveLength(2);
  });

  it('cancels before launching a process and rejects remote media paths', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(probeReferenceMedia('invalid', controller.signal)).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
    await expect(probeReferenceMedia('https://example.com/video.mp4')).rejects.toThrow('本地绝对路径');
  });
});

describe('reference media local FFmpeg integration', () => {
  it('scans past two minutes, retains cuts on chunk boundaries, and extracts bounded real audio/video', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-reference-media-'));
    try {
      const sourcePath = join(directory, 'reference.mp4');
      const ffmpeg = await resolveReferenceFfmpeg();
      const generated = await runBoundedProcess(ffmpeg, [
        '-hide_banner', '-nostdin', '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=96x64:r=8:d=30',
        '-f', 'lavfi', '-i', 'color=c=white:s=96x64:r=8:d=60',
        '-f', 'lavfi', '-i', 'color=c=black:s=96x64:r=8:d=35',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=125',
        '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
        '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '32k', '-shortest', sourcePath,
      ], { cwd: directory, timeoutMs: 60_000, maxStdoutBytes: 1024, maxStderrBytes: 128 * 1024 });
      expect(generated.code, generated.stderr).toBe(0);
      const progress: number[] = [];
      const scanned = await scanReferenceMedia(sourcePath, directory, undefined, (processedMs) => { progress.push(processedMs); });
      expect(scanned.probe).toMatchObject({ durationMs: 125_000, width: 96, height: 64, fps: 8, hasAudio: true });
      expect(scanned.sourceSha256).toBe(createHash('sha256').update(await readFile(sourcePath)).digest('hex'));
      expect(scanned.candidateBoundariesMs).toEqual([30_000, 90_000]);
      expect(progress).toEqual([0, 30_000, 60_000, 90_000, 120_000, 125_000]);
      const window = { id: '../../outside', coreRange: { startMs: 120_000, endMs: 125_000 }, contextRange: { startMs: 119_000, endMs: 125_000 } };
      const result = await extractReferenceWindow(sourcePath, directory, window);
      expect(result.frames).toHaveLength(4);
      expect(result.frames.map((frame) => frame.timeMs)).toEqual([119_000, 121_625, 123_250, 124_875]);
      for (const path of [...result.frames.map((frame) => frame.path), result.videoPath, result.audioPath!]) {
        const ownedPath = relative(directory, path);
        expect(isAbsolute(path)).toBe(true);
        expect(isAbsolute(ownedPath) || ownedPath.startsWith('..')).toBe(false);
        expect((await stat(path)).size).toBeGreaterThan(0);
      }
      const clip = await probeReferenceMedia(result.videoPath);
      expect(clip.durationMs).toBeCloseTo(5_000, -2);
      expect(clip.hasAudio).toBe(true);
      expect((await stat(result.audioPath!)).size).toBeLessThan(161_000);
      await expect(extractReferenceWindow(sourcePath, directory, {
        id: 'oversize', coreRange: { startMs: 0, endMs: 31_000 }, contextRange: { startMs: 0, endMs: 31_000 },
      })).rejects.toThrow('30 秒');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('extracts a silent video without inventing an audio file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-reference-silent-'));
    try {
      const sourcePath = join(directory, 'silent.mp4');
      const ffmpeg = await resolveReferenceFfmpeg();
      const result = await runBoundedProcess(ffmpeg, [
        '-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=8:d=1',
        '-an', '-c:v', 'libx264', '-preset', 'ultrafast', sourcePath,
      ], { cwd: directory, timeoutMs: 30_000, maxStdoutBytes: 1024, maxStderrBytes: 128 * 1024 });
      expect(result.code, result.stderr).toBe(0);
      const extracted = await extractReferenceWindow(sourcePath, directory, {
        id: 'silent', coreRange: { startMs: 0, endMs: 1_000 }, contextRange: { startMs: 0, endMs: 1_000 },
      });
      expect(extracted.audioPath).toBeUndefined();
      expect(extracted.frames).toHaveLength(4);
      expect((await probeReferenceMedia(extracted.videoPath)).hasAudio).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});

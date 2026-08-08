import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseStoryboundSidecarOutput,
  runStoryboundMediaSidecar,
  writeStoryboundSidecarInput,
  writeStoryboundSidecarScript,
  type StoryboundSidecarInput,
} from '@shared/storybound-sidecar';

describe('Storybound-compatible media sidecar', () => {
  it('parses the last JSON line from noisy sidecar stdout', () => {
    expect(parseStoryboundSidecarOutput('booting...\nprogress 80%\n{"success":true,"draft_dir":"D:/Drafts/A","draft_id":"A"}\n')).toEqual({
      success: true,
      draft_dir: 'D:/Drafts/A',
      draft_id: 'A',
    });
  });

  it('runs the sidecar with a JSON input file and normalizes success output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-run-'));
    const payload: StoryboundSidecarInput = {
      mode: 'convert_audio_16k',
      audio_path: join(dir, 'in.mp3'),
      output_path: join(dir, 'out.wav'),
    };
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

    try {
      const result = await runStoryboundMediaSidecar(payload, {
        pythonCommand: 'python-test',
        execute: async (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd });
          return {
            code: 0,
            stdout: 'noise\n{"success":true,"output_path":"out.wav"}\n',
            stderr: '',
          };
        },
      });

      expect(result).toEqual({ success: true, output_path: 'out.wav' });
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toBe('python-test');
      expect(calls[0].cwd).toBe(dir);
      expect(calls[0].args[0]).toMatch(/storybound-media-sidecar[\\/]sidecar\.py$/);
      expect(calls[0].args[1]).toMatch(/storybound-media-sidecar[\\/]input\.json$/);
      const savedPayload = JSON.parse(await readFile(calls[0].args[1], 'utf8'));
      expect(savedPayload).toMatchObject(payload);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('surfaces sidecar exit failures and structured failure JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-errors-'));
    const payload: StoryboundSidecarInput = {
      mode: 'remix_bgm',
      source_path: join(dir, '_source.mp4'),
      output_path: join(dir, 'out.mp4'),
    };

    try {
      await expect(
        runStoryboundMediaSidecar(payload, {
          pythonCommand: 'python-test',
          execute: async () => ({ code: 2, stdout: '', stderr: 'bad ffmpeg' }),
        }),
      ).rejects.toThrow(/退出码 2.*bad ffmpeg/);

      await expect(
        runStoryboundMediaSidecar(payload, {
          pythonCommand: 'python-test',
          execute: async () => ({
            code: 0,
            stdout: '{"success":false,"error":"missing source","traceback":"stack"}\n',
            stderr: '',
          }),
        }),
      ).rejects.toThrow(/missing source[\s\S]*stack/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('forwards timeout, cancellation, and output limits to the sidecar executor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-bounds-'));
    const controller = new AbortController();
    let received: Record<string, unknown> | null = null;
    try {
      await runStoryboundMediaSidecar(
        {
          mode: 'convert_audio_16k',
          audio_path: join(dir, 'in.wav'),
          output_path: join(dir, 'out.wav'),
        },
        {
          pythonCommand: 'python-test',
          timeoutMs: 1234,
          maxStdoutBytes: 2345,
          maxStderrBytes: 3456,
          signal: controller.signal,
          execute: async (_command, _args, options) => {
            received = options as unknown as Record<string, unknown>;
            return { code: 0, stdout: '{"success":true,"output_path":"out.wav"}', stderr: '' };
          },
        },
      );

      expect(received).toMatchObject({
        cwd: dir,
        timeoutMs: 1234,
        maxStdoutBytes: 2345,
        maxStderrBytes: 3456,
        signal: controller.signal,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps POSIX media children in the outer sidecar process group', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-process-group-'));
    try {
      const script = await readFile(await writeStoryboundSidecarScript(dir), 'utf8');

      expect(script).not.toContain('start_new_session');
      expect(script).not.toContain('os.killpg(process.pid');
      expect(script).toContain('process.terminate()');
      expect(script).toContain('process.kill()');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('redacts credentials from sidecar process failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-redaction-'));
    try {
      const pending = runStoryboundMediaSidecar(
        {
          mode: 'convert_audio_16k',
          audio_path: join(dir, 'in.wav'),
          output_path: join(dir, 'out.wav'),
        },
        {
          pythonCommand: 'python-test',
          execute: async () => ({
            code: 2,
            stdout: '',
            stderr: 'Authorization: Bearer super-secret-token\nCookie: session=private-cookie',
          }),
        },
      );

      await expect(pending).rejects.toThrow(/退出码 2/);
      await expect(pending).rejects.not.toThrow(/super-secret-token|private-cookie/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats a signal-terminated sidecar as a failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-signal-'));
    try {
      await expect(
        runStoryboundMediaSidecar(
          {
            mode: 'convert_audio_16k',
            audio_path: join(dir, 'in.wav'),
            output_path: join(dir, 'out.wav'),
          },
          {
            pythonCommand: 'python-test',
            execute: async () => ({
              code: null,
              signal: 'SIGTERM',
              stdout: '{"success":true,"output_path":"out.wav"}',
              stderr: '',
            }),
          },
        ),
      ).rejects.toThrow(/SIGTERM|signal|terminated/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a Python sidecar script with all recovered Storybound modes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-script-'));

    try {
      const inputPath = await writeStoryboundSidecarInput({
        mode: 'story',
        task_dir: dir,
        cover_title: { title: 'Title', subtitle: [] },
        bgm_path: '',
        jianying_draft_path: join(dir, 'Drafts'),
        template: {},
        task_title: 'Title',
      });
      const scriptPath = await writeStoryboundSidecarScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(inputPath).toMatch(/storybound-media-sidecar[\\/]input\.json$/);
      expect(script).toContain('def generate_story');
      expect(script).toContain('def generate_music_mv');
      expect(script).toContain('music_caption_style = str(payload.get("caption_style") or "karaoke")');
      expect(script).toContain('music_tracks.append({"type": "bgm"');
      expect(script).toContain('"canvas": music_canvas');
      expect(script).toContain('def generate_compose_render');
      expect(script).toContain('def generate_remix_bgm');
      expect(script).toContain('def convert_audio_16k');
      expect(script).toContain('def normalize_scene_video');
      expect(script).toContain('"-c:v", "libx264"');
      expect(script).toContain('video_by_scene = {int(item.get("scene_id") or 0): item');
      expect(script).toContain('"media_type": "video" if video else "image"');
      expect(script).toContain('imageio_ffmpeg.get_ffmpeg_exe');
      expect(script).toContain('frame_%04d.jpg');
      expect(script).toContain('seg_cover.mp4');
      expect(script).toContain('xfade');
      expect(script).toContain('pyJianYingDraft');
      expect(script).toContain('print(json.dumps(result, ensure_ascii=False))');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes compose_render with cover, transition filters, and _source BGM remix source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-compose-script-'));

    try {
      const scriptPath = await writeStoryboundSidecarScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('cover_segment_path = os.path.join(work_dir, "seg_cover.mp4")');
      expect(script).toContain('segments = [cover_segment_path, *segments]');
      expect(script).toContain('source_path = os.path.join(work_dir, "_source.mp4")');
      expect(script).toContain('generate_remix_bgm({');
      expect(script).toContain('"source_path": source_path');
      expect(script).toContain('"-filter_complex"');
      expect(script).toContain('xfade=transition=');
      expect(script).toContain('acrossfade=d=');
      expect(script).toContain('cover_fps = str(first_scene.get("fps") or 24)');
      expect(script).toContain('"-framerate",\n            cover_fps');
      expect(script).not.toContain('"-f", "concat"');
      expect(script).not.toContain('"concat.txt"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps each scene frame stream and narration stream explicitly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-compose-map-'));

    try {
      const scriptPath = await writeStoryboundSidecarScript(dir);
      const script = await readFile(scriptPath, 'utf8');

      expect(script).toContain('"-map", "0:v:0"');
      expect(script).toContain('"-map", "1:a:0"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps video and audio streams for narration shorter than one frame interval', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-short-scene-'));
    const framesDir = join(dir, 'frames');
    const audioPath = join(dir, 'voice.wav');
    const outputPath = join(dir, 'output.mp4');

    try {
      await mkdir(framesDir, { recursive: true });
      await writeFile(
        join(framesDir, '0001.png'),
        Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAVSURBVBhXY/jPAEQNIIrhPxD8/w8AQ9QJeKxchO4AAAAASUVORK5CYII=', 'base64'),
      );
      await writeFile(audioPath, wavTone(900));

      await runStoryboundMediaSidecar({
        mode: 'compose_render',
        work_dir: dir,
        scenes: [{ frames_dir: framesDir, audio_path: audioPath, fps: 1 }],
        output_path: outputPath,
      });
      const probe = await runStoryboundMediaSidecar({
        mode: 'probe_media',
        work_dir: dir,
        media_path: outputPath,
      });

      expect(probe).toMatchObject({
        success: true,
        has_audio: true,
        has_video: true,
        width: 2,
        height: 2,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('matches the cover frame rate to the scene before applying xfade', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-cover-fps-'));
    const framesDir = join(dir, 'frames');
    const audioPath = join(dir, 'voice.wav');
    const coverPath = join(dir, 'cover.png');
    const outputPath = join(dir, 'output.mp4');
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAVSURBVBhXY/jPAEQNIIrhPxD8/w8AQ9QJeKxchO4AAAAASUVORK5CYII=', 'base64');

    try {
      await mkdir(framesDir, { recursive: true });
      await Promise.all([
        writeFile(join(framesDir, '0001.png'), image),
        writeFile(coverPath, image),
        writeFile(audioPath, wavTone(900)),
      ]);

      await runStoryboundMediaSidecar({
        mode: 'compose_render',
        work_dir: dir,
        scenes: [{ frames_dir: framesDir, audio_path: audioPath, fps: 24 }],
        cover_path: coverPath,
        cover_duration_s: 0.9,
        canvas_w: 2,
        canvas_h: 2,
        output_path: outputPath,
      });
      const probe = await runStoryboundMediaSidecar({
        mode: 'probe_media',
        work_dir: dir,
        media_path: outputPath,
      });

      expect(probe).toMatchObject({
        success: true,
        has_audio: true,
        has_video: true,
        width: 2,
        height: 2,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('probes the real duration of task-local media with the bounded sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-probe-'));
    const source = join(dir, 'source.wav');

    try {
      await writeFile(source, wavTone(220));
      const result = await runStoryboundMediaSidecar({
        mode: 'probe_media',
        work_dir: dir,
        media_path: source,
      });

      expect(result).toMatchObject({
        success: true,
        has_audio: true,
        has_video: false,
      });
      expect(result.duration).toBeCloseTo(0.22, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('can smoke-test convert_audio_16k with the bundled Python runtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-sidecar-audio-'));
    const source = join(dir, 'source.wav');
    const output = join(dir, 'converted.wav');

    try {
      await mkdir(dir, { recursive: true });
      await writeFile(source, wavTone(220));
      const result = await runStoryboundMediaSidecar({
        mode: 'convert_audio_16k',
        audio_path: source,
        output_path: output,
      });
      const bytes = await readFile(output);

      expect(result).toMatchObject({ success: true, output_path: output });
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 8000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

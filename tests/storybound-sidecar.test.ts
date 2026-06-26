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
      expect(script).toContain('def generate_compose_render');
      expect(script).toContain('def generate_remix_bgm');
      expect(script).toContain('def convert_audio_16k');
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
      expect(script).not.toContain('"-f", "concat"');
      expect(script).not.toContain('"concat.txt"');
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

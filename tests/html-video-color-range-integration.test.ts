import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeHtmlFrames } from '../electron/html-video-frame-stream';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';

// Exercise the same pinned Python/FFmpeg runtime used by the desktop app.
beforeAll(() => setDefaultPythonRuntimeAppRoot(process.cwd()));
afterAll(() => setDefaultPythonRuntimeAppRoot(undefined));

const python = (root: string, code: string, args: string[]) => runBoundedProcess(resolvePythonRuntimeInfo().command,
  ['-c', code, ...args], { cwd: root, timeoutMs: 60000, maxStdoutBytes: 200000, maxStderrBytes: 200000 });

describe('HTML picture color range through the real media encoder', () => {
  it.each([3, 97])('keeps JPEG colors and explicit limited-range metadata across %i frames and composition', async count => {
    const root = await mkdtemp(join(tmpdir(), 'render-segments-color-test-'));
    try {
      const work = join(root, 'scene-0'), frames = join(work, 'frames');
      await mkdir(frames, { recursive: true });
      const jpeg = join(root, 'palette.jpg');
      const setup = await python(root, String.raw`
from PIL import Image, ImageDraw
import sys
im = Image.new('RGB', (160, 96))
draw = ImageDraw.Draw(im)
for i, color in enumerate([(250,240,222),(38,57,85),(68,125,79),(106,178,140),(66,127,222)]):
    draw.rectangle((i*32,0,(i+1)*32-1,95), fill=color)
im.save(sys.argv[1], quality=92)
`, [jpeg]);
      expect(setup.code, setup.stderr).toBe(0);
      const bytes = await readFile(jpeg), segment = join(root, 'segment-0.mp4');
      const duration = count / 60;
      await encodeHtmlFrames({ mode: 'encode_render_scene', work_dir: work, scene: {
        frames_dir: frames, audio_path: '', audio_clips: [], duration_s: duration, fps: 60, video_frame_count: count,
      }, output_path: segment }, async write => { for (let i = 0; i < count; i++) await write(i, bytes); });
      const output = join(root, 'composed.mp4');
      // Include the actual duration-normalizing re-encode, not a mux-only path.
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: join(root, 'compose'),
        scenes: [{ segment_path: segment, duration_s: duration, fps: 60, video_frame_count: count }],
        total_duration_s: duration, output_path: output });
      const measured = await python(root, String.raw`
import json, subprocess, sys
from PIL import Image
import imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe()
points = [(i*32+16,48) for i in range(5)]
source = Image.open(sys.argv[1]).convert('RGB')
rows = []
for path in sys.argv[2:]:
    meta = subprocess.run([ff,'-hide_banner','-i',path],capture_output=True,text=True).stderr
    raw = subprocess.run([ff,'-v','error','-i',path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True).stdout
    image = Image.frombytes('RGB',(160,96),raw)
    rows.append({'limited': 'yuv420p(tv,' in meta, 'srgb709': 'bt709/bt709/iec61966-2-1' in meta, 'errors': [[abs(a-b) for a,b in zip(source.getpixel(pt), image.getpixel(pt))] for pt in points]})
print(json.dumps(rows))
`, [jpeg, segment, output]);
      expect(measured.code, measured.stderr).toBe(0);
      for (const row of JSON.parse(measured.stdout) as Array<{limited: boolean; srgb709: boolean; errors: number[][]}>) {
        // Chromium's video pipeline expands full-range JPEG-derived H.264 in
        // our offscreen host; the encoder must convert AND label limited range.
        expect(row.limited, JSON.stringify(row)).toBe(true);
        expect(row.srgb709, JSON.stringify(row)).toBe(true);
        expect(Math.max(...row.errors.flat()), JSON.stringify(row)).toBeLessThanOrEqual(3);
      }
    } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }); }
  }, 120000);
});

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeHtmlFrames } from '../electron/html-video-frame-stream';
import { runStoryboundMediaSidecar, writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
const python = (dir: string, code: string, args: string[] = []) => runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', code, ...args], { cwd: dir, timeoutMs: 60000, maxStdoutBytes: 200000, maxStderrBytes: 200000 });
describe('real streaming media encoder', () => {
  it('streams 97 exact 60fps frames with audio and the final authored frame, then consumes only owned segments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-segments-stream-test-'));
    try {
      const dir = join(root, 'scene-0'), frames = join(dir, 'frames'); await mkdir(frames, { recursive: true });
      const setup = await python(root, 'from PIL import Image\nimport sys\nImage.new("RGB",(160,90),(20,180,20)).save(sys.argv[1],quality=92)\nImage.new("RGB",(160,90),(220,20,220)).save(sys.argv[2],quality=92)', [join(root, 'first.jpg'), join(root, 'last.jpg')]);
      expect(setup.code, setup.stderr).toBe(0);
      const [first, last] = await Promise.all([readFile(join(root, 'first.jpg')), readFile(join(root, 'last.jpg'))]);
      const audio = join(root, 'voice.wav'); await writeFile(audio, wavTone(97 / 60 * 1000));
      const segment = join(root, 'segment-0.mp4');
      await encodeHtmlFrames({ mode: 'encode_render_scene', work_dir: dir, scene: { frames_dir: frames, audio_path: audio, fps: 60, duration_s: 97 / 60, video_frame_count: 97 }, output_path: segment }, async write => {
        for (let i = 0; i < 97; i++) await write(i, i === 96 ? last : first);
      });
      expect(await readdir(frames)).toEqual([]);
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: dir, media_path: segment, require_nonblack: true, measure_audio_duration: true });
      expect(probe).toMatchObject({ has_video: true, has_audio: true, width: 160, height: 90, has_nonblack_video: true });
      expect(Math.abs(probe.duration! - 97 / 60)).toBeLessThan(.08);
      expect(Math.abs(probe.audio_duration_ms! - 97 / 60 * 1000)).toBeLessThan(140);
      const script = await writeStoryboundSidecarScript(dir);
      const decodeCode = String.raw`
import json, runpy, sys
ns = runpy.run_path(sys.argv[1])
r = ns['run_bounded_subprocess']([ns['ffmpeg_exe'](), '-v', 'error', '-i', sys.argv[2], '-map', '0:v:0', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', sys.argv[3]])
if r.returncode: raise RuntimeError(r.stderr)
with open(sys.argv[3], 'rb') as f: data = f.read()
size = 160*90*3
meta = ns['run_bounded_subprocess']([ns['ffprobe_exe'](), '-v','error','-show_streams','-of','json',sys.argv[2]]) if ns['ffprobe_exe']() else None
print(json.dumps({'frames':len(data)//size, 'first':list(data[:3]), 'last':list(data[-size:-size+3]), 'meta':json.loads(meta.stdout) if meta else None}))
`;
      const decoded = await python(root, decodeCode, [script, segment, join(root, 'decoded.rgb')]);
      expect(decoded.code, decoded.stderr).toBe(0);
      const measured = JSON.parse(decoded.stdout); expect(measured.frames, JSON.stringify(measured)).toBe(97);
      expect(measured.first[1]).toBeGreaterThan(150); expect(measured.first[0]).toBeLessThan(50);
      expect(measured.last[0]).toBeGreaterThan(190); expect(measured.last[2]).toBeGreaterThan(190); expect(measured.last[1]).toBeLessThan(50);
      const composeDir = join(root, 'compose'), output = join(root, 'final.mp4');
      await runStoryboundMediaSidecar({ mode: 'compose_render', work_dir: composeDir, scenes: [{ segment_path: segment, fps: 60, duration_s: 97 / 60, video_frame_count: 97 }], output_path: output, total_duration_s: 97 / 60, consume_owned_segments: true });
      await expect(readFile(segment)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readFile(output)).length).toBeGreaterThan(500);
      const final = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: dir, media_path: output, require_nonblack: true });
      expect(final).toMatchObject({ has_audio: true, has_video: true });
      expect(Math.abs(final.duration! - 97 / 60)).toBeLessThan(.08);
      const finalDecoded = await python(root, decodeCode, [script, output, join(root, 'final.rgb')]);
      expect(finalDecoded.code, finalDecoded.stderr).toBe(0);
      const finalFrames = JSON.parse(finalDecoded.stdout);
      expect(finalFrames.frames, JSON.stringify(finalFrames)).toBe(97);
      expect(finalFrames.last[0]).toBeGreaterThan(190); expect(finalFrames.last[2]).toBeGreaterThan(190);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 90000);
  it('validates all owned paths before work, accepts generated covers and never consumes user media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'render-segments-ownership-test-'));
    try {
      const script = await writeStoryboundSidecarScript(root);
      const result = await python(root, String.raw`
import json, os, pathlib, runpy, sys
root = sys.argv[2]
fn = runpy.run_path(sys.argv[1])['generate_compose_render']
g = fn.__globals__
g['run_ffmpeg'] = lambda args, **kwargs: pathlib.Path(args[-1]).write_bytes(b'encoded')
def scene(path): return {'segment_path':path, 'fps':60, 'duration_s':1}
def payload(scenes, **kwargs): return {'work_dir':os.path.join(root,'compose'), 'scenes':scenes, 'output_path':os.path.join(root,'out.mp4'), 'consume_owned_segments':True, **kwargs}
def create(path): pathlib.Path(path).write_bytes(b'original'); return path
owned = os.path.join(root,'segment-0.mp4')
cover = create(os.path.join(root,'cover.jpg'))
fn(payload([scene(create(owned))], cover_path=cover, cover_duration_s=.1))
assert not os.path.exists(owned) and os.path.exists(cover)
fn(payload([scene(create(owned)),scene(owned)]))
assert not os.path.exists(owned)
outsider = create(os.path.join(root, 'user-original.mp4'))
create(owned)
try: fn(payload([scene(owned),scene(outsider)]))
except ValueError as e: assert 'Unsafe' in str(e)
else: raise AssertionError('unsafe input was accepted')
assert pathlib.Path(owned).read_bytes()==b'original'
assert pathlib.Path(outsider).read_bytes()==b'original'
try: fn({**payload([scene(owned)]), 'work_dir':os.path.join(root,'not-compose')})
except ValueError as e: assert 'Unsafe' in str(e)
else: raise AssertionError('unsafe directory was accepted')
print(json.dumps({'cover':True,'duplicates':True,'ownership':True,'atomicValidation':True}))
`, [script, root]);
      expect(result.code, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ cover: true, duplicates: true, ownership: true, atomicValidation: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 60000);
});

function wavTone(durationMs: number, amplitude = 8000): Buffer {
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
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * 440) * amplitude);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}


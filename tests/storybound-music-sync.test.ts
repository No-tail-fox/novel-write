import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';

describe('music MV audio/video cut synchronization', () => {
  it.each([
    { sceneCount: 20, cover: 0, encoded: true, dissolve: false },
    { sceneCount: 20, cover: 0.137, encoded: false, dissolve: false },
    { sceneCount: 6, cover: 0, encoded: true, dissolve: true },
    { sceneCount: 20, cover: 0.137, encoded: true, dissolve: true },
  ])('keeps audio-clock alignment: %j', async config => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-music-sync-'));
    try {
      const script = await writeStoryboundSidecarScript(dir);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', String.raw`
import array, json, math, runpy, struct, subprocess, sys, wave
from pathlib import Path
from PIL import Image
namespace = runpy.run_path(sys.argv[1])
root = Path(sys.argv[2])
config = json.loads(sys.argv[3])
fps = 24
scene_duration = .83
scene_count = config['sceneCount']
cover = config['cover']
durations = [scene_duration] * scene_count
frame_counts = namespace['scene_video_frame_counts'](([cover] if cover else []) + durations, fps)
if cover: frame_counts = frame_counts[1:]
# One continuous source song; each shot references its real source offset.
voice = root / 'song.wav'
pcm = array.array('h', [round(11000 * math.sin(n * 880 * math.tau / 44100)) if n % round(scene_duration * 44100) < 2646 else 0 for n in range(round(scene_duration * scene_count * 44100))])
with wave.open(str(voice), 'wb') as audio:
    audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(44100); audio.writeframes(pcm.tobytes())
scenes = []
for index in range(scene_count):
    directory = root / str(index)
    directory.mkdir()
    Image.new('RGB', (32, 32), [(210, 54, 66), (43, 176, 112)][index % 2]).save(directory / 'frame.png')
    scene = {'frames_dir': str(directory), 'audio_clips': [{'path': str(voice), 'startMs': 0, 'sourceStartMs': index * scene_duration * 1000, 'durationMs': scene_duration * 1000}], 'duration_s': scene_duration, 'fps': fps}
    if config['encoded']:
        scene['video_frame_count'] = frame_counts[index]
        segment = str(directory / 'segment.mp4')
        namespace['encode_render_scene'](scene, str(directory), segment)
        scene = {'segment_path': segment, 'duration_s': scene_duration, 'fps': fps, 'video_frame_count': frame_counts[index]}
    if config['dissolve'] and index > 0:
        scene['transition_in'] = {'type': 'dissolve', 'durationMs': 100}
    scenes.append(scene)
output = str(root / 'sync.mp4')
payload = {'work_dir': str(root / 'compose'), 'scenes': scenes, 'output_path': output, 'total_duration_s': cover + sum(durations), 'canvas_w': 32, 'canvas_h': 32, 'transition': {'type': 'cut', 'duration': 0}}
if cover:
    cover_path = root / 'cover.png'
    Image.new('RGB', (32, 32), (0, 0, 180)).save(cover_path)
    payload.update(cover_path=str(cover_path), cover_duration_s=cover)
namespace['generate_compose_render'](payload)
ffmpeg = namespace['ffmpeg_exe']()
video = subprocess.check_output([ffmpeg, '-v', 'error', '-i', output, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], timeout=30)
frame_size = 32 * 32 * 3
frames = [video[offset:offset+frame_size] for offset in range(0, len(video), frame_size)]
def color(frame):
    offset = (16 * 32 + 16) * 3
    r, g, b = frame[offset:offset+3]
    return 'cover' if b > r and b > g else 'red' if r > g else 'green'
cut_times = [index / fps for index in range(1, len(frames)) if color(frames[index]) != color(frames[index-1])]
audio_raw = subprocess.check_output([ffmpeg, '-v', 'error', '-i', output, '-map', '0:a:0', '-ac', '1', '-ar', '44100', '-f', 's16le', '-'], timeout=30)
samples = struct.unpack('<' + 'h' * (len(audio_raw) // 2), audio_raw)
def rms(start, width=220):
    chunk = samples[max(0, start):max(0, start) + width]
    return (sum(float(sample) * sample for sample in chunk) / max(1, len(chunk))) ** .5
marker_starts = []
for scene_index in range(scene_count):
    expected = round((cover + scene_index * scene_duration) * 44100)
    search_start = max(0, expected - 4410)
    search_end = min(len(samples) - 220, expected + 4410)
    windows = [(index, rms(index)) for index in range(search_start, search_end + 1, 220)]
    threshold = max(500, max(value for _, value in windows) * 0.1)
    marker_starts.append(next(index for index, value in windows if value >= threshold) / 44100)
song_cut_times = cut_times[1:] if cover else cut_times
errors = [song_cut_times[index] - marker_starts[index + 1] for index in range(min(len(song_cut_times), len(marker_starts) - 1))]
audio_errors = [marker_starts[index] - (cover + index * scene_duration) for index in range(scene_count)]
# Inspect actual pixel blend weights, not a hue threshold masquerading as the
# 50% point. FFmpeg quantizes the dissolve window to the output frame grid.
all_counts = namespace['scene_video_frame_counts'](([cover] if cover else []) + durations, fps)
def rgb(frame):
    offset = (16 * 32 + 16) * 3
    return list(frames[frame][offset:offset+3])
boundaries = []
cursor = all_counts[0] if cover else 0
for scene_index in range(scene_count):
    if scene_index > 0:
        previous, incoming = rgb(cursor-1), rgb(cursor+frame_counts[scene_index]-1)
        vector = [incoming[c]-previous[c] for c in range(3)]
        norm = sum(v*v for v in vector)
        weights = [sum((rgb(f)[c]-previous[c])*vector[c] for c in range(3))/norm for f in range(cursor,cursor+5)]
        blend_frames = math.ceil(.1 * fps) if config['dissolve'] else 0
        assert abs(weights[0] - (0 if config['dissolve'] else 1)) < .04, (scene_index, weights)
        assert abs(weights[blend_frames]-1) < .04, (scene_index, weights)
        assert all(weights[i+1] >= weights[i]-.04 for i in range(4)), (scene_index, weights)
        assert all(abs(sum((rgb(f)[c]-previous[c])*vector[c] for c in range(3))/norm-1) < .04 for f in range(cursor+blend_frames,cursor+frame_counts[scene_index])), scene_index
        # The scene clock must still meet the authored audio boundary within half a frame.
        assert abs(cursor/fps-(cover+scene_index*scene_duration)) <= .5/fps+1e-9
        boundaries.append({'frame':cursor,'weights':[round(value,3) for value in weights]})
    cursor += frame_counts[scene_index]
report = {'sceneCount': scene_count, 'cutCount': len(cut_times), 'markerCount': len(marker_starts), 'maxAbsoluteOffsetMs': round(max(abs(value) for value in errors) * 1000, 3), 'audioMaxOffsetMs': max(abs(value) for value in audio_errors) * 1000, 'videoDuration': len(frames) / fps, 'offsetsMs': [round(value * 1000, 3) for value in errors], 'cutTimes': cut_times[:5], 'markerStarts': marker_starts[:5], 'validatedBoundaries':len(boundaries), 'boundarySamples':boundaries[:3]}
print(json.dumps(report))
`, script, dir, JSON.stringify(config)], { cwd: dir, timeoutMs: 120_000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      console.info('MV sync measurement', JSON.stringify({ config, ...report }));
      expect(report.cutCount).toBe(config.sceneCount - 1 + (config.cover ? 1 : 0));
      expect(report.markerCount).toBe(config.sceneCount);
      expect(report.audioMaxOffsetMs, JSON.stringify(report)).toBeLessThanOrEqual(10);
      expect(report.validatedBoundaries).toBe(config.sceneCount - 1);
      if (!config.dissolve) expect(report.maxAbsoluteOffsetMs, JSON.stringify(report)).toBeLessThanOrEqual(26);
      expect(Math.abs(report.videoDuration - (config.cover + config.sceneCount * 0.83))).toBeLessThanOrEqual(1 / 24);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    }
  }, 150_000);
});

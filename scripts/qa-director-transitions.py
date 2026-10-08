"""Real ffmpeg evidence: blend boundaries without changing narration or duration."""
import array, json, math, runpy, subprocess, sys, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

namespace = runpy.run_path(sys.argv[1])
root = Path(sys.argv[2]); root.mkdir(parents=True, exist_ok=True)
ffmpeg = namespace['ffmpeg_exe']()
fps = 24
durations = [1.31, 1.27, 1.41]
colors = [(192, 45, 35), (36, 142, 83), (35, 92, 182)]
paths = []
for index, duration in enumerate(durations):
    directory = root / f'source-{index}'; directory.mkdir(exist_ok=True)
    image = Image.new('RGB', (480, 270), colors[index]); draw = ImageDraw.Draw(image)
    draw.rectangle((50, 60, 160, 220), fill=(235, 213, 163)); draw.text((230, 135), f'SHOT {index + 1}', fill='white')
    image.save(directory / 'frame.png')
    source_audio = directory / 'voice.wav'
    count = round(44100 * duration)
    # Distinct continuous tones include a late transient to detect lost endings.
    pcm = array.array('h', [round((7500 if n < count - 882 else 14000) * math.sin(n * (330 + index * 220) * math.tau / 44100)) for n in range(count)])
    with wave.open(str(source_audio), 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(44100); audio.writeframes(pcm.tobytes())
    segment = directory / 'segment.mp4'
    namespace['encode_render_scene']({'frames_dir': str(directory), 'duration_s': duration, 'fps': fps, 'audio_path': str(source_audio)}, str(directory), str(segment))
    paths.append(str(segment))

def compose(name, scene_paths, scene_durations, enabled):
    destination = root / name
    payload = {'mode': 'compose_render', 'work_dir': str(root / (name + '-work')), 'output_path': str(destination), 'total_duration_s': sum(scene_durations), 'transition': {'type': 'cut', 'duration': 0},
               'scenes': [{'segment_path': path, 'fps': fps, 'duration_s': duration, **({'transition_in': (enabled[index] if isinstance(enabled, list) else {'type': 'dissolve', 'durationMs': 200})} if enabled else {})} for index, (path, duration) in enumerate(zip(scene_paths, scene_durations))]}
    namespace['generate_compose_render'](payload)
    return destination

def audio(path):
    data = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'])
    return np.frombuffer(data, dtype='<f4')

def frame(path, time):
    data = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', str(time), '-i', str(path), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(data, dtype=np.uint8).reshape((270, 480, 3))

checks = []
for count in [3, 10]:
    scene_paths = [paths[i % 3] for i in range(count)]
    scene_durations = [durations[i % 3] for i in range(count)]
    hard = compose(f'{count}-shots-cut.mp4', scene_paths, scene_durations, False)
    soft = compose(f'{count}-shots-dissolve.mp4', scene_paths, scene_durations, True)
    expected = sum(scene_durations)
    for path in [hard, soft]:
        actual = namespace['media_duration_s'](str(path))
        assert abs(actual - expected) < 1 / fps + .01, (path, actual, expected)
    plain_audio, soft_audio = audio(hard), audio(soft)
    assert len(plain_audio) == len(soft_audio), (len(plain_audio), len(soft_audio))
    full_correlation = float(np.corrcoef(plain_audio, soft_audio)[0, 1])
    assert full_correlation > .999, full_correlation
    tail_correlation = float(np.corrcoef(plain_audio[-6000:], soft_audio[-6000:])[0, 1])
    assert tail_correlation > .999, tail_correlation
    first_boundary = scene_durations[0]
    before = frame(soft, first_boundary - .1)
    during = frame(soft, first_boundary + .08)
    after = frame(soft, first_boundary + .4)
    # Plain backdrop contains both outgoing red and incoming green only during dissolve.
    region = lambda image: image[10:45, 240:420].mean(axis=(0, 1))
    red, blend, green = map(region, [before, during, after])
    assert red[0] > blend[0] > green[0] + 15, (red, blend, green)
    assert red[1] + 15 < blend[1] < green[1], (red, blend, green)
    Image.fromarray(np.concatenate([before, during, after], axis=1)).save(root / f'{count}-shots-transition-contact.png')
    checks.append({'shots': count, 'expectedDuration': expected, 'actualDuration': namespace['media_duration_s'](str(soft)), 'audioSamples': len(soft_audio), 'audioCorrelationAgainstHardCut': full_correlation,
                   'endingCorrelation': tail_correlation, 'boundaryRGB': [red.tolist(), blend.tolist(), green.tolist()]})
mixed = compose('mixed-cut-and-dissolve.mp4', paths, durations, [{'type': 'cut', 'durationMs': 0}, {'type': 'dissolve', 'durationMs': 200}, {'type': 'cut', 'durationMs': 0}])
mixed_boundary = frame(mixed, sum(durations[:2]) + .08)
assert np.max(np.abs(mixed_boundary[10:45, 240:420].mean(axis=(0, 1)) - np.array(colors[2]))) < 8
checks.append({'mixedTransitions': 'second shot dissolves; third shot remains an explicit hard cut'})
assert not list(root.rglob('*.filter'))
assert not list(root.rglob('compose-visual-transitions-*'))
print(json.dumps({'status': 'passed', 'checks': checks, 'paidCalls': 0}))

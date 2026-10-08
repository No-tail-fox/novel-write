"""Retain a complete real narration while testing multiple visual-only joins."""
from pathlib import Path
import json, runpy, subprocess, sys
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/director-transitions-real-media'
OUT.mkdir(parents=True, exist_ok=True)
ns = runpy.run_path(str(ROOT / '.artifacts/director-transitions-qa/storybound-media-sidecar/sidecar.py'))
ffmpeg = ns['ffmpeg_exe']()
original = ROOT / '.artifacts/vox-latest-media-20260916/real-shot-render/selfism-real-shot-local-motion.mp4'
durations = [1.0, 2.0, 11.667]
paths = []; start = 0
for index, duration in enumerate(durations):
    path = OUT / f'source-section-{index}.mp4'
    ns['run_ffmpeg'](['-ss', str(start), '-i', str(original), '-t', str(duration), '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', str(path)])
    paths.append(path); start += duration
output = OUT / 'selfism-full-narration-visual-transitions.mp4'
baseline = OUT / 'selfism-sections-hard-cut.mp4'
for destination, dissolve in [(baseline, False), (output, True)]:
    ns['generate_compose_render']({'mode': 'compose_render', 'work_dir': str(OUT / ('compose-soft' if dissolve else 'compose-cut')), 'output_path': str(destination), 'transition': {'type': 'cut', 'duration': 0}, 'total_duration_s': sum(durations),
        'scenes': [{'segment_path': str(path), 'fps': 24, 'duration_s': duration, **({'transition_in': {'type': 'dissolve', 'durationMs': 200}} if dissolve else {})} for path, duration in zip(paths, durations)]})
def decode(path):
    data = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'])
    return np.frombuffer(data, dtype='<f4')
document = json.loads((ROOT / '.artifacts/vox-latest-media-20260916/real-shot-render/isolated-shot.json').read_text(encoding='utf-8'))
speech = next(clip for clip in document['timeline']['audioClips'] if clip['trackType'] == 'narration')
asset = next(asset for asset in document['assets'] if asset['id'] == speech['assetVersionId'])
source, video = decode(asset['localPath']), decode(output)
reference = decode(baseline)
assert len(reference) == len(video)
actual_duration, baseline_duration = ns['media_duration_s'](str(output)), ns['media_duration_s'](str(baseline))
assert actual_duration == baseline_duration
assert abs(actual_duration - sum(durations)) < 2 / 24
transition_correlation = float(np.corrcoef(reference, video)[0, 1]); assert transition_correlation > .999999
assert len(video) >= len(source)
aligned = video[:len(source)]
correlation = float(np.corrcoef(source, aligned)[0, 1])
audible = np.flatnonzero(np.abs(source) > .003); audible_end = int(audible[-1]) + 1
tail = float(np.corrcoef(source[audible_end - 4000:audible_end], aligned[audible_end - 4000:audible_end])[0, 1])
assert correlation > .99 and tail > .99, (correlation, tail)
boundary_audio = []
for boundary in [1, 3]:
    start = round((boundary - .1) * 16000); end = round((boundary + .4) * 16000)
    value = float(np.corrcoef(reference[start:end], video[start:end])[0, 1]); assert value > .999999
    boundary_audio.append({'boundaryMs': boundary * 1000, 'correlationAgainstHardCut': value})
frames = []
for seconds in [.94, 1.04, 1.12, 1.3]:
    data = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', str(seconds), '-i', str(output), '-frames:v', '1', '-vf', 'scale=480:270', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    frames.append(np.frombuffer(data, dtype=np.uint8).reshape((270, 480, 3)))
Image.fromarray(np.concatenate(frames, axis=1)).save(OUT / 'real-transition-contact.png')
report = {'status': 'passed', 'sampleVideo': str(output), 'source': str(original), 'sourceProjectTitle': '今天要介绍的是——自我主义',
          'scope': '原有真实首镜头分成三段，验证两个转场边界；保留完整原旁白。不是新项目出片。', 'visualSections': 3, 'paidCalls': 0, 'liveDatabaseModified': False,
          'expectedDurationMs': sum(durations) * 1000, 'durationMs': actual_duration * 1000, 'hardCutDurationMs': baseline_duration * 1000,
          'sourceNarrationMs': len(source) / 16, 'fullCorrelation': correlation, 'last250AudibleMsCorrelation': tail, 'transitionAudioCorrelationAgainstHardCut': transition_correlation, 'boundaryAudio': boundary_audio}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

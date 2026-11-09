"""Compare the production mix across shot cuts against an unsliced music clock."""
import json
from pathlib import Path
import runpy
import subprocess
import sys
import wave
import numpy as np

sidecar = runpy.run_path(sys.argv[1])
work = Path(sys.argv[2])
fixture = json.loads((work / 'music-clips.json').read_text(encoding='utf8'))
ffmpeg = sidecar['ffmpeg_exe']()
subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*(220*t+11*t*t)):s=44100:d=7', fixture['path']], check=True)

def mix(clips, duration, index):
    resolved = [{**clip, 'path': fixture['path']} for clip in clips]
    path = sidecar['scene_audio_input']({'audio_clips': resolved}, duration / 1000, str(work), index)
    with wave.open(path, 'rb') as audio:
        return np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').reshape(-1, 2).astype(float)

timeline = fixture['timeline']
pieces = []
for index, shot in enumerate(timeline['clips']):
    clips = [{**clip, 'startMs': clip['startMs'] - shot['startMs']} for clip in timeline['audioClips'] if clip['shotId'] == shot['shotId']]
    pieces.append(mix(clips, shot['durationMs'], index))
actual = np.concatenate(pieces)
expected = mix(fixture['reference'], timeline['durationMs'], 999)
assert actual.shape == expected.shape, (actual.shape, expected.shape)
correlation = float(np.corrcoef(actual[:, 0], expected[:, 0])[0, 1])
maximum_error = float(np.max(np.abs(actual - expected)))
assert correlation > .999999, correlation
assert maximum_error <= 2, maximum_error
print(json.dumps({'status': 'passed', 'shots': len(pieces), 'loopMs': 7000, 'durationMs': timeline['durationMs'], 'samples': len(actual), 'correlation': correlation, 'maximumPcmError': maximum_error}))

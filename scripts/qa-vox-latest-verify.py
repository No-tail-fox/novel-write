from pathlib import Path
import json
import subprocess
import imageio_ffmpeg
import numpy as np

OUT = Path(__file__).resolve().parents[1] / '.artifacts' / 'vox-latest-media-20260916' / 'real-shot-render'
report = json.loads((OUT / 'report.json').read_text(encoding='utf-8'))
assert report['status'] == 'passed', report.get('error')
document = json.loads((OUT / 'isolated-shot.json').read_text(encoding='utf-8'))
speech = next(clip for clip in document['timeline']['audioClips'] if clip['trackType'] == 'narration')
asset = next(asset for asset in document['assets'] if asset['id'] == speech['assetVersionId'])

def decode(path):
    process = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(process.stdout, dtype='<f4')

source = decode(asset['localPath'])
video = decode(report['sampleVideo'])
length = min(len(source), 32000)
template = source[:length].astype(float)
search = video[:length + 1600].astype(float)
size = 1 << (len(search) + len(template) - 2).bit_length()
correlation = np.fft.irfft(np.fft.rfft(search, size) * np.fft.rfft(template[::-1], size), size)
offset = int(np.argmax(correlation[length - 1:len(search)]))
aligned = video[offset:offset + len(source)]
assert len(aligned) == len(source), 'The export truncated the original narration.'
correlation_full = float(np.corrcoef(source, aligned)[0, 1])
audible = np.flatnonzero(np.abs(source) > 0.003)
assert len(audible), 'Expected an audible real narration recording.'
audible_end = int(audible[-1]) + 1
audible_start = max(0, audible_end - 4000)
correlation_tail = float(np.corrcoef(source[audible_start:audible_end], aligned[audible_start:audible_end])[0, 1])
result = {'status': 'passed', 'sourceMs': len(source) / 16, 'exportAudioMs': len(video) / 16, 'measuredStartOffsetMs': offset / 16, 'fullCorrelation': correlation_full, 'last250AudibleMsCorrelation': correlation_tail, 'trailingQuietSourceMs': (len(source) - audible_end) / 16, 'sourceRetainedMs': speech['durationMs']}
assert offset / 16 <= 1
assert correlation_full > .99
assert correlation_tail > .99
(OUT / 'audio-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))

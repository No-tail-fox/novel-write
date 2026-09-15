import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path
import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw

root = Path(sys.argv[2]).resolve()
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def decode(path):
    raw = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], timeout=30)
    return np.frombuffer(raw, dtype=np.float32)

def create():
    Image.new('RGB', (960, 540), '#d6ceb6').save(root / 'background.png')
    for index, duration in enumerate([.820, 1.414]):
        image = Image.new('RGBA', (400, 500), (0, 0, 0, 0))
        d = ImageDraw.Draw(image)
        d.rounded_rectangle((40, 40, 360, 460), 35, fill=['#bc492a', '#255f9c'][index])
        d.ellipse((115, 100, 285, 270), fill='#efe7cf')
        image.save(root / f'subject-{index}.png')
        with wave.open(str(root / f'voice-{index}.wav'), 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
            samples = bytearray()
            for n in range(round(duration * 16000)):
                t = n / 16000
                envelope = min(1, t/.015, (duration-t)/.010)
                # Chirps identify the source and preserve an audible marker in the final 414ms.
                phase = math.tau * ((420 + index*200)*t + (350 + index*170)*t*t)
                sample = round(10000 * envelope * math.sin(phase))
                samples.extend(struct.pack('<h', sample))
            output.writeframes(samples)
    return {'audioDurationsMs': [820, 1414], 'paidCalls': 0}

def verify():
    expected = json.loads((root / 'expected.json').read_text(encoding='utf-8'))
    audio = decode(expected['video'])
    results = []
    for shot in expected['shots']:
        source = decode(shot['audioPath'])
        predicted = round(shot['startMs'] * 16)
        pad = 800
        lo = max(0, predicted-pad)
        window = audio[lo:predicted+pad+len(source)]
        correlations = np.correlate(window, source, 'valid')
        located = lo + int(np.argmax(correlations))
        actual = audio[located:located+len(source)]
        corr = float(np.corrcoef(source, actual)[0, 1])
        tail_corr = float(np.corrcoef(source[-4000:], actual[-4000:])[0, 1])
        offset_ms = (located-predicted)/16
        assert abs(offset_ms) <= 42, offset_ms
        assert corr > .97 and tail_corr > .97, (corr, tail_corr)
        assert shot['durationMs'] >= shot['audioMs'], shot
        results.append({**shot, 'offsetMs': offset_ms, 'fullCorrelation': corr, 'last250msCorrelation': tail_corr, 'retainedTail': True})
    return {'status': 'passed', 'shots': results, 'decodedAudioMs': len(audio)/16, 'finalTailVerified': True}

print(json.dumps(create() if sys.argv[1] == 'create' else verify(), ensure_ascii=True))

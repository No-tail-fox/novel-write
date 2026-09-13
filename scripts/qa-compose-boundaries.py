"""Compare grouped and original composition at every 1080p group boundary."""
import json
import math
import subprocess
from io import BytesIO
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageChops, ImageDraw, ImageStat

root = Path(__file__).resolve().parents[1]
artifacts = root / '.artifacts/compose-long-1080p-qa'
current, previous = artifacts / 'result.mp4', artifacts / 'single-stage.mp4'
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()


def frame(path, time):
    raw = subprocess.check_output([ffmpeg, '-v', 'error', '-ss', str(time), '-i', str(path), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', '-'], timeout=30)
    return Image.open(BytesIO(raw)).convert('RGB')


def audio_hash(path):
    return subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 'hash', '-hash', 'sha256', '-'], timeout=90).decode().strip()


times = [boundary+offset for boundary in range(80, 600, 80) for offset in [-.1, .1]]
sheet = Image.new('RGB', (960, math.ceil(len(times)/2)*300), 'white')
draw = ImageDraw.Draw(sheet)
checks = []
for index, time in enumerate(times):
    actual, expected = frame(current, time), frame(previous, time)
    assert actual.size == expected.size == (1920,1080)
    difference = ImageStat.Stat(ImageChops.difference(actual, expected))
    mean_error = sum(difference.mean)/3
    if mean_error >= 2.5:
        actual.save(artifacts/f'boundary-{time}-actual.png')
        expected.save(artifacts/f'boundary-{time}-expected.png')
    checks.append({'time':time,'meanAbsolutePixelError':mean_error})
    actual.thumbnail((480,270))
    x,y = index%2*480,index//2*300
    sheet.paste(actual,(x,y))
    draw.text((x+8,y+275),str(time)+' s',fill='black')
sheet.save(artifacts/'group-boundaries.png')
current_audio_hash, previous_audio_hash = audio_hash(current), audio_hash(previous)
assert current_audio_hash == previous_audio_hash, (current_audio_hash,previous_audio_hash)
report = {'status':'passed' if all(check['meanAbsolutePixelError'] < 2.5 for check in checks) else 'failed','checkedGroupBoundaries':len(times)//2,'frameChecks':checks,'allAudioSamplesIdentical':True,'pcmSha256':current_audio_hash}
(artifacts/'boundary-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
assert report['status'] == 'passed'

"""Synthetic media and pixel measurements for the real local VOX renderer. No network."""
from __future__ import annotations

import io
import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont


def create(root: Path) -> dict:
    background = Image.new('RGB', (1920, 1080), '#d8cbb1')
    draw = ImageDraw.Draw(background)
    for y in range(0, 1080, 8):
        draw.line((0, y, 1920, y), fill='#d4c7ae', width=1)
    for column in range(15):
        x = column * 145 - 40
        top = 170 + (column * 73) % 160
        draw.rectangle((x, top, x + 95, 690), fill='#aaa798', outline='#97998d', width=3)
        for window_y in range(top + 20, 680, 42):
            for window_x in (x + 14, x + 55):
                draw.rectangle((window_x, window_y, window_x + 23, window_y + 23), fill='#d7d0bd')
    draw.rectangle((0, 690, 1920, 1080), fill='#b1aa96')
    background.save(root / 'background.png')
    # Large source with antialiased transparent edges; orange pixels let QA locate the actor after encoding.
    cutout = Image.new('RGBA', (1800, 1800), (0, 0, 0, 0))
    d = ImageDraw.Draw(cutout)
    d.ellipse((1170, 510, 1660, 1100), fill='#f56624')
    d.ellipse((1280, 630, 1530, 980), fill=(0, 0, 0, 0))
    d.rounded_rectangle((250, 420, 1340, 1400), radius=180, fill='#f56624')
    d.ellipse((250, 315, 1340, 620), fill='#fff4d8')
    d.ellipse((330, 360, 1260, 550), fill='#493a2c')
    d.ellipse((180, 1330, 1450, 1510), fill='#efbf78')
    for x in (630, 870, 1110):
        d.arc((x - 40, 80, x + 140, 330), 75, 245, fill='#fff4d8', width=34)
    cutout = cutout.resize((900, 900), Image.Resampling.LANCZOS)
    cutout.save(root / 'cutout.png')
    alpha = cutout.getchannel('A')
    values = list(alpha.getdata())
    transparent = sum(value == 0 for value in values)
    partial = sum(0 < value < 255 for value in values)
    assert transparent > len(values) * 0.3 and partial > 100
    with wave.open(str(root / 'tone.wav'), 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
        samples = bytearray()
        for sample in range(64000):
            envelope = min(1, sample / 1200, (64000 - sample) / 1200)
            samples.extend(struct.pack('<h', round(math.sin(sample * 330 * math.tau / 16000) * envelope * 3800)))
        output.writeframes(samples)
    return {'transparentPixels': transparent, 'antialiasedPixels': partial, 'totalPixels': len(values), 'durationMs': 4000}


def verify(root: Path, video: Path) -> dict:
    frames = []
    observations = []
    for index, (time, name) in enumerate(((0.1, 'before'), (0.48, 'enter'), (1.6, 'settled'), (3.8, 'exit'))):
        raw = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(time), '-i', str(video), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', '-'], timeout=45)
        path = root / f'{index + 1:02d}-{name}.png'
        path.write_bytes(raw)
        frame = Image.open(io.BytesIO(raw)).convert('RGB')
        assert frame.size == (1920, 1080)
        # Color masking on the decoded MP4, independent of authored keyframe sampling.
        pixels = frame.load()
        points = [(x, y) for y in range(0, 880, 3) for x in range(0, 1920, 3)
                  if pixels[x, y][0] > 120 and 32 < pixels[x, y][1] < 170 and pixels[x, y][2] < 125
                  and pixels[x, y][0] - pixels[x, y][2] > 70 and pixels[x, y][1] - pixels[x, y][2] > 15
                  and pixels[x, y][0] > pixels[x, y][1] * 1.25]
        observations.append({'atSeconds': time, 'phase': name, 'actorPixels': len(points) * 9,
                             'centroidX': sum(point[0] for point in points) / len(points) if points else None,
                             'centroidY': sum(point[1] for point in points) / len(points) if points else None,
                             'screenshot': str(path)})
        thumb = frame.resize((960, 540), Image.Resampling.LANCZOS)
        canvas = Image.new('RGB', (960, 580), '#f7f4ed')
        canvas.paste(thumb, (0, 40))
        ImageDraw.Draw(canvas).text((18, 10), f'{name.upper()} | {time:.2f} s', fill='#232323', font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 21))
        frames.append(canvas)
    before, enter, settled, exit_frame = observations
    assert settled['actorPixels'] > 65000, observations
    assert before['actorPixels'] < settled['actorPixels'] * 0.03, observations
    assert enter['actorPixels'] > 5000 and enter['centroidX'] > settled['centroidX'] + 150, observations
    assert exit_frame['actorPixels'] < settled['actorPixels'] * 0.7, observations
    assert exit_frame['centroidX'] < settled['centroidX'] - 250, observations
    montage = Image.new('RGB', (1920, 1160), '#f7f4ed')
    for index, frame in enumerate(frames):
        montage.paste(frame, ((index % 2) * 960, (index // 2) * 580))
    montage.save(root / 'motion-contact-sheet.png')
    result = {'frames': observations, 'actorEntranceShiftPixels': enter['centroidX'] - settled['centroidX'],
              'actorExitShiftPixels': settled['centroidX'] - exit_frame['centroidX'],
              'contactSheet': str(root / 'motion-contact-sheet.png'), 'decodedVideoVerified': True}
    (root / 'pixel-measurements.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    mode, directory = sys.argv[1:3]
    artifacts = Path(directory).resolve()
    print(json.dumps(create(artifacts) if mode == 'create' else verify(artifacts, Path(sys.argv[3]).resolve()), ensure_ascii=True))

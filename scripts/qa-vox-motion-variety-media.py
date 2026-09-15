"""Offline synthetic media and measurements from an actual encoded five-scene MP4."""
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

ORANGE = '#ed681f'
BLUE = '#196ace'
FONT = 'C:/Windows/Fonts/msyh.ttc'

def create(root: Path) -> dict:
    colors = ['#d8cbb1', '#cdd5bf', '#e1d0b7', '#cacfd1', '#d4c9ba']
    for index, color in enumerate(colors):
        image = Image.new('RGB', (1920, 1080), color)
        d = ImageDraw.Draw(image)
        for y in range(0, 1080, 9): d.line((0, y, 1920, y), fill='#c1c0b3', width=1)
        for column in range(15):
            x = column * 145 - 40; top = 210 + (column * 73) % 170
            d.rectangle((x, top, x + 95, 780), fill='#aaa99e', outline='#95998d', width=3)
            for wy in range(top + 20, 760, 42):
                for wx in (x + 14, x + 55): d.rectangle((wx, wy, wx + 23, wy + 23), fill='#d7d0bd')
        d.rectangle((0, 780, 1920, 1080), fill='#b1aa96')
        image.save(root / f'background-{index}.png')
    transparencies = {}
    for actor in ['coffee', 'teapot', 'newspaper', 'photo', 'blueprint']:
        image = Image.new('RGBA', (900, 900), (0, 0, 0, 0)); d = ImageDraw.Draw(image)
        if actor == 'coffee':
            d.ellipse((600, 270, 825, 590), fill=ORANGE); d.ellipse((660, 340, 770, 525), fill=(0, 0, 0, 0))
            d.rounded_rectangle((120, 230, 690, 745), radius=90, fill=ORANGE)
            d.ellipse((120, 175, 690, 330), fill='#fff4d8'); d.ellipse((170, 205, 650, 295), fill='#493a2c')
            d.ellipse((85, 720, 750, 810), fill='#eebf78')
            for x in (320, 445, 570): d.arc((x-20, 30, x+65, 160), 75, 245, fill='#fff4d8', width=17)
        elif actor == 'teapot':
            d.ellipse((560, 235, 825, 660), fill=BLUE); d.ellipse((620, 310, 765, 590), fill=(0, 0, 0, 0))
            d.polygon([(240, 420), (75, 295), (35, 255), (80, 490), (270, 620)], fill=BLUE)
            d.ellipse((160, 280, 710, 790), fill=BLUE); d.ellipse((245, 210, 635, 360), fill='#f6e5bb')
            d.ellipse((395, 155, 485, 240), fill=BLUE)
            d.arc((265, 350, 605, 720), 20, 150, fill='#f6e5bb', width=12)
        elif actor == 'newspaper':
            d.rectangle((90, 100, 800, 795), fill=ORANGE)
            d.rectangle((115, 130, 775, 770), fill='#fff4dc')
            d.rectangle((145, 165, 745, 235), fill=ORANGE)
            d.rectangle((150, 285, 425, 495), fill=ORANGE)
            for y in range(290, 500, 35): d.rectangle((465, y, 735, y+9), fill='#5c5449')
            for y in range(545, 710, 30): d.rectangle((150, y, 735, y+9), fill='#5c5449')
        elif actor == 'photo':
            d.rectangle((80, 120, 820, 790), fill='#fff4dc')
            d.rectangle((120, 160, 780, 690), fill=ORANGE)
            d.polygon([(120, 560), (330, 260), (460, 450), (620, 280), (780, 555), (780, 690), (120, 690)], fill='#58534b')
            d.rectangle((265, 535, 350, 690), fill='#c9c1a5'); d.rectangle((520, 540, 605, 690), fill='#c9c1a5')
            d.ellipse((160, 195, 240, 275), fill='#fff4dc')
        else:
            d.rectangle((80, 120, 820, 790), fill='#fff4dc'); d.rectangle((115, 155, 785, 750), fill=BLUE)
            for x in range(145, 770, 40): d.line((x, 155, x, 750), fill='#70a2cf', width=1)
            for y in range(175, 750, 40): d.line((115, y, 785, y), fill='#70a2cf', width=1)
            d.rectangle((230, 290, 670, 660), outline='#f5f0df', width=8)
            d.polygon([(185, 290), (450, 195), (710, 290)], outline='#f5f0df', width=8)
            for x in (275, 460, 575): d.rectangle((x, 365, x+55, 435), outline='#f5f0df', width=5)
            d.rectangle((400, 520, 490, 660), outline='#f5f0df', width=5)
        image.save(root / f'{actor}.png')
        values = list(image.getchannel('A').getdata()); transparencies[actor] = sum(value == 0 for value in values)
        assert transparencies[actor] > len(values) * 0.25
    with wave.open(str(root / 'tone.wav'), 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
        samples = bytearray()
        for sample in range(40000):
            envelope = min(1, sample / 1200, (40000 - sample) / 1200)
            samples.extend(struct.pack('<h', round(math.sin(sample * 330 * math.tau / 16000) * envelope * 2500)))
        output.writeframes(samples)
    return {'actors': list(transparencies), 'transparentPixels': transparencies, 'durationMs': 12500}

def measure(frame: Image.Image, color: str) -> dict:
    pixels = frame.load()
    def matches(value):
        r, g, b = value
        return (r > 150 and 45 < g < 150 and b < 95 and r > g * 1.5) if color == 'orange' else (b > 110 and r < 100 and g < 155 and b > g * 1.4)
    points = [(x, y) for y in range(180, 900, 3) for x in range(0, 1920, 3) if matches(pixels[x, y])]
    return {'pixels': len(points) * 9, 'x': round(sum(x for x, y in points) / len(points), 2) if points else None, 'y': round(sum(y for x, y in points) / len(points), 2) if points else None}

def verify(root: Path, video: Path) -> dict:
    styles = ['cutout-slide', 'focus-reveal', 'comparison', 'path-progress', 'evidence-stack']
    titles = ['咖啡馆连接城市', '茶馆里的公共空间', '咖啡与茶的相遇', '报纸走进街巷', '档案记录街道变迁']
    observations = []
    sheet = Image.new('RGB', (1920, 1980), '#f7f4ed')
    for index, style in enumerate(styles):
        scene = {'style': style, 'title': titles[index], 'frames': []}
        for phase, fraction in enumerate((0.16 if style == 'evidence-stack' else 0.12, 0.44, 0.75)):
            time = index * 2.5 + 2.5 * fraction
            raw = subprocess.check_output([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-ss', str(time), '-i', str(video), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-threads', '1', '-'], timeout=45)
            path = root / f'{index+1:02d}-{style}-{phase+1}.png'; path.write_bytes(raw)
            frame = Image.open(io.BytesIO(raw)).convert('RGB'); assert frame.size == (1920, 1080)
            scene['frames'].append({'time': time, 'fraction': fraction, 'orange': measure(frame, 'orange'), 'blue': measure(frame, 'blue'), 'screenshot': str(path)})
            thumb = frame.resize((640, 360), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (phase * 640, index * 396 + 36))
            ImageDraw.Draw(sheet).text((phase * 640 + 12, index * 396 + 5), f'{index+1} {titles[index]} | {fraction*100:.0f}%', fill='#252525', font=ImageFont.truetype(FONT, 20))
        observations.append(scene)
    slide, reveal, comparison, path, evidence = [scene['frames'] for scene in observations]
    assert slide[0]['orange']['x'] > slide[1]['orange']['x'] + 100, slide
    assert reveal[1]['blue']['pixels'] > reveal[0]['blue']['pixels'] * 1.6, reveal
    assert abs(reveal[1]['blue']['x'] - reveal[2]['blue']['x']) < 40, reveal
    assert comparison[0]['blue']['pixels'] < 100, comparison
    assert comparison[1]['blue']['pixels'] > 10000 and comparison[1]['orange']['pixels'] > 10000, comparison
    assert comparison[1]['blue']['x'] - comparison[1]['orange']['x'] > 700, comparison
    assert path[1]['orange']['x'] - path[0]['orange']['x'] > 400, path
    assert path[2]['orange']['x'] - path[1]['orange']['x'] > 400, path
    assert path[0]['orange']['y'] - path[1]['orange']['y'] > 100, path
    assert evidence[0]['orange']['pixels'] > 5000, evidence
    assert evidence[0]['orange']['y'] < evidence[1]['orange']['y'] - 100, evidence
    assert evidence[1]['blue']['pixels'] < 100 and evidence[2]['blue']['pixels'] > 10000, evidence
    contact = root / 'five-motion-contact-sheet.png'; sheet.save(contact)
    result = {'distinctMotionStyles': 5, 'decodedVideoVerified': True, 'frames': observations, 'contactSheet': str(contact)}
    (root / 'pixel-measurements.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result

if __name__ == '__main__':
    mode, directory = sys.argv[1:3]; root = Path(directory).resolve()
    print(json.dumps(create(root) if mode == 'create' else verify(root, Path(sys.argv[3]).resolve()), ensure_ascii=True))

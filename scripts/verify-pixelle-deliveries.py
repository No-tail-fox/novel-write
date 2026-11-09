"""Verify the complete real-render matrix without altering films or draft files."""
import hashlib
import json
import av
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.artifacts/pixelle-all-templates-dual-output'


def main():
    source = json.loads((WORK / 'report.json').read_text(encoding='utf-8'))
    results = source['results']
    assert source['status'] == 'passed', 'Render matrix must finish successfully before final validation'
    assert source['expectedTemplates'] == 31 and len(results) == 31
    assert len({item['file'] for item in results}) == 31, 'All template paths must be distinct'
    checks = []
    for item in results:
        outputs = item['outputs']
        assert all(outputs[k]['status'] == 'completed' for k in ['mp4', 'jianying-draft'])
        movie = Path(outputs['mp4']['path']).resolve()
        draft = Path(outputs['jianying-draft']['path']).resolve()
        assert movie.is_file() and movie.stat().st_size > 0
        content = json.loads((draft / 'draft_content.json').read_text(encoding='utf-8'))
        material_ids = set()
        references = []
        for entries in content['materials'].values():
            if not isinstance(entries, list):
                continue
            for material in entries:
                if material.get('id'):
                    material_ids.add(material['id'])
                for field in ['path', 'media_path']:
                    if not material.get(field):
                        continue
                    path = Path(material[field])
                    if not path.is_absolute():
                        path = draft / path
                    path = path.resolve()
                    assert path.is_relative_to(draft), f"External draft dependency: {path}"
                    assert path.is_file() and path.stat().st_size > 0, f"Missing/empty draft material: {path}"
                    references.append(str(path.relative_to(draft)))
        assert references, f"No material references: {item['file']}"
        for track in content['tracks']:
            for segment in track['segments']:
                assert segment['material_id'] in material_ids, f"Unresolved track material: {item['file']}"
        assert outputs['mp4']['fingerprint'] == outputs['jianying-draft']['fingerprint']
        assert item['cachedRetry'] and item['templateCacheReused']
        frame = movie.parent.parent / 'frame.png'
        assert frame.is_file()
        motion = None
        if Path(item['file']).name.startswith(('video_', 'asset_')):
            samples = []
            with av.open(str(movie)) as container:
                for decoded in container.decode(video=0):
                    if decoded.time is not None and decoded.time >= (0.08 if not samples else 0.32):
                        samples.append(decoded.to_ndarray(format='rgb24'))
                        if len(samples) == 2:
                            break
            assert len(samples) == 2, f"Missing motion samples: {item['file']}"
            delta = np.abs(samples[0].astype(np.int16) - samples[1].astype(np.int16))
            motion = {'meanAbsoluteDifference': float(delta.mean()), 'changedPixelFraction': float(np.mean(np.max(delta, axis=2) > 12))}
            # The source fixture moves during its first half-second; noise alone must not pass.
            assert motion['meanAbsoluteDifference'] > 1 and motion['changedPixelFraction'] > 0.01, f"Video is static: {item['file']}"
        checks.append({'template': item['file'], 'materials': references, 'mp4Sha256': hashlib.sha256(movie.read_bytes()).hexdigest(), 'frame': str(frame), 'motion': motion})
    assert sum(item['motion'] is not None for item in checks) == 3
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 14)
    sheets = []
    for start in range(0, len(checks), 12):
        chunk = checks[start:start + 12]
        sheet = Image.new('RGB', (1440, ((len(chunk) + 3) // 4) * 345), '#e8e8e8')
        draw = ImageDraw.Draw(sheet)
        for i, check in enumerate(chunk):
            x, y = (i % 4) * 360, (i // 4) * 345
            with Image.open(check['frame']) as frame:
                thumb = frame.convert('RGB')
                thumb.thumbnail((340, 300))
                sheet.paste(thumb, (x + (360 - thumb.width) // 2, y + (300 - thumb.height) // 2))
            parts = check['template'].split('/')
            draw.text((x + 8, y + 305), parts[0], font=font, fill='#222222')
            draw.text((x + 8, y + 323), parts[1], font=font, fill='#222222')
        path = WORK / f'contact-sheet-{start // 12 + 1}.png'
        sheet.save(path)
        sheets.append(str(path))
    report = {'status': 'passed', 'templates': len(checks), 'checks': checks, 'contactSheets': sheets, 'jianyingApplicationOpened': False, 'aiArtisticQualityAccepted': False, 'paidRequests': 0}
    (WORK / 'delivery-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': report['status'], 'templates': len(checks), 'draftMaterialReferences': sum(len(x['materials']) for x in checks), 'movingVideoTemplates': sum(x['motion'] is not None for x in checks), 'contactSheets': sheets}, ensure_ascii=False))


if __name__ == '__main__':
    main()

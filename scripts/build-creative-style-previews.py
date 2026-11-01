"""Build bundled, attributed Lemo gallery stills; never downloads film/audio.

Only explicit execution accesses the public gallery. Normal builds are offline.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'src/assets/creative-style-previews'
CACHE = ROOT / '.artifacts/creative-style-previews/originals'
GALLERY = 'https://lemomo-ai.github.io/lemo-opuscar/'
CATALOG = json.loads((ROOT / 'src/shared/creative-animation/lemo-catalog.json').read_text(encoding='utf8'))


def build(style):
    slug = style['slug']
    url = f'{GALLERY}img/{slug}_0.jpg'
    cached = CACHE / f'{slug}.jpg'
    if not cached.exists():
        for attempt in range(3):
            try:
                with urlopen(Request(url, headers={'User-Agent': 'StoryDream-style-preview/1.0'}), timeout=25) as response:
                    original = response.read()
                with Image.open(BytesIO(original)) as image:
                    image.verify()
                cached.write_bytes(original)
                break
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
    original = cached.read_bytes()
    with Image.open(BytesIO(original)) as image:
        original_size = list(image.size)
        image = image.convert('RGB')
        image.thumbnail((768, 432), Image.Resampling.LANCZOS)
        path = DEST / f'{slug}.webp'
        image.save(path, 'WEBP', quality=84, method=6)
        size = list(image.size)
    data = path.read_bytes()
    return {
        'slug': slug, 'label': style['cn'], 'file': path.name,
        'source': url, 'creator': 'LemoLab',
        'repository': 'https://github.com/lemomo-ai/lemo-opuscar',
        'license': 'CC-BY-4.0',
        'changes': 'Resized to fit 768 x 432 and converted from JPEG to WebP; no cropping.',
        'originalSize': original_size, 'previewSize': size,
        'originalSha256': sha256(original).hexdigest(),
        'previewSha256': sha256(data).hexdigest(), 'previewBytes': len(data),
    }


if __name__ == '__main__':
    DEST.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as executor:
        entries = list(executor.map(build, CATALOG))
    manifest = {
        'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'attribution': 'LemoLab, Lemo Opuscar official gallery stills, CC BY 4.0.',
        'entries': entries,
    }
    (DEST / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'count': len(entries), 'bytes': sum(item['previewBytes'] for item in entries)}, ensure_ascii=False))

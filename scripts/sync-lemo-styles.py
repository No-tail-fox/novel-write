"""Sync the Lemo style catalogs from the pinned, hash-verified upstream snapshot.

Offline only: reads vendor/lemo-upstream (manifest storydream-upstream.json) and writes
  src/shared/creative-animation/lemo-upstream-catalog.json   66 complete library styles
  src/shared/creative-animation/opuscar98-catalog.json       98 OPUSCAR 98 light styles (UI fields only)
  src/assets/creative-style-previews/lemo-upstream/<slug>.webp + manifest.json
  src/assets/creative-style-previews/opuscar98/<NN>.webp     + manifest.json
Full prompts stay in the vendored JSON and are verified again at generation time.
"""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
UP = ROOT / 'vendor/lemo-upstream'
SHARED = ROOT / 'src/shared/creative-animation'
PREVIEWS = ROOT / 'src/assets/creative-style-previews'
MANIFEST = json.loads((UP / 'storydream-upstream.json').read_text(encoding='utf8'))
TRACKED = {item['path']: item for item in MANIFEST['files']}
REPOSITORY = 'https://github.com/lemomo-ai/lemo-opuscar'


def verified(relative: str) -> bytes:
    entry = TRACKED.get(relative)
    if not entry:
        raise SystemExit(f'not in upstream manifest: {relative}')
    data = (UP / relative).read_bytes()
    if sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit(f'integrity check failed: {relative}')
    return data


def preview(source: str, dest: Path, box: tuple[int, int], quality: int) -> dict:
    original = verified(source)
    with Image.open(BytesIO(original)) as image:
        original_size = list(image.size)
        image = image.convert('RGB')
        image.thumbnail(box, Image.Resampling.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(dest, 'WEBP', quality=quality, method=6)
        size = list(image.size)
    data = dest.read_bytes()
    return {'file': dest.name, 'source': source, 'originalSize': original_size, 'previewSize': size,
            'originalSha256': sha256(original).hexdigest(), 'previewSha256': sha256(data).hexdigest(), 'previewBytes': len(data)}


def main() -> None:
    revision = MANIFEST['revision']
    # 66 complete library styles: every styles/<slug>/ with STYLE.md + style.json in the manifest.
    slugs = sorted({path.split('/')[1] for path in TRACKED if path.startswith('styles/') and path.endswith('/STYLE.md')} - {'_template'})
    styles = []
    for slug in slugs:
        meta = json.loads(verified(f'styles/{slug}/style.json'))
        if meta['slug'] != slug:
            raise SystemExit(f'slug mismatch: {slug}')
        styles.append({key: meta[key] for key in ('slug', 'num', 'en', 'cn', 'category_en', 'category_cn', 'film', 'line', 'line_cn', 'uses', 'frame_sec', 'dur')})
    styles.sort(key=lambda item: int(item['num']))
    (SHARED / 'lemo-upstream-catalog.json').write_text(json.dumps({'revision': revision, 'styles': styles}, ensure_ascii=False, indent=1) + '\n', encoding='utf8')

    legacy = {item['slug'] for item in json.loads((SHARED / 'lemo-catalog.json').read_text(encoding='utf8'))}
    extra = []
    for style in styles:
        if style['slug'] in legacy:
            continue
        entry = preview(f"styleboard/img/{style['slug']}_0.jpg", PREVIEWS / 'lemo-upstream' / f"{style['slug']}.webp", (768, 432), 84)
        extra.append({'slug': style['slug'], 'label': style['cn'], **entry})
    (PREVIEWS / 'lemo-upstream' / 'manifest.json').write_text(json.dumps({
        'revision': revision, 'repository': REPOSITORY, 'creator': 'LemoLab', 'license': 'CC-BY-4.0',
        'changes': 'Resized to fit 768 x 432 and converted from JPEG to WebP; no cropping.', 'entries': extra,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    # OPUSCAR 98: one light style per film. UI gets descriptive fields; prompts stay in the verified vendor file.
    book = json.loads(verified('styleboard/opuscar98_styles.json'))
    chapters = {chapter['id']: chapter for chapter in book['chapters']}
    films, covers = [], []
    for film in sorted(book['films'], key=lambda item: item['no']):
        no = int(film['no'])
        chapter = chapters[film['chapter']]
        films.append({
            'slug': f'o98-{no:02d}', 'no': no, 'year': film['year'], 'title': film['title'], 'zh': film['zh'],
            'chapter': film['chapter'], 'chapter_en': chapter['en'], 'chapter_zh': chapter['zh'], 'years': chapter['years'],
            'style_en': film['style_en'], 'style_zh': film['style_zh'], 'blend_zh': film['blend_zh'],
            'render': film['render'], 'dim': film['dim'], 'desc_en': film['desc_en'], 'desc_zh': film['desc_zh'],
            't0': film['t0'], 'dur': film['dur'], 'frame_sec': film['frame_sec'],
        })
        entry = preview(f'styleboard/img/opuscar98/{no:02d}.jpg', PREVIEWS / 'opuscar98' / f'{no:02d}.webp', (480, 200), 80)
        covers.append({'slug': f'o98-{no:02d}', **entry})
    (SHARED / 'opuscar98-catalog.json').write_text(json.dumps({
        'revision': revision, 'source': 'styleboard/opuscar98_styles.json', 'film': book['film'], 'styles': films,
    }, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    (PREVIEWS / 'opuscar98' / 'manifest.json').write_text(json.dumps({
        'revision': revision, 'repository': REPOSITORY, 'creator': 'LemoLab', 'license': 'CC-BY-4.0',
        'changes': 'Resized to fit 480 x 200 and converted from JPEG to WebP; no cropping.', 'entries': covers,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'revision': revision, 'library': len(styles), 'newCovers': len(extra), 'opuscar98': len(films),
                      'coverBytes': sum(item['previewBytes'] for item in extra + covers)}, ensure_ascii=False))


if __name__ == '__main__':
    main()

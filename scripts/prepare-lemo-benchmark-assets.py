"""Install declared dependencies for two unchanged upstream benchmarks, never modify vendor files.
This is a bounded smoke-test recipe, not a claim of dependency coverage for all 66 styles.
"""
from pathlib import Path
import hashlib, json, re, sys, urllib.parse, urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.artifacts/lemo-upstream/resources'
REVISION = 'f17136060781a0068a7951245a3aa7835a7230de'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
ALLOWED = {'api.polyhaven.com', 'dl.polyhaven.org', 'fonts.googleapis.com', 'fonts.gstatic.com', 'raw.githubusercontent.com'}
CACHE.mkdir(parents=True, exist_ok=True)
index_path = CACHE / 'resources.json'
index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {'revision': REVISION, 'files': []}
if index['revision'] != REVISION:
    raise RuntimeError('Dependency cache revision mismatch')

def get(url):
    if urllib.parse.urlparse(url).scheme != 'https' or urllib.parse.urlparse(url).hostname not in ALLOWED:
        raise ValueError('Unexpected dependency origin')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as response:
        if urllib.parse.urlparse(response.url).hostname not in ALLOWED:
            raise ValueError('Unexpected dependency redirect')
        data = response.read(50_000_001)
    if len(data) > 50_000_000:
        raise ValueError('Dependency too large')
    return data

def cached(path):
    record = next((item for item in index['files'] if item['path'] == path), None)
    file = CACHE / path
    return bool(record and file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == record['sha256'])

def store(path, data, url, license_name):
    file = CACHE / path
    if not file.resolve().is_relative_to(CACHE.resolve()):
        raise ValueError('Cache path escapes its root')
    file.parent.mkdir(parents=True, exist_ok=True)
    staging = file.with_suffix(file.suffix + '.partial')
    staging.write_bytes(data); staging.replace(file)
    record = {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'sourceUrl': url, 'license': license_name}
    index['files'] = [item for item in index['files'] if item['path'] != path] + [record]
    temporary = index_path.with_suffix('.partial')
    temporary.write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(index_path)
    print(path, len(data), 'bytes', flush=True)

hdr_path = 'core/assets/polyhaven/photo_studio_loft_hall_2k.hdr'
if not cached(hdr_path):
    metadata = json.loads(get('https://api.polyhaven.com/files/photo_studio_loft_hall'))['hdri']['2k']['hdr']
    data = get(metadata['url'])
    if len(data) != metadata['size'] or hashlib.md5(data).hexdigest() != metadata['md5']:
        raise ValueError('Poly Haven file integrity check failed')
    store(hdr_path, data, metadata['url'], 'CC0-1.0; vendor/lemo-upstream/core/assets/polyhaven/SOURCES.md')

# Preserve the upstream subsetting recipe and CSS aliases. Only install missing binary dependencies.
main = (ROOT / 'vendor/lemo-upstream/styles/memphis-diorama/demo/main.js').read_text(encoding='utf-8')
src = main[main.index('const TEXT = ['):main.index('const TITLE')] + main[main.index('const TITLE'):].split('\n', 1)[0]
text = ''.join(sorted(set(re.findall(r'[　-〿一-鿿＀-￯·°×]', src)))) + ''.join(chr(c) for c in range(32, 127))
base = 'styles/memphis-diorama/demo/fonts/'
for family, weight, name in [('Noto Sans SC', 400, 'NotoSansSC-400'), ('Noto Sans SC', 600, 'NotoSansSC-600'),
                             ('Inter Tight', 400, 'InterTight-400'), ('Inter Tight', 600, 'InterTight-600'), ('IBM Plex Mono', 400, 'IBMPlexMono-400')]:
    path = base + name + '.woff2'
    if cached(path):
        continue
    css_url = 'https://fonts.googleapis.com/css2?family=' + urllib.parse.quote(family) + f':wght@{weight}&text=' + urllib.parse.quote(text)
    urls = re.findall(r'url\((https://[^)]+)\)', get(css_url).decode())
    if len(urls) != 1:
        raise ValueError('Expected one subset file from Google Fonts')
    data = get(urls[0])
    if not data.startswith(b'wOF2'):
        raise ValueError('Expected WOFF2 font')
    store(path, data, urls[0], 'OFL-1.1')
for family in ['notosanssc', 'intertight', 'ibmplexmono']:
    path = base + f'OFL-{family}.txt'
    if not cached(path):
        url = f'https://raw.githubusercontent.com/google/fonts/main/ofl/{family}/OFL.txt'
        data = get(url)
        if b'OPEN FONT LICENSE' not in data:
            raise ValueError('Missing font license text')
        store(path, data, url, 'OFL-1.1')
print('Dependencies ready; upstream source untouched.', flush=True)

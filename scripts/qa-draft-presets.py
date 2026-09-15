"""Check draft preset layout and persistence in isolated browser/Electron profiles."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/draft-presets'
PORTRAIT_PRESETS = [
    ('default-portrait-9-16', '沉浸口播'),
    ('builtin-portrait-knowledge', '顶栏科普'),
    ('builtin-portrait-story', '宽幕故事'),
    ('builtin-portrait-quote', '留白金句'),
    ('builtin-portrait-editorial', '杂志图文'),
]
LANDSCAPE_PRESETS = [
    ('builtin-landscape-talking', '横屏口播'),
    ('builtin-landscape-split', '左右科普'),
    ('builtin-landscape-documentary', '横屏纪录'),
    ('builtin-landscape-tutorial', '清晰教程'),
    ('builtin-landscape-editorial', '横屏书摘'),
]
PRESETS = PORTRAIT_PRESETS
LANDSCAPE = False
LAYERS = ('title', 'subtitle', 'caption', 'disclaimer')

BOUNDS_SCRIPT = r'''canvas => {
  const rect = n => { const r=n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
  const bounds=rect(canvas);
  const layers={};
  for(const layer of ['title','subtitle','caption','disclaimer']) {
    const node=canvas.querySelector('.draft-'+layer+' .draft-text-content');
    if(!node) continue;
    const range=document.createRange();range.selectNodeContents(node);
    layers[layer]={text:node.textContent,rects:[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom})),font:getComputedStyle(node.parentElement).fontSize};
  }
  const image=canvas.querySelector('.draft-image');
  return {bounds,layers,image:image?rect(image):null};
}'''


def check_geometry(canvas, name, report, *, expected_hidden=True):
    expect(canvas).to_be_visible()
    result = canvas.evaluate(BOUNDS_SCRIPT)
    bounds, layers = result['bounds'], result['layers']
    assert abs(bounds['width'] / bounds['height'] - (16 / 9 if LANDSCAPE else 9 / 16)) < .015, (name, bounds)
    if expected_hidden:
        assert 'subtitle' not in layers and 'disclaimer' not in layers, (name, layers.keys())
        assert ('title' not in layers) == any(value in name for value in ('quote', 'documentary')), (name, layers.keys())
    for layer, value in layers.items():
        for rect in value['rects']:
            assert rect['x'] >= bounds['x'] - 2 and rect['right'] <= bounds['right'] + 2, (name, layer, 'horizontal clipping', rect, bounds)
            assert rect['y'] >= bounds['y'] - 2 and rect['bottom'] <= bounds['bottom'] + 2, (name, layer, 'vertical clipping', rect, bounds)
    if 'title' in layers and 'caption' in layers:
        for title in layers['title']['rects']:
            for caption in layers['caption']['rects']:
                overlaps = min(title['right'], caption['right']) > max(title['x'], caption['x']) and min(title['bottom'], caption['bottom']) > max(title['y'], caption['y'])
                assert not overlaps, (name, 'title/caption collision', title, caption)
    if LANDSCAPE and any(value in name for value in ('split', 'editorial', 'tutorial')):
        for title in layers.get('title', {}).get('rects', []):
            frame = result['image']
            overlaps = min(title['right'], frame['right']) > max(title['x'], frame['x']) and min(title['bottom'], frame['bottom']) > max(title['y'], frame['y'])
            assert not overlaps, (name, 'title/image collision', title, frame)
    if LANDSCAPE and 'tutorial' in name and canvas.locator('.draft-image-asset').count() == 0:
        expect(canvas.locator('[data-layer="image-media"]')).to_have_count(0)
    report['geometry'][name] = result


def open_gallery(page):
    if page.locator('[data-nav-view="draft-templates"]').count() == 0:
        page.locator('[data-nav-view="prompt-templates"]').first.click()
    page.locator('[data-nav-view="draft-templates"]').click()
    expect(page.locator('.draft-template-gallery')).to_be_visible()


def capture(page, name, report):
    page.screenshot(path=OUTPUT / f'{name}.png', full_page=True)
    report['screenshots'].append(str(OUTPUT / f'{name}.png'))
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'), name


def exercise_ui(page, mode, report):
    page.wait_for_selector('.app-shell')
    open_gallery(page)
    if LANDSCAPE:
        tabs = page.get_by_role('tablist', name='模板画幅', exact=True)
        tabs.get_by_role('tab', name='全部', exact=True).focus()
        page.keyboard.press('ArrowRight')
        page.keyboard.press('Enter')
        expect(tabs.get_by_role('tab', name='横屏', exact=True)).to_have_attribute('aria-selected', 'true')
        expect(page.get_by_role('button', name='编辑 沉浸口播', exact=True)).to_have_count(0)
        tabs.get_by_role('tab', name='竖屏', exact=True).click()
        expect(page.get_by_role('button', name='编辑 横屏口播', exact=True)).to_have_count(0)
        expect(page.get_by_role('button', name='编辑 沉浸口播', exact=True)).to_be_visible()
        tabs.get_by_role('tab', name='全部', exact=True).click()
        expect(page.locator('.draft-template-thumb')).to_have_count(12)
        tabs.get_by_role('tab', name='横屏', exact=True).click()
        expect(page.locator('.draft-template-thumb')).to_have_count(6)
        report['checks'].append(f'{mode}: all/landscape/portrait filter results and keyboard navigation')
    first = page.get_by_role('button', name=f'编辑 {PRESETS[0][1]}', exact=True)
    first.focus()
    expect(first).to_be_focused()
    first.press('Enter')
    expect(page.locator('.editable-draft-canvas')).to_be_visible()
    page.locator('.template-name-input').fill('QA 未保存模板')
    page.get_by_role('button', name='返回模板列表', exact=True).click()
    dialog = page.get_by_role('dialog', name='保留未保存的改动？', exact=True)
    expect(dialog).to_be_visible()
    page.get_by_role('button', name='继续编辑', exact=True).click()
    expect(page.locator('.template-name-input')).to_have_value('QA 未保存模板')
    page.get_by_role('button', name='返回模板列表', exact=True).click()
    page.get_by_role('button', name='放弃改动并离开', exact=True).click()
    expect(page.get_by_role('button', name=f'编辑 {PRESETS[0][1]}', exact=True)).to_be_visible()
    report['checks'].append(f'{mode}: keyboard thumbnail opening, unsaved stay and discard preserve the original preset')
    for width, height in [(1440, 1000), (1040, 720)]:
        page.set_viewport_size({'width': width, 'height': height})
        for preset_id, title in PRESETS:
            thumb = page.get_by_role('button', name=f'编辑 {title}', exact=True)
            expect(thumb).to_be_visible()
            canvas = thumb.locator('.draft-preview-mini')
            check_geometry(canvas, f'{mode}-gallery-{width}-{preset_id}', report)
        legacy = page.get_by_role('button', name='编辑 横屏16:9', exact=True).locator('.draft-preview-mini').bounding_box()
        assert abs(legacy['width'] / legacy['height'] - 16 / 9) < .015, legacy
        capture(page, f'{mode}-gallery-{width}', report)
        for preset_id, title in PRESETS:
            page.get_by_role('button', name=f'编辑 {title}', exact=True).click()
            canvas = page.locator('.editable-draft-canvas')
            expect(canvas).to_be_visible()
            check_geometry(canvas, f'{mode}-editor-{width}-{preset_id}', report)
            capture(page, f'{mode}-editor-{width}-{preset_id}', report)
            page.get_by_role('button', name='返回模板列表', exact=True).click()
            if LANDSCAPE:
                expect(page.get_by_role('tablist', name='模板画幅', exact=True).get_by_role('tab', name='横屏', exact=True)).to_have_attribute('aria-selected', 'true')
        report['checks'].append(f'{mode} {width}x{height}: five presets, hidden layers, text bounds and thumbnail ratios')

    # Every preset retains its own settings through actual copy/save/reload actions.
    for preset_id, title in PRESETS:
        page.get_by_role('button', name=f'编辑 {title}', exact=True).click()
        page.locator('.draft-stage').get_by_role('button', name='复制', exact=True).click()
        expect(page.locator('.template-name-input')).to_have_value(f'{title} 副本')
        saved_name = f'QA {title} 保存验证'
        page.locator('.template-name-input').fill(saved_name)
        save = page.get_by_role('button', name='保存', exact=True)
        save.click()
        expect(save).to_be_disabled()
        page.get_by_role('button', name='返回模板列表', exact=True).click()
        expect(page.get_by_role('button', name=f'编辑 {saved_name}', exact=True)).to_be_visible()
        page.reload()
        page.wait_for_selector('.app-shell')
        open_gallery(page)
        if LANDSCAPE:
            page.get_by_role('tablist', name='模板画幅', exact=True).get_by_role('tab', name='横屏', exact=True).click()
        page.get_by_role('button', name=f'编辑 {saved_name}', exact=True).click()
        expect(page.locator('.template-name-input')).to_have_value(saved_name)
        check_geometry(page.locator('.editable-draft-canvas'), f'{mode}-reloaded-{preset_id}', report)
        page.get_by_role('button', name='返回模板列表', exact=True).click()
        report['checks'].append(f'{mode} {title}: copied, renamed, saved and reloaded')

    if LANDSCAPE:
        page.get_by_role('button', name='新建草稿模板', exact=True).click()
        expect(page.locator('.template-name-input')).to_have_value('新模板')
        expect(page.locator('.draft-stage .hint-text')).to_contain_text('16:9 · 1920x1080')
        check_geometry(page.locator('.editable-draft-canvas'), f'{mode}-new-landscape', report)
        page.get_by_role('button', name='返回模板列表', exact=True).click()
        expect(page.get_by_role('tablist', name='模板画幅', exact=True).get_by_role('tab', name='横屏', exact=True)).to_have_attribute('aria-selected', 'true')
        expect(page.get_by_role('button', name='编辑 新模板', exact=True)).to_be_visible()
        report['checks'].append(f'{mode}: landscape filter survives editor return and new template uses 1920x1080')


def write_harness():
    # Locally authored scenic artwork; no remote media or provider APIs are used.
    image = Image.new('RGB', (1080, 1920))
    pixels = image.load()
    for y in range(image.height):
        t = y / image.height
        color = tuple(int(a + (b - a) * t) for a, b in zip((195, 211, 216), (51, 82, 88)))
        for x in range(image.width):
            pixels[x, y] = color
    draw = ImageDraw.Draw(image)
    draw.ellipse((670, 290, 850, 470), fill=(235, 218, 175))
    draw.polygon([(0, 970), (220, 700), (520, 1150), (850, 640), (1080, 910), (1080, 1920), (0, 1920)], fill=(87, 113, 117))
    draw.polygon([(0, 1260), (270, 990), (650, 1420), (1080, 1040), (1080, 1920), (0, 1920)], fill=(43, 76, 78))
    draw.polygon([(0, 1670), (460, 1390), (760, 1510), (1080, 1470), (1080, 1920), (0, 1920)], fill=(24, 56, 59))
    if LANDSCAPE:
        image = image.resize((1920, 1080))
        draw = ImageDraw.Draw(image)
        # Redraw the sky and peaks at their native wide proportions for the overview.
        draw.rectangle((0, 0, 1919, 1079), fill=(136, 166, 175))
        draw.ellipse((1280, 140, 1450, 310), fill=(235, 218, 175))
        draw.polygon([(0, 680), (400, 320), (800, 740), (1370, 360), (1920, 700), (1920, 1080), (0, 1080)], fill=(87, 113, 117))
        draw.polygon([(0, 830), (420, 640), (920, 880), (1510, 650), (1920, 800), (1920, 1080), (0, 1080)], fill=(43, 76, 78))
        draw.polygon([(0, 1040), (820, 840), (1400, 940), (1920, 880), (1920, 1080), (0, 1080)], fill=(24, 56, 59))
        image.save(OUTPUT / 'qa-landscape-clean.png')
        draw.rectangle((0, 0, 1919, 29), fill=(255, 220, 0))
        draw.rectangle((0, 1050, 1919, 1079), fill=(240, 30, 210))
        draw.rectangle((0, 30, 29, 1049), fill=(245, 55, 45))
        draw.rectangle((1890, 30, 1919, 1049), fill=(0, 220, 235))
    image.save(OUTPUT / 'qa-landscape.png')
    (OUTPUT / 'harness.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><head><meta charset="utf-8"><title>Draft preset QA</title></head><body><div id="root"></div><script type="module" src="./harness.tsx"></script></body></html>', encoding='utf-8')
    harness = '''import React from 'react';
import {createRoot} from 'react-dom/client';
import {DraftTemplatePreview, EditableDraftCanvas} from '/src/features/templates/DraftCanvas';
import {draftTemplates,draftTemplateGuides} from '/src/shared/templates';
import '/src/styles.css';
const presetIds=PRESET_IDS;
const presets=draftTemplates.filter(template => presetIds.includes(template.id));
const styles=document.createElement('style');styles.textContent=`html,body,#root{width:100%;height:auto;overflow:visible;background:#17191f;color:#eee;}main{padding:24px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:18px;}article{min-width:0;}h2{font:600 18px sans-serif;margin:0 0 15px;}p{font:12px sans-serif;color:#adb4bd;margin:14px 0;}article .draft-preview-large{width:100%;}.editable-draft-canvas{margin-top:10px;}@media(max-width:1100px){main{gap:12px;padding:18px}h2{font-size:15px}}`;document.head.append(styles);
createRoot(document.getElementById('root')).render(<main>{presets.map(template => <article key={template.id} data-preset={template.id}><h2>{template.name}</h2><DraftTemplatePreview template={template} imageUrl="./qa-landscape.png" captionText={draftTemplateGuides[template.id].captionExample}/><p>编辑画布 · 原始组件</p><EditableDraftCanvas template={template} selectedLayer="image-frame" onSelectLayer={()=>{}} onChange={()=>{}}/></article>)}</main>);
'''
    harness = harness.replace('PRESET_IDS', json.dumps([preset[0] for preset in PRESETS]))
    if LANDSCAPE:
        harness = harness.replace('grid-template-columns:repeat(5,', 'grid-template-columns:repeat(2,')
    (OUTPUT / 'harness.tsx').write_text(harness, encoding='utf-8')


def verify_contain_edges(page, width, report):
    canvas = page.locator('[data-preset="builtin-landscape-tutorial"] .draft-preview-large').first
    media = canvas.locator('img')
    expect(media).to_be_visible()
    page.wait_for_function('''() => [...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)''')
    geometry = media.evaluate('''img => {const r=img.getBoundingClientRect(),canvas=img.closest('[data-media-canvas]').getBoundingClientRect();const scale=Math.min(r.width/img.naturalWidth,r.height/img.naturalHeight);const w=img.naturalWidth*scale,h=img.naturalHeight*scale;return {x:r.x+(r.width-w)/2-canvas.x,y:r.y+(r.height-h)/2-canvas.y,width:w,height:h,fit:getComputedStyle(img).objectFit,natural:[img.naturalWidth,img.naturalHeight]};}''')
    assert geometry['fit'] == 'contain' and geometry['natural'] == [1920, 1080], geometry
    canvas.screenshot(path=OUTPUT / f'tutorial-complete-image-{width}.png')
    pixels = Image.open(OUTPUT / f'tutorial-complete-image-{width}.png').convert('RGB')
    box = canvas.bounding_box()
    x, y = geometry['x'], geometry['y']
    w, h = geometry['width'], geometry['height']
    edges = {
        'top': (x+w/2, y+h*15/1080, (255, 220, 0)),
        'bottom': (x+w/2, y+h*(1-15/1080), (240, 30, 210)),
        'left': (x+w*15/1920, y+h/2, (245, 55, 45)),
        'right': (x+w*(1-15/1920), y+h/2, (0, 220, 235)),
    }
    samples = {}
    for label, (px, py, expected) in edges.items():
        actual = pixels.getpixel((round(px), round(py)))
        assert max(abs(a-b) for a, b in zip(actual, expected)) < 30, (width, label, actual, expected, geometry, box)
        samples[label] = actual
    report['checks'].append(f'{width}: tutorial contain shows all four colored source-image edges')
    report.setdefault('containImage', {})[str(width)] = {'geometry': geometry, 'edgePixels': samples}


def main():
    global OUTPUT, PRESETS, LANDSCAPE
    parser = argparse.ArgumentParser()
    parser.add_argument('--electron', action='store_true')
    parser.add_argument('--harness-only', action='store_true')
    parser.add_argument('--landscape', action='store_true')
    args = parser.parse_args()
    LANDSCAPE = args.landscape
    if LANDSCAPE:
        OUTPUT = ROOT / '.artifacts/draft-landscape-presets'
        PRESETS = LANDSCAPE_PRESETS
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'status': 'running', 'checks': [], 'screenshots': [], 'geometry': {}, 'runtimeErrors': []}
    process = browser = page = None
    mode = 'electron' if args.electron else 'browser'
    pw = sync_playwright().start()
    try:
        if args.electron:
            spec = importlib.util.spec_from_file_location('draft_qa_base', ROOT / 'scripts/qa-director-desk.py')
            base = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(base)
            profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
            env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile)}
            for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
                env.pop(key, None)
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            base.wait_app(page)
            report['profile'] = str(profile)
        else:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(('http://127.0.0.1:5173/', 'data:', 'blob:')) else route.abort())
            page = context.new_page()
            page.goto('http://127.0.0.1:5173/')
        page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
        if not args.harness_only:
            exercise_ui(page, mode, report)
        if not args.electron:
            write_harness()
            page.goto(f'http://127.0.0.1:5173/{OUTPUT.relative_to(ROOT).as_posix()}/harness.html')
            expect(page.locator('[data-preset]')).to_have_count(5)
            for width, height in [(1440, 1000), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                for preset_id, _ in PRESETS:
                    article = page.locator(f'[data-preset="{preset_id}"]')
                    check_geometry(article.locator('.draft-preview-large').first, f'harness-preview-{width}-{preset_id}', report)
                    check_geometry(article.locator('.editable-draft-canvas'), f'harness-editor-{width}-{preset_id}', report)
                capture(page, f'preset-comparison-{width}', report)
                if LANDSCAPE:
                    verify_contain_edges(page, width, report)
                    overview_style = page.add_style_tag(content='article p,article .editable-draft-canvas{display:none!important}')
                    page.locator('img').evaluate_all("images => images.forEach(img => img.src='./qa-landscape-clean.png')")
                    page.wait_for_function("[...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)")
                    page.screenshot(path=OUTPUT / f'preset-overview-{width}.png', full_page=True)
                    overview_style.evaluate('node => node.remove()')
                    page.locator('img').evaluate_all("images => images.forEach(img => img.src='./qa-landscape.png')")
                else:
                    preview = page.locator('[data-preset]').first.locator('.draft-preview-large').first.bounding_box()
                    comparison = Image.open(OUTPUT / f'preset-comparison-{width}.png')
                    comparison.crop((0, 0, width, int(preview['y'] + preview['height'] + 12))).save(OUTPUT / f'preset-overview-{width}.png')
                report['screenshots'].append(str(OUTPUT / f'preset-overview-{width}.png'))
            report['checks'].append('Two sizes: actual preview with local QA media and original editor components have no text collisions')
        assert not report['runtimeErrors'], report['runtimeErrors']
        report['status'] = 'passed'
        print(f'{mode}: passed {len(report["checks"])} checks; {len(report["geometry"])} measured canvases', flush=True)
    except Exception as error:
        report.update(status='failed', error=str(error))
        if page and not page.is_closed():
            page.screenshot(path=OUTPUT / f'{mode}-failure.png', full_page=True)
        raise
    finally:
        if browser:
            browser.close()
        if process and process.poll() is None:
            process.terminate()
        pw.stop()
        (OUTPUT / f'{mode}-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

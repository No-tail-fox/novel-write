"""Local motion preview through the real director workspace; no generation services."""
from pathlib import Path
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/vox-local-preview'

def run():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    OUT.mkdir(parents=True, exist_ok=True)
    build = subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/director-vox-preview.harness.tsx',name:'motionPreviewQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)],
        cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    (OUT / 'build.log').write_text(build.stdout + build.stderr, encoding='utf-8')
    build.check_returncode()
    (OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'checks': [], 'motions': [], 'errors': [], 'externalCalls': 0}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
            page = browser.new_page()
            base = f'http://127.0.0.1:{server.server_port}'
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(base) else route.abort())
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.on('console', lambda message: report['errors'].append(message.text) if message.type == 'error' else None)
            for theme in ['dark', 'light']:
                for width, height in [(1536, 1024), (1040, 720)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    page.goto(f'{base}/?theme={theme}')
                    toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
                    if toggle.is_visible(): toggle.click()
                    original = page.get_by_label('叙事动作', exact=True).inner_text()
                    try:
                        page.get_by_role('button', name='预览动作', exact=True).click(timeout=7000)
                    except Exception:
                        page.screenshot(path=str(OUT / 'failure.png'))
                        (OUT / 'failure.txt').write_text(page.locator('body').inner_text(), encoding='utf-8')
                        raise
                    dialog = page.get_by_role('dialog', name='本地拼贴 · 动作预览')
                    expect(dialog).to_be_visible()
                    expect(dialog.locator('[data-motion-ready="true"]')).to_have_count(1)
                    dialog.get_by_role('button', name='暂停预览', exact=True).click()
                    slider = dialog.get_by_role('slider', name='动作预览进度')
                    slider.focus(); slider.press('Home'); slider.press('ArrowRight')
                    expect(slider).to_have_value('50')
                    dialog.get_by_role('button', name='重播', exact=True).click()
                    page.wait_for_function('(element)=>Number(element.value)>100', arg=slider.element_handle(), timeout=6000)
                    dialog.get_by_role('button', name='暂停预览', exact=True).click()
                    stopped = slider.input_value()
                    page.wait_for_timeout(120)
                    assert slider.input_value() == stopped
                    # Previewing another option must not change the underlying shot.
                    dialog.get_by_role('button', name='并列对比', exact=True).click()
                    expect(dialog.locator('[data-motion-ready="true"]')).to_have_count(1)
                    page.wait_for_timeout(1400)
                    surface = page.locator('.sd-dialog-surface')
                    assert surface.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1}')
                    assert dialog.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
                    page.screenshot(path=str(OUT / f'preview-{theme}-{width}.png'))
                    dialog.get_by_role('button', name='关闭', exact=True).click()
                    expect(page.get_by_label('叙事动作', exact=True)).to_have_text(original)
                    page.get_by_role('button', name='预览动作', exact=True).click()
                    dialog.get_by_role('button', name='路径推进', exact=True).click()
                    dialog.get_by_role('button', name='应用到当前镜头', exact=True).click()
                    expect(page.get_by_label('叙事动作', exact=True)).to_have_text('路径推进')
                    assert page.evaluate('window.voxPreviewQA.generationCalls') == 0
                    report['checks'].append(f'{theme} {width}x{height}: play/pause/replay/scrub, close preserves draft, apply selects motion, no overflow')
            page.get_by_role('button', name='预览动作', exact=True).click()
            dialog = page.get_by_role('dialog', name='本地拼贴 · 动作预览')
            for ratio in ['16:9', '9:16', '1:1', '4:3']:
                dialog.get_by_role('tab', name=ratio, exact=True).click()
                for label in ['切片入场', '聚焦揭示', '证据落版', '路径推进', '并列对比']:
                    dialog.get_by_role('button', name=label, exact=True).click()
                    expect(dialog.locator('[data-motion-ready="true"]')).to_have_count(1)
                    pause = dialog.get_by_role('button', name='暂停预览', exact=True)
                    if pause.is_visible(): pause.click()
                    frame = page.frame_locator('iframe[title="本地拼贴动作预览"]')
                    samples = []
                    for at in [.3, 1.6, 3.7]:
                        frame.locator('body').evaluate('(e,t)=>window.__tl.seek(t)', at)
                        samples.append(frame.locator('.scene-cutout').evaluate_all('(els)=>els.map(e=>({transform:e.style.transform,left:e.style.left,top:e.style.top,opacity:e.style.opacity}))'))
                    assert samples[0] != samples[1] and samples[1] != samples[2], (label, ratio)
                    size = dialog.locator('.director-motion-demo').bounding_box()
                    a, b = map(int, ratio.split(':'))
                    assert abs(size['width'] / size['height'] - a / b) < .02
                    report['motions'].append({'motion': label, 'ratio': ratio, 'samples': samples})
            browser.close()
        assert not report['errors'], report['errors']
        report['status'] = 'passed'
    finally:
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        server.shutdown()
    print(json.dumps({'status': report['status'], 'checks': len(report['checks']), 'motions': len(report['motions']), 'report': str(OUT / 'report.json')}))

if __name__ == '__main__': run()

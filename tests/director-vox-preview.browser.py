"""Verify both VOX modes and authored collage preview with local-only fixtures."""
from __future__ import annotations

import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/vox-preview')))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/director-vox-preview.harness.tsx',name:'voxPreviewQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                for theme in ['dark', 'light']:
                    page.goto(f'http://127.0.0.1:{server.server_port}/?theme={theme}')
                    preview = page.get_by_label('镜头预览', exact=True)
                    expect(preview.locator('.director-media-state')).to_have_count(0)
                    subject = preview.locator('[data-preview-layer-id="subject"]')
                    before = subject.evaluate('(element) => getComputedStyle(element).left')
                    slider = page.get_by_role('slider', name='播放进度')
                    slider.focus()
                    slider.press('Home')
                    for _ in range(20):
                        slider.press('ArrowRight')
                    expect(subject).to_have_css('opacity', '1')
                    assert subject.evaluate('(element) => getComputedStyle(element).left') != before
                    expect(subject.locator('img')).to_have_css('object-fit', 'contain')
                    expect(subject.locator('.director-media-image')).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
                    expect(preview.locator('[data-preview-layer-id="label"] svg')).to_have_count(1)
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                    page.screenshot(path=str(OUTPUT / f'local-{theme}-{width}x{height}.png'))
                    checks.append(f'{theme} {width}: background, transparent subject, timed text and independent motion')

                    toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
                    if toggle.is_visible():
                        toggle.click()
                    expect(preview.locator('.director-preview-title')).to_have_count(0)
                    expect(preview.locator('.director-preview-kicker')).to_have_count(0)
                    title = page.get_by_role('textbox', name='上屏标题', exact=True)
                    title.fill('一张咖啡桌，改变一座城')
                    expect(preview.get_by_role('img', name='一张咖啡桌，改变一座城', exact=True)).to_have_count(1)
                    expect(preview.locator('.director-preview-title')).to_have_count(0)
                    title.fill('')
                    expect(preview.locator('.director-preview-text-content')).to_have_count(0)
                    expect(preview.locator('.director-preview-title')).to_have_count(0)
                    title.fill('一张咖啡桌，改变一座城')
                    narrative = page.get_by_role('combobox', name='叙事动作', exact=True)
                    expect(narrative.locator('option')).to_have_count(5)
                    for style in ['cutout-slide', 'focus-reveal', 'comparison', 'evidence-stack', 'path-progress']:
                        narrative.select_option(style)
                        expect(narrative).to_have_value(style)
                    expect(page.get_by_role('combobox', name='相机运动', exact=True)).to_be_visible()
                    narrative.scroll_into_view_if_needed()
                    page.screenshot(path=str(OUTPUT / f'content-controls-{theme}-{width}x{height}.png'))
                    checks.append(f'{theme} {width}: editable and clearable content title, five narrative actions, no duplicate or technical canvas title')
                    local_mode = page.get_by_role('tab', name='本地拼贴动画', exact=True)
                    expect(local_mode).to_have_attribute('aria-selected', 'true')
                    page.get_by_role('tab', name='图生视频', exact=True).click()
                    expect(page.get_by_role('button', name='生成关键帧', exact=True)).to_be_visible()
                    expect(page.get_by_role('button', name='生成视频', exact=True)).to_be_disabled()
                    expect(preview.locator('.director-video-empty')).to_be_visible()
                    expect(preview.locator('.director-preview-title')).to_have_text('一张咖啡桌，改变一座城')
                    expect(narrative).to_have_count(0)
                    expect(title).to_have_value('一张咖啡桌，改变一座城')
                    page.screenshot(path=str(OUTPUT / f'video-{theme}-{width}x{height}.png'))
                    local_mode.click()
                    expect(subject).to_be_visible()
                    expect(narrative).to_have_value('path-progress')
                    expect(preview.locator('.director-preview-title')).to_have_count(0)
                    page.evaluate('window.voxPreviewQA.useSubjectOnly()')
                    expect(preview.locator('.director-media-state')).to_have_count(0)
                    page.evaluate('window.voxPreviewQA.useMissing()')
                    expect(page.get_by_role('button', name='补齐分层素材', exact=True)).to_be_visible()
                    expect(page.get_by_text('还缺少独立主体素材，请补齐后生成成片。', exact=True)).to_be_visible()
                    page.evaluate('window.voxPreviewQA.useTextOnly()')
                    expect(preview.locator('.director-preview-text-content svg')).to_have_count(1)
                    expect(preview.locator('.director-media-state')).to_have_count(0)
                    assert page.evaluate('window.voxPreviewQA.generationCalls') == 0
                    checks.append(f'{theme} {width}: mode switch, disabled unconfigured video, missing layers, text-only readiness')
            browser.close()
        assert not errors, errors
        (OUTPUT / 'result.json').write_text(json.dumps({'passed': True, 'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'passed': True, 'checks': len(checks), 'output': str(OUTPUT)}, ensure_ascii=False))
    finally:
        server.shutdown()


if __name__ == '__main__':
    run()

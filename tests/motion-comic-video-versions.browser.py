"""Offline real-component acceptance, synthetic local video fixture, no paid API."""
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'video-versions-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/video-versions-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-video-versions.harness.tsx',name:'versionsQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'OFFLINE FIXTURE: actual VideoVersions component + shared adoption; synthetic browser-recorded media; not Page/IPC/backend or real generation', 'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('blob:') or (urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port) else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        generate = page.get_by_role('button', name='仅生成视频候选', exact=True)
        # Two dispatches in one JS turn exercise the synchronous ref, before rerender.
        generate.evaluate('(button) => { button.click(); button.click(); }')
        expect(page.get_by_role('button', name='正在生成视频候选…')).to_be_disabled()
        expect(page.locator('p[role="status"]')).to_contain_text('当前视频未替换')
        assert page.evaluate('fixtureCounts.generate') == 1
        expect(page.get_by_label('当前绑定')).to_have_text('old')
        assert page.evaluate('fixtureDocument.episodes[0].timeline.clips[0].assetVersionIds.includes("old")')
        report['checks'].append('candidate fixture appended once under double dispatch; current and timeline remain old')
        preview = page.get_by_role('button', name='预览候选 2', exact=True)
        preview.evaluate('(button) => { button.click(); button.click(); }')
        video = page.get_by_label('历史候选视频预览', exact=True)
        expect(video).to_be_visible()
        video.evaluate('(video) => { video.muted = true; return video.play(); }')
        page.wait_for_function('document.querySelector("video")?.readyState >= 2')
        page.wait_for_function('document.querySelector("video").currentTime > 0')
        assert page.evaluate('fixtureCounts.read') == 1
        report['checks'].append('local WebM fixture decodes and plays; preview double dispatch reads once')
        adopt = page.get_by_role('button', name='采用此版本', exact=True)
        adopt.evaluate('(button) => { button.click(); button.click(); }')
        expect(page.get_by_label('当前绑定')).to_have_text('candidate-1')
        assert page.evaluate('fixtureCounts.adopt') == 1
        assert page.evaluate('fixtureDocument.episodes[0].timeline.clips[0].assetVersionIds.includes("candidate-1")')
        expect(page.locator('li').filter(has_text='候选 2')).to_contain_text('当前采用')
        report['checks'].append('explicit adoption changes shot, timeline and current marker once')
        page.screenshot(path=str(OUT / 'adopted-1280.png'), full_page=True)
        page.get_by_role('button', name='切换读取失败 fixture').click()
        preview.click()
        expect(page.locator('p[role="status"]')).to_contain_text('本地视频读取失败')
        expect(video).to_have_count(0)
        report['checks'].append('local read failure clears preview and presents explicit error')
        page.get_by_role('button', name='切换生成失败 fixture').click()
        generate.click()
        expect(page.locator('p[role="status"]')).to_contain_text('不会自动重试')
        expect(generate).to_be_enabled()
        assert page.evaluate('fixtureCounts.generate') == 2
        expect(page.get_by_label('当前绑定')).to_have_text('candidate-1')
        report['checks'].append('generation exception visible, no automatic retry, current preserved')
        page.get_by_role('button', name='使候选过期 fixture').click()
        expect(page.locator('li').filter(has_text='候选 1').get_by_role('button', name='采用此版本')).to_be_disabled()
        expect(page.locator('li').first).to_contain_text('候选已过期')
        report['checks'].append('stale candidate adoption disabled with explanation')
        page.get_by_role('button', name='未知任务 fixture').click()
        expect(generate).to_be_disabled()
        expect(page.get_by_label('镜头视频历史候选')).to_contain_text('勿重复提交')
        report['checks'].append('unknown job blocks generation without duplicate callback')
        page.set_viewport_size({'width': 375, 'height': 812})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.screenshot(path=str(OUT / 'errors-375.png'), full_page=True)
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

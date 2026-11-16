"""Offline browser acceptance; all media and persistence callbacks are mocked."""
import base64
import io
import wave
import functools
import http.server
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'character-voice-sample-ui'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/character-voice-sample-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-character-voice-sample.harness.tsx',name:'voiceQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
buffer = io.BytesIO()
with wave.open(buffer, 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(8000)
    wav.writeframes(b'\x00\x00' * 8000)
audio_url = 'data:audio/wav;base64,' + base64.b64encode(buffer.getvalue()).decode()
report = {'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1600, 'height': 1040})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.route('**/*', lambda route: route.continue_() if urlparse(route.request.url).hostname == '127.0.0.1' and urlparse(route.request.url).port == server.server_port else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        button = lambda text: page.get_by_role('button', name=text, exact=True)
        calls = lambda: page.evaluate('window.voiceQA.calls')
        assert not any(c.startswith('url:') for c in calls())
        button('导入样本').click()
        expect(button('导入中…')).to_be_disabled()
        page.evaluate("window.voiceQA.finish('cancel')")
        expect(button('导入样本')).to_be_enabled()
        expect(page.get_by_role('alert')).to_have_count(0)
        button('导入样本').click()
        page.evaluate("window.voiceQA.finish('error')")
        expect(page.get_by_role('alert')).to_contain_text('模拟保存失败')
        button('导入样本').click()
        page.evaluate("window.voiceQA.finish('save')")
        expect(button('替换样本')).to_be_enabled()
        assert calls().count('import') == 3
        assert not any(c.startswith('url:') for c in calls())
        report['checks'].append('Import awaits save, cancellation quiet, save error visible, no preload')
        for width in [1600, 1040, 375]:
            page.set_viewport_size({'width': width, 'height': 1040})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT / f'sample-{width}.png'), full_page=True)
        page.set_viewport_size({'width': 1040, 'height': 1040})
        button('解绑').click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_contain_text('保留历史样本记录')
        expect(dialog).to_contain_text('不会改变服务音色设置')
        page.screenshot(path=str(OUT / 'unlink-confirmation-1040.png'), full_page=True)
        button('取消').click()
        assert 'unlink' not in calls()
        button('试听').click()
        expect(button('加载中…')).to_be_disabled()
        button('切换样本B').click()
        expect(button('试听')).to_be_enabled()
        page.evaluate("window.voiceQA.mediaFinish('data:audio/wav;base64,OLD')")
        assert not any(c.startswith('play:') for c in calls())
        assert page.locator('audio').get_attribute('src') is None
        report['checks'].append('Sample switch resets audio and rejects stale URL completion')
        button('试听').click()
        page.evaluate('window.voiceQA.mediaReject()')
        expect(page.get_by_role('alert')).to_contain_text('模拟地址读取失败')
        button('重试试听').click()
        page.evaluate("url => { window.voiceQA.playError = true; window.voiceQA.mediaFinish(url); }", audio_url)
        expect(page.get_by_role('alert')).to_contain_text('模拟播放失败')
        button('重试试听').click()
        page.evaluate("url => { window.voiceQA.playError = false; window.voiceQA.mediaFinish(url); }", audio_url)
        expect(button('试听')).to_be_enabled()
        expect(page.get_by_role('alert')).to_have_count(0)
        page.locator('audio').dispatch_event('error')
        expect(page.get_by_role('alert')).to_contain_text('文件不可读')
        report['checks'].append('Play promise rejection and media error shown; retry succeeds')
        button('解绑').click()
        button('确认解绑').click()
        expect(button('解绑中…')).to_be_disabled()
        page.evaluate("window.voiceQA.finish('error')")
        expect(dialog.get_by_role('alert')).to_contain_text('模拟解绑失败')
        button('确认解绑').click()
        page.evaluate("window.voiceQA.finish('save')")
        expect(dialog).not_to_be_visible()
        expect(page.get_by_text('尚未导入声音样本', exact=True)).to_be_visible()
        expect(button('导入样本')).to_be_enabled()
        report['checks'].append('Unlink cancel, busy, error and success preserve controlled state')
        button('缺失文件').click()
        expect(button('试听')).to_be_disabled()
        expect(page.get_by_text('时长未知 · 缺少本地文件，请替换样本')).to_be_visible()
        page.get_by_label('禁用', exact=True).check()
        expect(button('替换样本')).to_be_disabled()
        expect(button('解绑')).to_be_disabled()
        page.get_by_label('禁用', exact=True).uncheck()
        button('切换样本B').click()
        button('试听').click()
        before = len([c for c in calls() if c.startswith('play:')])
        button('卸载').click()
        page.evaluate("window.voiceQA.mediaFinish('data:audio/wav;base64,UNMOUNTED')")
        assert len([c for c in calls() if c.startswith('play:')]) == before
        assert calls()[-2:] == ['pause', 'reset']
        report['checks'].append('Missing file and disabled states; unmount pauses/resets and ignores pending media')
        assert not report['errors'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))

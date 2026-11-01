"""Real local cover files, production database/IPC, and an isolated Electron profile."""
import importlib.util
import base64
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import threading
from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/project-cover'
spec = importlib.util.spec_from_file_location('base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    fixture = Image.new('RGB', (1280, 720), '#214c48')
    ImageDraw.Draw(fixture).text((100, 300), 'PROJECT COVER', fill='#ffffff', font_size=80)
    fixture.save(profile / 'fixture.png')
    generated = Image.new('RGB', (1280, 720), '#c06558')
    generated.save(profile / 'generated.png')
    requests = []
    class Provider(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append({'path': self.path, 'body': body})
            time.sleep(.8)
            if len(requests) == 1:
                self.send_response(400)
                response = {'error': {'message': 'QA image generation did not complete successfully'}}
            else:
                self.send_response(200)
                response = {'data': [{'b64_json': base64.b64encode((profile / 'generated.png').read_bytes()).decode()}]}
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())
    provider = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    # The isolated development bundle has no license endpoint; all provider calls use localhost.
    qa_main = ROOT / 'dist-electron/electron/qa-project-cover-main.js'
    subprocess.run([str(ROOT / 'scripts/run-npm-node.cmd'), '--input-type=module', '-e',
        "import {build} from 'esbuild';await build({entryPoints:['electron/main.ts'],outfile:process.argv[1],bundle:true,platform:'node',format:'esm',target:'node20',external:['electron','sql.js','undici'],banner:{js:\"import { createRequire as cr } from 'node:module'; import { fileURLToPath as fp } from 'node:url'; const require=cr(import.meta.url);const __filename=fp(import.meta.url);\"},plugins:[{name:'isolated-license',setup(b){b.onLoad({filter:/license-public\\.json$/},()=>({contents:'{}',loader:'json'}));}}]});",
        str(qa_main)], cwd=ROOT, env=env, check=True)
    env['STORYDREAM_PROJECT_QA_MAIN'] = str(qa_main)
    controls = {'allowCoverGeneration': True, 'coverUpload': 'fixture'}
    (profile / 'controls.json').write_text(json.dumps(controls), encoding='utf-8')
    subprocess.run([str(ROOT / 'scripts/run-npm-node.cmd'), 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-project-cover-seed.ts', str(profile)], cwd=ROOT, env=env, check=True)
    projects = {p['name']: p for p in json.loads((profile / 'covers.json').read_text(encoding='utf-8'))}
    report = {'status': 'running', 'checks': [], 'screenshots': [], 'runtimeErrors': [], 'profile': str(profile)}
    process = browser = None
    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30_000)
            page.on('pageerror', lambda e: report['runtimeErrors'].append(str(e)))
            base.wait_app(page)
            page.wait_for_selector('[data-project-home]')
            def card(name): return page.locator(f'[data-project-id="{projects[name]["id"]}"]')
            def loaded(name):
                img = card(name).locator('img')
                img.scroll_into_view_if_needed()
                expect(img).to_be_visible()
                page.wait_for_function('(id) => {const img=document.querySelector(`[data-project-id="${id}"] img`);return img?.complete && img.naturalWidth===1280;}', arg=projects[name]['id'])
            for name in ['自动封面', '手动封面', 'HTML 封面']: loaded(name)
            loaded('漫剧分镜封面')
            page.wait_for_function('(id) => {const img=document.querySelector(`[data-project-id="${id}"] img`);return img?.complete && img.src.includes("frame-") && img.naturalWidth===640;}', arg=projects['创意动画首帧']['id'])
            expect(card('缺少封面').locator('.project-card-cover-empty')).to_be_visible()
            report['checks'].append('Existing generated, manual and HTML covers load as real images; missing cover retains placeholder')
            target = projects['生成后同步']
            shutil.copyfile(profile / 'fixture.png', target['cover'])
            page.evaluate('(id) => window.storydream.setTaskFavorite(id, true)', target['id'])
            loaded('生成后同步')
            old_src = card('生成后同步').locator('img').get_attribute('src')
            replacement = Image.new('RGB', (1280, 720), '#a74138')
            replacement.save(target['cover'])
            page.evaluate('(id) => window.storydream.setTaskFavorite(id, false)', target['id'])
            page.wait_for_function('({id, old}) => {const img=document.querySelector(`[data-project-id="${id}"] img`);return img?.complete && img.naturalWidth===1280 && img.src!==old;}', arg={'id': target['id'], 'old': old_src})
            report['checks'].append('Task delta automatically refreshes a newly available cover and same-path replacement without page reload')
            page.evaluate('''async (url) => {
              const state = await window.storydream.getBootstrap();
              const image = {...state.config.gptImage, baseUrl: url, model: 'gpt-image-2', proxyUrl: '', ratio: '16:9'};
              const config = {...state.config, imageProvider:'gpt_image', gptImage:image, image, activeImageProfileId:'default-image',
                imageProfiles:[{id:'default-image',name:'Local QA',enabled:true,provider:'gpt_image',gptImage:image}]};
              await window.storydream.saveConfig({config,secretChanges:{'image/default-image/gptImage/apiKey':'qa-local-only'}});
            }''', f'http://127.0.0.1:{provider.server_port}/v1')
            def open_cover(name):
                card(name).get_by_role('button', name='设置项目封面', exact=True).click()
                return page.get_by_role('dialog', name='项目封面', exact=True)
            original = card('自动封面').locator('img').get_attribute('src')
            dialog = open_cover('自动封面')
            dialog.get_by_role('button', name='生成封面', exact=True).click()
            expect(dialog.get_by_role('button', name='正在生成', exact=True)).to_be_disabled()
            expect(dialog.get_by_role('button', name='上传封面', exact=True)).to_be_disabled()
            expect(dialog.get_by_role('button', name='重试生成', exact=True)).to_be_visible(timeout=20_000)
            expect(dialog).to_contain_text('图片服务未生成图片')
            expect(dialog).to_contain_text('(400)')
            assert card('自动封面').locator('img').get_attribute('src') == original
            assert len(requests) == 1
            page.screenshot(path=OUTPUT / 'generation-error.png', full_page=True, animations='disabled')
            report['screenshots'].append('generation-error.png')
            dialog.get_by_role('button', name='重试生成', exact=True).click()
            expect(dialog).not_to_be_visible(timeout=20_000)
            loaded('自动封面')
            generated_src = card('自动封面').locator('img').get_attribute('src')
            assert generated_src != original
            assert len(requests) == 2
            assert all(r['path'] == '/v1/images/generations' for r in requests)
            page.reload()
            page.wait_for_selector('[data-project-home]')
            loaded('自动封面')
            assert card('自动封面').locator('img').get_attribute('src') == generated_src
            dialog = open_cover('自动封面')
            dialog.get_by_role('button', name='恢复自动封面', exact=True).click()
            expect(dialog).not_to_be_visible()
            loaded('自动封面')
            assert card('自动封面').locator('img').get_attribute('src') == original
            dialog = open_cover('缺少封面')
            dialog.get_by_role('button', name='上传封面', exact=True).click()
            expect(dialog).not_to_be_visible()
            loaded('缺少封面')
            dialog = open_cover('缺少封面')
            dialog.get_by_role('button', name='恢复自动封面', exact=True).click()
            expect(dialog).not_to_be_visible()
            expect(card('缺少封面').locator('.project-card-cover-empty')).to_be_visible()
            controls['coverUpload'] = 'cancel'
            (profile / 'controls.json').write_text(json.dumps(controls), encoding='utf-8')
            dialog = open_cover('自动封面')
            dialog.get_by_role('button', name='上传封面', exact=True).click()
            expect(dialog.get_by_role('button', name='关闭', exact=True)).to_be_enabled()
            dialog.get_by_role('button', name='关闭', exact=True).click()
            report['checks'].append('Production IPC: generation 400 preserves original cover, retry succeeds once, generated cover persists, upload/reset/cancel work')
            for theme in ['dark', 'light']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                for width, height in [(1440, 960), (1040, 720)]:
                    base.set_size(page, width, height)
                    page.wait_for_timeout(350)
                    for name in ['自动封面', '手动封面', 'HTML 封面', '生成后同步']: loaded(name)
                    page.evaluate('document.querySelectorAll("*").forEach(n => {if(n.scrollTop) n.scrollTop=0;})')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    name = f'{theme}-{width}.png'
                    page.screenshot(path=OUTPUT / name, full_page=True, animations='disabled')
                    report['screenshots'].append(name)
                    dialog = open_cover('自动封面')
                    page.screenshot(path=OUTPUT / f'dialog-{name}', full_page=True, animations='disabled')
                    report['screenshots'].append(f'dialog-{name}')
                    assert dialog.evaluate('(n) => n.scrollWidth <= n.clientWidth + 1')
                    for button in dialog.locator('.fui-DialogActions button').all():
                        assert button.evaluate('(n) => getComputedStyle(n).whiteSpace === "nowrap"')
                    dialog.get_by_role('button', name='关闭', exact=True).click()
            page.reload()
            page.wait_for_selector('[data-project-home]')
            for name in ['自动封面', '手动封面', 'HTML 封面', '生成后同步']: loaded(name)
            report['checks'].append('Covers survive renderer reload; both themes fit desktop and compact windows')
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert not ledger['blockedGeneration']
            assert all(not item['heavy'] for item in ledger['lists'])
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        raise
    finally:
        if browser:
            try: browser.close()
            except Exception: pass
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        provider.shutdown()
        provider.server_close()
        report['providerRequests'] = requests
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()

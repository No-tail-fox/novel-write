"""Real local cover files, production database/IPC, and an isolated Electron profile."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
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
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
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
            deadline = time.monotonic() + 25
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
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
                    page.screenshot(path=OUTPUT / name, full_page=True)
                    report['screenshots'].append(name)
            page.reload()
            page.wait_for_selector('[data-project-home]')
            for name in ['自动封面', '手动封面', 'HTML 封面', '生成后同步']: loaded(name)
            report['checks'].append('Covers survive renderer reload; both themes fit desktop and compact windows')
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert not ledger['blockedGeneration']
            assert all(not item['heavy'] for item in ledger['lists'])
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
    finally:
        if browser:
            try: browser.close()
            except Exception: pass
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()

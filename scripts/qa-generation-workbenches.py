"""Standalone workbench navigation and local video generation through production Electron."""
from __future__ import annotations

import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import traceback

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/generation-workbenches'
spec = importlib.util.spec_from_file_location('generation_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
VIEWS = [('image-lab', '图片生成'), ('voice-lab', '配音生成'), ('video-lab', '视频生成')]


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    fixture_code = "import imageio_ffmpeg,subprocess,sys; subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',sys.argv[1]],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)"
    subprocess.run([str(ROOT / 'vendor/python/python.exe'), '-c', fixture_code, str(profile / 'fixture.mp4')], check=True, cwd=ROOT, env=env)
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'profile': str(profile)}
    process = None

    def ready(view):
        expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', view)
        expect(page.locator('.app-shell')).to_have_attribute('aria-busy', 'false')

    def navigate(view):
        if view in {item[0] for item in VIEWS} and not page.locator(f'.nav-list [data-nav-view="{view}"]').count():
            page.locator('.nav-list [data-nav-view="person-assets"]').click()
            ready('person-assets')
        page.locator(f'.nav-list [data-nav-view="{view}"]').click()
        ready(view)

    def capture(name):
        metrics = page.evaluate('''() => ({width: innerWidth, view: document.querySelector('.app-shell').dataset.shellView, overflow: document.documentElement.scrollWidth > innerWidth + 1,
          generation: [...document.querySelectorAll('.nav-list [data-nav-view]')].filter(n => ['image-lab','voice-lab','video-lab'].includes(n.dataset.navView)).map(n => {
            const r=n.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {view:n.dataset.navView, visible:r.top>=0 && r.bottom<=innerHeight && (hit===n || n.contains(hit))};
          })})''')
        assert not metrics['overflow'], metrics
        if metrics['view'] in {'person-assets', *(item[0] for item in VIEWS)}:
            assert len(metrics['generation']) == 3 and all(item['visible'] for item in metrics['generation']), metrics
            expect(page.locator('.nav-list [data-nav-view="person-assets"]')).to_have_class(re.compile(r'\bactive\b'))
            expect(page.locator('.page-breadcrumb')).to_contain_text('素材库')
        else:
            assert not metrics['generation'], metrics
        expect(page.locator('.global-action-banner')).not_to_contain_text('请求参数无效') if page.locator('.global-action-banner').count() else None
        path = OUTPUT / f'{name}.png'
        page.screenshot(path=path, animations='disabled')
        assert base.screenshot_variance(path) > 10
        report['captures'].append({'file': str(path), **metrics})

    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-generation-workbenches.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            if page.get_by_role('button', name='切换浅色主题', exact=True).count():
                page.get_by_role('button', name='切换浅色主题', exact=True).click()
            navigate('projects')
            for width, height in [(1440, 900), (1040, 720)]:
                base.set_size(page, width, height)
                capture(f'projects-{width}')
                navigate('person-assets')
                capture(f'assets-{width}')
                for view, label in VIEWS:
                    button = page.get_by_role('button', name=label, exact=True)
                    button.focus()
                    button.press('Enter')
                    ready(view)
                    expect(page.locator(f'[data-local-lab-workbench="{view}"]')).to_be_visible()
                    expect(button).to_have_attribute('aria-current', 'page')
                    capture(f'{view}-{width}')
                navigate('projects')
            report['checks'].append('All three workbenches belong to the asset library with correct parent selection and keyboard access at 1440 and 1040 widths')
            if '--navigation-only' in sys.argv:
                assert not report['runtimeErrors'], report['runtimeErrors']
                report['paidGenerationCalls'] = 0
                report['status'] = 'passed'
                return
            base.set_size(page, 1440, 900)
            navigate('video-lab')
            expect(page.get_by_role('button', name='生成视频', exact=True)).to_be_disabled()
            page.get_by_label('视频描述', exact=True).fill('镜头缓慢掠过清晨的海岸，海浪轻轻拍打沙滩。')
            page.get_by_label('视频描述', exact=True).press('Tab')
            navigate_button = page.locator('.nav-list [data-nav-view="projects"]')
            navigate_button.click()
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('button', name='继续编辑', exact=True).click()
            expect(page.get_by_label('视频描述', exact=True)).to_have_value('镜头缓慢掠过清晨的海岸，海浪轻轻拍打沙滩。')
            navigate_button.click()
            page.get_by_role('button', name='保存并离开', exact=True).click()
            ready('projects')
            navigate('video-lab')
            expect(page.get_by_label('视频描述', exact=True)).to_have_value('镜头缓慢掠过清晨的海岸，海浪轻轻拍打沙滩。')
            report['checks'].append('Unconfigured generation is disabled; cancel/save/return preserves video draft')
            page.evaluate('''async () => {
              const {config}=await window.storydream.getBootstrap();
              const provider={id:'video-workbench-qa',name:'本地验收视频服务',enabled:true,baseUrl:'https://video.example',apiKey:'',model:'qa-video',submitPath:'/v1/videos/generations',statusPathTemplate:'/v1/videos/{id}',pollIntervalMs:500,timeoutMs:30000,concurrency:1,pricePerSecond:0,maxDurationSec:10,maxResolution:'720p',capabilities:['t2v','i2v','first-last-frame','reference-image'],license:'QA only',requestParamsJson:'{}'};
              await window.storydream.saveConfig({config:{...config,video:{providers:[provider],activeProviderId:provider.id,automation:{...config.video.automation,providerWhitelist:[provider.id],fallback:'disabled',budgetLimit:10}}},secretChanges:{'video/video-workbench-qa/apiKey':'qa-dummy-key'}});
            }''')
            base.reload_app(page)
            ready('video-lab')
            page.get_by_label('视频服务', exact=True).select_option('video-workbench-qa')
            generate = page.get_by_role('button', name='生成视频', exact=True)
            expect(generate).to_be_enabled()
            generate.click()
            expect(page.locator('[data-video-lab-history]')).to_contain_text('已完成', timeout=90000)
            video = page.locator('video[data-media-canvas="video-lab"]')
            expect(video).to_be_visible()
            page.wait_for_function("() => document.querySelector('video[data-media-canvas=video-lab]')?.readyState >= 2")
            capture('video-generated-light')
            page.get_by_role('button', name='切换深色主题', exact=True).click()
            capture('video-generated-dark')
            base.set_size(page, 1040, 720)
            capture('video-generated-dark-compact')
            base.set_size(page, 1440, 900)
            page.get_by_role('button', name='切换浅色主题', exact=True).click()
            navigate_button.click()
            page.get_by_role('button', name='保存并离开', exact=True).click()
            ready('projects')
            navigate('video-lab')
            base.reload_app(page)
            expect(page.locator('[data-video-lab-history]')).to_contain_text('已完成')
            records = page.evaluate('async () => window.storydream.listVideoLabRecords()')
            assert len(records) == 1 and records[0]['status'] == 'completed'
            assert Path(records[0]['videoPath']).is_file()
            report['checks'].append('Production video IPC, provider adapter, normalization, preview and history persistence work with a local fixture')
            (profile / 'controls.json').write_text(json.dumps({'fail': True}), encoding='utf-8')
            page.get_by_label('视频描述', exact=True).fill('用于验证服务失败后仍保留生成记录。')
            generate.click()
            expect(page.locator('[data-video-lab-history]')).to_contain_text('失败', timeout=30000)
            expect(generate).to_be_enabled()
            capture('video-provider-failure')
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert len(ledger['submissions']) == 2, ledger
            assert not ledger['blockedCalls'], ledger
            report['checks'].append('Provider failure is visible and persisted, with exactly one submit per click')
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['paidGenerationCalls'] = 0
            report['status'] = 'passed'
    except Exception:
        report['status'] = 'failed'
        report['error'] = traceback.format_exc()
        raise
    finally:
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)


if __name__ == '__main__':
    main()

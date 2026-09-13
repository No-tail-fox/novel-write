"""Verify real comic shot controls and output ownership with local API fixtures."""
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
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', 'E:/StoryDream-QA/r04-r05/structure-browser'))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-structure.harness.tsx',name:'comicQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks, errors = [], []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
            page = browser.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                rows = page.locator('.director-shot-row')
                expect(rows).to_have_count(6)
                if width < 1180:
                    page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                expect(page.locator('.director-shot-row__index')).to_have_text(['01', '02', '03', '04', '05', '06'])
                rows.nth(1).click()
                page.get_by_role('button', name='下移当前镜头', exact=True).click()
                expect(page.locator('.director-shot-row__copy strong')).to_have_text(['A11', 'A21', 'A12', 'A22', 'A31', 'A32'])
                expect(rows.nth(2)).to_have_attribute('aria-pressed', 'true')
                page.get_by_role('button', name='上移当前镜头', exact=True).click()
                expect(page.locator('.director-shot-row__copy strong')).to_have_text(['A11', 'A12', 'A21', 'A22', 'A31', 'A32'])
                checks.append(f'{width}: global indices and cross-scene up/down order')

                rows.nth(3).click()
                page.get_by_role('button', name='删除当前镜头', exact=True).click()
                expect(page.get_by_role('dialog')).to_contain_text('A22')
                page.get_by_role('button', name='取消', exact=True).click()
                expect(rows).to_have_count(6)
                page.get_by_role('button', name='删除当前镜头', exact=True).click()
                page.get_by_role('button', name='删除镜头', exact=True).click()
                expect(rows).to_have_count(5)
                expect(rows.nth(3)).to_have_attribute('aria-pressed', 'true')
                expect(rows.nth(3)).to_contain_text('A31')
                checks.append(f'{width}: delete confirmation, cancel and adjacent selection')
                page.screenshot(path=str(OUTPUT / f'structure-{width}x{height}.png'))
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                toolbar = page.get_by_role('toolbar', name='镜头结构操作')
                assert toolbar.evaluate('(element) => element.scrollWidth <= element.clientWidth')
                checks.append(f'{width}: structure toolbar fits')
                if width < 1180:
                    page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                expect(page.locator('.director-preview-toolbar')).to_contain_text('成片已过期')
                page.get_by_role('button', name='成片历史', exact=True).click()
                expect(page.get_by_role('dialog')).to_contain_text('历史成片，与当前编辑不一致')
                page.get_by_role('button', name='关闭', exact=True).click()
                checks.append(f'{width}: stale output remains in history')

                duration = page.get_by_label('时长（秒）', exact=True)
                duration.fill('3.2')
                duration.press('Enter')
                expect(duration).to_have_value('3.2')
                page.get_by_role('button', name='保存版本', exact=True).first.click()
                page.wait_for_function('window.comicStructureQA.saved.length > 0')
                assert page.evaluate('window.comicStructureQA.saved.at(-1).episodes[0].scenes.flatMap(s=>s.shots).find(s=>s.title==="A31").durationMs') == 3200
                checks.append(f'{width}: duration edits reach persisted canonical timeline')

                page.get_by_role('button', name='生成成片', exact=True).click()
                page.wait_for_function('window.comicStructureQA.renderPending')
                expect(duration).to_be_disabled()
                if width < 1180:
                    page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                for label in ['新增镜头', '新增场景', '新增集数', '上移当前镜头', '下移当前镜头', '删除当前镜头']:
                    expect(page.get_by_role('button', name=label, exact=True)).to_be_disabled()
                assert page.evaluate('Boolean(window.comicStructureQA.renderRequests.at(-1).episodeId)')
                page.evaluate('window.comicStructureQA.endRender()')
                page.wait_for_function('!window.comicStructureQA.renderPending')
                checks.append(f'{width}: render locks structure and submits explicit episode')

                while rows.count() > 1:
                    page.get_by_role('button', name='删除当前镜头', exact=True).click()
                    page.get_by_role('button', name='删除镜头', exact=True).click()
                expect(page.get_by_role('button', name='删除当前镜头', exact=True)).to_be_disabled()
                checks.append(f'{width}: final shot deletion is unavailable')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps({'checks': checks, 'runtimeErrors': errors, 'paidGenerationCalls': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'runtimeErrors': errors}, ensure_ascii=False))

if __name__ == '__main__':
    run()

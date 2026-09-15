"""Exercise protocol selection with production IPC and an isolated secret vault."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/llm-protocol'


def open_settings(page):
    page.locator('[data-nav-level="primary"][data-nav-view="settings"]').click()
    expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'settings')
    if page.get_by_label('设置分类').is_visible():
        page.get_by_label('设置分类').select_option('llm')
    else:
        page.locator('.settings-tab').filter(has_text='LLM').click()
    expect(page.get_by_label('API 协议', exact=True)).to_be_visible()


def capture(page, name, report):
    page.get_by_label('API 协议', exact=True).scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT / f'{name}.png', full_page=True)
    geometry = page.evaluate('''() => ({
      width:innerWidth, document:document.documentElement.scrollWidth,
      overflow:[...document.querySelectorAll('.profile-editor-grid, .sd-select, .settings-content')]
        .filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.className),
      select: (() => { const n=[...document.querySelectorAll('select')].find(n=>n.closest('.sd-field')?.innerText.includes('API 协议')); const r=n.getBoundingClientRect(); return {x:r.x, right:r.right, width:r.width}; })()
    })''')
    assert geometry['document'] <= geometry['width'] + 2, geometry
    assert not geometry['overflow'], geometry
    assert 0 <= geometry['select']['x'] < geometry['select']['right'] <= geometry['width'], geometry
    report['screenshots'].append(name)


def save(page):
    page.get_by_role('button', name='保存配置', exact=True).click()
    expect(page.locator('.test-result')).to_contain_text('[pass]')
    expect(page.get_by_role('button', name='保存配置', exact=True)).to_be_enabled()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'checks': [], 'screenshots': [], 'runtimeErrors': []}
    spec = importlib.util.spec_from_file_location('llm_qa_base', ROOT / 'scripts/qa-director-desk.py')
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile)}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    process = browser = None
    try:
        with sync_playwright() as pw:
            preview = pw.chromium.launch(channel='chrome', headless=True)
            try:
                page = preview.new_page(viewport={'width': 1440, 'height': 900})
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                page.goto('http://127.0.0.1:5173/')
                page.wait_for_selector('.app-shell')
                open_settings(page)
                page.get_by_label('API 协议', exact=True).select_option('responses')
                capture(page, 'browser-responses', report)
                save(page)
                page.reload()
                page.wait_for_selector('.app-shell')
                open_settings(page)
                expect(page.get_by_label('API 协议', exact=True)).to_have_value('responses')
                report['checks'].append('Browser preview saves and restores protocol without credentials')
            finally:
                preview.close()

            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-llm-protocol.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            await_seed = '''async () => {
              const {config}=await window.storydream.getBootstrap();
              const llm={...config.llm,id:'llm-protocol-qa',name:'Protocol QA',provider:'custom',protocol:'openai',apiKey:'',baseUrl:'https://llm.example',model:'qa-model',requestParamsJson:'{}'};
              await window.storydream.saveConfig({config:{...config,llm,llmProfiles:[llm],activeLlmProfileId:llm.id},secretChanges:{'llm/llm-protocol-qa/apiKey':'qa-dummy-key'}});
            }'''
            page.evaluate(await_seed)
            base.reload_app(page)
            open_settings(page)
            for protocol in ['responses', 'anthropic', 'openai']:
                selector = page.get_by_label('API 协议', exact=True)
                selector.select_option(protocol)
                expect(selector).to_have_value(protocol)
                expect(page.get_by_role('button', name='自定义', exact=True)).to_have_attribute('aria-pressed', 'true')
                expect(page.locator('.secret-input input')).to_have_value('')
                expect(page.locator('.secret-input')).to_contain_text('已配置')
                page.get_by_role('button', name='仅测试当前 LLM', exact=True).click()
                expect(selector).to_be_disabled()
                expect(page.locator('.test-result')).to_contain_text('[pass]', timeout=15000)
                expect(selector).to_be_enabled()
                page.get_by_role('button', name='获取模型', exact=True).click()
                expect(page.locator('.model-list-status')).to_contain_text('[pass]')
                save(page)
                base.reload_app(page)
                open_settings(page)
                expect(selector).to_have_value(protocol)
                public = page.evaluate('''async () => { const s=await window.storydream.getBootstrap(); return {protocol:s.config.llm.protocol,provider:s.config.llm.provider,secretBlank:s.config.llm.apiKey==='',hasSecret:s.secretStatus['llm/llm-protocol-qa/apiKey']}; }''')
                assert public == {'protocol': protocol, 'provider': 'custom', 'secretBlank': True, 'hasSecret': True}, public
                report['checks'].append(f'{protocol}: production test/model-list/save/reload, custom identity, vault redaction')

            selector.select_option('responses')
            save(page)
            for theme in ['dark', 'light']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                for width, height in [(1440, 900), (1040, 720), (390, 844)]:
                    base.set_size(page, width, height)
                    capture(page, f'desktop-{theme}-{width}', report)
            base.set_size(page, 1440, 900)
            selector.focus()
            expect(selector).to_be_focused()
            selector.press('ArrowDown')
            expect(selector).to_have_value('anthropic')
            selector.select_option('responses')
            (profile / 'llm-controls.json').write_text('{"mode":"fail"}', encoding='utf-8')
            page.get_by_role('button', name='仅测试当前 LLM', exact=True).click()
            expect(page.locator('.test-result')).to_contain_text('404')
            capture(page, 'desktop-protocol-error', report)
            (profile / 'llm-controls.json').write_text('{}', encoding='utf-8')
            page.get_by_role('button', name='仅测试当前 LLM', exact=True).click()
            expect(page.locator('.test-result')).to_contain_text('[pass]')
            report['checks'].append('Keyboard, busy, provider failure and retry states')
            page.locator('[data-profile-card] button[title="复制"]').click()
            expect(selector).to_have_value('responses')
            page.get_by_role('button', name='启用 LLM 配置 Protocol QA 副本', exact=True).click()
            expect(page.locator('.test-result')).to_contain_text('[pass]')
            base.reload_app(page)
            open_settings(page)
            expect(selector).to_have_value('responses')
            report['checks'].append('Copied profile retains Responses after activation and reload')
            report['requests'] = json.loads((profile / 'llm-requests.json').read_text(encoding='utf-8'))
            assert {'/v1/responses', '/v1/messages', '/v1/chat/completions', '/v1/models'} <= {item['path'] for item in report['requests']}
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if process and process.poll() is None:
            process.terminate()
            process.wait(timeout=15)
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

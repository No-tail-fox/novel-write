"""Verify credential entry points without using real keys or external provider calls."""
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
OUTPUT = ROOT / '.artifacts/provider-portals'


def section(page, name):
    control = page.get_by_label('设置分类', exact=True)
    control.scroll_into_view_if_needed()
    control.select_option(name)
    expect(page.get_by_role('group', name='密钥与控制台', exact=True)).to_be_visible()


def capture(page, name, report):
    footer = page.get_by_role('group', name='密钥与控制台', exact=True)
    footer.scroll_into_view_if_needed()
    page.screenshot(path=OUTPUT / f'{name}.png', full_page=True)
    geometry = page.evaluate('''() => ({
      width:innerWidth, document:document.documentElement.scrollWidth,
      overflow:[...document.querySelectorAll('.provider-portal-links, .provider-portal-list, .provider-portal-item')]
        .filter(n => n.scrollWidth > n.clientWidth + 2).map(n => n.className),
      rects:[...document.querySelectorAll('.provider-portal-item button')].map(n => {const r=n.getBoundingClientRect();return {left:r.left,right:r.right};})
    })''')
    assert geometry['document'] <= geometry['width'] + 2, geometry
    assert not geometry['overflow'], geometry
    assert all(0 <= r['left'] < r['right'] <= geometry['width'] for r in geometry['rects']), geometry
    contrast = page.evaluate('''() => {
      const luminance = rgb => { const c=rgb.slice(0,3).map(x => {x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2]; };
      const channels = value => value.match(/[\\d.]+/g).map(Number);
      return [...document.querySelectorAll('.provider-portal-item .sd-button__content')].map(n => {
        let parent=n, bg;
        while(parent){const c=channels(getComputedStyle(parent).backgroundColor);if(c.length===3 || c[3]===1){bg=c;break;}parent=parent.parentElement;}
        const a=luminance(channels(getComputedStyle(n).color)), b=luminance(bg || [255,255,255]);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
    }''')
    assert all(value >= 4.5 for value in contrast), contrast
    button = footer.get_by_role('button').first
    if button.count():
        before = button.bounding_box()
        button.hover()
        page.wait_for_timeout(180)
        after = button.bounding_box()
        assert all(abs(before[key] - after[key]) < 1 for key in before), (before, after)
    report['screenshots'].append(name)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'checks': [], 'screenshots': [], 'runtimeErrors': []}
    spec = importlib.util.spec_from_file_location('portal_qa_base', ROOT / 'scripts/qa-director-desk.py')
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
                context = preview.new_context(viewport={'width': 1440, 'height': 900})
                context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5173/') else route.fulfill(status=200, content_type='text/html', body='<title>QA Provider</title><p>QA browser navigation</p>'))
                page = context.new_page()
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                page.goto('http://127.0.0.1:5173/')
                page.wait_for_selector('.app-shell')
                page.locator('[data-nav-level="primary"][data-nav-view="settings"]').click()
                section(page, 'tts')
                with context.expect_page() as opened:
                    page.get_by_role('button', name='火山语音密钥与应用', exact=True).click()
                popup = opened.value
                popup.wait_for_load_state()
                assert popup.url == 'https://console.volcengine.com/speech/service/8', popup.url
                assert popup.evaluate('window.opener === null')
                assert page.url.startswith('http://127.0.0.1:5173/')
                popup.close()
                capture(page, 'browser-tts', report)
                report['checks'].append('Browser preview opens a separate noopener tab and preserves the settings page')
            finally:
                preview.close()

            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-provider-portals.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            deadline = time.monotonic() + 30
            while not browser.contexts[0].pages and time.monotonic() < deadline:
                time.sleep(.1)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            page.evaluate('''async () => {
              const {config}=await window.storydream.getBootstrap();
              config.video.providers[0].baseUrl='https://video.example/api/v1?api_key=qa-secret#private';
              config.ttsProfiles.push({...config.ttsProfiles[0],id:'minimax-qa',name:'MiniMax QA',enabled:false,provider:'minimax'});
              await window.storydream.saveConfig({config,secretChanges:{}});
            }''')
            base.reload_app(page)
            page.locator('[data-nav-level="primary"][data-nav-view="settings"]').click()
            section(page, 'tts')
            original = page.evaluate('async () => JSON.stringify((await window.storydream.getBootstrap()).config)')

            def click_portal(label, url, keyboard=False):
                button = page.get_by_role('button', name=label, exact=True)
                button.scroll_into_view_if_needed()
                expect(button).to_have_attribute('title', url)
                if keyboard:
                    button.focus()
                    expect(button).to_be_focused()
                    button.press('Enter')
                else:
                    button.click()
                expect(button).to_be_disabled()
                expect(button).to_be_enabled(timeout=10000)
                urls = json.loads((profile / 'opened-portals.json').read_text(encoding='utf-8'))
                assert urls[-1] == url, urls
                expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'settings')

            click_portal('火山语音密钥与应用', 'https://console.volcengine.com/speech/service/8', keyboard=True)
            click_portal('火山 Access Key', 'https://console.volcengine.com/iam/keymanage/')
            page.get_by_role('button', name='旧版接口', exact=True).click()
            expect(page.get_by_role('button', name='火山 Access Key', exact=True)).to_have_count(0)
            expect(page.get_by_role('button', name='火山语音密钥与应用', exact=True)).to_be_visible()
            page.locator('[data-profile-card]').filter(has_text='MiniMax QA').click()
            expect(page.get_by_role('button', name='火山语音密钥与应用', exact=True)).to_have_count(0)
            click_portal('MiniMax API Key', 'https://platform.minimax.cn/console/access?tab=api-keys')
            report['checks'].append('Selected inactive TTS profile and legacy/V3 switch show the correct key console')

            section(page, 'llm')
            page.get_by_role('button', name='OpenAI', exact=True).click()
            click_portal('OpenAI API Key', 'https://platform.openai.com/api-keys')
            page.get_by_role('button', name='Anthropic', exact=True).click()
            click_portal('Claude API Key', 'https://platform.claude.com/settings/keys')
            section(page, 'image')
            click_portal('OpenAI API Key', 'https://platform.openai.com/api-keys')
            page.get_by_role('button', name='即梦', exact=True).click()
            click_portal('火山 Access Key', 'https://console.volcengine.com/iam/keymanage/')
            section(page, 'speechToText')
            page.get_by_role('button', name='SiliconFlow', exact=True).click()
            click_portal('SiliconFlow API Key', 'https://cloud.siliconflow.cn/account/ak')
            report['checks'].append('LLM, image, and transcription footer links follow supplier changes')

            section(page, 'video')
            click_portal('服务商网站', 'https://video.example/')
            field = page.get_by_label('接口地址', exact=True)
            field.fill('http://127.0.0.1:8080')
            expect(page.get_by_role('button', name='服务商网站', exact=True)).to_have_count(0)
            expect(page.get_by_text('暂无可用的服务商网址', exact=True)).to_be_visible()
            capture(page, 'desktop-video-no-portal', report)
            field.fill('https://video.example/api/v1?api_key=qa-secret#private')
            (profile / 'portal-controls.json').write_text('{"fail":true}', encoding='utf-8')
            page.get_by_role('button', name='服务商网站', exact=True).click()
            expect(page.locator('.provider-portal-links [role="alert"]')).to_contain_text('Browser launch failed')
            capture(page, 'desktop-open-error', report)
            (profile / 'portal-controls.json').write_text('{}', encoding='utf-8')
            click_portal('服务商网站', 'https://video.example/')
            expect(page.locator('.provider-portal-links [role="alert"]')).to_have_count(0)
            expect(field).to_have_value('https://video.example/api/v1?api_key=qa-secret#private')
            assert page.evaluate('async () => JSON.stringify((await window.storydream.getBootstrap()).config)') == original
            report['checks'].append('Public origin only, local/empty state, opener failure/retry, drafts and persisted config unchanged')

            for theme in ['dark', 'light']:
                if page.locator('html').get_attribute('data-theme') != theme:
                    page.locator('.theme-toggle').click()
                for width, height in [(1440, 900), (1040, 720), (390, 844)]:
                    base.set_size(page, width, height)
                    capture(page, f'desktop-video-{theme}-{width}', report)
            base.set_size(page, 1440, 900)
            section(page, 'tts')
            page.get_by_role('button', name='火山引擎', exact=True).click()
            page.get_by_role('button', name='新版 V3', exact=True).click()
            for width, height in [(1440, 900), (1040, 720), (390, 844)]:
                base.set_size(page, width, height)
                capture(page, f'desktop-tts-{width}', report)
            rejected = page.evaluate('''async () => { try { await window.storydream.openProviderPortal('https://video.example/?api_key=qa-secret');return false;} catch {return true;} }''')
            assert rejected
            report['opened'] = json.loads((profile / 'opened-portals.json').read_text(encoding='utf-8'))
            assert all('qa-secret' not in url for url in report['opened'])
            ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert ledger['blockedGeneration'] == 0
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

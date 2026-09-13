"""Check the shared preview-first layout with local media and an isolated profile."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts' / ('preview-layout-' + time.strftime('%Y%m%d-%H%M%S')))))


def helper(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


qa = helper('preview_layout_helpers', 'qa-director-desk.py')
sound = helper('preview_layout_seed', 'qa-director-sound.py')


def open_project(page, title):
    if page.locator('.director-desk').is_visible():
        page.get_by_role('button', name='返回全部任务', exact=True).click()
    if page.locator("button[data-nav-view='history']").count() == 0:
        qa.navigate(page, 'queue', "[data-task-operations='queue']")
    qa.navigate(page, 'history', "[data-task-operations='history']")
    page.get_by_role('textbox', name='搜索历史记录').fill(title)
    page.get_by_role('button', name='打开任务 ' + title, exact=True).click()
    expect(page.locator('.director-desk')).to_be_visible(timeout=30000)


def capture(page, report, name):
    page.wait_for_timeout(250)
    metrics = page.locator('.director-desk').evaluate('''root => {
      const visible = n => !!n?.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
      const box = n => { const r = n.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
      const preview = root.querySelector('.director-media-preview');
      const phase = root.querySelector('.director-phase-bar');
      const controls = [...root.querySelectorAll('.director-desk-header button,.director-phase-bar button,.director-stage-step .sd-button__content > span,.director-inspector-pane > .sd-tabs [role="tab"]')].filter(visible);
      return {width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme,
        overflow: Math.max(0,root.scrollWidth-root.clientWidth,document.documentElement.scrollWidth-innerWidth),
        clipped: controls.filter(n => n.scrollWidth-n.clientWidth>3 || n.scrollHeight-n.clientHeight>3).map(n => n.getAttribute('aria-label')||n.textContent),
        phase:box(phase), toolbar:box(root.querySelector('.director-preview-toolbar')), preview:box(preview),
        imageLoaded:[...preview.querySelectorAll('img')].some(n => n.complete && n.naturalWidth>0),
        phases:[...phase.querySelectorAll('.director-stage-step')].map(n=>n.textContent),
        panels:[...root.querySelectorAll('.director-left-pane,.director-inspector-pane')].filter(visible).map(box),
        windowControls:[...document.querySelectorAll('.window-controls button')].filter(visible).length,
        font:getComputedStyle(root).fontFamily,
        background:getComputedStyle(root).backgroundColor,
      };
    }''')
    path = OUTPUT / (name + '.png')
    page.screenshot(path=path, animations='disabled', scale='css')
    report['captures'].append({'file': path.name, **metrics})
    assert metrics['overflow'] <= 1 and not metrics['clipped'], metrics
    assert len(metrics['phases']) == 4 and metrics['windowControls'] == 3, metrics
    assert metrics['toolbar']['y'] >= metrics['phase']['bottom'] - 1, metrics
    assert metrics['preview']['width'] >= 280 and metrics['preview']['height'] >= 150 and metrics['imageLoaded'], metrics
    assert metrics['preview']['bottom'] < metrics['height'] - 34, metrics
    for panel in metrics['panels']:
        assert panel['x'] >= -1 and panel['right'] <= metrics['width'] + 1, metrics
    assert qa.screenshot_variance(path, metrics['preview']) > 80


def exercise(page, report, mode, theme, width, height):
    qa.set_size(page, width, height)
    name = f'{mode}-{theme}-{width}x{height}'
    print(name, flush=True)
    page.locator('.director-center-pane').evaluate('n => {n.scrollTop=0}')
    capture(page, report, name)
    root = page.locator('.director-desk')
    if width <= 1180:
        toggle = page.get_by_role('button', name='显示项目与镜头', exact=True)
        toggle.click()
        expect(page.locator('#director-objects')).to_be_focused()
        capture(page, report, name + '-shots')
        page.keyboard.press('Escape')
        expect(toggle).to_be_focused()
        expect(toggle).to_have_attribute('aria-expanded', 'false')
        toggle.click()
        page.get_by_role('button', name='关闭项目与镜头', exact=True).click()
        expect(toggle).to_be_focused()
    if width <= 900:
        toggle = page.get_by_role('button', name='显示镜头检查器', exact=True)
        toggle.click()
        expect(page.locator('#director-inspector')).to_be_focused()
        capture(page, report, name + '-inspector')
        page.get_by_role('button', name='显示项目与镜头', exact=True).click()
        expect(root).to_have_attribute('data-inspector-open', 'false')
        toggle.click()
        expect(root).to_have_attribute('data-left-pane-open', 'false')
        page.keyboard.press('Escape')
        expect(toggle).to_be_focused()
        page.locator('.director-stage-step').filter(has_text='声音').click()
        expect(root).to_have_attribute('data-inspector-open', 'true')
        expect(page.get_by_role('tab', name='字幕', exact=True)).to_have_attribute('aria-selected', 'true')
    page.get_by_role('button', name='版本记录', exact=True).click()
    expect(page.get_by_role('tab', name='版本', exact=True)).to_have_attribute('aria-selected', 'true')
    page.get_by_role('button', name='审片报告', exact=True).click()
    expect(page.locator('.director-stage-step[aria-current="step"]')).to_contain_text('交付')
    page.get_by_role('button', name='制作步骤', exact=True).click()
    expect(page.get_by_role('menuitem', name='导出', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    if width <= 900:
        expect(root).to_have_attribute('data-inspector-open', 'true')
    page.get_by_role('tab', name='画面', exact=True).click()
    expect(page.locator('.director-stage-step[aria-current="step"]')).to_contain_text('分镜')
    if width <= 900:
        page.get_by_role('button', name='关闭镜头检查器', exact=True).click()
    report['interactions'].append(name)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=False)
    qa.QA_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='preview-layout-', dir=qa.QA_TEMP_ROOT))
    media = qa.make_fixtures(profile)
    env = os.environ.copy()
    env['NODE_ENV'] = 'production'
    for key in ['VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS']:
        env.pop(key, None)
    port = qa.free_port()
    report = {'status':'running','paidGenerationCalls':0,'runtimeErrors':[],'captures':[],'interactions':[]}
    with (OUTPUT / 'electron.log').open('wb') as log:
        process = subprocess.Popen([str(qa.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
            '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT)], cwd=ROOT, env=env,
            stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.connect_over_cdp(qa.wait_cdp(port, process))
                page = browser.contexts[0].pages[0]
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                qa.wait_app(page)
                try:
                    for mode in ['editorial-collage','motion-comic']:
                        title = '预览布局验收 ' + mode
                        sound.seed_project(page, mode, title, media['image'], media['audio'])
                        for theme in ['light','dark']:
                            qa.set_size(page, 1920, 1080)
                            if page.locator('html').get_attribute('data-theme') != theme:
                                page.locator('.theme-toggle').click()
                            expect(page.locator('html')).to_have_attribute('data-theme', theme)
                            open_project(page, title)
                            for width, height in [(1920,1080),(1440,900),(1040,720),(390,844)]:
                                exercise(page, report, mode, theme, width, height)
                            page.get_by_role('button', name='返回全部任务', exact=True).click()
                            expect(page.locator("[data-task-operations='history']")).to_be_visible()
                    assert not report['runtimeErrors'], report['runtimeErrors']
                    report['status'] = 'passed'
                except Exception as error:
                    report.update(status='failed', error=str(error))
                    page.screenshot(path=OUTPUT/'failure.png')
                    raise
                finally:
                    browser.close()
        finally:
            if process.poll() is None:
                subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'], capture_output=True, timeout=20)
                process.wait(timeout=15)
            (OUTPUT/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

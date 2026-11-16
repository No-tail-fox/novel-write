"""Real AppShell presentation integration; not an authorization or live-provider test.
Run with Python + playwright installed. Only local bundle requests are permitted.
"""
from __future__ import annotations
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_SHELL_QA_OUTPUT', 'E:/StoryDream-QA/r04-r05/shell-browser'))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([os.environ.get('STORYDREAM_QA_NODE', 'I:/nodejs/node.exe'), '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-shell.harness.tsx',name:'comicShellQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'scope': 'Real AppShell + MotionComicPage presentation only; default inactive license; no auth/bootstrap bypass or AI outputs', 'checks': [], 'failures': [], 'layout': [], 'runtimeErrors': [], 'blockedNetwork': [], 'controls': {}}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_CHROME', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page(viewport={'width': 1536, 'height': 1024})
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            def route_request(route):
                parsed = urlparse(route.request.url)
                if parsed.hostname == '127.0.0.1' and parsed.port == server.server_port:
                    route.continue_()
                else:
                    report['blockedNetwork'].append(route.request.url)
                    route.abort()
            page.route('**/*', route_request)
            def check(name, action):
                try:
                    action()
                    report['checks'].append(name)
                except Exception as error:
                    report['failures'].append({'check': name, 'error': str(error)})
            def snapshot(name):
                page.screenshot(path=str(OUTPUT / f'{name}-1536x1024.png'))
                metrics = page.evaluate('''() => {
                  const selectors = ['.app-shell', '.window-line', '.sidebar', '.shell-grid', '.content', '.page-head', '.motion-comic-production', '.motion-comic-production__sections', '.director-desk'];
                  const elements = Object.fromEntries(selectors.map(selector => {
                    const e = document.querySelector(selector); if (!e) return [selector, null];
                    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
                    return [selector, {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,display:s.display,gridTemplateRows:s.gridTemplateRows,overflow:s.overflow,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight}];
                  }));
                  return {elements, documentWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth, viewportHeight:innerHeight};
                }''')
                report['layout'].append({'screen': name, **metrics})
                def verify_geometry():
                    assert metrics['documentWidth'] <= metrics['viewportWidth'], 'document horizontal overflow'
                    elements = metrics['elements']
                    for selector in ['.sidebar', '.window-line', '.motion-comic-production__sections']:
                        box = elements[selector]
                        if box:
                            assert box['width'] > 0 and box['height'] > 0, f'{selector} has no visible area'
                            assert box['y'] >= 0 and box['bottom'] <= metrics['viewportHeight'] + 1, f'{selector} outside viewport'
                    desk = elements['.director-desk']
                    if desk:
                        assert desk['y'] >= elements['.page-head']['bottom'], 'page-head overlaps director desk'
                        assert desk['bottom'] <= metrics['viewportHeight'] + 1, 'director desk extends below viewport'
                check(f'{name}: viewport and header clearance', verify_geometry)
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            overview = page.get_by_role('region', name='漫剧项目总览')
            expect(overview).to_be_visible()
            check('overview visible', lambda: expect(overview).to_be_visible())
            snapshot('overview')
            overview.get_by_role('button', name='继续制作', exact=True).click()
            tabs = page.get_by_role('tablist', name='漫剧项目功能区')
            expect(tabs).to_be_visible()
            check('continue opens workspace', lambda: expect(tabs).to_be_visible())
            for label in ['剧本', '资产', '分镜', '生产', '预览']:
                def navigate_domain():
                    tab = tabs.get_by_role('tab', name=label, exact=True)
                    expect(tab).to_be_enabled()
                    tab.focus()
                    tab.press('Enter')
                    expect(tab).to_have_attribute('aria-selected', 'true')
                    expect(page.locator('.sidebar')).to_be_visible()
                    expect(page.locator('.window-line')).to_be_visible()
                check(f'{label}: accessible domain and visible sidebar/window-line', navigate_domain)
                snapshot(f'domain-{label}')
            check('inactive license remains displayed', lambda: expect(page.get_by_role('button', name='软件授权 未激活', exact=True)).to_be_visible())
            def back_and_continue():
                for label, stage in [('返回配音合成', 'audio'), ('返回视频生成', 'video'), ('返回分镜', 'storyboard'), ('返回剧本', 'episodes')]:
                    page.get_by_role('button', name=label, exact=True).first.click(timeout=5000)
                    expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', stage)
                    expect(overview).not_to_be_visible()
                page.get_by_role('button', name='返回项目总览', exact=True).first.click(timeout=5000)
                expect(overview).to_be_visible()
                overview.get_by_role('button', name='继续制作', exact=True).click(timeout=5000)
                expect(tabs).to_be_visible()
            check('return overview and continue round trip', back_and_continue)
            snapshot('continued')
            def episode_back():
                page.get_by_role('button', name='返回项目总览', exact=True).click()
                overview.get_by_role('button', name='打开分集', exact=True).first.click()
                expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'scenes')
                page.get_by_role('button', name='返回本集剧本', exact=True).first.click()
                expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'episodes')
            check('single episode returns to script', episode_back)
            page.set_viewport_size({'width': 1280, 'height': 800})
            tabs.get_by_role('tab', name='分镜', exact=True).click()
            snapshot('compact-storyboard')
            page.get_by_role('button', name='返回剧本', exact=True).click()
            check('compact storyboard returns to script', lambda: expect(page.locator('[data-motion-comic-production]')).to_have_attribute('data-stage', 'episodes'))
            page.set_viewport_size({'width': 1536, 'height': 1024})
            report['controls'] = page.evaluate('window.comicShellQA')
            assert not report['controls']['forbiddenCalls'], report['controls']
            page.goto(f'http://127.0.0.1:{server.server_port}/?fixture=empty')
            expect(overview).to_be_visible()
            check('empty generated episodes: source row remains in overview', lambda: expect(overview.get_by_text('第 1 集 · 尚未规划的源分集', exact=True)).to_be_visible())
            overview.get_by_role('button', name='编辑剧本', exact=True).click()
            check('empty generated episodes: script workspace reachable', lambda: expect(page.locator('[data-motion-comic-script-workspace]')).to_be_visible())
            tabs.get_by_role('tab', name='资产', exact=True).click()
            check('empty generated episodes: project assets reachable', lambda: expect(page.locator('[data-motion-comic-series-bible]')).to_be_visible())
            check('empty generated episodes: reference status has project scope', lambda: expect(page.get_by_text('项目 · 参考就绪情况', exact=True)).to_have_count(1))
            snapshot('empty-project-assets')
            page.get_by_role('button', name='返回项目总览', exact=True).click()
            expect(overview).to_be_visible()
            overview.get_by_role('button', name='继续制作', exact=True).click()
            check('empty generated episodes: continue remains safe', lambda: expect(tabs).to_be_visible())
            report['controls'] = page.evaluate('window.comicShellQA')
            check('shell navigation dispatch', lambda: page.locator('.sidebar [data-nav-view="motion-comic"]').click(timeout=5000))
            report['controls'] = page.evaluate('window.comicShellQA')
            assert not report['controls']['forbiddenCalls'], report['controls']
            browser.close()
    except Exception as error:
        report['failures'].append({'check': 'runner', 'error': str(error)})
    finally:
        server.shutdown()
        server.server_close()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(report['checks']), 'failures': [{'check': failure['check'], 'error': failure['error'].split('Aria snapshot:')[0]} for failure in report['failures']], 'runtimeErrors': report['runtimeErrors'], 'output': str(OUTPUT)}, ensure_ascii=True))
    if report['failures'] or report['runtimeErrors'] or report['blockedNetwork']:
        raise SystemExit(1)

if __name__ == '__main__':
    run()

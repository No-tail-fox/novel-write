"""Visual and interaction QA for the sourced copy studio."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/copy-studio'
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_PROJECT_QA_DIR': str(profile), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    report = {'status': 'running', 'checks': [], 'captures': [], 'runtimeErrors': [], 'paidCalls': 0}
    process = None
    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-project-home.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            page.evaluate("""() => localStorage.setItem('storydream.copy-studio.v1', JSON.stringify({version:1,topic:'敦煌守护人',requirements:'480 字，事实准确，口语化，有清晰开头和收束',track:'character-story',sourceIds:['bing::https://example.test/a::敦煌研究资料','toutiao::https://example.test/b::守护人的工作'],sources:[{source:'必应',provider:'bing',title:'敦煌研究资料',url:'https://example.test/a',content:'资料介绍了壁画保护、数字化采集和日常修复工作。'},{source:'头条',provider:'toutiao',title:'守护人的工作',url:'https://example.test/b',content:'采访记录了研究人员在洞窟内长期监测环境的工作。'}],revisions:[{id:'v1',kind:'draft',label:'来源初稿',instruction:'依据来源起稿',text:'第一次走进洞窟时，她没有想到，往后的二十年都会在这里度过。',createdAt:'2026-09-15T01:00:00.000Z'},{id:'v2',kind:'refine',label:'精修 1',instruction:'加强开头，保留事实',text:'她把二十年留在一间不能久待的洞窟里。每天，先看温湿度，再看壁画最细微的变化。',createdAt:'2026-09-15T01:10:00.000Z'},{id:'v3',kind:'track',label:'赛道强化 1',instruction:'人物故事赛道，强化选择与坚持',text:'她把二十年留在一间不能久待的洞窟里。不是为了被看见，而是为了让千年前的颜色继续被看见。',createdAt:'2026-09-15T01:20:00.000Z'}],activeRevisionId:'v3',updatedAt:'2026-09-15T01:20:00.000Z'}))""")
            page.reload()
            base.wait_app(page)
            page.locator('.nav-list [data-nav-view="person-assets"]').click()
            expect(page.locator('.nav-list [data-nav-view="copy-studio"]')).to_be_visible()
            page.locator('.nav-list [data-nav-view="copy-studio"]').click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'copy-studio')
            expect(page.locator('[data-copy-studio]')).to_be_visible()
            for width, height in [(1440, 900), (1040, 720)]:
                base.set_size(page, width, height)
                metrics = page.evaluate("""() => { const root=document.querySelector('[data-copy-studio]'); const style=getComputedStyle(root); return {width:innerWidth,columns:style.gridTemplateColumns,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,rootOverflow:root.scrollWidth>root.clientWidth+1}; }""")
                assert not metrics['pageOverflow'] and not metrics['rootOverflow'], metrics
                path = OUTPUT / f'copy-studio-{width}.png'
                page.screenshot(path=path, animations='disabled')
                assert base.screenshot_variance(path) > 10
                report['captures'].append({'file': str(path), **metrics})
            expect(page.get_by_text('V3 · 赛道强化 1', exact=True)).to_be_visible()
            expect(page.get_by_label('当前文案', exact=True)).to_contain_text('千年前的颜色')
            page.get_by_role('tab', name='跳过预审', exact=True).click()
            page.get_by_role('button', name='回传并继续视频制作', exact=True).click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view', 'new-task')
            draft = page.evaluate("() => JSON.parse(localStorage.getItem('storydream.new-task-draft.v1'))")
            assert draft['values']['publishMode'] == 'direct-copy' and '千年前的颜色' in draft['values']['inputText'], draft
            report['checks'].append('Sourced draft, three saved revisions, track enhancement and skip-review handoff are visible and functional')
            report['checks'].append('No horizontal overflow at 1440x900 or 1040x720')
            assert not report['runtimeErrors'], report['runtimeErrors']
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

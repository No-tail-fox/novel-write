"""Real Page acceptance; fixture APIs only. Run: vendor/python/python.exe tests/motion-comic-approved-integration.browser.py"""
import functools, http.server, json, os, subprocess, threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_APPROVED_QA_OUTPUT', str(ROOT / 'artifacts/approved-integration')))
def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([os.environ.get('STORYDREAM_QA_NODE', 'I:/nodejs/node.exe'), '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-approved-integration.harness.tsx',name:'comicShellQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, env=env, check=True)
    (OUTPUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    report={'checks':[], 'failures':[], 'runtimeErrors':[], 'blockedNetwork':[], 'controls':[], 'layout':[]}
    try:
      with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,env=env,executable_path=os.environ.get('STORYDREAM_QA_CHROME','C:/Program Files/Google/Chrome/Application/chrome.exe'))
        for width,height in [(1040,720),(1600,1000)]:
          page=browser.new_page(viewport={'width':width,'height':height})
          page.on('pageerror',lambda e: report['runtimeErrors'].append(str(e)))
          def route(r):
            u=urlparse(r.request.url)
            if u.hostname=='127.0.0.1' and u.port==server.server_port: r.continue_()
            else: report['blockedNetwork'].append(r.request.url); r.abort()
          page.route('**/*',route)
          def check(label,fn):
            fn(); report['checks'].append(f'{width}: {label}')
          def snap(label):
            page.evaluate('''async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }''')
            if label == 'tasks':
              report['layout'].append(page.locator('.comic-task-drawer').evaluate('e => ({screen:"drawer-style",background:getComputedStyle(e).backgroundColor,opacity:getComputedStyle(e).opacity,surface:getComputedStyle(e).getPropertyValue("--shell-surface")})'))
            page.screenshot(path=str(OUTPUT/f'{label}-{width}x{height}.png'))
            metric=page.evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
            report['layout'].append({'screen':label,**metric})
            assert metric['scrollWidth']<=width,metric
          try:
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            expect(page.get_by_role('region',name='漫剧项目总览')).to_be_visible()
            # Overview also consumes the read-only snapshot for task counts.
            assert not page.evaluate('window.comicShellQA.forbiddenCalls')
            # Comic defaults remain editable for future submissions during background work.
            # This read-only fixture forbids all mutations, including model saves.
            models=page.get_by_role('group',name='项目模型')
            check('future-task model defaults remain inspectable',lambda:expect(models.get_by_role('combobox',name='LLM模型')).to_be_visible())
            for control in models.get_by_role('combobox').all(): expect(control).to_be_enabled()
            assert not page.evaluate('window.comicShellQA.forbiddenCalls')
            snap('editable-model-defaults')
            page.get_by_role('button',name='后台任务',exact=False).first.click()
            expect(page.locator('.comic-task-drawer__card')).to_have_count(3)
            expect(page.get_by_text('剧本生成与审核',exact=True)).to_be_visible()
            expect(page.get_by_text('人物参考 · 批次',exact=True)).to_be_visible()
            check('drawer reads three real projection sources',lambda:expect(page.get_by_text('QA 原文证据',exact=True)).to_be_visible())
            snap('tasks')
            page.get_by_role('button',name='查看分集剧本',exact=True).click()
            check('script navigation',lambda:expect(page.locator('[data-motion-comic-script-workspace]')).to_be_visible())
            page.get_by_role('button',name='后台任务',exact=False).first.click()
            page.get_by_role('button',name='核对资产',exact=True).click()
            check('asset navigation',lambda:expect(page.locator('[data-motion-comic-workbench]')).to_be_visible())
            page.get_by_role('button',name='新增人物',exact=True).click()
            dialog=page.get_by_role('dialog')
            dialog.get_by_role('textbox',name='人物名称').fill('QA取消人物')
            dialog.get_by_role('button',name='取消',exact=True).click()
            check('cancel creates no object',lambda:expect(page.get_by_text('QA取消人物',exact=True)).to_have_count(0))
            page.get_by_role('button',name='新增人物',exact=True).click()
            dialog=page.get_by_role('dialog')
            expect(dialog.get_by_role('textbox',name='人物名称')).to_have_value('')
            dialog.get_by_role('button',name='新增人物',exact=True).click()
            check('name required',lambda:expect(dialog.get_by_role('alert')).to_have_text('请填写名称。'))
            dialog.get_by_role('textbox',name='人物名称').fill('QA本地人物')
            dialog.get_by_role('textbox',name='人物设定').fill('本地人工设定，无模型调用')
            snap('asset-create')
            dialog.get_by_role('button',name='新增人物',exact=True).click()
            expect(dialog).to_have_count(0)
            check('asset saved locally and dirty',lambda:expect(page.locator('[data-dirty="true"]')).to_have_text('未保存'))
            expect(page.get_by_role('heading',name='QA本地人物',exact=True)).to_be_visible()
            snap('asset-local-dirty')
            page.get_by_role('button',name='后台任务',exact=False).first.click()
            page.get_by_role('button',name='查看对应分集',exact=True).click()
            check('provider episode navigation',lambda:expect(page.get_by_role('tab',name='生产',exact=True)).to_have_attribute('aria-selected','true'))
          except Exception as e:
            report['failures'].append({'viewport':width,'error':str(e)})
            page.screenshot(path=str(OUTPUT/f'failure-{width}.png'))
          finally:
            control=page.evaluate('window.comicShellQA'); report['controls'].append(control)
            if control['forbiddenCalls']: report['failures'].append({'forbiddenCalls':control['forbiddenCalls']})
            page.close()
        browser.close()
    finally:
      server.shutdown(); server.server_close()
      (OUTPUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=True))
    if report['failures'] or report['blockedNetwork'] or report['runtimeErrors']: raise SystemExit(1)
if __name__=='__main__': run()

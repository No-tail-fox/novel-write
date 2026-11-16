import functools, http.server, json, subprocess, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/motion-comic-look-page'; OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node','--input-type=module','-e',"import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/motion-comic-look-page',emptyOutDir:false,lib:{entry:'tests/motion-comic-look-page.harness.tsx',name:'qa',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"],cwd=ROOT,check=True)
(OUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>',encoding='utf-8')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'errors':[], 'checks':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
  page=browser.new_page(viewport={'width':1600,'height':1000});page.on('pageerror',lambda e:report['errors'].append(str(e)))
  try:
   page.goto(f'http://127.0.0.1:{server.server_port}')
   page.get_by_role('button',name='管理项目资产',exact=True).click()
   page.locator('[aria-label="项目资产列表"]').get_by_role('button').filter(has_text='QA人物').click()
   tabs=page.get_by_role('tablist',name='角色造型')
   daily=tabs.get_by_role('tab').filter(has_text='日常');battle=tabs.get_by_role('tab').filter(has_text='战斗')
   expect(daily).to_have_attribute('aria-selected','true'); expect(page.locator('.comic-reference-slot.is-empty')).to_have_count(3)
   prompt=page.get_by_role('textbox',name='生成提示词',exact=True)
   for value in ['身份标记：黑发少年','外貌标记：蓝眼','服装标记：白衣','连续性标记：银色胸针']: assert value in prompt.input_value(),prompt.input_value()
   battle.click();expect(battle).to_have_attribute('aria-selected','true');expect(daily).to_have_attribute('aria-selected','false');assert '服装标记：红甲' in prompt.input_value()
   daily.click();prompt.fill('自定义提示词保留');battle.click();daily.click();expect(prompt).to_have_value('自定义提示词保留')
   page.get_by_role('button',name='重新填入当前设定').click();assert '服装标记：白衣' in prompt.input_value()
   page.get_by_role('button',name='上传参考图',exact=True).click();expect(page.get_by_alt_text('生图输入参考图 1')).to_be_visible()
   page.get_by_role('button',name='删除生图参考图 1').click();expect(page.get_by_alt_text('生图输入参考图 1')).to_have_count(0)
   page.get_by_role('button',name='上传参考图',exact=True).click()
   page.get_by_role('button',name='生成三视图 · 3 张',exact=True).click()
   page.wait_for_function('window.submissions.length === 1')
   expect(page.get_by_role('button',name='三视图生成中…',exact=True)).to_be_disabled()
   prompt.fill('后台运行时编辑');battle.click();expect(battle).to_have_attribute('aria-selected','true');daily.click();expect(prompt).to_have_value('后台运行时编辑')
   page.get_by_role('button',name='删除生图参考图 1').click();expect(page.get_by_alt_text('生图输入参考图 1')).to_have_count(0)
   assert page.evaluate('window.submissions.length')==1
   page.locator('.comic-look-panel').evaluate("e => e.scrollIntoView({block:'start'})");page.screenshot(path=str(OUT/'page-1600.png'))
   page.set_viewport_size({'width':1040,'height':800});page.locator('.comic-look-panel').evaluate("e => e.scrollIntoView({block:'start'})");page.screenshot(path=str(OUT/'page-1040.png'))
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   report['checks']=['real Page two-look selection and drafts','prefill identity appearance wardrobe continuity','three persistent slots','upload/remove input','exactly one batch submission','pending edits/tab switch/input deletion','desktop and compact overflow']
   report['controls']=page.evaluate('window.comicShellQA');report['submissions']=page.evaluate('window.submissions')
   assert not report['controls']['forbiddenCalls'],report['controls']
   assert not report['errors'],report
  except Exception as e:
   report['failure']=str(e);page.screenshot(path=str(OUT/'failure.png'));raise
  finally:
   (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');browser.close()
finally:server.shutdown()

"""Isolated review inspector: no user database, provider, or filesystem media."""
import functools,http.server,json,subprocess,threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/script-evidence-ui'; OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',"import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/script-evidence-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-script-evidence.harness.tsx',name:'evidenceQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"],cwd=ROOT,check=True)
(OUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>',encoding='utf-8')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'checks':[],'errors':[],'external':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe');page=browser.new_page(viewport={'width':1366,'height':900})
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  def route(r):
   if urlparse(r.request.url).hostname=='127.0.0.1':r.continue_()
   else:report['external'].append(r.request.url);r.abort()
  page.route('**/*',route)
  def load(mode):page.goto(f'http://127.0.0.1:{server.server_port}/?state={mode}')
  load('empty')
  page.screenshot(path=str(OUT/'debug.png'))
  expect(page.get_by_text('本集暂无关联参考图',exact=True)).to_be_visible()
  expect(page.locator('.comic-script-evidence img')).to_have_count(0)
  expect(page.locator('.comic-script-beat-citation').first).to_contain_text('第 2 自然段')
  assert 'beat-private-uuid' not in page.locator('body').inner_text()
  expect(page.get_by_text('保留提案区域',exact=True)).to_be_visible()
  trigger=page.get_by_role('button',name='打开第 1 条完整原文',exact=True)
  trigger.click();expect(page.get_by_role('dialog')).to_contain_text('最后一段全文核对。')
  expect(page.locator('.comic-script-source-dialog section[data-referenced]')).to_contain_text('第 2 自然段')
  page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);expect(trigger).to_be_focused()
  page.get_by_role('button',name='打开项目资产',exact=True).click();expect(page.get_by_text('已打开项目资产入口',exact=True)).to_be_visible()
  page.get_by_role('button',name='编辑第 1 条剧情',exact=True).click();page.get_by_label('剧情内容',exact=True).fill('本地修改仍保存')
  expect(page.get_by_role('checkbox')).to_be_disabled()
  page.get_by_text('当前稿与已保存稿差异（只读）',exact=True).click();expect(page.locator('.comic-script-evidence__records')).to_contain_text('当前稿：本地修改仍保存')
  report['checks'].append('empty assets entry; natural paragraph mapping; technical IDs collapsed; complete source dialog Escape + focus return; proposal and edit gating; read-only diff')
  for mode in ['validation','ambiguous','locked']:
   load(mode);expect(page.get_by_role('checkbox')).to_be_disabled()
  load('missing');expect(page.get_by_text('1 条缺少有效引用',exact=True)).to_be_visible()
  load('image');expect(page.locator('.comic-script-reference-image img')).to_have_count(1);expect(page.locator('.comic-script-reference-image img')).to_have_attribute('src',__import__('re').compile('^blob:'))
  page.screenshot(path=str(OUT/'image-1366.png'))
  preview=page.get_by_role('button',name='预览门厅参考图',exact=True);preview.click();expect(page.get_by_role('dialog')).to_contain_text('项目参考图');page.keyboard.press('Escape');expect(page.get_by_role('dialog')).to_have_count(0);expect(preview).to_be_focused()
  load('unsafe');expect(page.get_by_text('参考图加载失败',exact=True)).to_be_visible();expect(page.locator('.comic-script-evidence img')).to_have_count(0)
  for width in [1600,1366,760,375]:
   page.set_viewport_size({'width':width,'height':1000});load('empty');assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   page.screenshot(path=str(OUT/f'empty-{width}.png'))
  report['checks'].append('locked/validation/unresolved gates; missing citation; linked real asset resolver; unsafe file URI rejected; 1600/1366/760/375 no horizontal overflow')
  assert not report['errors'] and not report['external'];report['passed']=True;browser.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

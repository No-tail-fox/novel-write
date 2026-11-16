"""Offline real ScriptWorkspace+ProductionWorkspace; no user DB/provider."""
import functools,http.server,json,subprocess,threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/script-reading-ui'; OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',"import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/script-reading-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-script-reading.harness.tsx',name:'readingQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"],cwd=ROOT,check=True)
(OUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>',encoding='utf-8')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
report={'checks':[],'errors':[],'external':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe');page=browser.new_page()
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  def route(r):
   if urlparse(r.request.url).hostname=='127.0.0.1':r.continue_()
   else:report['external'].append(r.request.url);r.abort()
  page.route('**/*',route)
  for width,height in [(1600,1000),(1366,900)]:
   page.set_viewport_size({'width':width,'height':height})
   for state in ['review','running','failed','paused']:
    page.goto(f'http://127.0.0.1:{server.server_port}/?state={state}');expect(page.locator('.comic-script-detail__heading')).to_contain_text('雨夜来信')
    if state in ['review','paused']:
     expect(page.locator('.comic-script-beat-reading')).to_have_count(4)
     metrics=page.locator('.comic-script-beat-reading').evaluate_all('(els)=>els.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,clipBottom:e.closest(".motion-comic-script-beats").getBoundingClientRect().bottom,font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight}))')
     # Desktop heights vary; require readable initial content and prove every
     # beat can be fully revealed by the owning scroll pane.
     assert sum(m['bottom']<=min(height,m['clipBottom']) for m in metrics)>=2,metrics
     for beat in page.locator('.comic-script-beat-reading').all():
      beat.scroll_into_view_if_needed()
      assert beat.evaluate('(e)=>{const r=e.getBoundingClientRect(),p=e.closest(".motion-comic-script-beats").getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=Math.min(innerHeight,p.bottom)+1}'), 'beat cannot be fully revealed'
     page.locator('.motion-comic-script-beats').evaluate('(e)=>{e.scrollTop=0}')
     assert all(m['font']=='16px' and m['line']=='28px' for m in metrics),metrics
     report['checks'].append({'size':[width,height],'state':state,'beats':metrics})
    else:expect(page.locator('.comic-script-detail__heading')).to_contain_text('生成中' if state=='running' else '失败')
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    page.screenshot(path=str(OUT/f'{state}-{width}.png'))
  page.goto(f'http://127.0.0.1:{server.server_port}/?state=review');expect(page.locator('.comic-script-beat-reading')).to_have_count(4)
  expect(page.get_by_label('剧情内容',exact=True)).to_have_count(0)
  page.get_by_role('button',name='编辑第 2 条剧情',exact=True).click();expect(page.get_by_label('剧情内容',exact=True)).to_have_count(1)
  page.get_by_label('剧情内容',exact=True).fill('尚未保存的第二条草稿')
  page.get_by_role('button',name='编辑第 3 条',exact=True).click();expect(page.get_by_label('剧情内容',exact=True)).to_have_count(1)
  expect(page.get_by_role('button',name='编辑第 2 条剧情',exact=True)).to_contain_text('尚未保存')
  page.get_by_label('本集分幕与场次',exact=True).select_option('scene-1');expect(page.get_by_label('剧情内容',exact=True)).to_have_count(0)
  page.get_by_label('本集分幕与场次',exact=True).select_option('scene-0');expect(page.get_by_role('button',name='编辑第 2 条剧情',exact=True)).to_contain_text('尚未保存')
  page.get_by_role('button',name='编辑第 2 条',exact=True).focus();page.keyboard.press('Enter');expect(page.get_by_label('剧情内容',exact=True)).to_have_value('尚未保存的第二条草稿')
  page.get_by_role('tab',name='人物 (0)',exact=True).click();page.get_by_role('tab',name='分幕分场',exact=True).click();expect(page.get_by_label('剧情内容',exact=True)).to_have_count(0)
  expect(page.get_by_role('button',name='编辑第 2 条剧情',exact=True)).to_contain_text('尚未保存')
  page.get_by_role('button',name='撤销本地修改',exact=True).click();expect(page.get_by_role('button',name='编辑第 2 条剧情',exact=True)).to_contain_text('她停在门口')
  report['checks'].append('single editor, reading click, keyboard, scene/tab resets preserve dirty draft; undo restores text')
  assert not report['errors'] and not report['external'];report['passed']=True;browser.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

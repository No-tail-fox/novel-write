"""Offline browser regression: stale validation, title repair, undo and regeneration."""
import functools,http.server,json,subprocess,threading
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/script-validation-ui'; OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',"import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'artifacts/script-validation-ui',emptyOutDir:false,lib:{entry:'tests/motion-comic-script-validation.harness.tsx',name:'validationQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"],cwd=ROOT,check=True)
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
  for width,height in [(1658,900),(1366,768)]:
   page.set_viewport_size({'width':width,'height':height});page.goto(f'http://127.0.0.1:{server.server_port}/')
   issues=page.get_by_label('当前剧本校验问题');expect(issues).to_contain_text('第 1 场 · 第 1 条');expect(issues).to_contain_text('章节或分集标题不得成为旁白')
   undo=page.get_by_role('button',name='撤销本地修改',exact=True);regen=page.get_by_role('button',name='重新生成剧本',exact=True)
   expect(undo).to_be_disabled();expect(regen).to_be_enabled();expect(page.get_by_text('暂无可撤销的本地修改；编辑剧情后即可撤销。',exact=True)).to_be_visible()
   expect(page.get_by_role('button',name='重做',exact=True)).to_have_count(0)
   expect(page.get_by_role('button',name='批准本集剧本',exact=True)).to_be_disabled()
   page.screenshot(path=str(OUT/f'issues-{width}.png'))
   page.get_by_role('button',name='修复章节标题旁白',exact=True).click();expect(issues).to_have_count(0);expect(undo).to_be_enabled();expect(regen).to_be_disabled()
   undo.click();expect(issues).to_be_visible();expect(undo).to_be_disabled()
   page.get_by_role('button',name='修复章节标题旁白',exact=True).click();page.get_by_role('button',name='保存修改并校验',exact=True).click()
   expect(page.get_by_text('已保存 r2',exact=True)).to_be_visible();expect(regen).to_be_enabled();expect(undo).to_be_disabled()
   regen.click();expect(page.get_by_role('dialog')).to_be_visible();expect(page.get_by_role('dialog')).to_contain_text('仅当前章：第 1 集 · 第2章');expect(page.get_by_label('改编要求',exact=True)).to_have_value('保持人物口吻');expect(page.get_by_label('目标集长（秒，可留空）',exact=True)).to_have_value('180')
   page.screenshot(path=str(OUT/f'regenerate-{width}.png'), animations='disabled')
   page.get_by_role('button',name='开始后台生成',exact=True).click();expect(page.get_by_role('dialog')).to_have_count(0)
   calls=page.evaluate('window.qaCalls');assert calls[-1]['type']=='enqueue' and calls[-1]['input']['scope']=='selected';assert calls[-1]['input']['sourceEpisodeIds']==[page.evaluate('window.qaCurrentSourceId')];assert page.evaluate('window.qaOtherSourceId') not in calls[-1]['input']['sourceEpisodeIds']
   assert calls[0]['input']['script']['scenes'][0]['beats'][0]['kind']=='action'
   assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
   report['checks'].append({'size':[width,height],'result':'live issues, title repair, undo, save and selected regeneration passed'})
  assert not report['errors'] and not report['external'];report['passed']=True;browser.close()
finally:
 server.shutdown();(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

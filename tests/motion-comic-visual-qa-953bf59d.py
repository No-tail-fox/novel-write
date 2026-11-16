"""Isolated UI QA at requested desktop sizes; no application server or live calls."""
import functools, http.server, json, os, subprocess, threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/comic-visual-qa-953bf59d'
OUT.mkdir(parents=True,exist_ok=True)
report={'scope':'Real shell/page fixture and reference board; no live model or auth assertion','checks':[],'failures':[],'errors':[],'screens':[],'network':[]}
for kind in ['shell','three-view','count']:
 target=OUT/kind;target.mkdir(exist_ok=True)
 code="import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:process.argv[2],name:'qa',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});"
 entry = f'tests/motion-comic-{kind}.harness.tsx' if kind=='shell' else f'tests/motion-comic-{kind}-qa-953bf59d.harness.tsx'
 subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',code,str(target),entry],cwd=ROOT,check=True)
 (target/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>',encoding='utf-8')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
def check(name,fn):
 try:fn();report['checks'].append(name)
 except Exception as e:report['failures'].append({'name':name,'error':str(e)[:1800]})
def snapshot(page,name):
 page.wait_for_timeout(300)
 page.screenshot(path=str(OUT/f'{name}.png'), animations='disabled')
 data=page.evaluate('''()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,regions:[...document.querySelectorAll('.sidebar,.window-line,.director-desk,.motion-comic-production__sections,.director-inspector-pane')].map(e=>{const r=e.getBoundingClientRect();return {class:e.className,x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}}),unlabelledButtons:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width&&!e.innerText.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')).length})''')
 report['screens'].append({'name':name,**data})
 assert data['documentWidth']<=data['width'],f'horizontal overflow {name}: {data}'
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
  for width,height in [(1600,1000),(1040,720)]:
   page=browser.new_page(viewport={'width':width,'height':height})
   page.on('pageerror',lambda e:report['errors'].append(str(e)))
   def route(r):
    if r.request.url.startswith(base+'/') or r.request.url.startswith('data:'):r.continue_()
    else:report['network'].append(r.request.url);r.abort()
   page.route('**/*',route)
   try:
    page.goto(base+'/shell/')
    overview=page.get_by_role('region',name='漫剧项目总览')
    expect(overview).to_be_visible()
    check(f'overview-{width}',lambda:snapshot(page,f'overview-{width}x{height}'))
    overview.get_by_role('button',name='继续制作',exact=True).click()
    tabs=page.get_by_role('tablist',name='漫剧项目功能区')
    for label in ['剧本','资产','分镜','生产','预览']:
     def domain():
      tab=tabs.get_by_role('tab',name=label,exact=True)
      if tab.is_disabled():
       report['checks'].append(f'{label}-{width}: disabled for empty fixture');return
      tab.focus();tab.press('Enter');expect(tab).to_have_attribute('aria-selected','true')
      expect(page.locator('.sidebar')).to_be_visible()
      snapshot(page,f'{label}-{width}x{height}')
     check(f'domain-{label}-{width}',domain)
    controls=page.evaluate('window.comicShellQA')
    assert not controls['forbiddenCalls'],controls
    page.goto(base+'/shell/?fixture=empty')
    expect(overview).to_be_visible()
    overview.get_by_role('button',name='编辑剧本',exact=True).click()
    expect(page.locator('[data-motion-comic-script-workspace]')).to_be_visible()
    tabs.get_by_role('tab',name='资产',exact=True).click()
    check(f'empty-assets-{width}',lambda:snapshot(page,f'empty-assets-{width}x{height}'))
    page.goto(base+'/count/')
    expect(page.locator('.motion-comic-production__identity small')).to_contain_text('1 集')
    expect(page.get_by_role('region',name='漫剧项目总览').get_by_role('article')).to_have_count(1)
    snapshot(page,f'imported-count-{width}x{height}')
    report['checks'].append(f'imported single episode header and overview agree-{width}')
    page.goto(base+'/three-view/')
    expect(page.locator('.comic-reference-slot.is-empty')).to_have_count(3)
    snapshot(page,f'three-view-empty-{width}x{height}')
    page.get_by_role('button',name='模拟生成状态',exact=True).click()
    expect(page.get_by_role('status').filter(has_text='正在生成三视图')).to_be_visible()
    page.get_by_role('tab',name='战斗',exact=True).click()
    page.get_by_label('生图提示词').fill('仍然可以编辑提示词')
    page.get_by_role('button',name='删除生图参考图 1').click()
    page.get_by_role('button',name='显示候选',exact=True).click()
    snapshot(page,f'three-view-candidates-{width}x{height}')
    for role in ['正面','侧面','背面']:
     expect(page.get_by_role('listitem',name=role+'视图',exact=True).locator('.comic-reference-candidate')).to_have_count(1)
    page.get_by_role('button',name='固定为正面',exact=True).click()
    snapshot(page,f'three-view-confirm-{width}x{height}')
    page.get_by_role('checkbox').check()
    page.get_by_role('button',name='确认固定为正面',exact=True).click()
    expect(page.get_by_role('button',name='移除正面参考图',exact=True)).to_be_visible()
    snapshot(page,f'three-view-pinned-{width}x{height}')
    page.get_by_role('button',name='移除正面参考图',exact=True).click()
    page.get_by_role('button',name='移除出列表',exact=True).click()
    expect(page.get_by_role('listitem',name='正面视图',exact=True).locator('.comic-reference-slot.is-empty')).to_have_count(1)
    report['checks'].append(f'three-view edit-during-generation / grouping / pin / remove-{width}')
   except Exception as e:
    report['failures'].append({'name':f'flow-{width}','error':str(e)[:2400]})
    page.screenshot(path=str(OUT/f'failure-{width}.png'))
   finally:page.close()
  browser.close()
finally:
 server.shutdown();server.server_close()
 (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))
if report['failures'] or report['errors'] or report['network']:raise SystemExit(1)

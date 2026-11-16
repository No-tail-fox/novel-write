"""Offline final visual audit. Reuses existing isolated shell bundle; no production edits."""
import functools, http.server, threading, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path(os.environ.get('STORYDREAM_SHELL_QA_OUTPUT','E:/StoryDream-QA/final-shell-20260906'))
def run():
 server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)))
 threading.Thread(target=server.serve_forever,daemon=True).start()
 report={'scope':'offline real AppShell presentation; no generated media or paid calls','screens':[], 'errors':[], 'blocked':[]}
 try:
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
   page=browser.new_page()
   page.on('pageerror',lambda e:report['errors'].append(str(e)))
   def route(r):
    if r.request.url.startswith(f'http://127.0.0.1:{server.server_port}/'):r.continue_()
    else:report['blocked'].append(r.request.url);r.abort()
   page.route('**/*',route)
   for fixture in ['normal','empty']:
    for w,h in [(1536,1024),(1040,720)]:
     page.set_viewport_size({'width':w,'height':h})
     page.goto(f'http://127.0.0.1:{server.server_port}/?fixture={fixture}')
     page.get_by_role('region',name='漫剧项目总览').get_by_role('button',name='继续制作',exact=True).click()
     for domain in ['资产','生产','预览']:
      tab=page.get_by_role('tablist',name='漫剧项目功能区').get_by_role('tab',name=domain,exact=True)
      if tab.is_disabled():
       report['screens'].append({'name':f'{fixture}-{domain}-{w}x{h}','disabled':True,'reason':'No generated episode; domain intentionally unavailable'})
       continue
      tab.click()
      page.wait_for_timeout(150)
      name=f'{fixture}-{domain}-{w}x{h}'
      page.screenshot(path=str(OUT/f'{name}.png'))
      data=page.evaluate('''() => {const box=e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return {cls:e.className,tag:e.tagName,text:e.innerText?.slice(0,100),x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom,clientW:e.clientWidth,scrollW:e.scrollWidth,clientH:e.clientHeight,scrollH:e.scrollHeight,overflowX:s.overflowX,overflowY:s.overflowY}};return {viewport:[innerWidth,innerHeight],documentW:document.documentElement.scrollWidth,shell: [...document.querySelectorAll('.sidebar,.window-line,.content,.director-desk')].map(box),scrolls:[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(box),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,label:e.getAttribute('aria-label')})),timeline:[...document.querySelectorAll('[class*="timeline"]')].map(box)}}''')
      data['name']=name
      data['targets']=[]
      selectors=['button'] if domain=='资产' else ['.motion-comic-video-readiness'] if domain=='生产' else ['[class*="timeline"]']
      if domain=='资产': targets=page.locator('.director-series-editor input, .director-series-editor textarea, .director-series-editor summary, .director-series-editor button')
      elif domain=='生产':targets=page.locator('.motion-comic-video-readiness, .motion-comic-video-readiness button')
      else:targets=page.locator('.director-multitrack-row .director-multitrack-label')
      for i in range(targets.count()):
       el=targets.nth(i)
       if not el.is_visible():continue
       el.scroll_into_view_if_needed()
       b=el.bounding_box()
       data['targets'].append({'text':el.inner_text() or el.get_attribute('aria-label') or el.get_attribute('value'),'box':b,'hit':el.evaluate('(e)=>{const r=e.getBoundingClientRect();let x=Math.min(innerWidth-1,r.x+r.width/2),y=Math.min(innerHeight-1,r.y+r.height/2);const t=document.elementFromPoint(x,y);return !!t&&e.contains(t)}')})
       page.screenshot(path=str(OUT/f'{name}-target-{i}.png'))
      data['inspectorChildren']=page.locator('.director-inspector-pane').evaluate_all('(es)=>es.flatMap(e=>[e,...e.children].map(c=>{let r=c.getBoundingClientRect(),s=getComputedStyle(c);return {cls:c.className,y:r.y,height:r.height,clientHeight:c.clientHeight,scrollHeight:c.scrollHeight,flex:s.flex,overflow:s.overflow}}))')
      data['controls']=page.evaluate('window.comicShellQA')
      report['screens'].append(data)
   browser.close()
 finally:
  server.shutdown();server.server_close()
  (OUT/'final-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'screens':len(report['screens']),'errors':report['errors'],'blocked':report['blocked']}))
if __name__=='__main__':run()

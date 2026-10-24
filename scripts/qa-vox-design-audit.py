"""Capture current Vox components in isolated Electron; mock API, no provider calls."""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'docs/design/2026-10-22-vox-generation-simplification/evidence'
ART.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('qa_base',ROOT/'scripts/qa-motion-comic.py')
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
profile=Path(tempfile.mkdtemp(prefix='vox-design-',dir=ROOT/'.codex-temp'))
source=(ROOT/'tests/editorial-dual-chain.harness.tsx').read_text(encoding='utf8')
source=source.replace("'../src/", "'"+ROOT.as_posix()+"/src/")
source=source.replace('theme="dark"', 'theme={new URLSearchParams(location.search).get("theme")==="light"?"light":"dark"}')
source=source.replace('VOX 双链路集成验收','Vox 生成流程 · 当前界面')
entry=profile/'audit.tsx'
entry.write_text(source,encoding='utf8')
build=subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[2],emptyOutDir:false,target:'chrome120',lib:{entry:process.argv[1],name:'voxAudit',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",str(entry),str(profile)],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
(ART/'build.log').write_text(build.stdout+build.stderr,encoding='utf8')
build.check_returncode()
runtime_build=subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',
    "import {build} from 'esbuild';await build({entryPoints:['src/features/vox-animation/runtime.tsx'],outfile:process.argv[1],bundle:true,platform:'browser',format:'iife',target:'chrome120',define:{'process.env.NODE_ENV':JSON.stringify('production')},minify:true,logLevel:'warning'});",str(profile/'runtime.js')],cwd=ROOT,capture_output=True,text=True,encoding='utf8')
runtime_build.check_returncode()
(profile/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")==="light"?"light":"dark";</script><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>',encoding='utf8')
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(profile)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'
(profile/'main.cjs').write_text("const {app,BrowserWindow,session}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('"+url+"')&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadURL('"+url+"');});",encoding='utf8')
(profile/'package.json').write_text('{"name":"vox-design-audit","version":"1.0.0","main":"main.cjs"}',encoding='utf8')
env=os.environ.copy()
for name in (*base.PAID_API_ENV_VARS,'ELECTRON_RUN_AS_NODE','NODE_OPTIONS'):env.pop(name,None)
port=base.available_port()
process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}',f'--user-data-dir={profile}',str(profile)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
report={'surface':'current real React Vox page in isolated Electron, mocked APIs','paidCalls':0,'screenshots':[],'states':{},'errors':[]}
try:
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp(base.wait_for_cdp(port,process))
        page=browser.contexts[0].pages[0]
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.wait_for_selector('.director-desk')
        page.set_viewport_size({'width':1536,'height':1024})
        def capture(name):
            page.screenshot(path=str(ART/f'{name}.png'))
            report['screenshots'].append(f'{name}.png')
            report['states'][name]=page.evaluate('''()=>({width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({label:e.getAttribute('aria-label')||e.textContent?.trim(),x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),inspector:(()=>{let e=document.querySelector('.director-inspector-scroll');return {client:e?.clientHeight,scroll:e?.scrollHeight,top:e?.scrollTop}})()})''')
        capture('desktop-current')
        page.get_by_role('tab',name='画面',exact=True).click()
        capture('desktop-generate-local')
        page.get_by_role('tab',name='动画',exact=True).click()
        page.locator('.vox-preview[data-vox-ready="true"]').wait_for(timeout=20000)
        capture('desktop-template')
        page.get_by_role('tab',name='AI 生成动画',exact=True).click()
        capture('desktop-ai-code')
        page.locator('.director-inspector-scroll').evaluate('e=>e.scrollTop=e.scrollHeight')
        capture('desktop-ai-bottom')
        page.locator('.director-inspector-scroll').evaluate('e=>e.scrollTop=0')
        page.get_by_role('tab',name='本地拼贴动画',exact=True).click()
        page.get_by_role('button',name='批量生成',exact=True).click()
        capture('desktop-batch')
        page.get_by_role('button',name='取消',exact=True).click()
        page.get_by_role('dialog').wait_for(state='hidden')
        page.set_viewport_size({'width':1040,'height':720})
        capture('compact-current')
        page.goto(url+'/?theme=light')
        page.wait_for_selector('.director-desk')
        capture('compact-light')
        page.set_viewport_size({'width':1536,'height':1024})
        capture('desktop-light')
        page.set_viewport_size({'width':860,'height':720})
        page.get_by_role('button',name='显示镜头检查器',exact=True).click()
        capture('narrow-inspector')
        report['blockedCalls']=page.evaluate('window.editorialDualChainQA.snapshot().blockedCalls')
        report['status']='captured'
        browser.close()
except Exception as e:
    report['status']='partial';report['error']=repr(e)
finally:
    (ART/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    process.terminate()
    server.shutdown()
print(json.dumps({'status':report['status'],'screenshots':report['screenshots'],'error':report.get('error')},ensure_ascii=False))

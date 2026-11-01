"""Offline visual and interaction QA for Lemo's stepwise authoring controls.
Uses real production dialogs in isolated Electron; no database or provider IPC.
"""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = Path(os.environ.get('STORYDREAM_QA_ARTIFACT_DIR', ROOT / '.artifacts/lemo-project')).resolve()
ART.mkdir(parents=True, exist_ok=True)
TEMP_ROOT = Path(os.environ.get('STORYDREAM_QA_TEMP_DIR', ROOT / '.codex-temp')).resolve()
TEMP_ROOT.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='lemo-project-qa-', dir=TEMP_ROOT))
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
node = shutil.which('node')
assert node, 'Node.js unavailable'
build = subprocess.run([node, '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/lemo-project-ui.harness.tsx',name:'lemoQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'build.log').write_text(build.stdout + build.stderr, encoding='utf8')
build.check_returncode()
film_fixture = subprocess.run([node, 'node_modules/tsx/dist/cli.mjs', 'tests/lemo-project-render.fixture.ts', str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'film-fixture.log').write_text(film_fixture.stdout + film_fixture.stderr, encoding='utf8')
film_fixture.check_returncode()
(profile / 'index.html').write_text('<!doctype html><html lang="zh-CN" data-theme="dark" data-theme-ready="true"><head><meta charset="utf-8"><link rel="stylesheet" href="harness.css"></head><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>',encoding='utf8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(profile)))
threading.Thread(target=server.serve_forever,daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
(profile / 'main.cjs').write_text("""
const {app,BrowserWindow,session}=require('electron');
app.disableHardwareAcceleration();app.whenReady().then(()=>{
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith(LOCAL+'/')&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));
 const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
 w.loadURL(LOCAL);
});
""".replace('LOCAL',json.dumps(url)),encoding='utf8')
(profile / 'package.json').write_text('{"name":"lemo-offline-qa","version":"1.0.0","main":"main.cjs"}',encoding='utf8')
env = os.environ.copy()
for name in (*base.PAID_API_ENV_VARS,'ELECTRON_RUN_AS_NODE','NODE_OPTIONS'):
    env.pop(name,None)
port=base.available_port()
log=(ART / 'electron.log').open('w',encoding='utf8')
process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}',f'--user-data-dir={profile}',str(profile)],cwd=ROOT,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
report={'paidCalls':0,'database':'isolated fixture only','checks':[],'screenshots':[],'errors':[],'geometry':{}}
try:
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp(base.wait_for_cdp(port,process))
        page=browser.contexts[0].pages[0]
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.wait_for_selector('[data-lemo-qa-revision]')
        def check(name, passed):
            report['checks'].append({'name':name,'passed':bool(passed)})
            assert passed,name
        def show(view,**options):
            drawer=page.get_by_role('dialog',name='镜头高级设置',exact=True)
            if drawer.count():
                report.setdefault('drawerCloseDiagnostics',[]).append(page.evaluate("""()=>({active:document.activeElement?.outerHTML.slice(0,800),drawers:[...document.querySelectorAll('[role=dialog]')].map(e=>({name:e.getAttribute('aria-label'),text:e.textContent?.slice(0,80),display:getComputedStyle(e).display,hidden:e.getAttribute('aria-hidden')}))})"""))
                page.keyboard.press('Escape')
                expect(drawer).to_have_count(0)
            # A real workspace retains its opener while a dialog is mounted.
            # Close before replacing fixtures so modal isolation/focus can settle.
            page.evaluate('window.lemoQA.close()')
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
            page.get_by_role('button',name='制作进度',exact=True).focus()
            revision=page.evaluate('([view,options])=>{document.documentElement.dataset.theme=options.theme??"dark";return window.lemoQA.show(view,options)}',[view,options])
            expect(page.locator('[data-lemo-qa-revision]')).to_have_attribute('data-lemo-qa-revision',str(revision))
            page.evaluate('async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(r=>setTimeout(r,1500))])));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
            if view != 'workspace':
                expect(page.get_by_role('dialog')).to_be_visible()
        def capture(name):
            page.evaluate('async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>Promise.race([a.finished.catch(()=>{}),new Promise(r=>setTimeout(r,1500))])));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
            dialog=page.get_by_role('dialog')
            geo=dialog.evaluate('e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:e.scrollWidth-e.clientWidth,width:innerWidth,height:innerHeight}}')
            report['geometry'][name]=geo
            check(name+' no clipping',geo['left']>=0 and geo['right']<=geo['width']+1 and geo['top']>=0 and geo['bottom']<=geo['height']+1 and geo['overflow']<=1)
            page.screenshot(path=str(ART/(name+'.png')))
            report['screenshots'].append(name+'.png')
        for label,size in [('desktop',{'width':1536,'height':1024}),('compact',{'width':1040,'height':720})]:
            page.set_viewport_size(size)
            for theme in ['dark','light']:
                show('settings',theme=theme)
                dialog=page.get_by_role('dialog',name='自动制作设置')
                expect(dialog.get_by_role('checkbox',name='自动生成图片',exact=True)).to_be_visible()
                expect(dialog.get_by_role('checkbox',name='自动生成图片',exact=True)).not_to_be_checked()
                dialog.get_by_role('checkbox',name='自动生成图片',exact=True).check()
                dialog.get_by_role('button',name='保存设置',exact=True).click()
                check(label+theme+' generation setting persisted',page.evaluate('window.lastLemoAction.value.generateImages===true'))
                dialog.locator('.fui-DialogContent').evaluate('e=>e.scrollTop=0')
                capture(label+'-'+theme+'-settings')
                dialog.get_by_role('button',name='添加档案引用',exact=True).click()
                field=dialog.get_by_role('textbox',name='资料出处',exact=True)
                field.fill('公共档案馆，资料编号 2026-01')
                dialog.get_by_role('textbox',name='许可或使用说明',exact=True).fill('CC0')
                dialog.get_by_role('button',name='保存设置',exact=True).click()
                check(label+theme+' evidence provenance saved',page.evaluate('window.lastLemoAction.value.archives[0].license==="CC0"'))
                capture(label+'-'+theme+'-evidence')
                show('progress',theme=theme)
                dialog=page.get_by_role('dialog',name='自动制作进度')
                expect(dialog.get_by_text('创作连续场景 · scene-1',exact=True)).to_be_visible()
                check(label+theme+' style list uses one numbering source',dialog.locator('.vox-settings-disclosure > ol > li').evaluate_all('items=>items.length>0 && items.every(li=>!/^\\d+\\s*[·.]/.test(li.textContent.trim()))'))
                expect(dialog.get_by_role('button',name='重试失败步骤',exact=True)).to_be_enabled()
                dialog.get_by_role('button',name='重试失败步骤',exact=True).click()
                check(label+theme+' retry uses resume',page.evaluate('window.lastLemoAction.action==="resume"'))
                capture(label+'-'+theme+'-failed')
                show('progress',theme=theme,incremental=True)
                dialog=page.get_by_role('dialog',name='自动制作进度')
                expect(dialog.get_by_text('分批创作影片画面 · 第 2 批 · scene-1',exact=True)).to_be_visible()
                check(label+theme+' earlier batch remains completed',dialog.locator('li[data-status="completed"]').filter(has_text='分批创作影片画面 · 第 1 批').count()==1)
                expect(dialog.get_by_text('本批输出预算耗尽，上一批源码已保存',exact=True)).to_be_visible()
                dialog.get_by_role('button',name='重试失败步骤',exact=True).click()
                check(label+theme+' batch retry uses resume',page.evaluate('window.lastLemoAction.action==="resume"'))
                capture(label+'-'+theme+'-incremental')
                show('progress',theme=theme,staged=True)
                dialog=page.get_by_role('dialog',name='自动制作进度')
                expect(dialog.get_by_text('分段导演规划 · scene-1',exact=True)).to_be_visible()
                check(label+theme+' unfinished planning has no completed downstream stages',dialog.locator('li[data-status="completed"]').count()==2)
                check(label+theme+' unfinished planning hides code recheck',dialog.get_by_role('button',name='重新检查现有代码',exact=True).count()==0)
                check(label+theme+' outline checkpoint remains completed',dialog.locator('li[data-status="completed"]').filter(has_text='全局创意大纲').count()==1)
                check(label+theme+' materials checkpoint remains completed',dialog.locator('li[data-status="completed"]').filter(has_text='规划影片素材清单').count()==1)
                dialog.get_by_role('button',name='重试失败步骤',exact=True).click()
                check(label+theme+' stage retry uses resume',page.evaluate('window.lastLemoAction.action==="resume"'))
                capture(label+'-'+theme+'-staged')
                show('progress',theme=theme,upstream=True)
                dialog=page.get_by_role('dialog',name='自动制作进度')
                expect(dialog.get_by_text('原生 Agent · 第 1 轮',exact=True)).to_be_visible()
                expect(dialog.get_by_text('原生多文件 Agent：逐轮读库、编写工程、实帧检查；字幕和配音由本机合成。技术检查通过不等于审美验收。',exact=True)).to_be_visible()
                check(label+theme+' upstream has no legacy shot factory claims',dialog.get_by_text('镜头采用的风格',exact=True).count()==0)
                check(label+theme+' upstream hides legacy code recheck',dialog.get_by_role('button',name='重新检查现有代码',exact=True).count()==0)
                dialog.get_by_role('button',name='重试失败步骤',exact=True).click()
                check(label+theme+' upstream retries through durable coordinator',page.evaluate('window.lastLemoAction.action==="resume"'))
                capture(label+'-'+theme+'-upstream')

            show('progress',unknown=True,incremental=True)
            dialog=page.get_by_role('dialog')
            check(label+' unknown has no automatic resume',dialog.get_by_role('button',name='重试失败步骤',exact=True).count()==0)
            dialog.get_by_text('其他恢复选项',exact=True).click()
            dialog.get_by_role('button',name='恢复已保存结果',exact=True).click()
            check(label+' reconcile action',page.evaluate('window.lastLemoAction.action==="reconcile"'))
            capture(label+'-unknown')
            show('settings',busy=True)
            dialog=page.get_by_role('dialog')
            expect(dialog.get_by_role('checkbox',name='自动生成图片',exact=True)).to_be_disabled()
            expect(dialog.get_by_role('button',name='保存设置',exact=True)).to_be_disabled()
            capture(label+'-busy')
        # The model bar must share shell height with the real workspace, not add to it.
        for label, size in [('desktop', {'width':1320,'height':860}), ('minimum', {'width':1080,'height':720})]:
            page.set_viewport_size(size)
            for theme in ['dark','light']:
                show('workspace',theme=theme)
                page.locator('.vox-project-action-bar').wait_for(state='attached')
                report['workspaceAncestors']=page.locator('.vox-project-action-bar').evaluate('e=>{const out=[];for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);out.push({tag:n.tagName,cls:n.className,display:s.display,visibility:s.visibility,ariaHidden:n.getAttribute("aria-hidden"),inert:n.inert,rect:n.getBoundingClientRect().toJSON(),height:s.height,rows:s.gridTemplateRows});}return out}')
                page.locator('.vox-project-action-bar').wait_for(timeout=3000)
                geometry=page.locator('.vox-project-action-bar').evaluate('e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,buttons:[...e.querySelectorAll("button")].map(b=>{const r=b.getBoundingClientRect();return {text:b.innerText,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})}}')
                check(label+theme+' footer stays in shell',geometry['bottom']<=size['height']+1 and geometry['overflow']<=1)
                check(label+theme+' footer controls fully visible',all(b['left']>=0 and b['right']<=size['width']+1 and b['top']>=0 and b['bottom']<=size['height']+1 for b in geometry['buttons']))
                page.screenshot(path=str(ART/(label+'-'+theme+'-workspace.png')))
                report['geometry'][label+'-'+theme+'-workspace']=geometry
                progress=page.get_by_role('button',name='制作进度',exact=True)
                report["workspaceAccessibility"]=page.locator(".vox-project-action-bar").evaluate("e=>({hidden:[...document.querySelectorAll('[aria-hidden=true],[inert]')].filter(n=>n.contains(e)).map(n=>({tag:n.tagName,cls:n.className,containsFooter:n.contains(e),text:n.textContent.slice(0,80)})),active:document.activeElement?.outerHTML.slice(0,300)})")
                progress.focus(timeout=5000)
                page.keyboard.press('Enter')
                expect(page.get_by_role('dialog',name='自动制作进度')).to_be_visible()
                check(label+theme+' progress opens with keyboard',True)
                page.keyboard.press('Escape')
                expect(page.get_by_role('dialog',name='自动制作进度')).to_have_count(0)
                expect(progress).to_be_focused()
                check(label+theme+' closing restores keyboard focus',True)
            for theme in ['dark','light']:
                show('workspace',theme=theme,upstream=True,runState='running')
                expect(page.get_by_text('原生整片正在制作',exact=True)).to_be_visible()
                advanced=page.get_by_role('button',name='高级设置',exact=True)
                if advanced.get_attribute('aria-expanded')!='true': advanced.click()
                export=page.get_by_role('button',name='导出当前原生镜头',exact=True)
                expect(export).to_be_disabled()
                check(label+theme+' upstream blocks premature shot export',True)
                show('workspace',theme=theme,upstream=True,runState='completed')
                expect(page.get_by_text('原生工程已完成技术审片',exact=True)).to_be_visible()
                advanced=page.get_by_role('button',name='高级设置',exact=True)
                if advanced.get_attribute('aria-expanded')!='true': advanced.click()
                expect(page.get_by_text('Lemo 原生整片工程',exact=True)).to_be_visible()
                check(label+theme+' upstream has no legacy animation editor',page.locator('.vox-animation-editor').count()==0)
                expect(page.get_by_role('region',name='镜头渲染策略',exact=True)).to_have_count(0)
                check(label+theme+' native project cannot switch to ignored legacy renderers',True)
                export=page.get_by_role('button',name='导出当前原生镜头',exact=True)
                expect(export).to_be_enabled()
                previous_calls=page.evaluate('window.lemoExportCalls??0')
                page.evaluate('window.lemoQA.holdExport()')
                export.click()
                pending=page.get_by_role('button',name='正在导出原生镜头…',exact=True)
                expect(pending).to_be_disabled()
                expect(pending).to_be_focused()
                page.keyboard.press('Enter');page.keyboard.press('Space')
                check(label+theme+' pending export retains focus and blocks repeat activation',page.evaluate('window.lemoExportCalls')==previous_calls+1)
                page.evaluate('window.lemoQA.finishExport()')
                expect(export).to_be_enabled();expect(export).to_be_focused()
                check(label+theme+' upstream shot export invokes production handler',page.evaluate('window.lastLemoAction.action==="export-shot"&&window.lastLemoAction.value==="shot"'))
                page.screenshot(path=str(ART/(label+'-'+theme+'-upstream-workspace.png')))
                report['screenshots'].append(label+'-'+theme+'-upstream-workspace.png')
                page.keyboard.press('Escape')
                expect(page.get_by_role('dialog',name='镜头高级设置',exact=True)).to_have_count(0)
                expect(advanced).to_be_focused()
                check(label+theme+' export completion preserves Escape and restores opener',True)
            for state,options in [('failed',{}),('unknown',{'unknown':True}),('running',{'runState':'running','mixed':True})]:
                show('progress',longRun=True,incremental=True,**options)
                target=page.locator('li[data-node-id="'+page.evaluate('window.lemoQA.targetId')+'"]')
                expect(target).to_be_in_viewport()
                check(label+' '+state+' active node automatically revealed',True)
                # Initial modal autofocus can legitimately land on error details.
                # A later live node update must not steal the user's chosen focus.
                close=page.get_by_role('dialog',name='自动制作进度').get_by_role('button',name='关闭',exact=True)
                close.focus()
                previous_target=page.evaluate('window.lemoQA.targetId')
                page.evaluate('window.lemoQA.advance()')
                page.wait_for_function('previous=>window.lemoQA.targetId!==previous',arg=previous_target)
                updated_target=page.locator('li[data-node-id="'+page.evaluate('window.lemoQA.targetId')+'"]')
                expect(updated_target).to_be_in_viewport()
                expect(close).to_be_focused()
                check(label+' '+state+' live scrolling preserves chosen focus',True)
                recheck=page.get_by_role('button',name='重新检查现有代码',exact=True)
                if state=='failed': expect(recheck).to_be_enabled()
                else: expect(recheck).to_have_count(0)
            show('progress',runState='completed')
            recheck=page.get_by_role('button',name='重新检查现有代码',exact=True)
            expect(recheck).to_be_enabled()
            recheck.click()
            check(label+' completed supports free recheck',page.evaluate('window.lastLemoAction.action==="recheck-code"'))
            show('progress',runState='completed',busy=True)
            expect(page.get_by_role('button',name='重新检查现有代码',exact=True)).to_be_disabled()
            check(label+' busy disables free recheck',True)
        # The real native host loads shared assets, samples one scene and seeks one full film.
        page.set_viewport_size({'width':640,'height':360})
        for name,offset in [('first',0),('second',4),('sample',0)]:
            page.goto(url+'/film-'+name+'.html')
            # Poll via CDP directly: Playwright's in-page predicate evaluator is blocked by production CSP.
            for attempt in range(200):
                state=page.evaluate('()=>({ready:window.__ready===true,error:window.__htmlVideoMediaError})')
                if state.get('ready') or state.get('error'):
                    break
                page.wait_for_timeout(100)
            check(name+' native ready',page.evaluate('window.__ready===true && !window.__htmlVideoMediaError'))
            check(name+' full duration preserved',page.evaluate('window.DUR===8'))
            frames=[]
            for time in [2.9,0,1.2,2.9]:
                frame=page.evaluate('async t=>{await window.__tl.seek(t);const canvas=document.querySelector("canvas:not([data-lemo-stage])");return {time:window.__lemo.time,text:window.__lemo.texts()[0].text,pixel:Array.from(canvas.getContext("2d").getImageData(610,30,1,1).data),png:canvas.toDataURL()}}',time)
                check(name+' absolute seek '+str(time),abs(frame['time']-(offset+time))<0.00001)
                expected_scene='2' if name=='second' else '1'
                check(name+' active scene '+str(time),frame['text']=='Scene '+expected_scene+' '+format(offset+time,'.2f'))
                report.setdefault('nativeFrames',[]).append({'case':name,'seek':time,'time':frame['time'],'text':frame['text'],'pixel':frame['pixel']})
                if frame['pixel'] != [36,85,187,255]:
                    report['nativeCanvases']=page.locator('canvas').evaluate_all('canvases=>canvases.map(c=>({width:c.width,height:c.height,html:c.outerHTML.slice(0,200),pixel:Array.from(c.getContext("2d").getImageData(610,30,1,1).data)}))')
                    page.screenshot(path=str(ART/(name+'-asset-failure.png')))
                check(name+' prepared image drawn '+str(time),frame['pixel']==[36,85,187,255])
                frames.append(frame)
            check(name+' repeatable nonsequential frame',frames[0]['png']==frames[3]['png'] and frames[1]['png']!=frames[2]['png'])
            page.screenshot(path=str(ART/('film-'+name+'.png')))
            report['screenshots'].append('film-'+name+'.png')
        check('no renderer errors',not report['errors'])
        report['passed']=True
except Exception as exc:
    report["failure"]=str(exc)
    raise
finally:
    (ART/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    process.terminate()
    try:process.wait(timeout=10)
    except subprocess.TimeoutExpired:process.kill()
    log.close()
    server.shutdown()
print(json.dumps({'passed':report.get('passed',False),'checks':len(report['checks']),'screenshots':len(report['screenshots']),'report':str(ART/'report.json')},ensure_ascii=False))

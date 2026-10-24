"""Offline Electron QA for the selected Vox process-outline implementation.

Runs the real React page and mock persistence. Artwork is cropped from the
approved design only as project fixture content; it is never shipped in UI.
"""
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'docs/design/2026-10-22-vox-generation-simplification/implementation-evidence'
ART.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
profile = Path(tempfile.mkdtemp(prefix='vox-process-', dir=ROOT / '.codex-temp'))
Image.open(ART.parent / 'concepts/process-outline/design.png').crop((387, 115, 1499, 588)).save(profile / 'fixture-art.png')
source = (ROOT / 'tests/editorial-dual-chain.harness.tsx').read_text(encoding='utf8')
source = source.replace("'../src/", "'" + ROOT.as_posix() + '/src/')
source = source.replace('theme="dark"', 'theme={new URLSearchParams(location.search).get("theme")==="light"?"light":"dark"}')
source = source.replace('insertEditorialShot, parseEditorialCollagePipelineData', 'insertEditorialShot, rebuildEditorialTimeline, parseEditorialCollagePipelineData')
source = source.replace('Object.assign(window, { editorialDualChainQA: controls });', '''
Object.assign(controls, {
  processFixture(count = 4, longContent = false) {
    snapshot = emptySnapshot();
    const document = snapshot.document;
    document.title = '城市为什么更热';
    if (longContent) document.title = '城市为什么更热：建筑、道路、交通与绿色空间如何影响我们的生活'.repeat(3);
    document.sourceText = '夏天的城市，为什么总是比郊区更热？\\n这不仅是天气的原因，更与城市的结构和人类活动密切相关。';
    const beat = document.beats[0];
    const template = beat.shots[0];
    const descriptions = ['城市全景 · 早晨', '街道与交通 · 中午', '建筑与热岛 · 下午', '应对与未来 · 傍晚'];
    const narration = ['夏天的城市，为什么总是比郊区更热？', '城市道路上车流密集，周围高楼林立。', '建筑和路面吸收热量，使城市持续升温。', '树木与绿色空间，帮助城市降温。'];
    beat.title = '城市热岛'; beat.startMs = 0; beat.durationMs = count * 15000;
    beat.shots = Array.from({length: count}, (_, i) => ({...template, id: 'process-shot-' + i, title: descriptions[i % 4], durationMs: 15000, renderStrategy: 'deterministic-layers', layers: [{...template.layers[0], id:'process-layer-'+i, label:'城市拼贴画面', kind:'background', required:false, content:undefined, assetVersionId:'process-art', width:1, height:1, fit:'contain', motion:[{atMs:0,x:.5,y:.5,scale:1,rotation:0,opacity:1}]}], cuePlan: undefined, camera: [{atMs:0, x:.5, y:.5, zoom:1}], scenePrompt: '城市道路上车流密集，周围高楼林立，阳光强烈。画面呈现城市的繁忙与高温氛围，采用拼贴风格与纸张纹理。', subtitleCueIds: ['process-cue-' + i], keyframeAssetVersionId: 'process-art'}));
    beat.subtitleCues = beat.shots.map((shot, i) => ({id:'process-cue-'+i, text:narration[i%4], startMs:i*15000, endMs:(i+1)*15000}));
    beat.narration = beat.subtitleCues.map(cue => cue.text).join(' ');
    document.beats = count ? [beat] : [];
    document.assets = [{id:'process-art', assetId:'process-art', kind:'image', localPath:location.origin+'/fixture-art.png', provider:'local-import', prompt:'获选参考稿中的演示画面，仅用于界面验收', createdAt:seedTime}];
    snapshot.document = rebuildEditorialTimeline(document);
    if (longContent) snapshot.document.beats.forEach(beat => beat.shots.forEach(shot => { shot.title = '很长的镜头名称：城市街道与交通如何持续影响热岛效应'.repeat(3); }));
    store(); controls.remount();
  },
  finishRender() { if (pendingRender) { pendingRender(); pendingRender = undefined; } },
});
Object.assign(window, { editorialDualChainQA: controls });''')
source = source.replace('const localApi = {', '''let pendingRender: (() => void) | undefined;
const localApi = {
  async renderDirectorProject() { await new Promise<void>(resolve => { pendingRender = resolve; }); throw new Error('QA_RENDER_FAILURE: 本地模拟失败，请检查镜头后重试'); },
''')
entry = profile / 'process.tsx'
entry.write_text(source, encoding='utf8')
build = subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[2],emptyOutDir:false,target:'chrome120',lib:{entry:process.argv[1],name:'voxQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(entry), str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'build.log').write_text(build.stdout + build.stderr, encoding='utf8')
build.check_returncode()
runtime = subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e',
    "import {build} from 'esbuild';await build({entryPoints:['src/features/vox-animation/runtime.tsx'],outfile:process.argv[1],bundle:true,platform:'browser',format:'iife',target:'chrome120',define:{'process.env.NODE_ENV':JSON.stringify('production')},minify:true,logLevel:'warning'});", str(profile / 'runtime.js')], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
runtime.check_returncode()
(profile / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")==="light"?"light":"dark";</script><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(profile)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
(profile / 'preload.cjs').write_text("const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qaProcessZoom',factor=>ipcRenderer.invoke('qa-process-zoom',factor));", encoding='utf8')
(profile / 'main.cjs').write_text("const {app,BrowserWindow,session,ipcMain}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>{session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('" + url + "')&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')}));const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,preload:require('path').join(__dirname,'preload.cjs')}});ipcMain.handle('qa-process-zoom',(_,factor)=>w.webContents.setZoomFactor(factor));w.loadURL('" + url + "');});", encoding='utf8')
(profile / 'package.json').write_text('{"name":"vox-process-qa","version":"1.0.0","main":"main.cjs"}', encoding='utf8')
env = os.environ.copy()
for name in (*base.PAID_API_ENV_VARS, 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(name, None)
port = base.available_port()
process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
report = {'surface':'real React Vox page in isolated Electron, mocked API/persistence', 'paidCalls':0, 'screenshots':[], 'checks':[], 'states':{}, 'errors':[], 'consoleErrors':[]}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        page.on('console', lambda message: report['consoleErrors'].append(message.text) if message.type == 'error' else None)
        page.wait_for_selector('.director-desk')
        page.set_viewport_size({'width':1536, 'height':1024})
        def check(name, value):
            report['checks'].append({'name':name, 'passed':bool(value)})
            assert value, name
        def capture(name):
            # Visibility is reached before Fluent's enter transition finishes.
            # Wait for finite animations without disabling the product's motion.
            page.evaluate('''async () => {
              await document.fonts.ready;
              const finite = document.getAnimations().filter(animation => {
                const timing = animation.effect?.getComputedTiming();
                return timing && Number.isFinite(timing.endTime);
              });
              await Promise.race([Promise.allSettled(finite.map(a => a.finished)), new Promise(r => setTimeout(r, 1500))]);
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }''')
            page.screenshot(path=str(ART / f'{name}.png'))
            report['screenshots'].append(f'{name}.png')
            report['states'][name] = page.evaluate('''()=>({width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,footer:(()=>{let e=document.querySelector('.vox-project-action-bar');let r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}})(),center:(()=>{let e=document.querySelector('.director-center-pane');return {client:e.clientHeight,scroll:e.scrollHeight,top:e.scrollTop}})(),inspector:(()=>{let e=document.querySelector('.director-inspector-scroll');return {client:e?.clientHeight,scroll:e?.scrollHeight,top:e?.scrollTop}})()})''')
        def fixture(count=4):
            page.evaluate(f'window.editorialDualChainQA.processFixture({count})')
            page.wait_for_selector('.vox-outline-shot' if count else '.director-empty-state', state='attached')
            expect(page.locator('.vox-process-pane .vox-outline-shot')).to_have_count(count)
            page.locator('.director-center-pane').evaluate('e=>e.scrollTop=0')
        def advanced():
            page.get_by_role('button', name='高级设置', exact=True).click()
            expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_visible()
        def check_drawer_bounds(name):
            geometry = page.get_by_role('dialog', name='镜头高级设置').evaluate('''e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e),h=e.querySelector('.fui-DrawerHeader');return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,opacity:s.opacity,width:innerWidth,height:innerHeight,overflow:e.scrollWidth-e.clientWidth,scrollTop:e.scrollTop,header:h?.getBoundingClientRect().toJSON(),children:[...e.children].map(c=>({className:c.className,rect:c.getBoundingClientRect().toJSON(),scrollTop:c.scrollTop,display:getComputedStyle(c).display,flex:getComputedStyle(c).flex}))}}''')
            report['states'][name]['drawer'] = geometry
            check(name + ' stable drawer within viewport', geometry['left'] >= -1 and geometry['right'] <= geometry['width']+1 and geometry['top'] >= -1 and geometry['bottom'] <= geometry['height']+1 and float(geometry['opacity']) == 1 and geometry['overflow'] <= 1)
            check_drawer_header('镜头高级设置', name)
        def check_drawer_header(title, name):
            dialog = page.get_by_role('dialog', name=title, exact=True)
            header = dialog.locator('.fui-DrawerHeader')
            close = dialog.get_by_role('button', name='关闭' + title, exact=True)
            expect(header).to_be_in_viewport()
            expect(close).to_be_in_viewport()
            # A visible DOM box can still be covered by the sticky workspace header.
            for element in [header, close]:
                check(name + ' header control unobscured', element.evaluate('''e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'''))
        fixture()
        capture('desktop-initial')
        report['initialNavigation'] = page.locator('.vox-outline-shot').evaluate_all('es=>es.map(e=>({visible:!!e.getClientRects().length,rect:e.getBoundingClientRect().toJSON(),hidden:e.closest("[aria-hidden=true]")?.className}))')
        check('single visible shot navigation', page.locator('.vox-outline-shot:visible').count() == 4 and page.locator('.director-filmstrip:visible').count() == 0)
        check('no persistent inspector', not page.get_by_role('dialog', name='镜头高级设置').is_visible())
        page.locator('.vox-process-pane .vox-outline-shot').nth(1).click()
        capture('desktop-dark')
        check('footer at bottom', abs(report['states']['desktop-dark']['footer']['bottom'] - 1024) < 2)
        page.get_by_role('textbox', name='旁白', exact=True).fill('修改后的旁白，第一句。\n第二句与镜头同步。')
        page.get_by_role('textbox', name='画面描述', exact=True).fill('QA 修改：树荫下的城市街道，纸张拼贴。')
        page.locator('.vox-process-pane .vox-outline-shot').nth(0).click()
        page.locator('.vox-process-pane .vox-outline-shot').nth(1).click()
        expect(page.get_by_role('textbox', name='旁白', exact=True)).to_have_value('修改后的旁白，第一句。\n第二句与镜头同步。')
        expect(page.get_by_role('textbox', name='画面描述', exact=True)).to_have_value('QA 修改：树荫下的城市街道，纸张拼贴。')
        check('edits survive selection', True)
        page.get_by_role('button', name='保存版本', exact=True).click()
        page.wait_for_function('window.editorialDualChainQA.snapshot().saveCount > 0')
        page.reload()
        page.wait_for_selector('.director-desk')
        page.locator('.vox-process-pane .vox-outline-shot').nth(1).click()
        expect(page.get_by_role('textbox', name='旁白', exact=True)).to_have_value('修改后的旁白，第一句。\n第二句与镜头同步。')
        expect(page.get_by_role('textbox', name='画面描述', exact=True)).to_have_value('QA 修改：树荫下的城市街道，纸张拼贴。')
        check('edits survive save/reload', True)
        advanced()
        capture('desktop-advanced')
        check_drawer_bounds('desktop-advanced')
        check('drawer receives focus', page.evaluate('!!document.activeElement?.closest(".vox-advanced-drawer")'))
        page.locator('.director-inspector-scroll').evaluate('e=>e.scrollTop=e.scrollHeight')
        check('advanced scroll reaches bottom', page.locator('.director-inspector-scroll').evaluate('e=>e.scrollTop>0 && e.scrollTop+e.clientHeight>=e.scrollHeight-2'))
        capture('desktop-advanced-bottom')
        for _ in range(16):
            page.keyboard.press('Tab')
            check('focus trapped in drawer', page.evaluate('!!document.activeElement?.closest(".vox-advanced-drawer")'))
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_hidden()
        check('focus returns to advanced trigger', page.evaluate('document.activeElement?.textContent?.trim()==="高级设置"'))
        advanced()
        page.get_by_role('tab', name='动画', exact=True).click()
        page.locator('.vox-preview[data-vox-ready="true"]').wait_for(timeout=30000)
        page.get_by_role('textbox', name='保存为我的模板', exact=True).fill('未保存的模板草稿')
        page.get_by_role('button', name='选择模板 ·', exact=False).click()
        check('single template entry', page.get_by_role('combobox', name='动画模板', exact=True).count() == 0)
        capture('desktop-template')
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='预览并选择动画模板')).to_be_hidden()
        expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_visible()
        check('escape closes innermost modal only', True)
        report['templateReturnFocus'] = page.evaluate('document.activeElement?.outerHTML')
        capture('desktop-template-closed')
        expect(page.get_by_role('button', name='选择模板 ·', exact=False)).to_be_focused()
        check('template focus returns to opener', True)
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_hidden()
        advanced()
        expect(page.get_by_role('textbox', name='保存为我的模板', exact=True)).to_have_value('未保存的模板草稿')
        check('editor draft retained on drawer close', True)
        page.keyboard.press('Escape')
        page.get_by_role('button', name='更多制作操作', exact=True).click()
        page.get_by_role('menuitem', name='制作设置', exact=True).click()
        expect(page.get_by_role('dialog', name='自动制作设置')).to_be_visible()
        capture('desktop-production-settings')
        settings = page.get_by_role('dialog', name='自动制作设置')
        start = settings.get_by_role('button', name='开始自动制作', exact=True)
        settings.get_by_role('combobox', name='制作预设', exact=True).select_option('data-map')
        expect(start).to_be_disabled()
        expect(settings.get_by_role('alert')).to_contain_text('至少两条')
        check('data preset blocks missing sourced rows', True)
        settings.get_by_role('textbox', name='数据单位', exact=True).fill('℃')
        expect(settings.get_by_role('textbox', name='数据单位', exact=True)).to_have_value('℃')
        check('data preset exposes a shared unit', True)
        for i in range(2):
            settings.get_by_role('button', name='添加有来源的数据', exact=True).click()
            settings.get_by_role('textbox', name='名称', exact=True).nth(i).fill(f'真实数据 {i+1}')
            settings.get_by_role('spinbutton', name='数值', exact=True).nth(i).fill(str(i+1))
            settings.get_by_role('textbox', name='出处或链接', exact=True).nth(i).fill('https://data.giss.nasa.gov/gistemp/')
        expect(start).to_be_enabled()
        check('data preset accepts sourced values', True)
        settings.get_by_role('checkbox', name='使用地点坐标绘制路线', exact=True).check()
        settings.get_by_role('spinbutton', name='纬度', exact=True).first.fill('91')
        expect(start).to_be_disabled()
        check('map preset blocks invalid latitude', True)
        settings.get_by_role('spinbutton', name='纬度', exact=True).first.fill('30')
        expect(start).to_be_enabled()
        check('map preset accepts valid coordinates', True)
        settings.get_by_role('combobox', name='制作预设', exact=True).select_option('archival-story')
        expect(start).to_be_disabled()
        settings.get_by_role('button', name='添加档案引用', exact=True).click()
        expect(start).to_be_disabled()
        check('archive preset blocks missing provenance', True)
        settings.get_by_role('textbox', name='资料出处', exact=True).fill('QA 离线参考图，仅用于界面验收')
        settings.get_by_role('textbox', name='许可或使用说明', exact=True).fill('不用于真实成片或发布')
        expect(start).to_be_enabled()
        check('archive preset accepts imported reference and provenance', True)
        settings.get_by_role('combobox', name='制作预设', exact=True).select_option('paper-explainer')
        page.get_by_role('button', name='取消', exact=True).click()
        expect(page.get_by_role('dialog', name='自动制作设置')).to_be_hidden()
        page.get_by_role('button', name='更多制作操作', exact=True).click()
        page.get_by_role('menuitem', name='生成现有镜头成片', exact=True).click()
        expect(page.locator('.vox-project-primary')).to_be_disabled()
        expect(page.locator('.vox-project-primary')).to_have_text('正在生成成片…')
        page.get_by_role('button', name='更多制作操作', exact=True).click()
        expect(page.get_by_role('menuitem', name='制作设置', exact=True)).to_be_disabled()
        page.keyboard.press('Escape')
        capture('desktop-render-busy')
        page.evaluate('window.editorialDualChainQA.finishRender()')
        expect(page.locator('.vox-project-primary')).to_be_enabled()
        expect(page.locator('.director-header-message')).to_contain_text('本地模拟失败，请检查镜头后重试')
        capture('desktop-render-error')
        fixture(24)
        page.locator('.vox-process-pane').evaluate('e=>e.scrollTop=e.scrollHeight')
        page.locator('.vox-process-pane .vox-outline-shot').last.click()
        check('long list canonical selection', page.locator('.vox-process-pane .vox-outline-shot[aria-pressed="true"]').count() == 1)
        check('long list selection visible', page.locator('.vox-process-pane .vox-outline-shot[aria-pressed="true"]').evaluate('e=>{let r=e.getBoundingClientRect(),p=e.closest(".vox-process-pane").getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom}'))
        capture('desktop-long-list')
        fixture(0)
        expect(page.locator('.vox-project-primary')).to_be_disabled()
        capture('desktop-empty')
        check('empty project action disabled', True)
        fixture()
        for theme in ['dark', 'light']:
            page.set_viewport_size({'width':1536, 'height':1024})
            page.goto(url + '/?theme=' + theme)
            page.wait_for_selector('.director-desk')
            fixture()
            page.locator('.vox-process-pane .vox-outline-shot').nth(1).click()
            for name, width, height in [('desktop',1536,1024), ('compact',1040,720), ('narrow',860,720)]:
                page.set_viewport_size({'width':width, 'height':height})
                capture(name + '-' + theme + '-final')
                check(name + '-' + theme + ' footer in viewport', abs(report['states'][name+'-'+theme+'-final']['footer']['bottom']-height)<2)
                check(name + '-' + theme + ' no horizontal page overflow', report['states'][name+'-'+theme+'-final']['bodyOverflow'] <= 0)
                if name != 'narrow':
                    page.get_by_role('button', name='自动制作…', exact=True).click()
                    expect(page.get_by_role('dialog', name='自动制作设置')).to_be_visible()
                    capture(name + '-' + theme + '-production-settings')
                    expect(page.get_by_role('button', name='开始自动制作', exact=True)).to_be_in_viewport()
                    page.get_by_role('button', name='高级：风格、创作方式与镜头锁定', exact=True).click()
                    expect(page.get_by_role('textbox', name='搜索风格', exact=True)).to_be_visible()
                    expect(page.get_by_role('button', name='开始自动制作', exact=True)).to_be_in_viewport()
                    check(name + '-' + theme + ' advanced dialog has fixed action', True)
                    styles = page.get_by_role('combobox', name='视觉风格', exact=True)
                    expect(styles.locator('option')).to_have_count(60)
                    check(name + '-' + theme + ' unadapted styles disabled', styles.locator('option:disabled').count() == 53)
                    page.get_by_role('textbox', name='搜索风格', exact=True).fill('dataviz')
                    expect(styles.locator('option')).to_have_count(2)
                    page.get_by_role('textbox', name='搜索风格', exact=True).fill('')
                    dialog = page.get_by_role('dialog', name='自动制作设置', exact=True)
                    check(name + '-' + theme + ' advanced dialog fits viewport', dialog.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}'))
                    capture(name + '-' + theme + '-creative-advanced')
                    page.get_by_role('button', name='取消', exact=True).click()
                page.locator('.director-center-pane').evaluate('e=>e.scrollTop=e.scrollHeight')
                check(name + '-' + theme + ' center scroll', page.locator('.director-center-pane').evaluate('e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2'))
                page.locator('.director-center-pane').evaluate('e=>e.scrollTop=0')
                if name == 'narrow':
                    page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                    expect(page.get_by_role('dialog', name='制作大纲')).to_be_visible()
                    capture('narrow-outline-' + theme)
                    check_drawer_header('制作大纲', 'narrow-outline-' + theme)
                    page.get_by_role('button', name='关闭制作大纲', exact=True).click()
                    expect(page.get_by_role('dialog', name='制作大纲')).to_be_hidden()
                    page.wait_for_function('document.activeElement?.getAttribute("aria-label")==="显示项目与镜头"')
                    check('outline close restores opener ' + theme, True)
                    page.get_by_role('button', name='显示项目与镜头', exact=True).click()
                    page.locator('.vox-outline-drawer .vox-outline-shot').nth(1).click()
                    expect(page.get_by_role('dialog', name='制作大纲')).to_be_hidden()
                    advanced()
                    check('narrow drawers mutually exclusive', not page.get_by_role('dialog', name='制作大纲').is_visible())
                    capture('narrow-advanced-' + theme)
                    check_drawer_bounds('narrow-advanced-' + theme)
                    page.get_by_role('button', name='关闭镜头高级设置', exact=True).click()
                    expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_hidden()
                    page.wait_for_function('document.activeElement?.textContent?.trim()==="高级设置"')
                    check('advanced close restores opener ' + theme, True)
        page.set_viewport_size({'width':1536, 'height':1024})
        page.goto(url + '/?theme=dark')
        page.wait_for_selector('.director-desk')
        page.evaluate('window.editorialDualChainQA.processFixture(100, true)')
        expect(page.locator('.vox-process-pane .vox-outline-shot')).to_have_count(100)
        page.locator('.vox-process-pane').evaluate('e=>e.scrollTop=e.scrollHeight')
        page.locator('.vox-process-pane .vox-outline-shot').last.click()
        check('100 shot selection', page.locator('.vox-process-pane .vox-outline-shot[aria-pressed="true"]').count() == 1)
        capture('desktop-100-long-title')
        check('long content no horizontal overflow', report['states']['desktop-100-long-title']['bodyOverflow'] <= 0)
        page.evaluate('window.qaProcessZoom(2)')
        page.wait_for_function('innerWidth < 900')
        capture('desktop-200-percent')
        check('200 percent actual Electron zoom', report['states']['desktop-200-percent']['width'] < 900)
        check('200 percent no horizontal overflow', report['states']['desktop-200-percent']['bodyOverflow'] <= 0)
        check('200 percent footer in viewport', abs(report['states']['desktop-200-percent']['footer']['bottom'] - report['states']['desktop-200-percent']['height']) < 2)
        expect(page.locator('.vox-project-primary')).to_be_in_viewport()
        page.locator('.director-center-pane').evaluate('e=>e.scrollTop=e.scrollHeight')
        expect(page.get_by_role('button', name='高级设置', exact=True)).to_be_in_viewport()
        advanced()
        capture('desktop-200-percent-advanced')
        check_drawer_bounds('desktop-200-percent-advanced')
        page.keyboard.press('Escape')
        page.evaluate('window.qaProcessZoom(1)')
        report['blockedCalls'] = page.evaluate('window.editorialDualChainQA.snapshot().blockedCalls')
        check('no provider calls', len(report['blockedCalls']) == 0)
        check('no page errors', len(report['errors']) == 0)
        report['status'] = 'passed'
        browser.close()
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
    try:
        capture('failure')
        report['blockedCalls'] = page.evaluate('window.editorialDualChainQA.snapshot().blockedCalls')
    except Exception:
        pass
finally:
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    process.terminate()
    server.shutdown()
print(json.dumps({'status':report['status'], 'checks':len(report['checks']), 'screenshots':report['screenshots'], 'error':report.get('error')}, ensure_ascii=False))
if report['status'] != 'passed':
    raise SystemExit(1)

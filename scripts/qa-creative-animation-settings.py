"""Offline Electron QA for the selected Vox process-outline implementation.

Runs the real React page and mock persistence. Artwork is cropped from the
approved design only as project fixture content; it is never shipped in UI.
"""
import functools
import http.server
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import threading

from PIL import Image
import imageio_ffmpeg
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ART = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/creative-animation-settings'))).resolve()
NODE = os.environ.get('STORYDREAM_QA_NODE') or shutil.which('node')
if not NODE:
    raise RuntimeError('Node.js executable was not found; set STORYDREAM_QA_NODE')
ART.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
profile = Path(tempfile.mkdtemp(prefix='vox-process-', dir=ART))
Image.open(ROOT / 'docs/design/2026-10-22-vox-generation-simplification/concepts/process-outline/design.png').crop((387, 115, 1499, 588)).save(profile / 'fixture-art.png')
source = (ROOT / 'tests/editorial-dual-chain.harness.tsx').read_text(encoding='utf8')
source = source.replace("'../src/", "'" + ROOT.as_posix() + '/src/')
source = source.replace('theme="dark"', 'theme={new URLSearchParams(location.search).get("theme")==="light"?"light":"dark"}')
source = source.replace('insertEditorialShot, parseEditorialCollagePipelineData', 'insertEditorialShot, rebuildEditorialTimeline, parseEditorialCollagePipelineData')
source = source.replace("import '../src/styles.css';", "import '../src/styles.css';")
source = "import { LEMO_NATIVE_ENGINE } from '" + ROOT.as_posix() + "/src/shared/creative-animation/native-film';\nimport { directorDocumentRenderFingerprint } from '" + ROOT.as_posix() + "/src/shared/director-render';\n" + source
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
  outputFixture() {
    controls.processFixture();
    snapshot.document.assets.push({ id:'qa-final', assetId:'director-final-video', kind:'video', localPath:location.origin+'/fixture-video.mp4', selected:true, renderFingerprint:directorDocumentRenderFingerprint(snapshot.document), createdAt:seedTime });
    store(); controls.remount();
  },
  officialProductionFixture(scenario: 'unknown'|'failed'|'running' = 'unknown') {
    controls.processFixture(4);
    controls.productionCalls = []; controls.holdProduction = false;
    const document = snapshot.document;
    const settings = {...voxProductionSettings(), generateImages:false, narration:false, authoring:{mode:'ai-code' as const,styleId:'watercolor'}};
    const nodes = buildVoxProductionNodes(document, settings);
    const stage = nodes.find(n => n.id === 'official-authoring')!;
    for (const node of nodes.slice(0, nodes.indexOf(stage))) { node.status='completed'; node.attempt=1; }
    stage.status=scenario; stage.attempt=1; stage.requestId='offline-official-request';
    stage.error=scenario==='running'?undefined:scenario==='unknown'?'LEMO_SESSION_CANCELLED: 官方会话的原请求仍待核对。':'LEMO_OFFICIAL_REVIEW_REQUIRED: 请先完成本次官方工程的实帧审片。';
    document.productionSettings=settings;
    document.productionRun={version:1,id:'qa-official-run',engine:LEMO_NATIVE_ENGINE,authoringVersion:4,status:scenario==='running'?'running':'failed',settings,nodes,sourceHash:'fixture',runtimeIdentity:'fixture',createdAt:seedTime,updatedAt:seedTime,message:stage.error};
    store(); controls.remount();
  },
  finishRender() { if (pendingRender) { pendingRender(); pendingRender = undefined; } },
});
Object.assign(window, { editorialDualChainQA: controls });''')
source = source.replace('const localApi = {', '''let pendingRender: (() => void) | undefined;
const localApi = {
  async getTaskMediaUrl(projectId: string, path: string) {
    if (projectId !== snapshot.document.id || path !== location.origin + '/fixture-video.mp4') throw new Error('QA_BLOCKED_MEDIA');
    return path;
  },
  async importBgmAudio() { return {title:'导入测试音乐', path:location.origin+'/fixture-music.wav'}; },
  async openHotBoardUrl(url: string) { Object.assign(window, { qaOpenedUrl: url }); },
  async createEditorialCollage(input: Parameters<StoryDreamApi['createEditorialCollage']>[0]) {
    snapshot = emptySnapshot();
    snapshot.document = createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'qa-created', title:input.title, ratio:input.ratio, now:seedTime}), input.sourceText, seedTime, input.durationMs);
    store(); return {kind:'task-upsert', task:taskDetail()};
  },
  async renderDirectorProject() { await new Promise<void>(resolve => { pendingRender = resolve; }); throw new Error('QA_RENDER_FAILURE: 本地模拟失败，请检查镜头后重试'); },
''')
source = source.replace('video: { ...defaultConfig.video,', "jianying: { ...defaultConfig.jianying, bgmLibrary: [{id:'qa-music',title:'测试背景音乐',path:location.origin+'/fixture-music.wav',durationMs:12000}] }, video: { ...defaultConfig.video,")
ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
subprocess.run([str(ffmpeg), '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=12', str(profile / 'fixture-music.wav')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run([str(ffmpeg), '-y', '-loop', '1', '-i', str(profile / 'fixture-art.png'), '-t', '2', '-vf', 'scale=640:360', '-pix_fmt', 'yuv420p', str(profile / 'fixture-video.mp4')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
entry = profile / 'process.tsx'
entry.write_text(source, encoding='utf8')
build = subprocess.run([NODE, '--input-type=module', '-e',
    "import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[2],emptyOutDir:false,target:'chrome120',lib:{entry:process.argv[1],name:'voxQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(entry), str(profile)], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
(ART / 'build.log').write_text(build.stdout + build.stderr, encoding='utf8')
build.check_returncode()
runtime = subprocess.run([NODE, '--input-type=module', '-e',
    "import {build} from 'esbuild';await build({entryPoints:['src/features/vox-animation/runtime.tsx'],outfile:process.argv[1],bundle:true,platform:'browser',format:'iife',target:'chrome120',define:{'process.env.NODE_ENV':JSON.stringify('production')},minify:true,logLevel:'warning'});", str(profile / 'runtime.js')], cwd=ROOT, capture_output=True, text=True, encoding='utf8')
runtime.check_returncode()
import re
csp = re.search(r'content="(default-src[^"]+)"', (ROOT / 'index.html').read_text(encoding='utf8')).group(1)
# Playwright's string polling uses eval; retain the exact production media CSP.
# Only the isolated test harness allows eval for automation predicates.
csp = csp.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")
(profile / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><script nonce="storydream-html-video">document.documentElement.dataset.theme=new URLSearchParams(location.search).get("theme")==="light"?"light":"dark";</script><link rel="stylesheet" href="harness.css"><style>[data-editorial-collage-workbench]{height:100vh;min-height:0;overflow:hidden}</style><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(profile)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
(profile / 'preload.cjs').write_text("const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qaProcessZoom',factor=>ipcRenderer.invoke('qa-process-zoom',factor));contextBridge.exposeInMainWorld('qaMedia',mode=>ipcRenderer.invoke('qa-media',mode));", encoding='utf8')
(profile / 'main.cjs').write_text("""
const {app,BrowserWindow,session,ipcMain}=require('electron');
let mode='offline'; const requests=[];
const slugs=STYLE_SLUGS;
const allowed=new Set(slugs.flatMap(s=>['https://lemomo-ai.github.io/lemo-opuscar/img/'+s+'_0.jpg','https://lemomo-ai.github.io/lemo-opuscar/films/'+s+'.mp4']));
app.disableHardwareAcceleration();app.whenReady().then(()=>{
session.defaultSession.webRequest.onBeforeRequest((d,cb)=>{
  if(allowed.has(d.url)) { requests.push(d.url); return cb(mode==='live'?{}:{redirectURL:LOCAL+(d.url.endsWith('.mp4')?(mode==='error'?'/missing-film.mp4':'/fixture-video.mp4'):'/fixture-art.png')}); }
  cb({cancel:!d.url.startsWith(LOCAL)&&!d.url.startsWith('data:')&&!d.url.startsWith('blob:')});
});
const w=new BrowserWindow({width:1536,height:1024,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,preload:require('path').join(__dirname,'preload.cjs')}});
ipcMain.handle('qa-process-zoom',(_,factor)=>w.webContents.setZoomFactor(factor));
ipcMain.handle('qa-media',(_,value)=>{if(value)mode=value;return {mode,requests};});
w.loadURL(LOCAL);
});
""".replace('LOCAL', json.dumps(url)).replace('STYLE_SLUGS', json.dumps([s['slug'] for s in json.loads((ROOT / 'src/shared/creative-animation/lemo-catalog.json').read_text(encoding='utf8'))])), encoding='utf8')
(profile / 'package.json').write_text('{"name":"vox-process-qa","version":"1.0.0","main":"main.cjs"}', encoding='utf8')
env = os.environ.copy()
for name in (*base.PAID_API_ENV_VARS, 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(name, None)
port = base.available_port()
electron_log = (ART / 'electron.log').open('w', encoding='utf8')
process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=electron_log, stderr=electron_log, creationflags=subprocess.CREATE_NO_WINDOW)
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
            report['states'][name] = page.evaluate('''()=>({width:innerWidth,height:innerHeight,bodyOverflow:document.documentElement.scrollWidth-innerWidth,footer:(()=>{let e=document.querySelector('.vox-project-action-bar');let r=e?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,height:r.height}:null})(),center:(()=>{let e=document.querySelector('.director-center-pane');return {client:e?.clientHeight,scroll:e?.scrollHeight,top:e?.scrollTop}})(),inspector:(()=>{let e=document.querySelector('.director-inspector-scroll');return {client:e?.clientHeight,scroll:e?.scrollHeight,top:e?.scrollTop}})()})''')
        def fixture(count=4):
            page.evaluate(f'window.editorialDualChainQA.processFixture({count})')
            page.wait_for_selector('.vox-outline-shot' if count else '.director-empty-state', state='attached')
            expect(page.locator('.vox-process-pane .vox-outline-shot')).to_have_count(count)
            page.locator('.director-center-pane').evaluate('e=>e.scrollTop=0')
        def style_options(scope=page):
            scope.get_by_role('combobox', name='视觉风格', exact=True).click()
            listbox = page.get_by_role('listbox')
            expect(listbox).to_be_visible()
            expect(listbox.get_by_role('option')).to_have_count(60)
            check('all 59 styles and automatic selectable', listbox.get_by_role('option', disabled=True).count() == 0)
            check('style categories available', listbox.get_by_role('group').count() >= 8)
            page.keyboard.press('Escape')
        def choose_style(label, scope=page):
            scope.get_by_role('combobox', name='视觉风格', exact=True).click()
            page.get_by_role('listbox').get_by_role('option', name=label, exact=True).click()
        def loaded_cover(locator):
            expect(locator).to_be_visible()
            expect(locator).to_have_js_property('complete', True)
            expect(locator).not_to_have_js_property('naturalWidth', 0)
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
        # Official SDK entrypoints use the real page, dialogs and mock-only IPC.
        for label, size in [('desktop', {'width':1536,'height':1024}), ('compact', {'width':1040,'height':720})]:
            page.set_viewport_size(size)
            for theme in ['dark', 'light']:
                page.goto(url + '?theme=' + theme)
                page.wait_for_selector('.director-desk')
                for scenario in ['failed', 'unknown']:
                    page.evaluate('(scenario)=>window.editorialDualChainQA.officialProductionFixture(scenario)', scenario)
                    page.get_by_role('button', name='制作进度', exact=True).click()
                    dialog = page.get_by_role('dialog', name='自动制作进度', exact=True)
                    expect(dialog).to_be_visible()
                    stage = dialog.locator('[data-node-id="official-authoring"]')
                    expect(stage.get_by_text('官方 SDK · 整片创作与审片', exact=True)).to_be_visible()
                    check(label + theme + scenario + ' official stage label', True)
                    check(label + theme + scenario + ' no retired code recheck', dialog.get_by_role('button', name='重新检查现有代码', exact=True).count() == 0)
                    check(label + theme + scenario + ' no legacy style fallback disclosure', dialog.get_by_text('镜头采用的风格', exact=True).count() == 0)
                    if scenario == 'failed':
                        expect(dialog.get_by_role('button', name='重试失败步骤', exact=True)).to_be_enabled()
                    else:
                        expect(dialog.get_by_role('button', name='继续官方步骤', exact=True)).to_be_enabled()
                        check(label + theme + ' no generic direct retry claim', dialog.get_by_role('button', name='直接重试此步骤', exact=True).count() == 0)
                        dialog.get_by_text('其他恢复选项', exact=True).click()
                        expect(dialog.get_by_text('先尝试恢复本机已保存的官方工程与审片凭据。找不到回执不代表服务商没有结果；手工核对记录也不会清除官方会话的未决请求。', exact=True)).to_be_visible()
                        dialog.get_by_role('button', name='恢复已保存结果', exact=True).click()
                        check(label + theme + ' recovery stays in original run', page.evaluate('(()=>{const c=window.editorialDualChainQA.productionCalls.at(-1);return c.action==="reconcile"&&c.runId==="qa-official-run"})()'))
                        dialog.get_by_role('button', name='继续官方步骤', exact=True).click()
                        check(label + theme + ' official continuation targets same stage', page.evaluate('(()=>{const c=window.editorialDualChainQA.productionCalls.at(-1);return c.action==="retry-unknown"&&c.nodeId==="official-authoring"&&c.runId==="qa-official-run"})()'))
                        dialog.get_by_role('button', name='记录核对依据', exact=True).scroll_into_view_if_needed()
                        expect(dialog.get_by_role('button', name='记录核对依据', exact=True)).to_be_disabled()
                        check(label + theme + ' official evidence does not promise to unlock ledger', dialog.get_by_role('button', name='记录核对并解锁此步骤', exact=True).count() == 0)
                    name = label + '-' + theme + '-official-' + scenario
                    capture(name)
                    geometry = dialog.evaluate('e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:e.scrollWidth-e.clientWidth}}')
                    report['states'][name]['dialog'] = geometry
                    check(name + ' dialog within viewport', geometry['left'] >= -1 and geometry['right'] <= geometry['width']+1 and geometry['top'] >= -1 and geometry['bottom'] <= geometry['height']+1 and geometry['overflow'] <= 1)
                    expect(dialog.get_by_role('button', name='关闭', exact=True)).to_be_in_viewport()
                    if scenario == 'failed':
                        dialog.get_by_role('button', name='重试失败步骤', exact=True).click()
                        check(label + theme + ' failure resumes original run', page.evaluate('(()=>{const c=window.editorialDualChainQA.productionCalls.at(-1);return c.action==="resume"&&c.runId==="qa-official-run"})()'))
                    page.keyboard.press('Escape')
                    expect(dialog).to_be_hidden()
                    check(name + ' keyboard closes progress dialog', True)
        if os.environ.get('STORYDREAM_QA_OFFICIAL_ONLY') == '1':
            report['blockedCalls'] = page.evaluate('window.editorialDualChainQA.snapshot().blockedCalls')
            check('no provider calls', len(report['blockedCalls']) == 0)
            check('no page errors', len(report['errors']) == 0)
            report['status'] = 'passed'
            browser.close()
            raise SystemExit(0)
        page.set_viewport_size({'width':1536, 'height':1024})
        page.goto(url)
        page.wait_for_selector('.director-desk')
        fixture()
        page.get_by_role('button', name='背景音乐', exact=True).click()
        music = page.get_by_role('dialog', name='整片背景音乐', exact=True)
        expect(music.get_by_role('combobox', name='整片背景音乐', exact=True)).to_have_value('')
        music.get_by_role('combobox', name='整片背景音乐', exact=True).select_option('qa-music')
        audio = music.locator('audio')
        audio.evaluate('e=>e.play()')
        page.wait_for_function('document.querySelector("[data-project-music] audio")?.currentTime > .1')
        check('selected music actually plays', audio.evaluate('e=>!e.paused&&e.duration===12&&Math.abs(e.volume-Math.pow(10,-18/20))<.001'))
        audio.evaluate('e=>e.pause()')
        capture('project-music-desktop')
        page.set_viewport_size({'width':1040,'height':720})
        capture('project-music-compact')
        expect(music.get_by_role('button', name='保存音乐', exact=True)).to_be_in_viewport()
        check('compact music dialog fits', music.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}'))
        music.get_by_role('button', name='保存音乐', exact=True).click()
        expect(music).to_be_hidden()
        check('music saves to project and mix', page.evaluate('()=>{const d=window.editorialDualChainQA.snapshot().document;return d.productionSettings.music.id==="qa-music"&&d.timeline.audioClips.some(c=>c.trackType==="music")}'))
        page.reload()
        page.wait_for_selector('.director-desk')
        page.get_by_role('button', name='背景音乐', exact=True).click()
        expect(music.get_by_role('combobox', name='整片背景音乐', exact=True)).to_have_value('qa-music')
        check('music selection survives reload', True)
        music.get_by_role('button', name='导入背景音乐', exact=True).click()
        expect(music.locator('audio')).to_have_attribute('aria-label', '试听背景音乐：导入测试音乐')
        check('local music imports after measured duration', music.locator('audio').evaluate('e=>e.duration===12'))
        music.get_by_role('button', name='保存音乐', exact=True).click()
        expect(music).to_be_hidden()
        page.get_by_role('button', name='背景音乐', exact=True).click()
        expect(music.locator('audio')).to_have_attribute('aria-label', '试听背景音乐：导入测试音乐')
        music.get_by_role('combobox', name='整片背景音乐', exact=True).select_option('')
        music.get_by_role('button', name='保存音乐', exact=True).click()
        expect(music).to_be_hidden()
        check('removing music clears generated mix', page.evaluate('()=>!window.editorialDualChainQA.snapshot().document.timeline.audioClips?.some(c=>c.id.startsWith("project-music-"))'))
        page.set_viewport_size({'width':1536,'height':1024})
        fixture()
        page.get_by_role('button', name='全屏', exact=True).click()
        page.wait_for_function('!!document.fullscreenElement')
        expect(page.get_by_role('button', name='退出全屏', exact=True)).to_be_in_viewport()
        capture('preview-fullscreen')
        check('fullscreen frame fits viewport', page.locator('.director-media-preview').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1}'))
        page.get_by_role('button', name='退出全屏', exact=True).click()
        page.wait_for_function('!document.fullscreenElement')
        page.get_by_role('button', name='全屏', exact=True).click()
        page.wait_for_function('!!document.fullscreenElement')
        page.keyboard.press('Escape')
        page.wait_for_function('!document.fullscreenElement')
        expect(page.get_by_role('button', name='全屏', exact=True)).to_be_visible()
        check('preview fullscreen button and Escape round trips', True)
        page.locator('.director-media-preview').dblclick()
        page.wait_for_function('!!document.fullscreenElement')
        page.locator('.director-media-preview').dblclick()
        page.wait_for_function('!document.fullscreenElement')
        check('double click toggles preview fullscreen', True)
        page.evaluate('window.editorialDualChainQA.outputFixture()')
        page.wait_for_selector('video[aria-label$="成片预览"]')
        page.get_by_role('button', name='全屏', exact=True).click()
        page.wait_for_function('!!document.fullscreenElement')
        expect(page.get_by_role('button', name='退出全屏', exact=True)).to_be_in_viewport()
        capture('output-fullscreen')
        page.get_by_role('button', name='退出全屏', exact=True).click()
        page.wait_for_function('!document.fullscreenElement')
        page.get_by_role('button', name='全屏', exact=True).click()
        page.wait_for_function('!!document.fullscreenElement')
        page.keyboard.press('Escape')
        page.wait_for_function('!document.fullscreenElement')
        check('rendered video fullscreen round trips', True)
        fixture()
        advanced()
        drawer = page.get_by_role('dialog', name='镜头高级设置')
        expect(drawer.get_by_role('tab', name='画面与动画', exact=True)).to_be_visible()
        expect(drawer.get_by_role('tab', name='声音与字幕', exact=True)).to_be_visible()
        check('two main inspector tabs', drawer.get_by_role('tablist', name='镜头设置', exact=True).get_by_role('tab').count() == 2)
        expect(drawer.get_by_role('combobox', name='相机运动', exact=True)).to_be_hidden()
        expect(drawer.get_by_role('combobox', name='图片生成服务', exact=True)).to_be_hidden()
        drawer.get_by_text('图层与运动关键帧', exact=True).click()
        expect(drawer.get_by_role('button', name='相机运动', exact=False)).to_be_visible()
        drawer.get_by_text('图层与运动关键帧', exact=True).click()
        drawer.get_by_role('tab', name='声音与字幕', exact=True).click()
        expect(drawer.get_by_text('背景音乐与音效', exact=True)).to_be_visible()
        check('secondary settings progressively disclosed', True)
        page.keyboard.press('Escape')
        page.get_by_role('button', name='自动制作…', exact=True).click()
        settings = page.get_by_role('dialog', name='自动制作设置')
        choose_style('瑞士动态排版', settings)
        settings.get_by_role('textbox', name='动画创作要求', exact=True).fill('大字开场，观点依次出现，不要快速闪烁。')
        settings.get_by_role('button', name='保存设置', exact=True).click()
        expect(settings).to_be_hidden()
        page.wait_for_function('window.editorialDualChainQA.snapshot().document.productionSettings?.authoring?.styleId === "swiss-motion"')
        page.reload()
        page.wait_for_selector('.director-desk')
        page.get_by_role('button', name='自动制作…', exact=True).click()
        expect(settings.get_by_role('combobox', name='视觉风格', exact=True)).to_have_text('瑞士动态排版')
        # Image-like hover previews must not load films or mutate settings.
        before = page.evaluate('window.editorialDualChainQA.snapshot().document.productionSettings.authoring.styleId')
        loaded_cover(settings.locator('.sd-preview-select-selected img'))
        capture('style-selected-offline-cover')
        settings.get_by_role('combobox', name='视觉风格', exact=True).click()
        # Keep remote media unavailable. Each of the 59 covers must decode from
        # the real bundled asset, not a successful network redirect or DOM box.
        report['offlineCovers'] = []
        catalog = json.loads((ROOT / 'src/shared/creative-animation/lemo-catalog.json').read_text(encoding='utf8'))
        for style in catalog:
            option = page.get_by_role('listbox').get_by_role('option', name=style['cn'], exact=True)
            option.scroll_into_view_if_needed()
            loaded_cover(option.locator('img'))
            option.hover()
            expect(page.get_by_role('tooltip')).to_contain_text(style['cn'])
            cover = page.get_by_role('tooltip').get_by_role('img')
            loaded_cover(cover)
            geometry = page.get_by_role('tooltip').evaluate('''e=>{
              const r=e.getBoundingClientRect(); const previous=e.style.pointerEvents;
              e.style.pointerEvents='auto';
              const exposed=e.contains(document.elementFromPoint(r.x+r.width/2,r.y+Math.min(r.height/2,80)));
              e.style.pointerEvents=previous;
              const img=e.querySelector('img');
              return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,exposed,source:img.currentSrc,naturalWidth:img.naturalWidth};
            }''')
            check('offline thumbnail and unobscured hover ' + style['slug'], geometry['exposed'] and geometry['left'] >= 0 and geometry['right'] <= geometry['width'] + 1 and geometry['top'] >= 0 and geometry['bottom'] <= geometry['height'] + 1 and not geometry['source'].startswith('https:'))
            report['offlineCovers'].append({'slug':style['slug'], **geometry})
        check('no remote cover requests', not any('/img/' in u for u in page.evaluate('window.qaMedia()')['requests']))
        page.get_by_role('option', name='暗色科技发布', exact=True).hover()
        loaded_cover(page.get_by_role('tooltip').get_by_role('img'))
        expect(page.locator('video')).to_have_count(0)
        capture('style-hover-cover')
        check('hover never selects or loads film', before == page.evaluate('window.editorialDualChainQA.snapshot().document.productionSettings.authoring.styleId') and not any(u.endswith('.mp4') for u in page.evaluate('window.qaMedia()')['requests']))
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        settings.get_by_role('button', name='详细预览视觉风格', exact=True).click()
        sample = page.get_by_role('dialog', name='瑞士动态排版 · 效果预览', exact=True)
        expect(sample).to_be_visible()
        film = sample.get_by_label('瑞士动态排版官方参考样片', exact=True)
        check('video only preloads on demand', film.get_attribute('preload') == 'none')
        check('unplayed sample does not show loading', sample.get_by_role('status').count() == 0)
        film.evaluate('e=>e.play()')
        page.wait_for_function('document.querySelector(".creative-style-player video")?.currentTime > .1')
        film.evaluate('e=>e.pause()')
        check('sample video plays and pauses', film.evaluate('e=>e.paused&&e.currentTime>0'))
        film.evaluate('e=>e.requestFullscreen()')
        page.wait_for_function('!!document.fullscreenElement')
        page.keyboard.press('Escape')
        page.wait_for_function('!document.fullscreenElement')
        expect(sample).to_be_visible()
        check('sample Escape exits fullscreen before closing preview', True)
        sample.get_by_role('button', name='查看 Lemo 全部 59 种风格', exact=True).click()
        check('gallery opens through app API', page.evaluate('window.qaOpenedUrl') == 'https://lemomo-ai.github.io/lemo-opuscar/')
        capture('style-film-preview')
        page.keyboard.press('Escape')
        expect(sample).to_be_hidden()
        expect(settings).to_be_visible()
        page.wait_for_function('document.activeElement?.getAttribute("aria-label")==="详细预览视觉风格"')
        check('closing nested sample returns focus to settings', True)
        page.evaluate('window.qaMedia("error")')
        settings.get_by_role('button', name='详细预览视觉风格', exact=True).click()
        sample.locator('video').evaluate('e=>e.play().catch(()=>{})')
        expect(sample.get_by_role('alert')).to_contain_text('样片加载失败')
        capture('style-film-network-error')
        page.evaluate('window.qaMedia("offline")')
        sample.get_by_role('button', name='重新加载样片', exact=True).click()
        sample.locator('video').evaluate('e=>e.play()')
        page.wait_for_function('document.querySelector(".creative-style-player video")?.currentTime > .1')
        check('sample network error retry recovers', True)
        page.keyboard.press('Escape')
        check('preview leaves saved settings intact', before == page.evaluate('window.editorialDualChainQA.snapshot().document.productionSettings.authoring.styleId'))
        expect(settings.get_by_role('textbox', name='动画创作要求', exact=True)).to_have_value('大字开场，观点依次出现，不要快速闪烁。')
        settings.get_by_role('combobox', name='视觉风格', exact=True).focus()
        page.keyboard.press('ArrowDown')
        expect(page.get_by_role('listbox')).to_be_visible()
        expect(settings.get_by_role('combobox', name='视觉风格', exact=True)).to_have_attribute('aria-activedescendant', re.compile('.+'))
        page.keyboard.press('Home')
        report['keyboardStyleState'] = settings.get_by_role('combobox', name='视觉风格', exact=True).evaluate('e=>({element:e.outerHTML,active:document.activeElement?.outerHTML,option:document.getElementById(e.getAttribute("aria-activedescendant"))?.outerHTML})')
        expect(page.get_by_role('tooltip')).to_contain_text('自动匹配（推荐）')
        loaded_cover(page.get_by_role('tooltip').get_by_role('img'))
        check('keyboard navigation previews cover without film', page.locator('video').count() == 0)
        page.keyboard.press('Escape')
        page.keyboard.press('Escape')
        choose_style('自动匹配（推荐）', settings)
        settings.get_by_role('combobox', name='素材流程', exact=True).select_option('data-map')
        settings.get_by_role('combobox', name='制作方式', exact=True).select_option('template')
        settings.get_by_role('button', name='详细预览视觉风格', exact=True).click()
        automatic_sample = page.get_by_role('dialog', name='自动匹配（推荐） · 效果预览', exact=True)
        expect(automatic_sample).to_contain_text('当前素材流程自动匹配：数据叙事')
        expect(automatic_sample).to_contain_text('使用所选配色与现有兼容动效')
        check('automatic preview follows workflow and explains template scope', True)
        page.keyboard.press('Escape')
        settings.get_by_role('button', name='取消', exact=True).click()
        check('save settings survives reload without production call', True)
        # Newly adapted families must work through the actual settings owner,
        # not only through the static catalog or the six original styles.
        for slug, label, scope_note in [
            ('watercolor', '水彩笔刷', '未复现原项目的逐笔材质模拟'),
            ('pixel-rpg', '16-bit 像素 RPG', '未复现原项目的逐笔材质模拟'),
            ('glass-product', '玻璃质感产品', '当前不运行三维引擎或物理材质模拟'),
            ('news-package', '电视新闻包装', '原片配音不在此许可内'),
        ]:
            page.get_by_role('button', name='自动制作…', exact=True).click()
            choose_style(label, settings)
            settings.get_by_role('button', name='保存设置', exact=True).click()
            expect(settings).to_be_hidden()
            page.wait_for_function('(slug)=>window.editorialDualChainQA.snapshot().document.productionSettings?.authoring?.styleId===slug', arg=slug)
            page.reload()
            page.wait_for_selector('.director-desk')
            page.get_by_role('button', name='自动制作…', exact=True).click()
            expect(settings.get_by_role('combobox', name='视觉风格', exact=True)).to_have_text(label)
            check('new style save and reload ' + slug, True)
            settings.get_by_role('button', name='详细预览视觉风格', exact=True).click()
            new_sample = page.get_by_role('dialog', name=label + ' · 效果预览', exact=True)
            expect(new_sample).to_contain_text(scope_note)
            expect(new_sample).to_contain_text('制作时不使用原片音轨')
            check('new style sample and scope ' + slug, new_sample.locator('video').get_attribute('src').endswith('/' + slug + '.mp4'))
            capture('new-style-' + slug)
            page.keyboard.press('Escape')
            if slug == 'watercolor':
                settings.get_by_role('combobox', name='视觉风格', exact=True).click()
                page.get_by_role('option', name=label, exact=True).scroll_into_view_if_needed()
                capture('all-styles-category-list')
                check('all categories accessible', page.get_by_role('listbox').get_by_role('group').count() == 11)
                page.keyboard.press('Escape')
            settings.get_by_role('button', name='取消', exact=True).click()
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
        check('advanced content bottom reachable', page.locator('.director-inspector-scroll').evaluate('e=>e.scrollTop+e.clientHeight>=e.scrollHeight-2'))
        capture('desktop-advanced-bottom')
        for _ in range(16):
            page.keyboard.press('Tab')
            check('focus trapped in drawer', page.evaluate('!!document.activeElement?.closest(".vox-advanced-drawer")'))
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog', name='镜头高级设置')).to_be_hidden()
        check('focus returns to advanced trigger', page.evaluate('document.activeElement?.textContent?.trim()==="高级设置"'))
        advanced()
        page.get_by_role('tab', name='创意动画', exact=True).click()
        page.locator('.vox-preview[data-vox-ready="true"]').wait_for(timeout=30000)
        page.get_by_text('模板复用与镜头导出', exact=True).click()
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
        start = settings.get_by_role('button', name='按此风格创作全片', exact=True)
        settings.get_by_role('combobox', name='素材流程', exact=True).select_option('data-map')
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
        settings.get_by_role('combobox', name='素材流程', exact=True).select_option('archival-story')
        expect(start).to_be_disabled()
        settings.get_by_role('button', name='添加档案引用', exact=True).click()
        expect(start).to_be_disabled()
        check('archive preset blocks missing provenance', True)
        settings.get_by_role('textbox', name='资料出处', exact=True).fill('QA 离线参考图，仅用于界面验收')
        settings.get_by_role('textbox', name='许可或使用说明', exact=True).fill('不用于真实成片或发布')
        expect(start).to_be_enabled()
        check('archive preset accepts imported reference and provenance', True)
        settings.get_by_role('combobox', name='素材流程', exact=True).select_option('paper-explainer')
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
                    expect(page.get_by_role('button', name='按此风格创作全片', exact=True)).to_be_in_viewport()
                    style_options()
                    page.get_by_role('button', name='详细预览视觉风格', exact=True).click()
                    capture(name + '-' + theme + '-sample-dialog')
                    sample_dialog = page.get_by_role('dialog').filter(has=page.locator('.creative-style-film'))
                    check(name + '-' + theme + ' sample preview fits viewport', sample_dialog.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}'))
                    page.keyboard.press('Escape')
                    check(name + '-' + theme + ' no nested advanced setup', page.get_by_role('button', name='高级：风格、创作方式与镜头锁定', exact=True).count() == 0)
                    dialog = page.get_by_role('dialog', name='自动制作设置', exact=True)
                    check(name + '-' + theme + ' advanced dialog fits viewport', dialog.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}'))
                    check(name + '-' + theme + ' production actions share one row', dialog.locator('.fui-DialogActions > button').evaluate_all('es=>es.every(e=>Math.abs(e.getBoundingClientRect().top-es[0].getBoundingClientRect().top)<1)'))
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
        page.get_by_role('button', name='自动制作…', exact=True).click()
        page.get_by_role('button', name='详细预览视觉风格', exact=True).click()
        zoom_sample = page.get_by_role('dialog').filter(has=page.locator('.creative-style-film'))
        capture('desktop-200-percent-sample')
        check('200 percent sample fits viewport', zoom_sample.evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1}'))
        expect(zoom_sample.get_by_role('button', name='关闭', exact=True)).to_be_in_viewport()
        page.keyboard.press('Escape')
        page.get_by_role('button', name='取消', exact=True).click()
        page.evaluate('window.qaProcessZoom(1)')
        page.goto(url + '/?theme=dark')
        page.wait_for_selector('.director-desk')
        fixture()
        page.get_by_role('button', name='新建 创意动画项目', exact=True).click()
        page.wait_for_selector('[data-director-create-wizard]')
        page.get_by_role('textbox', name='项目标题', exact=True).fill('创意动画参数验收')
        page.get_by_role('textbox', name='原始文案', exact=True).fill('城市道路吸收阳光。树荫帮助街道降温。')
        page.get_by_role('button', name='下一步', exact=True).click()
        expect(page.get_by_role('combobox', name='制作方式', exact=True)).to_have_value('ai-code')
        style_options()
        choose_style('暗色科技发布')
        page.get_by_role('button', name='详细预览视觉风格', exact=True).click()
        expect(page.get_by_role('dialog', name='暗色科技发布 · 效果预览', exact=True)).to_be_visible()
        capture('creation-style-film-preview')
        page.keyboard.press('Escape')
        check('creation sample closes to wizard', page.locator('[data-director-create-wizard]').is_visible())
        loaded_cover(page.locator('[data-director-create-wizard] .sd-preview-select-selected img'))
        check('creation has decoded selected local cover', True)
        page.get_by_role('textbox', name='动画创作要求', exact=True).fill('大字和留白，观点逐个出现。')
        capture('creation-animation-settings')
        page.set_viewport_size({'width':1040, 'height':720})
        capture('creation-animation-settings-compact')
        expect(page.get_by_role('button', name='下一步', exact=True)).to_be_in_viewport()
        check('compact creation no horizontal overflow', report['states']['creation-animation-settings-compact']['bodyOverflow'] <= 0)
        expect(page.get_by_text('生成服务与素材一致性', exact=True)).to_have_count(0)
        check('native authoring uses the project model settings', True)
        page.get_by_role('combobox', name='制作方式', exact=True).select_option('template')
        page.get_by_text('生成服务与素材一致性', exact=True).click()
        expect(page.get_by_text('项目生图模型：', exact=False)).to_be_visible()
        expect(page.get_by_role('checkbox', name='锁定跨镜头 Seed 与风格参考', exact=True)).to_be_visible()
        capture('creation-generation-services-compact')
        expect(page.get_by_role('button', name='下一步', exact=True)).to_be_in_viewport()
        check('compact creation expanded settings no horizontal overflow', report['states']['creation-generation-services-compact']['bodyOverflow'] <= 0)
        page.get_by_role('combobox', name='制作方式', exact=True).select_option('ai-code')
        choose_style('暗色科技发布')
        expect(page.get_by_role('textbox', name='动画创作要求', exact=True)).to_have_value('大字和留白，观点逐个出现。')
        page.set_viewport_size({'width':1536, 'height':1024})
        page.get_by_role('button', name='下一步', exact=True).click()
        page.get_by_role('checkbox', name='自动生成旁白与字幕', exact=True).uncheck()
        page.get_by_role('combobox', name='整片背景音乐', exact=True).select_option('qa-music')
        creation_audio = page.locator('[data-project-music] audio')
        creation_audio.evaluate('e=>e.play()')
        page.wait_for_function('document.querySelector("[data-project-music] audio")?.currentTime > .1')
        creation_audio.evaluate('e=>e.pause()')
        capture('creation-music-preview')
        page.get_by_role('button', name='创建 创意动画项目', exact=True).click()
        page.wait_for_selector('.director-desk')
        check('creation settings persisted', page.evaluate('''()=>{const d=window.editorialDualChainQA.snapshot().document;return d.productionSettings.authoring.styleId==='dark-keynote'&&d.productionSettings.authoring.brief==='大字和留白，观点逐个出现。'&&d.productionSettings.narration===false}''') )
        check('creation music persists into mix', page.evaluate('()=>{const d=window.editorialDualChainQA.snapshot().document;return d.productionSettings.music.id==="qa-music"&&d.timeline.audioClips.some(c=>c.trackType==="music")}'))
        if os.environ.get('QA_LEMO_LIVE') == '1':
            page.evaluate('window.qaMedia("live")')
            page.get_by_role('button', name='自动制作…', exact=True).click()
            for label in ['复古半调案卷','档案灯台','数据叙事','瑞士动态排版','暗色科技发布','纸片立体书']:
                choose_style(label)
                page.get_by_role('button', name='详细预览视觉风格', exact=True).click()
                live_film = page.locator('.creative-style-player video')
                live_film.evaluate('e=>{e.muted=true;void e.play()}')
                page.wait_for_function('document.querySelector(".creative-style-player video")?.currentTime > .1', timeout=45000)
                check('official live stream plays ' + label, live_film.evaluate('e=>e.videoWidth>0&&e.duration>10'))
                live_film.evaluate('e=>e.pause()')
                live_film.evaluate('e=>{e.currentTime=5}')
                page.wait_for_function('(()=>{const e=document.querySelector(".creative-style-player video");return e&&e.currentTime>=5&&!e.seeking&&e.readyState>=2})()', timeout=45000)
                report.setdefault('officialSamples', []).append(live_film.evaluate('e=>({src:e.currentSrc,width:e.videoWidth,height:e.videoHeight,duration:e.duration,currentTime:e.currentTime})'))
                capture('live-sample-' + live_film.get_attribute('src').rsplit('/',1)[1].replace('.mp4',''))
                page.keyboard.press('Escape')
            page.get_by_role('button', name='取消', exact=True).click()
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
    report['electronExitCode'] = process.poll()
    process.terminate()
    electron_log.close()
    server.shutdown()
print(json.dumps({'status':report['status'], 'checks':len(report['checks']), 'screenshots':report['screenshots'], 'error':report.get('error')}, ensure_ascii=False))
if report['status'] != 'passed':
    raise SystemExit(1)

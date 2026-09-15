from pathlib import Path
import functools,http.server,json,threading,subprocess,math,wave,struct,os
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/vox-animation-qa';OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',54)
for name,bg,text in [('cover','#315b4e','知识的力量'),('page','#eee8dc','观察 · 理解 · 行动'),('cutout',None,'思想')]:
    im=Image.new('RGBA',(600,800),bg or (0,0,0,0));d=ImageDraw.Draw(im)
    if name=='cutout': d.ellipse((40,80,560,720),fill='#c7513b')
    else: d.rectangle((35,35,565,765),outline='#c09b5c',width=5)
    d.text((70,270),text,font=font,fill='white' if name!='page' else '#242820');im.save(OUT/f'{name}.png')
with wave.open(str(OUT/'audio.wav'),'w') as w:
    w.setparams((1,2,24000,0,'NONE','not compressed'));w.writeframes(b''.join(struct.pack('<h',int(9000*math.sin(2*math.pi*(220+80*math.sin(i/5000))*i/24000))) for i in range(96000)))
subprocess.run(['I:/nodejs/node.exe','node_modules/tsx/dist/cli.mjs','scripts/qa-vox-animation.ts'],cwd=ROOT,check=True)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(OUT)));threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
report={'templates':[],'ui':[],'errors':[]}
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page=browser.new_page(viewport={'width':960,'height':540});page.on('pageerror',lambda e:report['errors'].append(str(e)))
        page.on('console',lambda msg:report['errors'].append(msg.text[:1000]) if msg.type=='error' else None)
        page.goto(base+'/?catalog');page.wait_for_function('window.voxQA')
        for ratio,w,h in ([] if os.environ.get('VOX_QA_UI_ONLY') else [('16:9',960,540),('9:16',540,960)]):
            page.set_viewport_size({'width':w,'height':h})
            for id in page.evaluate('voxQA.ids'):
                page.evaluate('([id,ratio])=>voxQA.set(id,ratio)',[id,ratio])
                page.wait_for_timeout(250)
                try: expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                except Exception:
                    report['failure']={'template':id,'text':page.locator('body').inner_text()};page.screenshot(path=str(OUT/'failure.png'));raise
                page.wait_for_timeout(150)
                page.screenshot(path=str(OUT/f'{id}-{w}.png'))
                report['templates'].append(f'{id} {ratio}')
        page.evaluate('voxQA.code()');page.wait_for_timeout(250);expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=20000)
        page.screenshot(path=str(OUT/'code-preview.png'))
        for w,h in [(1536,1024),(1040,720)]:
            page.set_viewport_size({'width':w,'height':h});page.goto(base);page.wait_for_function('window.voxQA')
            toggle=page.get_by_role('button',name='显示镜头检查器',exact=True)
            if toggle.is_visible():toggle.click()
            expect(page.get_by_role('tab',name='动画模板',exact=True)).to_be_visible()
            expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=20000)
            slider=page.get_by_role('slider',name='播放进度');slider.focus();slider.press('End');slider.press('ArrowLeft');page.wait_for_timeout(200)
            page.screenshot(path=str(OUT/f'workspace-{w}.png'))
            page.get_by_role('button',name='选择模板 · 书籍登场',exact=True).click()
            page.get_by_role('textbox',name='搜索模板',exact=True).fill('趋势')
            page.get_by_role('button',name='趋势线 沿数据点绘制趋势').click()
            page.get_by_role('textbox',name='动画标题',exact=True).fill('可以编辑的中文标题')
            expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=20000)
            page.get_by_role('textbox',name='保存为我的模板',exact=True).fill('我的趋势模板')
            page.get_by_role('button',name='保存模板',exact=True).click()
            expect(page.get_by_text('已保存到我的模板',exact=True)).to_be_visible()
            page.get_by_role('button',name='导出此镜头',exact=True).click()
            expect(page.get_by_text('镜头已导出，已打开所在文件夹',exact=True)).to_be_visible()
            page.get_by_role('tab',name='AI 生成动画',exact=True).click()
            page.get_by_role('textbox',name='描述动画或继续修改').fill('标题从右侧进入')
            page.get_by_role('button',name='生成动画',exact=True).click()
            expect(page.get_by_text('动画代码已生成，可继续描述修改或保存为个人模板',exact=True)).to_be_visible(timeout=10000)
            expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=20000)
            source=page.evaluate('voxQA.snapshot().animation.code.source')
            page.get_by_role('button',name='查看代码',exact=True).click()
            code=page.get_by_role('textbox',name='动画 TSX 代码',exact=True);code.fill('export default function( {')
            page.get_by_role('button',name='检查代码并预览',exact=True).click()
            expect(page.get_by_text('Error: 测试代码语法错误',exact=True)).to_be_visible()
            expect(page.get_by_role('button',name='保存模板',exact=True)).to_be_disabled()
            code.fill(source);page.get_by_role('button',name='检查代码并预览',exact=True).click()
            expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=20000)
            page.get_by_role('tab',name='动画模板',exact=True).click()
            assert page.get_by_role('textbox',name='动画标题',exact=True).input_value()=='可以编辑的中文标题'
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(OUT/f'workspace-edited-{w}.png'));report['ui'].append(f'{w}: template search, parameter edit, personal save, AI fixture, draft switch')
        browser.close()
finally:
    server.shutdown();(OUT/('browser-ui-final-report.json' if os.environ.get('VOX_QA_UI_ONLY') else 'browser-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'templates':len(report['templates']),'ui':report['ui'],'errors':report['errors']},ensure_ascii=False))

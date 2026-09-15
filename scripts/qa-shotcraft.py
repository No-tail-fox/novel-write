"""Local current-runtime visual/behavior QA. No providers, browser profile, or projects are used."""
from pathlib import Path
import functools
import hashlib
import http.server
import json
import os
import io
import sys
import subprocess
import threading
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/shotcraft-qa'
OUT.mkdir(parents=True, exist_ok=True)
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 42)
SMALL = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
if '--media-only' in sys.argv:
    import imageio_ffmpeg
    video=OUT/'shotcraft-integration.mp4'
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    decoded=subprocess.run([ffmpeg,'-hide_banner','-v','error','-i',str(video),'-progress','pipe:1','-nostats','-f','null','-'],capture_output=True,text=True,timeout=120)
    assert decoded.returncode==0,decoded.stderr
    decoded_frames=max(int(line.split('=',1)[1]) for line in decoded.stdout.splitlines() if line.startswith('frame='))
    assert decoded_frames==624,f'Expected 26 seconds at 24 fps; got {decoded_frames} decoded frames'
    fixture=json.loads((OUT/'fixture.json').read_text(encoding='utf-8'))
    render_evidence=json.loads((OUT/'render-report.json').read_text(encoding='utf-8'))
    ids=fixture['ids']+['legacy-text-opening']
    sheet=Image.new('RGB',(1020,235*7),'#202124')
    draw=ImageDraw.Draw(sheet)
    for row,id in enumerate(ids):
        for column,second in enumerate([.4,1.8,3.8] if row<6 else [.15,.9,1.8]):
            timestamp=row*4+second
            destination=OUT/f'render-{id}-{column}.png'
            subprocess.run([ffmpeg,'-hide_banner','-v','error','-ss',str(timestamp),'-i',str(video),'-frames:v','1','-y',str(destination)],check=True,timeout=30)
            with Image.open(destination) as frame:
                frame.thumbnail((340,191));sheet.paste(frame,(column*340,row*235+44))
            draw.text((column*340+6,row*235+3),id.replace('shotcraft-',''),font=SMALL,fill='white')
            draw.text((column*340+6,row*235+22),f'{timestamp:g}s in exported MP4',font=SMALL,fill='#c9ccd1')
    sheet.save(OUT/'render-contact.jpg',quality=94)
    evidence={'status':'passed','decodedFrames':decoded_frames,'expectedFrames':624,'durationMs':26000,'shots':7,'frameRate':24,'runtimeSha256':render_evidence.get('runtimeSha256'),'externalCalls':0,'decodeStderr':decoded.stderr}
    (OUT/'media-report.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    print(json.dumps(evidence))
    sys.exit(0)
for name, color, title in [('cover', '#315b4e', '观察与理解'), ('page', '#eee8dc', '记录真实的变化'), ('replacement', '#48409c', '这是替换后的图片')]:
    image = Image.new('RGB', (600, 800), color)
    draw = ImageDraw.Draw(image)
    draw.rectangle((30, 30, 570, 770), outline='#c09b5c', width=5)
    draw.text((55, 235), title, font=FONT, fill='#242820' if name == 'page' else '#ffffff')
    draw.ellipse((180, 390, 420, 630), outline='#c7513b', width=25)
    image.save(OUT / f'{name}.png')

node = os.environ.get('STORYDREAM_NODE', 'I:/nodejs/node.exe')
subprocess.run([node, 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-shotcraft.ts'], cwd=ROOT, check=True, timeout=90)
fixture = json.loads((OUT / 'fixture.json').read_text(encoding='utf-8'))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'status':'running', 'runtimeSha256':fixture['runtimeSha256'], 'frames':[], 'ui':[], 'errors':[], 'externalRequests':[], 'limitations':['The editor host persists fixture data to isolated browser localStorage; this does not exercise application database IPC.', 'Production export uses 24 fps; the direct production runtime is additionally checked at 30 fps.']}
report['seekComparison']='Exact frame DOM/styles and maximum RGB channel delta <=2/255; Chromium raster-cache rounding is recorded separately.'
report_name='browser-ui-report.json' if os.environ.get('SHOTCRAFT_QA_UI_ONLY') else 'browser-report.json'
(OUT/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
phases = [0, .25, .5, 1.5, 2.5, 3.75]

def viewport(ratio):
    return {'16:9':(960, 540), '9:16':(540, 960), '1:1':(720, 720), '4:3':(960, 720)}[ratio]

def mean_difference(a, b):
    return sum(ImageStat.Stat(ImageChops.difference(a.convert('RGB'), b.convert('RGB'))).mean) / 3

def contact_sheets():
    for ratio in ['16:9','9:16','1:1','4:3']:
        for fps in [24,30]:
            rows = [row for row in report['frames'] if row['ratio']==ratio and row['fps']==fps]
            if not rows:
                continue
            cell_w = 280 if ratio!='9:16' else 180
            vw, vh = viewport(ratio)
            cell_h = round(cell_w*vh/vw)+44
            sheet = Image.new('RGB',(cell_w*len(phases),cell_h*len(rows)), '#202124')
            draw = ImageDraw.Draw(sheet)
            for y, row in enumerate(rows):
                for x, second in enumerate(phases):
                    path=OUT / row['screenshots'][x]
                    with Image.open(path) as source:
                        source.thumbnail((cell_w,cell_h-44))
                        sheet.paste(source,(x*cell_w,y*cell_h+44))
                    draw.text((x*cell_w+6,y*cell_h+3),row['id'].replace('shotcraft-',''),font=SMALL,fill='white')
                    draw.text((x*cell_w+6,y*cell_h+22),f'{second:g}s · {fps} fps',font=SMALL,fill='#c9ccd1')
            sheet.save(OUT/f'contact-{ratio.replace(":","x")}-{fps}.jpg',quality=92)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        context = browser.new_context(viewport={'width':960,'height':540}, reduced_motion='reduce')
        def route_request(route):
            url=route.request.url
            if url.startswith(base) or url.startswith(('data:','blob:','about:')):
                route.continue_()
            else:
                report['externalRequests'].append(url)
                route.abort()
        context.route('**/*',route_request)
        page=context.new_page()
        page.on('pageerror',lambda error:report['errors'].append(str(error)))
        if not os.environ.get('SHOTCRAFT_QA_UI_ONLY'):
            for case in fixture['cases']:
                if os.environ.get('SHOTCRAFT_QA_CASE') and os.environ['SHOTCRAFT_QA_CASE'] not in case['name']:
                    continue
                w,h=viewport(case['ratio'])
                page.set_viewport_size({'width':w,'height':h})
                page.goto(f'{base}/frames/{case["name"]}.html')
                page.wait_for_function('window.__ready === true || window.__htmlVideoMediaError', timeout=25000)
                assert not page.evaluate('window.__htmlVideoMediaError'), case['name']
                row={key:case[key] for key in ['name','id','ratio','fps']}
                row['screenshots']=[]
                hashes=[]
                for i, second in enumerate(phases):
                    page.evaluate('(second)=>window.__tl.seek(second)',second)
                    filename=f'{case["name"]}-phase-{i}.png'
                    png=page.screenshot(path=str(OUT/filename))
                    hashes.append(hashlib.sha256(png).hexdigest())
                    row['screenshots'].append(filename)
                page.evaluate('()=>window.__tl.seek(1.5)')
                original_state=page.locator('.frame').inner_html()
                original=page.screenshot()
                page.evaluate('()=>window.__tl.seek(.25)')
                page.evaluate('()=>window.__tl.seek(1.5)')
                repeated_state=page.locator('.frame').inner_html()
                repeated=page.screenshot()
                difference=ImageChops.difference(Image.open(io.BytesIO(original)).convert('RGB'),Image.open(io.BytesIO(repeated)).convert('RGB'))
                row['seekMaximumChannelDifference']=max(high for low,high in difference.getextrema())
                row['seekMeanPixelDifference']=sum(ImageStat.Stat(difference).mean)/3
                row['sameFrameDomExact']=original_state==repeated_state
                row['sameFramePixelsExact']=original==repeated
                # Chromium raster caches can round a filtered glyph channel by two
                # intensity level after reverse seeking. Geometry/text/styles must
                # still match exactly; any larger pixel change is a failure.
                row['deterministic']=row['sameFrameDomExact'] and row['seekMaximumChannelDifference']<=2
                if not row['deterministic']:
                    (OUT/f'{case["name"]}-seek-original.png').write_bytes(original)
                    (OUT/f'{case["name"]}-seek-repeated.png').write_bytes(repeated)
                    report['determinismFailure']=row
                assert row['deterministic'], f'Non-deterministic repeated seek: {case["name"]}'
                row['uniqueFrames']=len(set(hashes))
                assert row['uniqueFrames']>=3, f'No meaningful motion: {case["name"]}'
                with Image.open(OUT/row['screenshots'][1]) as early, Image.open(OUT/row['screenshots'][-1]) as late:
                    row['motionMeanPixelDifference']=round(mean_difference(early,late),3)
                row['text']=page.locator('body').inner_text()
                report['frames'].append(row)
                if len(report['frames'])%8==0:
                    (OUT/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            contact_sheets()
        for theme in ['dark','light']:
            for w,h in [(1536,1024),(1040,720)]:
                page.set_viewport_size({'width':w,'height':h})
                page.goto(f'{base}/?theme={theme}')
                page.wait_for_function('window.shotcraftQA')
                page.evaluate('shotcraftQA.reset()')
                toggle=page.get_by_role('button',name='显示镜头检查器',exact=True)
                if toggle.is_visible():
                    toggle.click()
                expect(page.get_by_role('tab',name='动画模板',exact=True)).to_be_visible()
                expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                for template in page.evaluate('shotcraftQA.templates'):
                    page.get_by_role('button',name='选择模板 · ',exact=False).click()
                    page.get_by_role('textbox',name='搜索模板',exact=True).fill(template['name'])
                    page.get_by_role('group',name='可用动画模板').get_by_role('button').filter(has_text=template['name']).click()
                    expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                    assert page.evaluate('shotcraftQA.snapshot().animation.template.id')==template['id']
                custom=f'自定义中文标题 · {theme} · 保留草稿'
                page.get_by_role('textbox',name='动画标题',exact=True).fill(custom)
                page.get_by_role('textbox',name='正文 / 补充说明',exact=True).fill('切换模板后保留中文、条目和本地图片。')
                page.get_by_role('combobox',name='图片 1',exact=True).select_option('replacement')
                expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                edited=page.evaluate('shotcraftQA.snapshot().animation.template.props')
                first=page.evaluate('shotcraftQA.templates[0]')
                page.get_by_role('button',name='选择模板 · ',exact=False).click()
                page.get_by_role('textbox',name='搜索模板',exact=True).fill(first['name'])
                page.get_by_role('group',name='可用动画模板').get_by_role('button').filter(has_text=first['name']).click()
                assert page.evaluate('shotcraftQA.snapshot().animation.template.props')==edited
                page.get_by_role('tab',name='AI 生成动画',exact=True).click()
                page.get_by_role('textbox',name='描述动画或继续修改').fill('仅本地草稿，不提交生成')
                page.get_by_role('tab',name='动画模板',exact=True).click()
                assert page.get_by_role('textbox',name='动画标题',exact=True).input_value()==custom
                expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                page.get_by_role('textbox',name='保存为我的模板',exact=True).fill(f'中文镜头 {theme} {w}')
                page.get_by_role('button',name='保存模板',exact=True).click()
                expect(page.get_by_text('已保存到我的模板',exact=True)).to_be_visible()
                page.get_by_role('button',name='保存版本',exact=True).first.click()
                saved=page.evaluate('shotcraftQA.saved()')
                assert saved['animation']['template']['props']==edited
                page.reload()
                page.wait_for_function('window.shotcraftQA')
                assert page.evaluate('shotcraftQA.snapshot()')==saved
                expect(page.locator('[data-vox-ready="true"]')).to_have_count(1,timeout=25000)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'Horizontal overflow {theme} {w}'
                assert page.evaluate('shotcraftQA.forbiddenCalls()')==0
                slider=page.get_by_role('slider',name='播放进度',exact=True)
                slider.focus();slider.press('End');slider.press('ArrowLeft')
                page.wait_for_timeout(200)
                page.screenshot(path=str(OUT/f'workspace-{theme}-{w}.png'))
                report['ui'].append({'theme':theme,'width':w,'height':h,'templatesSelected':len(fixture['ids']),'chineseText':True,'assetReplacement':True,'templateSwitchPreservesProps':True,'modeSwitchPreservesDraft':True,'personalTemplateSave':True,'projectSaveReopen':True,'horizontalOverflow':False})
        assert not report['errors'], report['errors']
        assert not report['externalRequests'], report['externalRequests']
        browser.close()
    report['status']='passed'
except Exception as error:
    report['status']='failed'
    report['failure']=str(error)
    try:
        page.screenshot(path=str(OUT/'failure.png'))
        report['failureText']=page.locator('body').inner_text()[:12000]
    except Exception:
        pass
    raise
finally:
    server.shutdown()
    (OUT/report_name).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'cases':len(report['frames']),'frames':sum(len(r['screenshots']) for r in report['frames']),'ui':len(report['ui']),'externalRequests':len(report['externalRequests'])},ensure_ascii=False))

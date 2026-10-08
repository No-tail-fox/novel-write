"""Validate option previews and visible generation commands on the actual workspace."""
from pathlib import Path
import functools, http.server, json, subprocess, threading
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/vox-workspace-previews'
OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['I:/nodejs/node.exe','--input-type=module','-e',"import {build} from 'vite';await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/vox-workspace-previews.harness.tsx',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",str(OUT)],cwd=ROOT,check=True,capture_output=True)
(OUT/'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>',encoding='utf-8')
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(OUT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
report={'checks':[],'errors':[]}
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page=browser.new_page()
        page.on('pageerror',lambda error:report['errors'].append(str(error)))
        for theme in ['dark','light']:
            for width,height in [(1536,1024),(1040,720)]:
                page.set_viewport_size({'width':width,'height':height});page.goto(base+'/?theme='+theme)
                page.wait_for_function('window.workspacePreviewQA')
                for label in ['批量生成','合成整片','生成此镜头素材','生成此镜头旁白']:
                    button=page.get_by_role('button',name=label,exact=True)
                    expect(button).to_be_visible()
                    assert button.evaluate('(e)=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight}')
                page.get_by_role('button',name='批量生成',exact=True).click()
                dialog=page.get_by_role('dialog',name='批量生成计划',exact=True);expect(dialog).to_be_visible()
                assert page.evaluate('workspacePreviewQA.calls')==[]
                dialog.get_by_role('button',name='取消',exact=True).click()
                toggle=page.get_by_role('button',name='显示镜头检查器',exact=True)
                if toggle.is_visible() and toggle.get_attribute('aria-expanded')=='false':toggle.click()
                for label,option in [('叙事动作','路径推进'),('版式模板','纪录片 · 纯画面'),('相机运动','轻微视差')]:
                    field=page.get_by_label(label,exact=True);field.click()
                    page.get_by_role('option',name=option,exact=True).hover()
                    tip=page.get_by_role('tooltip');expect(tip).to_be_visible();expect(tip).to_contain_text(option)
                    expect(tip.locator('iframe')).to_have_count(1)
                    frame=tip.locator('iframe').content_frame
                    frame.locator('.scene-layer').first.wait_for()
                    frame.locator('.scene-layer').first.evaluate('(e)=>e.decode ? e.decode() : Promise.resolve()')
                    page.wait_for_timeout(200)
                    page.screenshot(path=str(OUT/f'{label}-{theme}-{width}.png'))
                    page.keyboard.press('Escape');page.keyboard.press('Escape')
                    assert page.evaluate('workspacePreviewQA.snapshot().shots[0].motionStyle')=='cutout-slide'
                page.get_by_role('button',name='详细预览版式模板',exact=True).click()
                detail=page.get_by_role('dialog',name='对比拼贴 · 纸张撕裂 · 效果预览',exact=True);expect(detail).to_be_visible()
                detail.get_by_role('button',name='关闭',exact=True).click()
                page.get_by_text('图像风格 · 悬停可看样张',exact=True).click()
                for label in ['档案红黑','瑞士信号','博物馆纸本']:
                    page.locator('.director-style-candidate-select').filter(has_text=label).hover()
                    tip=page.get_by_role('tooltip');expect(tip).to_be_visible()
                    expect(tip).to_contain_text(label)
                    tip.locator('img').evaluate('(e)=>e.decode()')
                    assert tip.locator('img').evaluate('e=>e.naturalWidth')==768
                    assert page.evaluate('workspacePreviewQA.snapshot().style')=='archival-red'
                page.screenshot(path=str(OUT/f'style-{theme}-{width}.png'))
                page.mouse.move(10,10);page.wait_for_timeout(140)
                expect(page.get_by_role('tooltip')).to_have_count(0)
                page.get_by_role('button',name='放大预览瑞士信号',exact=True).click()
                detail=page.get_by_role('dialog',name='瑞士信号 · 风格示例',exact=True);expect(detail).to_be_visible()
                detail.get_by_role('button',name='关闭',exact=True).click()
                assert page.evaluate('workspacePreviewQA.calls')==[]
                page.get_by_role('button',name='生成此镜头素材',exact=True).click()
                page.wait_for_function('workspacePreviewQA.calls.length===1')
                assert page.evaluate('workspacePreviewQA.calls')==['image:shot-1']
                left=page.get_by_role('button',name='显示项目与镜头',exact=True)
                if left.is_visible() and left.get_attribute('aria-expanded')=='false':left.click()
                page.locator('.director-shot-row').filter(has_text='旧物怎样连接今天').click()
                if left.is_visible() and left.get_attribute('aria-expanded')=='true':left.click()
                transition=page.get_by_role('combobox',name='入场转场',exact=True)
                expect(transition).to_be_enabled();transition.click()
                page.get_by_role('option',name='短叠化',exact=True).hover()
                tip=page.get_by_role('tooltip');expect(tip).to_be_visible()
                expect(tip.locator('[data-preview-kind="transition"]')).to_have_count(1)
                assert tip.locator('.director-transition-scene--after').evaluate('e=>getComputedStyle(e).animationDuration')=='4s'
                assert page.evaluate('workspacePreviewQA.snapshot().shots[1].transitionIn') is None
                page.get_by_role('option',name='直接切换',exact=True).click()
                assert page.evaluate('workspacePreviewQA.snapshot().shots[1].transitionIn')=={'type':'cut','durationMs':0}
                transition.click();page.get_by_role('option',name='短叠化',exact=True).click()
                assert page.evaluate('workspacePreviewQA.snapshot().shots[1].transitionIn')=={'type':'dissolve','durationMs':200}
                page.get_by_role('button',name='详细预览入场转场',exact=True).click()
                detail=page.get_by_role('dialog',name='短叠化 · 效果预览',exact=True);expect(detail).to_be_visible()
                detail.get_by_role('button',name='关闭',exact=True).click()
                page.get_by_role('button',name='生成此镜头旁白',exact=True).click()
                page.wait_for_function('workspacePreviewQA.calls.length===2')
                assert page.evaluate('workspacePreviewQA.calls')==['image:shot-1','voice:shot-2']
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.screenshot(path=str(OUT/f'workspace-{theme}-{width}.png'))
                report['checks'].append(f'{theme} {width}: visible generation, plan isolation, motion/layout/camera/transition hover, style cache, detail, correct shot dispatch')
        browser.close()
    assert not report['errors'],report['errors']
    report['passed']=True
finally:
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    server.shutdown()
print(json.dumps(report,ensure_ascii=False))

"""Offline scene workspace selection, draft guard and desktop layout QA."""
import functools, http.server, json, os, subprocess, threading
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'artifacts/motion-comic-scenes-workspace'

def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run(['I:/nodejs/node.exe', '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,logLevel:'warn',define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-scenes-workspace.harness.tsx',name:'scenesWorkspaceQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUTPUT)], cwd=ROOT, env=env, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>', encoding='utf-8')
    from PIL import Image, ImageDraw
    fixture = Image.new('RGB', (640, 360), '#17333d')
    draw = ImageDraw.Draw(fixture)
    draw.rectangle((80, 60, 130, 330), fill='#365c67')
    draw.rectangle((490, 40, 550, 330), fill='#365c67')
    draw.ellipse((265, 220, 375, 290), fill='#e6c88a')
    fixture.save(OUTPUT / 'qa-frame.png')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'checks': [], 'failures': [], 'runtimeErrors': [], 'screenshots': [], 'layout': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe', env=env)
            for width, height in [(1536, 960), (1040, 720)]:
                page = browser.new_page(viewport={'width': width, 'height': height})
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                try:
                    page.goto(f'http://127.0.0.1:{server.server_port}/')
                    directory = page.get_by_role('navigation', name='本集幕与场次目录')
                    expect(directory).to_be_visible()
                    expect(page.get_by_role('region', name='当前场次编辑')).to_have_count(1)
                    expect(directory.locator('button')).to_have_count(9)
                    directory.locator('button').nth(4).click()
                    expect(page.locator('.comic-scenes-detail__heading h2')).to_have_text('场次 5 · 雨夜线索场次 5')
                    expect(page.locator('.comic-scenes-detail')).to_have_count(1)
                    expect(directory.locator('button[aria-pressed="true"]')).to_have_count(1)
                    report['checks'].append(f'{width}: selection updates the single scene editor')
                    page.locator('.comic-scene-shot').first.get_by_role('button').click()
                    page.get_by_label('镜头标题', exact=True).fill('本地镜头草稿')
                    expect(directory.locator('button').first).to_be_disabled()
                    expect(page.get_by_label('当前分集', exact=True)).to_be_disabled()
                    expect(page.get_by_role('button', name='返回本集剧本', exact=True)).to_be_disabled()
                    page.get_by_role('button', name='测试外部切换', exact=True).click()
                    expect(page.locator('output')).to_have_text('切换已阻止')
                    expect(page.get_by_role('alert')).to_contain_text('镜头仍在编辑')
                    expect(page.get_by_label('镜头标题', exact=True)).to_have_value('本地镜头草稿')
                    report['checks'].append(f'{width}: pending shot draft blocks scene, episode and external navigation')
                    page.get_by_role('button', name='取消', exact=True).click()
                    directory.locator('button').first.click()
                    expect(page.locator('.comic-scenes-detail__heading h2')).to_have_text('场次 1 · 雨夜线索场次 1')
                    page.get_by_role('button', name='编辑场次信息', exact=True).click()
                    expect(page.get_by_label('场次标题', exact=True)).to_have_value('雨夜线索场次 1')
                    page.get_by_role('button', name='完成编辑', exact=True).click()
                    if width == 1040:
                        page.get_by_role('button', name='场次引用', exact=True).click()
                        expect(page.get_by_role('complementary', name='当前场次引用')).to_be_visible()
                        page.get_by_role('button', name='收起引用', exact=True).click()
                    else:
                        expect(page.get_by_role('complementary', name='当前场次引用')).to_be_visible()
                    report['checks'].append(f'{width}: collapsible metadata and contextual references work')
                    layout = page.evaluate('''() => { const e=document.querySelector('.comic-scenes-detail'); return {width:innerWidth, scrollWidth:document.documentElement.scrollWidth, detailScrollWidth:e.scrollWidth, detailClientWidth:e.clientWidth, editors:document.querySelectorAll('.comic-scenes-detail').length}; }''')
                    report['layout'].append(layout)
                    assert layout['scrollWidth'] <= width, layout
                    assert layout['detailScrollWidth'] <= layout['detailClientWidth'] + 1, layout
                    report['checks'].append(f'{width}: no document or scene detail horizontal overflow')
                    page.wait_for_timeout(350)
                    diagnostics = page.evaluate('''() => {
                      const rules=[]; const visit = list => { for(const r of list) { if(r.selectorText) rules.push(r); if(r.cssRules) visit(r.cssRules); } }; for(const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
                      const inspect = e => { const s=getComputedStyle(e), b=e.getBoundingClientRect(); return {text:e.textContent, pressed:e.getAttribute('aria-pressed'), className:e.className, disabled:e.disabled, background:s.backgroundColor, color:s.color, display:s.display, gridTemplateColumns:s.gridTemplateColumns, gap:s.gap, padding:s.padding, bounds:{x:b.x,y:b.y,width:b.width,height:b.height}, matchingRules:rules.filter(r=>{try{return e.matches(r.selectorText)}catch{return false}}).filter(r=>/background|color|display|grid|gap|padding/.test(r.style.cssText)).map(r=>({selector:r.selectorText,style:r.style.cssText}))}; };
                      const buttons=[...document.querySelectorAll('.comic-scenes-directory button')]; const cb=document.querySelector('.comic-scenes-detail input[type=checkbox]');
                      return {buttons:[inspect(buttons[0]),inspect(buttons[4])], active:document.activeElement?.textContent, checkbox:cb?{input:inspect(cb), parent:inspect(cb.parentElement), label:inspect(cb.parentElement.querySelector('label')), outer:inspect(cb.parentElement.parentElement)}:null};
                    }''')
                    report.setdefault('diagnostics', []).append({'viewport':f'{width}x{height}', **diagnostics})
                    selected, previous = diagnostics['buttons']
                    assert selected['pressed'] == 'true' and previous['pressed'] == 'false', diagnostics['buttons']
                    assert selected['background'] != previous['background'], 'selected button background must differ from the previous scene'
                    report['checks'].append(f'{width}: selected scene highlight follows aria-pressed after style update')
                    path = OUTPUT / f'scenes-workspace-{width}x{height}.png'
                    page.screenshot(path=str(path))
                    report['screenshots'].append(str(path))
                except Exception as error:
                    report['failures'].append({'viewport': f'{width}x{height}', 'error': str(error)})
                    page.screenshot(path=str(OUTPUT / f'failure-{width}x{height}.png'))
                page.goto(f'http://127.0.0.1:{server.server_port}/?images=1')
                expect(page.locator('.comic-scene-shot__thumbnail img').first).to_be_visible()
                page.wait_for_function("document.querySelector('.comic-scene-shot__thumbnail img')?.naturalWidth > 0")
                expect(page.locator('.comic-scenes-directory img').first).to_be_visible()
                report['checks'].append(f'{width}: adopted first frame resolves in shot and directory previews')
                page.screenshot(path=str(OUTPUT / f'scenes-workspace-images-{width}x{height}.png'))
                page.route('**/qa-frame.png', lambda route: route.abort())
                page.reload()
                expect(page.locator('.comic-scene-shot__thumbnail').first).to_contain_text('图片加载失败')
                report['checks'].append(f'{width}: unavailable media shows recoverable image placeholder')
                page.close()
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['failures'] or report['runtimeErrors']: raise SystemExit(1)

if __name__ == '__main__': run()

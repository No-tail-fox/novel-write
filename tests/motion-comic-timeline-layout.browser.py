"""Real AppShell + production workspace + DirectorDesk; local fixture, no paid calls."""
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('STORYDREAM_TIMELINE_QA_OUTPUT', str(ROOT / '.artifacts/timeline-layout')))
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([os.environ.get('STORYDREAM_QA_NODE', 'I:/nodejs/node.exe'), '--input-type=module', '-e', "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-timeline-layout.harness.tsx',name:'timelineLayoutQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});", str(OUT)], cwd=ROOT, check=True)
(OUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'layouts': [], 'interactions': [], 'errors': []}


def drag_clip(page, clip, delta):
    clip.scroll_into_view_if_needed()
    box = clip.bounding_box()
    assert box
    x, y = box['x'] + 20, box['y'] + box['height'] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + delta, y, steps=12)
    page.mouse.up()


def edit_timeline(page, width, height):
    page.goto(f'http://127.0.0.1:{server.server_port}')
    video = page.locator('.director-multitrack-lane--video button').first
    expect(video).to_have_attribute('data-draggable', 'true')
    # At 40px/sec a 330px drag moves the first shot into the next shot's slot.
    drag_clip(page, video, 330)
    page.wait_for_function("window.timelineStateQA.shots[0].id === 'shot-1'")
    page.wait_for_function("window.timelineStateQA.shots[1].id === 'shot-0'")
    page.get_by_role('button', name='更多操作', exact=True).click()
    page.get_by_role('menuitem', name='保存当前版本', exact=True).click()
    page.wait_for_function("window.timelineStateQA.savedShots[0]?.id === 'shot-1' && window.timelineStateQA.savedShots[1]?.id === 'shot-0'")
    # Alt+Left restores order through the real Workspace callback.
    moved = page.locator('.director-multitrack-lane--video button').filter(has_text='本地镜头 1')
    moved.press('Alt+ArrowLeft')
    page.wait_for_function("window.timelineStateQA.shots[0].id === 'shot-0'")
    music = page.locator('.director-multitrack-lane--music button').first
    drag_clip(page, music, 20)
    page.wait_for_function("window.timelineStateQA.shots[0].soundClips.find(c=>c.id==='sound-0-1').startMs === 1500")
    music.press('Alt+ArrowLeft')
    page.wait_for_function("window.timelineStateQA.shots[0].soundClips.find(c=>c.id==='sound-0-1').startMs === 1400")
    page.get_by_role('button', name='向后移动所选片段', exact=True).click()
    page.wait_for_function("window.timelineStateQA.shots[0].soundClips.find(c=>c.id==='sound-0-1').startMs === 1500")
    subtitle = page.locator('.director-multitrack-lane--subtitle button').first
    drag_clip(page, subtitle, 40)
    page.wait_for_function("window.timelineStateQA.shots[0].subtitleCues[0].startMs === 1000 && window.timelineStateQA.shots[0].subtitleCues[0].endMs === 5000")
    subtitle.press('Alt+ArrowRight')
    page.wait_for_function("window.timelineStateQA.shots[0].subtitleCues[0].startMs === 1100 && window.timelineStateQA.shots[0].subtitleCues[0].endMs === 5100")
    # Save snapshots are independent state: assertions catch visual-only dragging.
    page.get_by_role('button', name='更多操作', exact=True).click()
    page.get_by_role('menuitem', name='保存当前版本', exact=True).click()
    page.wait_for_function("window.timelineStateQA.savedShots.length === 8")
    saved = page.evaluate('window.timelineStateQA')
    assert [s['id'] for s in saved['savedShots']] == [f'shot-{i}' for i in range(8)]
    assert saved['savedShots'][0]['soundClips'][1]['startMs'] == 1500, saved
    assert saved['savedShots'][0]['subtitleCues'][0]['startMs'] == 1100, saved
    assert saved['savedShots'][0]['subtitleCues'][0]['endMs'] == 5100, saved
    assert len(saved['edits']) == 7, saved
    report['interactions'].append({'size':[width,height], 'edits':saved['edits'], 'savedShotOrder':[s['id'] for s in saved['savedShots']], 'savedMusicStartMs':1500, 'savedSubtitleRangeMs':[1100,5100]})
    page.locator('.director-multitrack-scroll').evaluate('(e)=>{e.scrollTop=0;e.scrollLeft=0}')
    page.screenshot(path=str(OUT/f'interactions-{width}x{height}.png'))


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        for width, height in [(1536,1024),(1040,720)]:
            page = browser.new_page(viewport={'width':width,'height':height})
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}')
            timeline = page.locator('.director-desk-grid > .director-multitrack')
            expect(timeline).to_be_visible()
            metrics = page.evaluate('''() => {
              const box = s => {const e=document.querySelector(s),r=e.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight};};
              return Object.fromEntries(['.sidebar','.window-line','.director-desk-grid','.director-multitrack','.director-preview-surface','.director-multitrack-scroll'].map(s=>[s,box(s)]));
            }''')
            report['layouts'].append({'size':[width,height], 'metrics':metrics})
            grid, track, sidebar = [metrics[s] for s in ['.director-desk-grid','.director-multitrack','.sidebar']]
            assert abs(track['x']-grid['x']) < 2 and abs(track['right']-grid['right']) < 2, metrics
            assert track['x'] >= sidebar['right']-1 and track['bottom'] <= height, metrics
            assert track['bottom'] <= grid['bottom'] + 1, metrics
            assert metrics['.director-preview-surface']['height'] >= 180, metrics
            ruler = page.get_by_role('slider',name='时间线播放位置')
            ruler.focus(); ruler.press('Home'); ruler.press('Shift+ArrowRight')
            expect(ruler).to_have_attribute('aria-valuenow','1000')
            assert page.locator('.director-multitrack-playhead').evaluate('(e)=>e.style.left') == '152px'
            page.get_by_label('时间线缩放',exact=True).select_option('80')
            assert page.locator('.director-multitrack-playhead').evaluate('(e)=>e.style.left') == '192px'
            for lane in ['video','dialogue','music','sfx','subtitle']:
                clip = page.locator(f'.director-multitrack-lane--{lane} button').first
                clip.scroll_into_view_if_needed(); clip.click()
                expect(clip).to_have_attribute('aria-pressed','true')
                expect(timeline).to_be_visible()
            page.locator('.director-multitrack-lane--music button').first.click()
            expect(page.get_by_role('tab',name='声音',exact=True)).to_have_attribute('aria-selected','true')
            expect(page.locator('.director-inspector-pane')).to_be_visible()
            expect(page.locator('[data-sound-clip-id="sound-0-1"]')).to_be_visible()
            page.get_by_role('button', name='定位片段', exact=True).scroll_into_view_if_needed()
            page.get_by_role('button', name='定位片段', exact=True).click()
            expect(ruler).to_have_attribute('aria-valuenow','1000')
            page.locator('.director-inspector-pane').evaluate('(e)=>e.scrollTop=0')
            page.get_by_role('button', name='显示项目与镜头', exact=True).click()
            expect(page.locator('.director-left-pane')).to_be_visible()
            page.get_by_role('button', name='关闭项目与镜头', exact=True).click()
            page.locator('.director-multitrack-scroll').evaluate('(e)=>{e.scrollTop=0;e.scrollLeft=0}')
            page.screenshot(path=str(OUT/f'preview-{width}x{height}.png'))
            edit_timeline(page, width, height)
            page.goto(f'http://127.0.0.1:{server.server_port}/?stage=production')
            expect(page.locator('[data-motion-comic-production-layout]')).to_be_visible()
            assert page.locator('.director-center-pane > .director-multitrack').count() == 0
            assert page.locator('[data-motion-comic-timeline-layout]').count() == 0
            production = page.evaluate('''() => {
              const box = s => { const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,right:r.right,width:r.width}; };
              return {tasks:box('.director-left-pane'),inspector:box('.director-inspector-pane'),preview:box('.director-center-pane'),overflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            assert production['tasks']['right'] <= production['inspector']['x'] + 1, production
            assert production['inspector']['right'] <= production['preview']['x'] + 1, production
            assert not production['overflow'], production
            page.screenshot(path=str(OUT/f'production-{width}x{height}.png'))
            page.goto(f'http://127.0.0.1:{server.server_port}/?stage=storyboard')
            expect(page.get_by_role('region', name='分镜编排工作台')).to_be_visible()
            board = page.evaluate('''() => {
              const box = s => { const r=document.querySelector(s).getBoundingClientRect(); return {x:r.x,right:r.right,bottom:r.bottom,height:r.height}; };
              return {main:box('.comic-storyboard__main'),detail:box('.comic-storyboard__inspector'),footer:box('.comic-storyboard__summary'),overflow:document.documentElement.scrollWidth>innerWidth};
            }''')
            assert board['main']['right'] <= board['detail']['x'] + 1, board
            assert board['footer']['bottom'] <= height, board
            assert not board['overflow'], board
            page.get_by_role('button',name='本地镜头 2',exact=True).click()
            expect(page.get_by_role('textbox',name='镜头标题',exact=True)).to_have_value('本地镜头 2')
            page.screenshot(path=str(OUT/f'storyboard-{width}x{height}.png'))
            page.close()
        browser.close()
    assert not report['errors'], report['errors']
    report['passed'] = True
finally:
    server.shutdown(); server.server_close()
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))

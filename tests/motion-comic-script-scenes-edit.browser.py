"""Focused offline QA for scene shot editing and Page persistence."""
from __future__ import annotations
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / 'artifacts/motion-comic-script-scenes-edit')))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'tests/motion-comic-script-scenes-edit.harness.tsx',name:'scenesEditQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=env, check=True)
    (OUTPUT / 'index.html').write_text(
        '<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script src="harness.js"></script></body></html>',
        encoding='utf-8',
    )
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = {'checks': [], 'runtimeErrors': [], 'external': [], 'screenshots': []}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, env=env, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
            page = browser.new_page()
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            page.route('**/*', lambda route: route.continue_() if '127.0.0.1' in route.request.url else (report['external'].append(route.request.url), route.abort()))
            for width, height in [(1700, 990), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                expect(page.get_by_role('heading', name='Scenes edit fixture')).to_be_visible()
                overview = page.get_by_role('region', name='漫剧项目总览')
                expect(overview).to_be_visible()
                overview.get_by_role('button', name='继续制作', exact=True).click()
                # Script substeps use stable shared geometry across episodes and scenes.
                source_header = page.locator('.motion-comic-production__header').bounding_box()
                source_nav = page.locator('.motion-comic-production__sections').bounding_box()
                page.get_by_role('tab', name='剧本', exact=True).click()
                steps = page.get_by_role('navigation', name='剧本子流程')
                steps.get_by_role('button', name='2. 分集拆解', exact=False).click()
                expect(page.locator('[data-motion-comic-stage-panel="episodes"]')).to_be_visible()
                episodes_header = page.locator('.motion-comic-production__header').bounding_box()
                episodes_nav = page.locator('.motion-comic-production__sections').bounding_box()
                episode_steps = steps.locator('button').evaluate_all('(items) => items.map(e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })')
                page.get_by_role('button', name='返回项目总览', exact=True).click()
                overview.get_by_role('button', name='打开分集', exact=True).first.click()
                expect(page.get_by_role('heading', name='第 1 集 · Episode A', exact=True)).to_be_visible()
                scenes_header = page.locator('.motion-comic-production__header').bounding_box()
                scenes_nav = page.locator('.motion-comic-production__sections').bounding_box()
                scene_steps = steps.locator('button').evaluate_all('(items) => items.map(e => { const r=e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; })')
                assert episode_steps == scene_steps, (episode_steps, scene_steps)
                for left, right, label in [(source_header, episodes_header, 'header source/episodes'), (episodes_header, scenes_header, 'header episodes/scenes'), (source_nav, episodes_nav, 'nav source/episodes'), (episodes_nav, scenes_nav, 'nav episodes/scenes')]:
                    assert left and right and abs(left['width'] - right['width']) <= 1 and abs(left['x'] - right['x']) <= 1, (label, left, right)
                report['checks'].append(f'{width}: script headers and section nav keep equal bounds across source, episodes and scenes')

                editor = page.locator('.comic-scene-shot').first
                editor.get_by_role('button', name='编辑镜头 1', exact=True).click()
                expect(editor.get_by_text('编辑中 · 尚未应用')).to_be_visible()
                # Pending scene edits guard stage changes and episode changes.
                expect(page.get_by_role('button', name='进入制作资产', exact=True)).to_be_disabled()
                page.get_by_label('镜头标题', exact=True).fill('雨夜线索 · 新标题')
                page.get_by_label('景别', exact=True).fill('特写')
                page.get_by_label('时长（秒）', exact=True).fill('3.75')
                page.get_by_label('画面描述', exact=True).fill('湿润石路上的信封特写')
                page.get_by_label('动作 / 运镜', exact=True).fill('镜头缓慢推近，信封边缘轻微颤动')
                page.get_by_label('起始状态', exact=True).fill('信封仍在掌心，雨水落下')
                page.get_by_label('结束状态', exact=True).fill('信封被翻到正面，露出无署名封口')
                page.get_by_label('画面方向 / 视线', exact=True).fill('从右向左看向封口')
                page.get_by_label('动作节拍（每行一项）', exact=True).fill('手指收紧\n镜头推进\n封口露出')
                cue = editor.locator('textarea').filter(has_not=page.get_by_label('画面描述', exact=True)).last
                # The first starter shot has dialogue; target by fieldset scope to avoid label wording assumptions.
                dialogue_fields = editor.locator('.comic-scene-dialogue textarea')
                if dialogue_fields.count():
                    dialogue_fields.first.fill('这封信终于出现了。')
                page.get_by_role('button', name='保存镜头', exact=True).click()
                expect(editor.get_by_role('button', name='编辑镜头 1', exact=True)).to_be_visible()
                expect(editor).to_contain_text('雨夜线索 · 新标题')
                page.get_by_role('button', name='保存', exact=True).click()
                page.wait_for_function('window.comicScenesEditQA.saved.length > 0')
                persisted = page.evaluate('''() => { const d = window.comicScenesEditQA.saved.at(-1); const s = d.episodes[0].scenes[0].shots[0]; const cues = d.episodes[0].dialogueCues.filter(c => s.dialogueCueIds.includes(c.id)); return { title:s.title, framing:s.framing, durationMs:s.durationMs, prompt:s.prompt, motionPrompt:s.motionPrompt, continuity:s.continuity, dialogue:cues.map(c=>c.text) }; }''')
                assert persisted['title'] == '雨夜线索 · 新标题'
                assert persisted['framing'] == '特写' and persisted['durationMs'] == 3750
                assert persisted['prompt'] == '湿润石路上的信封特写' and persisted['motionPrompt'] == '镜头缓慢推近，信封边缘轻微颤动'
                assert persisted['continuity'] == {'startState': '信封仍在掌心，雨水落下', 'endState': '信封被翻到正面，露出无署名封口', 'screenDirection': '从右向左看向封口', 'actionBeats': ['手指收紧', '镜头推进', '封口露出']}
                if dialogue_fields.count(): assert '这封信终于出现了。' in persisted['dialogue']
                report['checks'].append(f'{width}: title, framing, duration, prompt, motion, continuity and cue text persist through Page save')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.locator('.comic-scenes-detail').evaluate('(element) => { element.scrollTop = 0; }')
                page.locator('.motion-comic-scenes-panel').evaluate('(element) => { element.scrollTop = 0; }')
                page.screenshot(path=str(OUTPUT / f'scenes-edit-{width}x{height}.png'), full_page=False)
                report['screenshots'].append(str(OUTPUT / f'scenes-edit-{width}x{height}.png'))
            assert not report['runtimeErrors'], report['runtimeErrors']
            assert not report['external'], report['external']
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(report['checks']), 'runtimeErrors': report['runtimeErrors']}, ensure_ascii=False))


if __name__ == '__main__':
    run()

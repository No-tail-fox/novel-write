"""Production Electron QA for copy genres, template layout, and draft processing labels."""
from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import traceback
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/copywriting-templates'
spec = importlib.util.spec_from_file_location('copy_template_qa_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def capture(page, name, report):
    metrics = page.evaluate("""() => ({width:innerWidth, horizontalOverflow:document.documentElement.scrollWidth > innerWidth+1})""")
    assert not metrics['horizontalOverflow'], metrics
    path = OUTPUT / (name + '.png')
    page.screenshot(path=path, animations='disabled')
    assert base.screenshot_variance(path) > 10
    report['captures'].append({'file': str(path), **metrics})


def check_gallery(page, image):
    rows = page.locator('.prompt-template-row')
    assert rows.count() > 0
    metrics = rows.evaluate_all("""(rows, image) => rows.map(row => {
      const main=row.querySelector('.prompt-template-row-main'), actions=row.querySelector('.prompt-template-row-actions');
      const rect=row.getBoundingClientRect(), text=main.getBoundingClientRect(), buttons=actions.getBoundingClientRect();
      const sample=row.querySelector('.image-style-sample-thumb,.image-style-sample-empty');
      return {name:main.querySelector('strong').textContent, overflow:row.scrollWidth > row.clientWidth+1,
        textClipped:[...main.children].some(el => el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1),
        controlsOutside:buttons.right>rect.right+1 || buttons.bottom>rect.bottom+1,
        mediaOverlap:!!sample && sample.getBoundingClientRect().right>text.left+1,
        imageFit:!image || !sample || !sample.matches('img') || getComputedStyle(sample).objectFit==='contain'};
    })""", image)
    assert not [m for m in metrics if m['overflow'] or m['textClipped'] or m['controlsOutside'] or m['mediaOverlap'] or not m['imageFit']], metrics
    rows.last.scroll_into_view_if_needed()
    expect(rows.last.get_by_role('button', name='查看', exact=True)).to_be_in_viewport()
    rows.first.scroll_into_view_if_needed()
    return len(metrics)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    env = {**os.environ, 'NODE_ENV':'production', 'STORYDREAM_PROJECT_QA_DIR':str(profile), 'PYTHONIOENCODING':'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    # Keep the isolated QA bundle offline without changing production licensing configuration.
    qa_main = ROOT / 'dist-electron/electron/qa-copywriting-templates-main.js'
    subprocess.run([str(ROOT / 'scripts/run-npm-node.cmd'), '--input-type=module', '-e',
        "import {build} from 'esbuild';await build({entryPoints:['electron/main.ts'],outfile:process.argv[1],bundle:true,platform:'node',format:'esm',target:'node20',external:['electron','sql.js','undici'],banner:{js:\"import { createRequire as cr } from 'node:module'; import { fileURLToPath as fp } from 'node:url'; const require=cr(import.meta.url);const __filename=fp(import.meta.url);\"},plugins:[{name:'isolated-license',setup(b){b.onLoad({filter:/license-public\\.json$/},()=>({contents:'{}',loader:'json'}));}}]});",
        str(qa_main)], cwd=ROOT, env=env, check=True)
    env['STORYDREAM_PROJECT_QA_MAIN'] = str(qa_main)
    report = {'status':'running', 'checks':[], 'captures':[], 'runtimeErrors':[], 'paidCalls':0, 'profile':str(profile)}
    process = None
    page = None
    try:
        with sync_playwright() as pw:
            port = base.free_port()
            with (OUTPUT / 'electron.log').open('wb') as log:
                process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-copywriting-templates.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            browser = pw.chromium.connect_over_cdp(base.wait_cdp(port, process))
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.wait_for_event('page', timeout=30_000)
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(page)
            page.locator('.nav-list [data-nav-view="prompt-templates"]').first.click()
            expect(page.locator('.prompt-template-gallery')).to_be_visible()
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                for image,tab in [(False,'故事模板'),(True,'图像模板')]:
                    page.get_by_role('tab',name=tab,exact=True).click()
                    count=check_gallery(page,image)
                    capture(page,f'{"image" if image else "story"}-templates-{width}',report)
                    report['checks'].append(f'{tab}: {count} rows without overlap or clipping at {width}')
                view = page.locator('.prompt-template-row').first.get_by_role('button',name='查看',exact=True)
                view.focus()
                expect(view).to_be_focused()
                preview = page.locator('.sd-hover-preview')
                expect(preview).to_be_visible()
                page.wait_for_function('() => {const img=document.querySelector(".sd-hover-preview img"); return img?.complete && img.naturalWidth>0;}')
                bounds = preview.bounding_box()
                assert bounds and bounds['x'] >= 0 and bounds['y'] >= 0 and bounds['x']+bounds['width'] <= width and bounds['y']+bounds['height'] <= height, bounds
                capture(page,f'template-preview-{width}',report)
                view.press('Escape')
                expect(preview).not_to_be_visible()
                view.press('Enter')
                expect(page.get_by_role('heading',name='查看图像模板',exact=False)).to_be_visible()
                page.get_by_role('button',name='返回模板库',exact=True).click()
                expect(page.get_by_role('tab',name='图像模板',exact=True)).to_have_attribute('aria-selected','true')
            report['checks'].append('Image template details return to the selected library tab')
            report['checks'].append('Keyboard focus opens a fully visible image preview; Escape dismisses and Enter opens details')
            page.evaluate("""() => localStorage.setItem('storydream.copy-studio.v1',JSON.stringify({version:1,topic:'一只随身杯的使用场景',track:'ecommerce',requirements:'面向通勤人群，保留素材事实。',sourceIds:['user::::产品资料'],sources:[{source:'user',title:'产品资料',content:'容量 350 毫升，提供防漏杯盖，适合短途携带。'}],revisions:[],activeRevisionId:'',updatedAt:''}))""")
            page.locator('.nav-list [data-nav-view="person-assets"]').first.click()
            page.locator('.nav-list [data-nav-view="copy-studio"]').click()
            genres=page.get_by_label('内容赛道',exact=True)
            expect(genres.locator('option')).to_have_count(12)
            expect(genres).to_have_value('ecommerce')
            page.get_by_role('button',name='根据 1 条来源生成初稿',exact=True).click()
            expect(page.get_by_label('当前文案',exact=True)).to_have_value('本地验收文案：ecommerce。保留素材中的关键内容，用具体场景推进，结尾回应开头。')
            genres.select_option('folk-tale')
            page.get_by_role('button',name='按要求精修一轮',exact=True).click()
            expect(page.get_by_label('当前文案',exact=True)).to_have_value('本地验收文案：folk-tale。保留素材中的关键内容，用具体场景推进，结尾回应开头。')
            page.get_by_role('button',name='增加赛道特色',exact=True).click()
            expect(page.get_by_text('V3 · 赛道强化 1',exact=True)).to_be_visible()
            requests=json.loads((profile/'copy-requests.json').read_text(encoding='utf-8'))
            assert [(r['track'],r['intent']) for r in requests]==[('ecommerce','draft'),('folk-tale','refine'),('folk-tale','track')],requests
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                capture(page,f'copy-genres-{width}',report)
            expect(page.get_by_role('tab',name='使用定稿',exact=True)).to_have_attribute('aria-selected','true')
            page.get_by_role('button',name='回传并继续视频制作',exact=True).click()
            expect(page.locator('.app-shell')).to_have_attribute('data-shell-view','new-task')
            expect(page.get_by_role('tab',name='使用原文',exact=True)).to_have_attribute('aria-selected','true')
            expect(page.get_by_text('保留当前文案，跳过 AI 素材整理和改写，直接进入分镜制作。',exact=True)).to_be_visible()
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                page.get_by_text('当前模板配置',exact=True).scroll_into_view_if_needed()
                capture(page,f'copy-processing-{width}',report)
            report['checks'].append('11 genres plus custom; drafting, refinement and track requests carry the selected genre')
            report['checks'].append('Finished copy defaults to direct use and the video form explains actual processing')
            page.locator('.nav-list [data-nav-view="projects"]').first.click()
            page.locator('.nav-list [data-nav-view="editorial-collage"]').click()
            expect(page.locator('[data-director-create-wizard]')).to_be_visible()
            page.get_by_label('项目标题',exact=True).fill('村口的一盏灯')
            genres=page.get_by_label('内容赛道',exact=True)
            expect(genres.locator('option')).to_have_count(11)
            genres.select_option('folk-tale')
            page.get_by_label('原始文案',exact=True).fill('老人每天点亮村口的一盏灯，等候远行的人。')
            page.get_by_role('button',name='AI 修改',exact=True).click()
            expect(page.get_by_label('原始文案',exact=True)).to_have_value('本地验收文案：folk-tale。保留素材中的关键内容，用具体场景推进，结尾回应开头。')
            (profile/'copy-controls.json').write_text(json.dumps({'delayMs':1600}),encoding='utf-8')
            page.get_by_role('button',name='AI 修改',exact=True).click()
            genres.select_option('character-story')
            page.get_by_label('原始文案',exact=True).fill('用户保留的手动文案。')
            expect(page.get_by_text('文案输入已修改，已保留当前内容。请基于当前内容重新生成。',exact=False)).to_be_visible()
            expect(page.get_by_label('原始文案',exact=True)).to_have_value('用户保留的手动文案。')
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                page.get_by_label('内容赛道',exact=True).scroll_into_view_if_needed()
                capture(page,f'animation-genres-{width}',report)
            report['checks'].append('Creative animation keeps genres separate from writing styles and ignores results after input changes')
            ledger=json.loads((profile/'ledger.json').read_text(encoding='utf-8'))
            assert ledger['blockedGeneration']==0,ledger
            assert not report['runtimeErrors'],report['runtimeErrors']
            report['status']='passed'
            browser.close()
    except Exception:
        report['status']='failed'
        report['error']=traceback.format_exc()
        if page and not page.is_closed():
            try: page.screenshot(path=OUTPUT/'failure.png')
            except Exception: pass
        raise
    finally:
        (OUTPUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
    print(f"Passed {len(report['checks'])} checks; {len(report['captures'])} captures; no paid calls.",flush=True)


if __name__=='__main__':
    main()

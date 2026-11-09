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
OUTPUT = ROOT / '.artifacts/workflow-prompts'
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
    qa_main = ROOT / 'dist-electron/electron/qa-workflow-prompts-main.js'
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
            expect(page.locator('.prompt-template-row')).to_have_count(290)
            inventory=page.evaluate("""async () => { let items=[],cursor; do {const p=await window.storydream.listPromptTemplates({limit:100,cursor});items.push(...p.items);cursor=p.nextCursor;} while(cursor);return items;}""")
            assert len(inventory)==290, len(inventory)
            assert len([t for t in inventory if t['type']=='workflow'])==276
            report['checks'].append('All 290 builtin templates, including 276 workflow entries, load across cursor pages')
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                page.get_by_label('创作频道',exact=True).select_option('all')
                capture(page,f'gallery-{width}',report)
                check_gallery(page,False)
            page.get_by_label('创作频道',exact=True).select_option('html-video')
            page.get_by_label('搜索提示词',exact=True).fill('writing-style:')
            expect(page.locator('.prompt-template-row')).to_have_count(6)
            report['checks'].append('HTML channel exposes all six shared writing styles')
            page.get_by_label('创作频道',exact=True).select_option('music-mv')
            expect(page.locator('.prompt-template-row')).to_have_count(0)
            page.get_by_label('搜索提示词',exact=True).fill('')
            expect(page.locator('.prompt-template-row')).to_have_count(1)
            report['checks'].append('Music MV channel only exposes its existing visual prompt composition')
            page.get_by_label('创作频道',exact=True).select_option('html-video')
            page.get_by_label('搜索提示词',exact=True).fill('html-planning')
            expect(page.locator('.prompt-template-row')).to_have_count(1)
            page.get_by_role('button',name='查看',exact=True).click()
            expect(page.get_by_label('提示词用途',exact=True)).to_be_disabled()
            expect(page.get_by_label('生效频道',exact=True)).to_be_disabled()
            expect(page.get_by_role('button',name='删除',exact=True)).to_have_count(0)
            content=page.get_by_label('提示词内容',exact=True)
            original=content.input_value()
            content.fill(original+'\n本地验收标记。')
            page.get_by_role('button',name='保存并应用',exact=True).click()
            page.wait_for_function("""async () => (await window.storydream.getPromptTemplateDetail('workflow-html-planning')).content.endsWith('本地验收标记。')""")
            saved=page.evaluate("async () => await window.storydream.getPromptTemplateDetail('workflow-html-planning')")
            assert saved['isBuiltin'] and saved['builtinModified'] and saved['enabled']
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                page.get_by_label('模板名',exact=True).scroll_into_view_if_needed()
                page.get_by_label('提示词内容',exact=True).evaluate('(el)=>el.scrollTop=0')
                capture(page,f'editor-{width}',report)
            page.reload()
            base.wait_app(page)
            page.locator('.nav-list [data-nav-view="prompt-templates"]').first.click()
            page.get_by_label('搜索提示词',exact=True).fill('html-planning')
            page.get_by_role('button',name='查看',exact=True).click()
            expect(page.get_by_label('提示词内容',exact=True)).to_have_value(saved['content'])
            report['checks'].append('Builtin editing persists after reload; identity fields are locked and deletion is absent')
            content=page.get_by_label('提示词内容',exact=True)
            content.fill('未保存的本地改动')
            page.get_by_role('button',name='返回模板库',exact=True).click()
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('button',name='继续编辑',exact=True).click()
            expect(content).to_have_value('未保存的本地改动')
            page.get_by_role('button',name='返回模板库',exact=True).click()
            page.get_by_role('button',name='放弃改动并离开',exact=True).click()
            expect(page.locator('.prompt-template-gallery')).to_be_visible()
            report['checks'].append('Unsaved navigation supports continuing or discarding without losing the saved template')
            page.get_by_role('button',name='克隆',exact=True).click()
            expect(page.get_by_label('提示词内容',exact=True)).to_have_value(saved['content'])
            expect(page.get_by_label('提示词用途',exact=True)).to_be_enabled()
            expect(page.get_by_label('生效频道',exact=True)).to_be_enabled()
            page.get_by_label('模板名',exact=True).fill('本地 HTML 克隆')
            page.get_by_role('button',name='保存为备用',exact=True).click()
            page.wait_for_timeout(250)
            page.get_by_role('button',name='返回模板库',exact=True).click()
            report['checks'].append('Cloning a summary fetches full prompt text and saves it as an inactive custom template')
            page.get_by_label('搜索提示词',exact=True).fill('')
            page.get_by_label('创作频道',exact=True).select_option('html-video')
            page.get_by_role('button',name='新建模板',exact=True).click()
            expect(page.get_by_label('生效频道',exact=True)).to_have_value('html-video')
            page.get_by_label('提示词用途',exact=True).select_option('writing-style:story')
            expect(page.get_by_label('生效频道',exact=True)).to_have_value('html-video')
            values=page.get_by_label('生效频道',exact=True).locator('option').evaluate_all('(options)=>options.map(o=>o.value)')
            assert set(values)=={'shared','html-video','editorial-collage'},values
            page.get_by_label('模板名',exact=True).fill('本地 HTML 风格')
            page.get_by_label('提示词内容',exact=True).fill('本地风格验收标记。')
            page.get_by_role('button',name='保存并应用',exact=True).click()
            page.wait_for_timeout(250)
            expect(page.get_by_text('当前应用：本地 HTML 风格。',exact=False)).to_be_visible()
            page.get_by_role('button',name='返回模板库',exact=True).click()
            customs=page.evaluate("""async () => {let items=[],cursor;do{const p=await window.storydream.listPromptTemplates({limit:100,cursor});items.push(...p.items);cursor=p.nextCursor;}while(cursor);return items.filter(t=>!t.isBuiltin);}""")
            assert len(customs)==2,customs
            assert next(t for t in customs if t['name']=='本地 HTML 克隆')['enabled'] is False
            assert next(t for t in customs if t['name']=='本地 HTML 风格')['enabled'] is True
            report['checks'].append('New custom templates retain their channel across slot changes; backup and apply states persist independently')
            page.locator('.nav-list [data-nav-view="projects"]').first.click()
            page.locator('.nav-list [data-nav-view="html-video"]').click()
            create=page.locator('[data-html-video-create-page=true]')
            expect(create).to_be_visible()
            create.get_by_role('tab',name='AI 创作',exact=True).click()
            expect(page.get_by_label('内容赛道',exact=True).locator('option')).to_have_count(11)
            expect(page.get_by_label('文案创作风格',exact=True).locator('option')).to_have_count(6)
            page.get_by_label('内容赛道',exact=True).select_option('folk-tale')
            page.get_by_label('文案创作风格',exact=True).select_option('story')
            for width,height in [(1440,900),(1040,720)]:
                base.set_size(page,width,height)
                page.get_by_label('创作主题',exact=True).scroll_into_view_if_needed()
                capture(page,f'html-creation-{width}',report)
            report['checks'].append('HTML creation offers 11 tracks and six writing styles at normal and compact window sizes')
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

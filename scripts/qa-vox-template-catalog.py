from pathlib import Path
import functools, http.server, json, threading, subprocess, os
from playwright.sync_api import sync_playwright, expect
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/vox-template-catalog-qa'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['I:/nodejs/node.exe', 'node_modules/tsx/dist/cli.mjs', 'scripts/qa-vox-template-catalog.ts'], cwd=ROOT, check=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
report = {'templates': [], 'hoverTemplates': [], 'ui': [], 'motion': [], 'errors': []}

def wait_ready(dialog):
    expect(dialog.locator('[data-vox-ready="true"]')).to_have_count(1, timeout=25000)
    expect(dialog.get_by_role('button', name='应用此动画', exact=True)).to_be_enabled(timeout=25000)

try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1536, 'height': 1024})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.goto(base)
        page.wait_for_function('window.catalogQA')
        draft = page.evaluate('catalogQA.snapshot()')
        page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
        dialog = page.get_by_role('dialog', name='预览并选择动画模板')
        templates = page.evaluate('catalogQA.templates')
        # The small hover uses the production composition without changing the
        # selected detailed preview or applying anything to the shot.
        for title in ['分层纸片入场', '立体翻书', '音乐频谱', '两地路线']:
            option = dialog.locator('.vox-template-option').filter(has=page.get_by_text(title, exact=True))
            option.hover()
            tooltip = page.get_by_role('tooltip'); expect(tooltip).to_contain_text(title)
            try:
                expect(tooltip.locator('[data-vox-ready="true"]')).to_have_count(1, timeout=25000)
            except Exception:
                page.screenshot(path=str(OUT / 'hover-failure.png'))
                print('HOVER FAILED', title, page.locator('.sd-hover-preview').all_inner_texts(), report['errors'])
                raise
            expect(dialog.get_by_role('region', name='大字开场 动态预览')).to_be_visible()
            assert page.evaluate('catalogQA.snapshot()') == draft
            assert tooltip.locator('iframe').count() == 1
            page.mouse.move(10, 10); expect(tooltip).to_have_count(0)
        first_option = dialog.locator('.vox-template-option').first
        first_option.focus(); expect(page.get_by_role('tooltip')).to_be_visible()
        page.keyboard.press('Escape'); expect(page.get_by_role('tooltip')).to_have_count(0)
        expect(dialog).to_be_visible()
        report['ui'].append('hover paper/book/audio/map: one production preview, no selection/apply, unmount on leave; focus/Escape preserves detailed dialog')
        for template in ([] if os.environ.get('VOX_CATALOG_UI_ONLY') else templates):
            button = dialog.get_by_role('button', name=template['name'] + ' ', exact=False)
            # Accessible names include the explanatory description.
            option = dialog.locator('.vox-template-option').filter(has=page.get_by_text(template['name'], exact=True))
            option.hover()
            tooltip = page.get_by_role('tooltip'); expect(tooltip).to_contain_text(template['name'])
            expect(tooltip.locator('[data-vox-ready="true"]')).to_have_count(1, timeout=25000)
            assert page.evaluate('catalogQA.snapshot()') == draft
            report['hoverTemplates'].append(template['id'])
            option.click()
            expect(dialog.get_by_role('region', name=template['name'] + ' 动态预览')).to_be_visible()
            page.wait_for_timeout(240)
            wait_ready(dialog)
            assert page.evaluate('catalogQA.snapshot()') == draft
            assert dialog.locator('iframe').count() == 1
            report['templates'].append(template['id'])
        # Playback advances production composition markup, then pause and scrub freeze/set frames.
        for template_id, title in ([] if os.environ.get('VOX_CATALOG_UI_ONLY') else [('paper-actors', '分层纸片入场'), ('book-3d', '立体翻书'), ('audio-spectrum', '音乐频谱'), ('map-a-to-b', '两地路线'), ('shotcraft-source-merge', '来源汇聚成一体')]):
            dialog.locator('.vox-template-option').filter(has=page.get_by_text(title, exact=True)).click()
            page.wait_for_timeout(240); wait_ready(dialog)
            dialog.get_by_role('button', name='暂停动画', exact=True).click()
            slider = dialog.get_by_role('slider', name='动画示例进度')
            slider.focus(); slider.press('Home'); slider.press('ArrowRight'); slider.press('ArrowRight')
            page.wait_for_timeout(150)
            stage = dialog.locator('.vox-catalog-stage')
            early = OUT / f'{template_id}-early.png'; late = OUT / f'{template_id}-late.png'
            stage.screenshot(path=str(early))
            dialog.get_by_role('button', name='播放动画', exact=True).click()
            page.wait_for_timeout(950)
            dialog.get_by_role('button', name='暂停动画', exact=True).click()
            stage.screenshot(path=str(late))
            delta = sum(ImageStat.Stat(ImageChops.difference(Image.open(early).convert('RGB'), Image.open(late).convert('RGB'))).mean) / 3
            assert delta > .05, (template_id, delta)
            assert float(dialog.get_by_label('示例播放时间').inner_text().split('/')[0]) > .5
            previous = dialog.get_by_label('示例播放时间').inner_text()
            page.wait_for_timeout(200)
            assert dialog.get_by_label('示例播放时间').inner_text() == previous
            slider.focus(); slider.press('End'); page.wait_for_timeout(100)
            assert float(dialog.get_by_label('示例播放时间').inner_text().split('/')[0]) > 3
            report['motion'].append({'template': template_id, 'frameDifference': round(delta, 3)})
        page.keyboard.press('Escape'); expect(dialog).not_to_be_visible()
        assert page.evaluate('catalogQA.snapshot()') == draft
        for theme in ['dark', 'light']:
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height}); page.goto(base + '/?theme=' + theme)
                page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
                dialog = page.get_by_role('dialog', name='预览并选择动画模板')
                dialog.get_by_role('textbox', name='搜索模板', exact=True).fill('分层纸片')
                dialog.locator('.vox-template-option').click(); page.wait_for_timeout(240); wait_ready(dialog)
                page.wait_for_timeout(900)
                page.screenshot(path=str(OUT / f'catalog-{theme}-{width}.png'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                bounds = dialog.bounding_box(); assert bounds['y'] >= 0 and bounds['y'] + bounds['height'] <= height + 1
                dialog.get_by_role('button', name='取消', exact=True).click()
                assert page.evaluate('catalogQA.snapshot()') == draft
                page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
                dialog.get_by_role('textbox', name='搜索模板', exact=True).fill('趋势')
                dialog.locator('.vox-template-option').click(); page.wait_for_timeout(240); wait_ready(dialog)
                dialog.get_by_role('button', name='应用此动画', exact=True).click()
                expect(dialog).not_to_be_visible()
                applied = page.evaluate('catalogQA.snapshot()')
                assert applied['template']['id'] == 'data-line'
                assert applied['template']['props'] == draft['template']['props']
                report['ui'].append(f'{theme} {width}x{height}: search, preview, cancel, apply, draft isolation')
        # Portrait catalog media stays inside the same bounded dialog.
        page.goto(base); page.wait_for_function('window.catalogQA'); page.evaluate("catalogQA.setRatio('9:16')")
        page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
        dialog = page.get_by_role('dialog', name='预览并选择动画模板'); wait_ready(dialog)
        page.screenshot(path=str(OUT / 'catalog-portrait.png'))
        dialog.get_by_label('模板分类', exact=True).select_option('我的模板')
        dialog.get_by_role('button', name='我的字幕模板', exact=True).hover()
        expect(page.get_by_role('tooltip').locator('[data-vox-ready="true"]')).to_have_count(1, timeout=25000)
        dialog.get_by_role('button', name='我的字幕模板', exact=True).click()
        expect(dialog.get_by_text('字幕使用示例时间演示；应用后跟随当前镜头字幕。')).to_be_visible()
        expect(dialog.get_by_role('button', name='应用个人模板', exact=True)).to_be_enabled(timeout=25000)
        assert page.evaluate('catalogQA.snapshot()') == draft
        dialog.get_by_role('button', name='应用个人模板', exact=True).click()
        assert page.evaluate('catalogQA.snapshot().template.id') == 'audio-captions'
        assert page.evaluate('catalogQA.snapshot().template.props.title') == '个人字幕样式'
        report['ui'].append('personal caption template: sample timing, no premature draft mutation, apply saved settings')
        page.goto(base)
        page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
        dialog = page.get_by_role('dialog', name='预览并选择动画模板')
        dialog.get_by_label('模板分类', exact=True).select_option('我的模板')
        dialog.get_by_role('button', name='跨项目纸片模板', exact=True).click()
        expect(dialog.get_by_text('部分素材不在当前项目。可先应用，再补齐素材或修正内容；预览通过后才能导出。')).to_be_visible()
        expect(dialog.get_by_role('alert')).to_contain_text('有图片素材不存在', timeout=25000)
        assert page.evaluate('catalogQA.snapshot()') == draft
        expect(dialog.get_by_role('button', name='应用个人模板', exact=True)).to_be_enabled()
        dialog.get_by_role('button', name='应用个人模板', exact=True).click()
        expect(dialog).not_to_be_visible()
        applied = page.evaluate('catalogQA.snapshot()')
        assert applied['template']['props']['assetIds'] == ['other-project-background', 'other-project-subject']
        assert applied['template']['props']['title'] == '另一个项目的纸片镜头'
        expect(page.get_by_role('button', name='导出此镜头', exact=True)).to_be_disabled()
        expect(page.get_by_role('button', name='保存模板', exact=True)).to_be_disabled()
        report['ui'].append('missing-asset personal template: applies original ids for remapping; invalid export/save remain disabled')
        page.emulate_media(reduced_motion='reduce'); page.goto(base)
        page.get_by_role('button', name='选择模板 · 大字开场', exact=True).click()
        dialog = page.get_by_role('dialog', name='预览并选择动画模板'); wait_ready(dialog)
        expect(dialog.get_by_text('已按系统设置关闭自动播放，可手动播放查看效果。')).to_be_visible()
        page.wait_for_timeout(350)
        assert dialog.get_by_label('示例播放时间').inner_text().startswith('0.0 /')
        dialog.get_by_role('button', name='播放动画', exact=True).click(); page.wait_for_timeout(550)
        assert float(dialog.get_by_label('示例播放时间').inner_text().split('/')[0]) > .3
        dialog.locator('.vox-template-option').filter(has=page.get_by_text('立体翻书', exact=True)).click()
        page.wait_for_timeout(240); wait_ready(dialog); page.wait_for_timeout(250)
        expect(dialog.get_by_role('button', name='播放动画', exact=True)).to_be_enabled()
        assert dialog.get_by_label('示例播放时间').inner_text().startswith('0.0 /')
        dialog.get_by_role('button', name='重新播放示例', exact=True).click(); page.wait_for_timeout(350)
        assert float(dialog.get_by_label('示例播放时间').inner_text().split('/')[0]) > .1
        report['ui'].append('prefers-reduced-motion: opening and selection stay paused; manual playback/replay work')
        report['passed'] = not report['errors']
        assert report['passed'], report['errors']
        browser.close()
finally:
    server.shutdown()
    (OUT / ('ui-final-report.json' if os.environ.get('VOX_CATALOG_UI_ONLY') else 'report.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))

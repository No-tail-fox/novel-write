"""Exercise delayed copy responses on the real director creation forms."""
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
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/director-copy')))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run([
        'I:/nodejs/node.exe', '--input-type=module', '-e',
        "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:false,target:'chrome120',lib:{entry:'tests/director-copy-stale.harness.tsx',name:'directorCopyQA',formats:['es'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
        str(OUTPUT),
    ], cwd=ROOT, env=environment, check=True)
    (OUTPUT / 'index.html').write_text('<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>', encoding='utf-8')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    errors: list[str] = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, env=environment, executable_path=os.environ.get('STORYDREAM_QA_BROWSER', 'C:/Program Files/Google/Chrome/Application/chrome.exe'))
            page = browser.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith(f'http://127.0.0.1:{server.server_port}/') else route.abort())
            for width, height in [(1536, 1024), (1040, 720)]:
                page.set_viewport_size({'width': width, 'height': height})
                for mode in ['vox', 'comic']:
                    page.goto(f'http://127.0.0.1:{server.server_port}/?mode={mode}')
                    title = page.get_by_label('项目标题' if mode == 'vox' else '系列名称', exact=True)
                    copy = page.get_by_label('原始文案' if mode == 'vox' else '核心设定', exact=True)
                    title.fill('Original title')
                    copy.fill('Original copy')
                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    copy.fill('Newer user copy')
                    page.evaluate('window.directorCopyQA.release("Older AI copy")')
                    expect(copy).to_have_value('Newer user copy')
                    expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
                    checks.append(f'{mode} {width}: newer copy survives delayed revision')
                    page.screenshot(path=str(OUTPUT / f'{mode}-{width}x{height}-stale-copy.png'))

                    page.get_by_role('button', name='AI 创作', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    title.fill('A replacement subject')
                    page.evaluate('window.directorCopyQA.release("Wrong subject copy")')
                    expect(title).to_have_value('A replacement subject')
                    expect(copy).to_have_value('Newer user copy')
                    expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
                    checks.append(f'{mode} {width}: changed title rejects delayed creation')

                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    page.evaluate('window.directorCopyQA.release("Accepted AI copy")')
                    expect(copy).to_have_value('Accepted AI copy')
                    checks.append(f'{mode} {width}: unchanged input accepts response')

                    page.get_by_role('button', name='AI 修改', exact=True).click()
                    page.wait_for_function('window.directorCopyQA.pending.length === 1')
                    page.evaluate('window.directorCopyQA.remount()')
                    expect(copy).to_have_value('')
                    title.fill('New workspace')
                    copy.fill('New workspace copy')
                    page.evaluate('window.directorCopyQA.release("Departed workspace copy")')
                    expect(copy).to_have_value('New workspace copy')
                    checks.append(f'{mode} {width}: departed page cannot receive response')
            page.set_viewport_size({'width': 1440, 'height': 960})
            page.goto(f'http://127.0.0.1:{server.server_port}/?mode=vox')
            title = page.get_by_label('项目标题', exact=True)
            copy = page.get_by_label('原始文案', exact=True)
            direction = page.get_by_label('AI 创作要求', exact=True)
            title.fill('城市旧书店为何消失')
            direction.fill('面向大学生，从租金变化切入，采用客观的纪录片口吻，避免怀旧煽情。')
            page.get_by_role('button', name='AI 创作', exact=True).click()
            page.wait_for_function('window.directorCopyQA.pending.length === 1')
            request = page.evaluate('window.directorCopyQA.requests.at(-1)')
            assert direction.input_value() in request['extraRequirements'], request
            expect(page.get_by_role('button', name='创作中', exact=True)).to_be_disabled()
            direction.fill('面向第一次逛旧书店的年轻人，从店主的一天切入，重点呈现书店与社区的联系，不编造数据。')
            page.evaluate('window.directorCopyQA.release("Old direction result")')
            expect(copy).to_have_value('')
            expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
            checks.append('VOX: direction reaches request; changing it rejects the old response')

            writing_style = page.get_by_role('combobox', name='文案创作风格', exact=True)
            expect(writing_style).to_contain_text('纪实解释')
            writing_style.click()
            page.get_by_role('option', name='数据解读', exact=True).hover()
            expect(page.locator('.sd-hover-preview')).to_contain_text('示例文案')
            expect(page.locator('.sd-hover-preview')).to_contain_text('统一比较口径')
            page.get_by_role('option', name='数据解读', exact=True).click()
            page.get_by_role('button', name='AI 创作', exact=True).click()
            page.wait_for_function('window.directorCopyQA.pending.length === 1')
            assert '文案创作风格：数据解读' in page.evaluate('window.directorCopyQA.requests.at(-1).extraRequirements')
            writing_style.click()
            page.get_by_role('option', name='故事叙事', exact=True).click()
            page.evaluate('window.directorCopyQA.release("Old writing style result")')
            expect(copy).to_have_value('')
            expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('已保留当前内容')
            checks.append('VOX: style hover previews are labeled; changing style rejects a delayed response')

            page.get_by_role('button', name='AI 创作', exact=True).click()
            page.wait_for_function('window.directorCopyQA.pending.length === 1')
            assert direction.input_value() in page.evaluate('window.directorCopyQA.requests.at(-1).extraRequirements')
            assert '文案创作风格：故事叙事' in page.evaluate('window.directorCopyQA.requests.at(-1).extraRequirements')
            generated = '旧书店的早晨，从店主整理书架开始。读者在这里寻找旧书，也交换生活中的见闻。书店留下的，是人与社区的联系。'
            page.evaluate('(copy) => window.directorCopyQA.release(copy)', generated)
            expect(copy).to_have_value(generated)
            page.get_by_role('button', name='AI 修改', exact=True).click()
            page.wait_for_function('window.directorCopyQA.pending.length === 1')
            request = page.evaluate('window.directorCopyQA.requests.at(-1)')
            assert direction.input_value() in request['extraRequirements']
            assert '文案创作风格：故事叙事' in request['extraRequirements']
            assert request['selectedSources'][0]['content'] == generated
            page.evaluate('window.directorCopyQA.fail()')
            expect(copy).to_have_value(generated)
            expect(page.locator('[data-director-copy-assist] [role=alert]')).to_contain_text('LLM')
            page.get_by_role('button', name='AI 修改', exact=True).click()
            page.wait_for_function('window.directorCopyQA.pending.length === 1')
            page.evaluate('(copy) => window.directorCopyQA.release(copy)', generated)
            expect(page.locator('[data-director-copy-assist] [role=status]')).to_contain_text('已修改并填入')
            checks.append('VOX: creation and revision use direction; failures preserve editable copy and retry works')

            saved_direction = direction.input_value()
            page.evaluate('window.directorCopyQA.leave()')
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('button', name='继续编辑', exact=True).click()
            expect(direction).to_have_value(saved_direction)
            page.evaluate('window.directorCopyQA.leave()')
            page.get_by_role('button', name='保存并离开', exact=True).click()
            expect(page.get_by_role('dialog')).not_to_be_visible()
            expect(direction).to_have_value(saved_direction)
            page.reload()
            expect(direction).to_have_value(saved_direction)
            expect(copy).to_have_value(generated)
            expect(writing_style).to_contain_text('故事叙事')
            page.get_by_role('button', name='下一步', exact=True).click()
            page.get_by_role('button', name='上一步', exact=True).click()
            expect(direction).to_have_value(saved_direction)
            expect(writing_style).to_contain_text('故事叙事')
            checks.append('VOX: requirements and writing style survive cancel, save/remount, reload and wizard steps')

            for theme in ['dark', 'light']:
                for width, height in [(1440, 960), (1040, 720), (390, 844)]:
                    page.set_viewport_size({'width': width, 'height': height})
                    page.goto(f'http://127.0.0.1:{server.server_port}/?mode=vox&theme={theme}')
                    expect(direction).to_have_value(saved_direction)
                    expect(writing_style).to_contain_text('故事叙事')
                    direction.focus()
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    page.screenshot(path=str(OUTPUT / f'vox-direction-{theme}-{width}.png'), full_page=True)
                    checks.append(f'VOX {theme} {width}: input visible, focusable, draft preserved, no horizontal overflow')
                    if width >= 1000:
                        writing_style.click()
                        for label in ['纪实解释', '故事叙事', '观点评论', '轻松科普', '数据解读', '文化随笔']:
                            page.get_by_role('option', name=label, exact=True).hover()
                            expect(page.locator('.sd-hover-preview > strong')).to_have_text(label)
                            expect(page.locator('.sd-hover-preview')).to_contain_text('示例文案 · 旧书店')
                        page.screenshot(path=str(OUTPUT / f'vox-writing-preview-{theme}-{width}.png'))
                        page.keyboard.press('Escape')
                        page.keyboard.press('Escape')
                        expect(writing_style).to_contain_text('故事叙事')
                        page.get_by_role('button', name='下一步', exact=True).click()
                        for label, selector in [('视觉风格', 'img'), ('版式模板', 'iframe'), ('运动控制', 'iframe')]:
                            field = page.get_by_role('combobox', name=label, exact=True)
                            original_value = field.inner_text()
                            field.click()
                            for option in page.get_by_role('listbox').get_by_role('option').all():
                                name = option.inner_text()
                                option.hover()
                                expect(page.locator('.sd-hover-preview > strong')).to_have_text(name)
                                expect(page.locator(f'.sd-hover-preview {selector}')).to_be_visible()
                                if selector == 'img':
                                    expect(page.locator('.sd-hover-preview img')).to_have_js_property('complete', True)
                                    assert page.locator('.sd-hover-preview img').evaluate('(img) => img.naturalWidth > 0')
                            page.screenshot(path=str(OUTPUT / f'vox-wizard-{label}-{theme}-{width}.png'))
                            page.keyboard.press('Escape')
                            page.keyboard.press('Escape')
                            expect(field).to_contain_text(original_value)
                        page.get_by_role('button', name='下一步', exact=True).click()
                        field = page.get_by_role('combobox', name='字幕样式', exact=True)
                        original_value = field.inner_text()
                        field.click()
                        for option in page.get_by_role('listbox').get_by_role('option').all():
                            name = option.inner_text()
                            option.hover()
                            expect(page.locator('.sd-hover-preview > strong')).to_have_text(name)
                            expect(page.locator('.sd-hover-preview iframe')).to_be_visible()
                        page.screenshot(path=str(OUTPUT / f'vox-wizard-subtitles-{theme}-{width}.png'))
                        page.keyboard.press('Escape')
                        page.keyboard.press('Escape')
                        expect(field).to_contain_text(original_value)
                        checks.append(f'VOX {theme} {width}: all 6 writing styles and all visual/layout/camera/subtitle options preview without selecting')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(json.dumps({'checks': checks, 'runtimeErrors': errors, 'paidGenerationCalls': 0}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(checks), 'runtimeErrors': errors, 'output': str(OUTPUT)}, ensure_ascii=False))


if __name__ == '__main__':
    run()

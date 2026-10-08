"""Render the motion-comic planning dialog in both themes and desktop sizes."""
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
OUTPUT = ROOT / '.artifacts' / 'motion-comic-plan-dialog'
VIEWPORTS = ((1536, 1024, 'desktop'), (1040, 720, 'compact'))


def run() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, 'TEMP': str(OUTPUT), 'TMP': str(OUTPUT)}
    subprocess.run(
        [
            'I:/nodejs/node.exe',
            '--input-type=module',
            '-e',
            "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:process.argv[1],emptyOutDir:true,target:'chrome120',lib:{entry:'tests/motion-comic-planner.harness.tsx',name:'plannerQA',formats:['iife'],fileName:()=> 'harness.js',cssFileName:'harness'}}});",
            str(OUTPUT),
        ],
        cwd=ROOT,
        env=environment,
        check=True,
    )
    (OUTPUT / 'index.html').write_text(
        '<!doctype html><html data-theme-ready="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="harness.css"></head><body><div id="root"></div><script src="harness.js"></script></body></html>',
        encoding='utf-8',
    )

    server = http.server.ThreadingHTTPServer(
        ('127.0.0.1', 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUTPUT)),
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks: list[str] = []
    runtime_errors: list[str] = []
    external_requests: list[str] = []
    measurements: dict[str, object] = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                env=environment,
                executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe',
            )
            page = browser.new_page()
            page.on('pageerror', lambda error: runtime_errors.append(str(error)))
            page.on('request', lambda request: external_requests.append(request.url) if not request.url.startswith(('http://127.0.0.1:', 'data:', 'blob:')) else None)
            for theme in ('dark', 'light'):
                for view in ('source', 'preview'):
                    for width, height, size in VIEWPORTS:
                        label = f'{theme}-{view}-{size}-{width}x{height}'
                        page.set_viewport_size({'width': width, 'height': height})
                        page.goto(f'http://127.0.0.1:{server.server_port}/?view={view}&theme={theme}')
                        surface = page.locator('.sd-dialog-surface')
                        expect(surface).to_be_visible()
                        page.wait_for_function("document.querySelector('.sd-dialog-surface')?.getBoundingClientRect().width >= 959")
                        if view == 'preview':
                            expect(page.get_by_text('幕边界依据', exact=True)).to_be_visible()
                            expect(page.get_by_text('2', exact=True).first).to_be_visible()
                            assert page.locator('.motion-comic-plan-metrics > span').count() == 6
                            assert page.locator('.motion-comic-plan-scene').count() == 2
                            page.locator('.motion-comic-plan-scene').nth(1).click()
                            expect(page.get_by_text('地点转入旧车站，广播从警告升级为能预知行动的直接威胁。', exact=True)).to_be_visible()
                        else:
                            expect(page.get_by_label('故事原文', exact=True)).to_be_visible()
                            expect(page.get_by_label('目标时长（秒）', exact=True)).to_be_visible()
                            expect(page.get_by_role('button', name='生成剧本，进入审核', exact=True)).to_be_visible()

                        geometry = surface.evaluate(
                            """element => {
                              const rect = element.getBoundingClientRect();
                              const actions = element.querySelector('.fui-DialogActions')?.getBoundingClientRect();
                              const content = element.querySelector('.fui-DialogContent');
                              const review = element.querySelector('.motion-comic-plan-review')?.getBoundingClientRect();
                              return {
                                surface: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height},
                                actions: actions ? {left: actions.left, top: actions.top, right: actions.right, bottom: actions.bottom} : null,
                                review: review ? {width: review.width, height: review.height} : null,
                                surfaceOverflowX: element.scrollWidth > element.clientWidth + 1,
                                contentOverflowX: content ? content.scrollWidth > content.clientWidth + 1 : false,
                                contentScrollHeight: content?.scrollHeight ?? 0,
                                contentClientHeight: content?.clientHeight ?? 0,
                              };
                            }"""
                        )
                        measurements[label] = geometry
                        rect = geometry['surface']
                        assert rect['left'] >= -1 and rect['top'] >= -1
                        assert rect['right'] <= width + 1 and rect['bottom'] <= height + 1
                        assert rect['width'] >= min(900, width - 80)
                        assert not geometry['surfaceOverflowX'] and not geometry['contentOverflowX']
                        actions = geometry['actions']
                        assert actions and actions['bottom'] <= height + 1
                        review = geometry['review']
                        if view == 'preview':
                            assert review and review['width'] >= 700 and review['height'] >= 260
                        for button in surface.get_by_role('button').all():
                            box = button.bounding_box()
                            if box:
                                assert box['x'] >= -1 and box['x'] + box['width'] <= width + 1
                        page.screenshot(path=str(OUTPUT / f'{label}.png'))
                        checks.append(f'{label}: dialog content, actions and horizontal bounds')

                        if theme == 'dark' and view == 'preview' and size == 'compact':
                            shot_list = page.locator('.motion-comic-plan-shots > ol')
                            shot_list.evaluate("element => { const source = [...element.children]; for (let i = 0; i < 4; i += 1) source.forEach(item => element.append(item.cloneNode(true))); }")
                            assert shot_list.evaluate('element => element.scrollHeight > element.clientHeight')
                            shot_list.hover()
                            page.mouse.wheel(0, 640)
                            page.wait_for_timeout(100)
                            assert shot_list.evaluate('element => element.scrollTop > 0')
                            expect(page.get_by_role('button', name='追加为第 3 集', exact=True)).to_be_visible()
                            page.screenshot(path=str(OUTPUT / 'dark-preview-compact-scroll-bottom.png'))
                            checks.append('dark-preview-compact: mouse wheel scroll keeps dialog actions visible')
            page.set_viewport_size({'width': 1040, 'height': 720})
            page.goto(f'http://127.0.0.1:{server.server_port}/?view=preview&theme=dark&fixture=adjustments')
            surface = page.locator('.sd-dialog-surface')
            page.wait_for_function("document.querySelector('.sd-dialog-surface')?.getBoundingClientRect().width >= 959")
            adjustments_tab = page.get_by_role('button', name='自动整理与补齐（48）', exact=True)
            expect(adjustments_tab).to_be_visible()
            checklist = page.locator('.motion-comic-plan-adjustments')
            expect(checklist).to_be_visible()
            assert checklist.evaluate('element => element.scrollHeight > element.clientHeight')
            primary = surface.get_by_role('button', name='追加为第 3 集', exact=True)
            expect(primary).to_be_disabled()
            checklist.hover()
            page.mouse.wheel(0, 900)
            page.wait_for_timeout(100)
            assert checklist.evaluate('element => element.scrollTop > 0')
            expect(primary).to_be_visible()
            page.get_by_role('checkbox', name='我已核对自动整理与补齐项，同意写入本集').check()
            expect(primary).to_be_enabled()
            page.screenshot(path=str(OUTPUT / 'dark-preview-compact-adjustments-scroll.png'))
            checks.append('dark-preview-compact: adjustment audit scrolls and blocks apply until confirmed')
            page.goto(f'http://127.0.0.1:{server.server_port}/?view=preview&theme=dark&fixture=manual')
            expect(page.get_by_role('button', name='整理与修改记录（1）', exact=True)).to_be_visible()
            expect(page.get_by_text('剧情内容 · 人工修改', exact=True)).to_be_visible()
            expect(page.get_by_text('规划已修改并重新校验', exact=True)).to_be_visible()
            expect(page.get_by_text('规划已自动修复并重新校验', exact=True)).to_have_count(0)
            primary = page.get_by_role('button', name='追加为第 3 集', exact=True)
            expect(primary).to_be_disabled()
            page.get_by_role('checkbox', name='我已核对人工修改与系统整理，同意写入本集', exact=True).check()
            expect(primary).to_be_enabled()
            page.screenshot(path=str(OUTPUT / 'dark-compact-manual-adjustments.png'))
            checks.append('manual edits are distinguished from automatic normalization and require review')
            page.goto(f'http://127.0.0.1:{server.server_port}/?view=source&theme=dark&fixture=recovery')
            expect(page.get_by_role('button', name='保留剧本，仅重试分镜', exact=True)).to_be_visible()
            retained = page.get_by_role('region', name='当前集剧本审核', exact=True)
            expect(retained).to_be_visible()
            retry = page.get_by_role('button', name='保留剧本，仅重试分镜', exact=True)
            expect(retry).to_be_disabled()
            page.get_by_role('checkbox', name='我已核对本集剧情、角色及修改记录，确认后生成分镜').check()
            expect(retry).to_be_enabled()
            page.screenshot(path=str(OUTPUT / 'dark-preview-compact-retained-script.png'))
            checks.append('dark-compact: retained script is inspectable and storyboard retry requires review')
            for theme in ('dark', 'light'):
                for width, height, size in VIEWPORTS:
                    page.set_viewport_size({'width': width, 'height': height})
                    page.evaluate("localStorage.removeItem('planner-qa-review')")
                    page.goto(f'http://127.0.0.1:{server.server_port}/?view=source&theme={theme}&fixture=review')
                    confirm = page.get_by_role('button', name='确认剧本，生成分镜', exact=True)
                    expect(confirm).to_be_disabled()
                    beats = page.get_by_role('region', name='剧情节拍与原文证据', exact=True)
                    beats.locator('summary').first.click()
                    expect(beats.locator('details p').first).to_be_visible()
                    beat_text = beats.get_by_label('剧情内容', exact=True).first
                    beat_text.fill('')
                    expect(page.get_by_role('button', name='保存修改并重新校验', exact=True)).to_be_disabled()
                    page.get_by_role('button', name='取消', exact=True).click()
                    page.get_by_role('button', name='重新打开规划', exact=True).click()
                    expect(beat_text).to_have_value('')
                    page.reload()
                    expect(beat_text).to_have_value('')
                    beat_text.fill('林夏停下脚步，确认来信内容。')
                    beats.get_by_label('类型与说话人', exact=True).first.select_option('dialogue:lin-xia')
                    page.get_by_role('button', name='保存修改并重新校验', exact=True).click()
                    assert page.evaluate('window.motionComicPlannerQA.calls') == ['validate']
                    expect(confirm).to_be_disabled()
                    checkbox = page.get_by_role('checkbox', name='我已核对本集剧情、角色及修改记录，确认后生成分镜')
                    checkbox.check()
                    expect(confirm).to_be_enabled()
                    beats.hover()
                    page.mouse.wheel(0, 600)
                    page.wait_for_timeout(100)
                    assert beats.evaluate('e => e.scrollTop > 0')
                    box = confirm.bounding_box()
                    assert box and box['y'] >= 0 and box['y'] + box['height'] <= height
                    assert page.locator('.sd-dialog-surface').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
                    page.screenshot(path=str(OUTPUT / f'{theme}-{size}-script-review.png'))
                    confirm.click()
                    assert page.evaluate('window.motionComicPlannerQA.calls') == ['validate', 'resume']
                    page.get_by_role('button', name='返回修改剧本', exact=True).click()
                    beats.get_by_label('剧情内容', exact=True).first.fill('林夏重新读了一遍信。')
                    expect(page.get_by_role('button', name='追加为第 3 集', exact=True)).to_have_count(0)
                    expect(page.get_by_role('button', name='保存修改并重新校验', exact=True)).to_be_enabled()
                    checks.append(f'{theme}-{size}: script review edits persist, revalidation precedes confirmation, old preview is hidden')
            for theme in ('dark', 'light'):
                for width, height, size in VIEWPORTS:
                    page.set_viewport_size({'width': width, 'height': height})
                    page.evaluate("localStorage.removeItem('planner-qa-failure')")
                    page.goto(f'http://127.0.0.1:{server.server_port}/?view=source&theme={theme}&fixture=failure')
                    issues = page.get_by_role('region', name='剧本校验问题', exact=True)
                    expect(issues).to_be_visible()
                    fields = issues.get_by_label('修正类型与说话人', exact=True)
                    expect(fields).to_have_count(16)
                    expect(fields.first).to_have_value('dialogue:')
                    fields.first.select_option('dialogue:lin-xia')
                    fields.nth(1).select_option('narration:lin-xia')
                    page.get_by_role('button', name='取消', exact=True).click()
                    page.get_by_role('button', name='重新打开规划', exact=True).click()
                    expect(fields.first).to_have_value('dialogue:lin-xia')
                    expect(fields.nth(1)).to_have_value('narration:lin-xia')
                    page.reload()
                    expect(fields.first).to_have_value('dialogue:lin-xia')
                    expect(fields.nth(1)).to_have_value('narration:lin-xia')
                    assert page.evaluate('window.motionComicPlannerQA.calls.length') == 0
                    assert issues.evaluate('element => element.clientHeight >= 180 && element.scrollHeight > element.clientHeight')
                    issues.hover()
                    page.mouse.wheel(0, 700)
                    page.wait_for_timeout(100)
                    assert issues.evaluate('element => element.scrollTop > 0')
                    primary = page.get_by_role('button', name='保存修正并重新校验', exact=True)
                    expect(primary).to_be_visible()
                    box = primary.bounding_box()
                    assert box and box['y'] >= 0 and box['y'] + box['height'] <= height
                    assert page.locator('.sd-dialog-surface').evaluate('element => element.scrollWidth <= element.clientWidth + 1')
                    primary.click()
                    assert page.evaluate('window.motionComicPlannerQA.calls') == ['repair']
                    page.screenshot(path=str(OUTPUT / f'{theme}-{size}-script-repair.png'))
                    checks.append(f'{theme}-{size}: repair selections survive close and reload, wheel scroll keeps actions visible')
            assert not runtime_errors, runtime_errors
            assert not external_requests, external_requests
            browser.close()
    finally:
        server.shutdown()
        (OUTPUT / 'report.json').write_text(
            json.dumps(
                {
                    'status': 'passed' if len(checks) == 20 and not runtime_errors and not external_requests else 'failed',
                    'checks': checks,
                    'measurements': measurements,
                    'runtimeErrors': runtime_errors,
                    'externalNetworkRequests': external_requests,
                    'paidGenerationCalls': 0,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding='utf-8',
        )
    print(json.dumps({'status': 'passed' if len(checks) == 20 else 'failed', 'checks': len(checks)}, ensure_ascii=False))


if __name__ == '__main__':
    run()

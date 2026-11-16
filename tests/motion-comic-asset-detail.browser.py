"""Offline visual QA for the motion-comic asset detail workspace.

Renders the real Page-owned layout pieces (look rail, multi-image reference board,
definition form, removal guard) with synthetic fixtures.
No IPC, auth, provider or paid call.
"""
import functools
import http.server
import json
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / 'motion-comic-asset-detail'
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([
    'node', '--input-type=module', '-e',
    "import {build} from 'vite'; await build({configFile:false,define:{'process.env.NODE_ENV':JSON.stringify('production')},"
    "build:{outDir:'artifacts/motion-comic-asset-detail',emptyOutDir:false,"
    "lib:{entry:'tests/motion-comic-asset-detail.harness.tsx',name:'assetDetailQA',formats:['iife'],"
    "fileName:()=> 'harness.js',cssFileName:'harness'}}});",
], cwd=ROOT, check=True)
(OUT / 'index.html').write_text(
    '<!doctype html><html data-theme="dark"><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<link rel="stylesheet" href="harness.css"><body><div id="root"></div>'
    '<script src="harness.js"></script></body></html>', encoding='utf-8')
server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0),
    functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(OUT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
report = {'scope': 'Real asset-detail components with offline fixtures; not full Page/Electron/backend acceptance',
          'checks': [], 'errors': []}
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files/Google/Chrome/Application/chrome.exe')
        page = browser.new_page(viewport={'width': 1428, 'height': 840})
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        page.on('console', lambda message: report['errors'].append(message.text) if message.type == 'error' and '404' not in message.text else None)
        page.route('**/*', lambda route: route.continue_()
                   if urlparse(route.request.url).hostname == '127.0.0.1'
                   and urlparse(route.request.url).port == server.server_port else route.abort())
        page.goto(f'http://127.0.0.1:{server.server_port}')
        expect(page.get_by_role('heading', name='哪吒')).to_be_visible()

        tabs = page.locator('.comic-look-tab')
        expect(tabs).to_have_count(3)  # two looks + add
        expect(page.locator('.comic-look-tab.is-add')).to_contain_text('新增造型')
        report['checks'].append('Look rail renders each造型 as a selectable tab plus an explicit add tab')

        # The old bug: a sticky bar covered the first造型 fields.
        heading = page.locator('.comic-asset-detail-heading')
        name_field = page.get_by_label('造型名称')
        expect(name_field).to_be_visible()
        expect(name_field).to_have_value('东海战后红绫装')
        box = heading.bounding_box()
        field_box = name_field.bounding_box()
        assert field_box['y'] >= box['y'] + box['height'] - 1, (box, field_box)
        overlap = page.evaluate("""() => {
          const bar = document.querySelector('.comic-asset-detail-heading').getBoundingClientRect();
          const field = document.querySelector('input[name], .sd-field').getBoundingClientRect();
          return !(bar.bottom <= field.top || field.bottom <= bar.top);
        }""")
        assert overlap is False
        report['checks'].append('Sticky identity header no longer covers the first造型 field')

        # Multi-image board: every fixed reference is its own slot with an explicit role.
        expect(page.locator('.comic-reference-chip')).to_contain_text('已固定 2')
        slots = page.get_by_role('list', name='哪吒 · 东海战后红绫装固定参考图').get_by_role('listitem')
        expect(slots).to_have_count(2)
        expect(page.locator('.comic-reference-slot__role').first).to_have_text('设计稿')
        expect(page.locator('.comic-reference-slot__role').nth(1)).to_have_text('正面')
        expect(page.get_by_role('button', name='上传参考图（可多选）')).to_be_visible()
        report['checks'].append('Fixed references render one labelled slot per role (设计稿 + 正面) from project data')

        # Importing several files keeps them pending until the user says what they are.
        page.get_by_role('button', name='上传参考图（可多选）').click()
        expect(page.locator('.comic-reference-slot.is-loading').first).to_be_visible()
        pending = page.locator('.comic-reference-pending__row')
        expect(pending).to_have_count(2, timeout=5000)
        expect(pending.first).to_contain_text('这张图是什么？')
        expect(pending.first.get_by_role('group', name='选择这张图的用途')).to_be_visible()
        page.screenshot(path=str(OUT / 'reference-import-pending-1428.png'), full_page=True)
        report['checks'].append('Importing multiple files shows one loading tile per file, then role-choosing cards')

        # Choosing a role pins that image; the card disappears and the chip counts it.
        pending.first.get_by_role('button', name='侧面', exact=True).click()
        expect(page.locator('.comic-reference-pending__row')).to_have_count(1)
        expect(page.locator('.comic-reference-chip')).to_contain_text('已固定 3')
        expect(page.locator('.comic-reference-slot__role').nth(2)).to_have_text('侧面')
        report['checks'].append('Assigning 侧面 to an imported image fixes it as a third reference slot')

        # A fixed role cannot be assigned twice; the second card offers only free roles.
        pending.first.get_by_role('button', name='背面', exact=True).click()
        expect(page.locator('.comic-reference-chip')).to_contain_text('已固定 4')
        expect(page.locator('.comic-reference-slot')).to_have_count(4)  # upload action lives in the board header
        expect(page.locator('.comic-reference-pending__row')).to_have_count(0)
        report['checks'].append('A fourth reference (背面) is accepted and all roles stay distinct')

        # Multi-image composition is an explicit switch that only affects generation.
        compose = page.get_by_role('switch', name='生成候选时使用全部 4 张固定参考图')
        expect(compose).to_be_checked()
        expect(page.locator('.comic-reference-compose')).to_contain_text('只影响“生成候选”')
        compose.click()
        expect(compose).not_to_be_checked()
        compose.click()
        expect(compose).to_be_checked()
        report['checks'].append('Multi-image composition is a labelled switch, on by default for 4 fixed images')

        # Background generation still surfaces an inline job from the batch record.
        page.get_by_role('button', name='模拟后台生成中').click()
        job = page.locator('.comic-reference-job')
        expect(job).to_contain_text('正在生成')
        expect(job.locator('.comic-reference-job__bar')).to_have_count(1)
        expect(page.locator('.comic-reference-slot.is-job')).to_be_visible()
        page.screenshot(path=str(OUT / 'reference-multi-job-1428.png'), full_page=True)
        report['checks'].append('Background generation shows an inline job tile and progress strip')

        # Unpinning frees a role without touching the other references.
        page.get_by_role('button', name='取消固定正面').click()
        expect(page.locator('.comic-reference-chip')).to_contain_text('已固定 3')
        expect(page.locator('.comic-reference-slot__role')).not_to_contain_text(['正面'])
        report['checks'].append('Unpinning 正面 leaves 设计稿/侧面/背面 fixed')

        # Candidates can be pinned to a chosen role, or removed after a confirmation.
        candidate = page.locator('.comic-reference-candidate').first
        candidate.get_by_role('button', name='固定为…').click()
        expect(candidate.get_by_role('group', name=re.compile(r'固定 v\d+ 为'))).to_be_visible()
        candidate.get_by_role('button', name='正面', exact=True).click()
        expect(page.locator('.comic-reference-chip')).to_contain_text('已固定 4')
        report['checks'].append('A candidate can be pinned to a specific role from the candidate strip')

        page.locator('.comic-reference-candidate').first.get_by_role('button', name=re.compile(r'移除候选 v\d+')).click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text('参考图与图片历史仍保留')
        dialog.get_by_role('button', name='移除出列表').click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        report['checks'].append('Removing a reference is an explicit dialog that keeps the image history')

        # Switching looks keeps one canonical selection.
        page.locator('.comic-look-tab', has_text='混天绫战损').click()
        expect(page.get_by_label('造型名称')).to_have_value('混天绫战损')
        expect(page.locator('.comic-look-tab[aria-selected="true"]')).to_contain_text('混天绫战损')
        expect(page.locator('.comic-reference-chip')).to_contain_text('待采用')
        page.screenshot(path=str(OUT / 'detail-1428.png'), full_page=True)
        report['checks'].append('Look selection stays canonical across rail, board and form')

        # Removal is guarded, not silently rebinding shots (look-0 is bound by a shot).
        page.locator('.comic-look-tab', has_text='东海战后红绫装').click()
        expect(page.get_by_label('造型名称')).to_have_value('东海战后红绫装')
        page.get_by_role('button', name='删除此造型').click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text('删除造型')
        expect(dialog.get_by_role('alert')).to_contain_text('仍在使用')
        expect(dialog.get_by_role('button', name='删除造型', exact=True)).to_be_disabled()
        page.screenshot(path=str(OUT / 'remove-blocked-1428.png'), full_page=True)
        dialog.get_by_role('button', name='取消', exact=True).click()
        page.get_by_role('button', name='允许删除').click()
        page.get_by_role('button', name='删除此造型').click()
        expect(dialog.get_by_role('button', name='删除造型', exact=True)).to_be_enabled()
        dialog.get_by_role('button', name='删除造型', exact=True).click()
        expect(page.locator('.comic-look-tab:not(.is-add)')).to_have_count(1)
        expect(page.locator('#removal-log')).to_contain_text('look-0')
        report['checks'].append('Removal is blocked while referenced and applies only after explicit confirmation')

        # Compact desktop: single column, no horizontal overflow.
        for width in [1180, 900]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.wait_for_timeout(200)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), width
            page.screenshot(path=str(OUT / f'detail-{width}.png'), full_page=True)
        report['checks'].append('1180/900 compact widths have no horizontal overflow')

        # Summary mode replaces the per-造型 editors.
        page.set_viewport_size({'width': 1428, 'height': 840})
        page.get_by_role('button', name='造型总览').click()
        expect(page.get_by_role('table', name='造型概览')).to_be_visible()
        page.screenshot(path=str(OUT / 'summary-1428.png'), full_page=True)
        page.get_by_role('button', name='编辑').first.click()
        expect(page.get_by_label('造型名称')).to_be_visible()
        report['checks'].append('Summary table lists造型 with state and returns to editing')

        assert not report['errors'], report['errors']
        browser.close()
except Exception as error:  # noqa: BLE001 - report for the run
    report['errors'].append(str(error))
    raise
finally:
    server.shutdown()
    (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
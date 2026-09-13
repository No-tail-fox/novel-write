"""Full-source creation and persistence QA in an isolated production Electron profile."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts' / 'director-long-script-qa'
TEMP_ROOT = ROOT / '.codex-audit-temp'
spec = importlib.util.spec_from_file_location('long_script_helpers', ROOT / 'scripts' / 'qa-director-desk.py')
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TITLE = 'VOX 全文时长验收'
SOURCE = '  第一段原稿。\n\n' + '完整事实与上下文。' * 1330 + '\n最后一段原稿。  '
SIZES = [(1536, 1024), (1040, 720)]


def document(page, task_id):
    return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', task_id)


def capture(page, report, name, size, focus=None):
    base.set_size(page, *size)
    if focus:
        focus.scroll_into_view_if_needed()
    metrics = page.evaluate('''() => ({
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wizardOverflow: (() => { const e = document.querySelector('.director-create-panel'); return e ? e.scrollWidth - e.clientWidth : 0; })(),
      selectedFilmstrip: (() => {
        const strip = document.querySelector('.director-filmstrip');
        const selected = strip?.querySelector('[aria-pressed="true"]');
        if (!selected) return null;
        const r = selected.getBoundingClientRect(), p = strip.getBoundingClientRect();
        return { left: r.left, right: r.right, containerLeft: p.left, containerRight: p.right };
      })(),
      dialog: (() => { const e = document.querySelector('[role="dialog"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; })(),
      mojibake: /[\uFFFD]/u.test(document.body.innerText),
    })''')
    assert metrics['documentOverflow'] <= 1 and metrics['wizardOverflow'] <= 1, metrics
    assert not metrics['mojibake'], metrics
    if metrics['selectedFilmstrip']:
        selected = metrics['selectedFilmstrip']
        assert selected['left'] >= selected['containerLeft'] - 1 and selected['right'] <= selected['containerRight'] + 1, selected
    if metrics['dialog']:
        rect = metrics['dialog']
        assert rect['x'] >= 0 and rect['y'] >= 0 and rect['right'] <= size[0] + 1 and rect['bottom'] <= size[1] + 1, rect
    filename = f'{name}-{size[0]}x{size[1]}.png'
    page.screenshot(path=ARTIFACTS / filename, animations='disabled')
    variance = base.screenshot_variance(ARTIFACTS / filename)
    assert variance > 10, variance
    report['captures'].append({'file': filename, 'metrics': metrics, 'variance': variance})


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-long-script-', dir=TEMP_ROOT))
    preload = profile / 'block-network.cjs'
    preload.write_text("setImmediate(() => { globalThis.fetch = () => Promise.reject(new Error('Long-script QA forbids generation network calls')); });\n", encoding='utf-8')
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'NODE_OPTIONS': f'--require="{preload.as_posix()}"', 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    env.pop('VITE_DEV_SERVER_URL', None)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    port = base.free_port()
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
    process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=flags)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runtimeErrors': [], 'paidGenerationCalls': 0, 'captures': []}
    page = None
    try:
        endpoint = base.wait_cdp(port, process)
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(endpoint)
            page = browser.contexts[0].pages[0]
            page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            page.route('https://**/*', lambda route: route.abort())
            base.wait_app(page)
            base.set_size(page, *SIZES[0])
            base.navigate(page, 'editorial-collage', '[data-director-create-wizard]')
            page.get_by_role('textbox', name='项目标题', exact=True).fill(TITLE)
            source = page.get_by_role('textbox', name='原始文案', exact=True)
            source.fill(SOURCE)
            duration = page.get_by_role('combobox', name='起步时长', exact=True)
            expect(duration).to_have_value('auto')
            expect(page.get_by_role('button', name='下一步', exact=True)).to_be_enabled()
            report['defaultFullText'] = True
            duration.select_option('60000')
            expect(page.get_by_role('button', name='下一步', exact=True)).to_be_disabled()
            expect(page.get_by_text('超过所选 60 秒', exact=False)).to_be_visible()
            for size in SIZES:
                capture(page, report, 'duration-error', size)
                capture(page, report, 'duration-error-actions', size, page.get_by_role('button', name='下一步', exact=True))
            duration.select_option('auto')
            expect(page.get_by_role('button', name='下一步', exact=True)).to_be_enabled()
            expect(page.locator('.director-structure-preview')).to_contain_text('预计朗读至少')
            expect(page.locator('.director-structure-preview')).to_contain_text('字/秒')
            report['readingSpeedVisible'] = True
            for size in SIZES:
                capture(page, report, 'full-source-plan', size)
                capture(page, report, 'full-source-actions', size, page.get_by_role('button', name='下一步', exact=True))
            # Creation draft must retain the original and the auto mode across a reload.
            page.get_by_role('button', name='返回新建任务', exact=True).click()
            leave = page.get_by_role('dialog', name='保留未保存的改动？', exact=True)
            expect(leave).to_be_visible()
            leave.get_by_role('button', name='保存并离开', exact=True).click()
            expect(leave).not_to_be_visible()
            base.reload_app(page)
            base.navigate(page, 'editorial-collage', '[data-director-create-wizard]')
            expect(page.get_by_role('textbox', name='原始文案', exact=True)).to_have_value(SOURCE)
            expect(page.get_by_role('combobox', name='起步时长', exact=True)).to_have_value('auto')
            base.set_size(page, *SIZES[0])
            page.get_by_role('button', name='下一步', exact=True).click()
            page.get_by_role('button', name='下一步', exact=True).click()
            page.get_by_role('button', name='创建 VOX 项目', exact=True).click()
            page.wait_for_selector('.director-desk', timeout=30000)
            task_id = page.evaluate('''async title => (await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 50 })).items.find(item => item.title === title).id''', TITLE)
            saved = document(page, task_id)
            shots = [shot for beat in saved['beats'] for shot in beat['shots']]
            cues = [cue for beat in saved['beats'] for cue in beat['subtitleCues']]
            assert saved['sourceText'] == SOURCE
            assert ''.join(cue['text'] for cue in cues) == ' '.join(SOURCE.split())
            assert saved['timeline']['durationMs'] > 120000
            assert all(0 < shot['durationMs'] <= 15000 for shot in shots)
            rows = page.locator('.director-shot-row')
            expect(rows).to_have_count(len(shots))
            rows.last.click()
            expect(rows.last).to_have_attribute('aria-pressed', 'true')
            filmstrip = page.locator('.director-filmstrip-card[aria-pressed="true"]')
            expect(filmstrip).to_be_in_viewport(ratio=0.9)
            expect(page.locator('.director-filmstrip img')).to_have_count(0)
            page.get_by_role('textbox', name='编辑提示词', exact=True).fill('最后镜头的保存重开验收')
            save = page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)
            expect(save).to_be_enabled()
            save.click()
            expect(save).to_be_disabled(timeout=20000)
            saved = document(page, task_id)
            assert saved['beats'][-1]['shots'][-1]['scenePrompt'] == '最后镜头的保存重开验收'
            for size in SIZES:
                capture(page, report, 'last-shot', size)
                page.get_by_role('button', name='剧本', exact=True).click()
                dialog = page.get_by_role('dialog', name='剧本原稿', exact=True)
                expect(dialog).to_be_visible()
                expect(dialog.get_by_role('textbox', name='原始文案', exact=True)).to_have_value(SOURCE)
                expect(dialog.get_by_role('textbox', name='原始文案', exact=True)).to_have_attribute('readonly', '')
                capture(page, report, 'original-source', size)
                dialog.get_by_role('button', name='关闭', exact=True).click()
                expect(dialog).not_to_be_visible()
            base.reload_app(page)
            base.set_size(page, *SIZES[0])
            base.open_from_history(page, TITLE)
            expect(page.locator('.director-shot-row')).to_have_count(len(shots))
            page.locator('.director-shot-row').last.click()
            page.get_by_role('tab', name='生成', exact=True).click()
            expect(page.get_by_role('textbox', name='编辑提示词', exact=True)).to_have_value('最后镜头的保存重开验收')
            reopened = document(page, task_id)
            assert reopened == saved
            report['paidGenerationCalls'] = len(reopened['providerJobs'])
            report['project'] = {'id': task_id, 'sourceCharacters': len(SOURCE), 'durationMs': saved['timeline']['durationMs'], 'beatCount': len(saved['beats']), 'shotCount': len(shots), 'cueCount': len(cues), 'draftRestored': True, 'savedAndReopened': True, 'originalSourceExact': True}
            assert not report['runtimeErrors'], report['runtimeErrors']
            assert report['paidGenerationCalls'] == 0
            report['status'] = 'passed'
            browser.close()
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png')
                report['failureText'] = page.locator('body').inner_text()[-10000:]
            except Exception:
                pass
        raise
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=10)
            report['processOutputTail'] = {'stdout': stdout.decode('utf-8', errors='replace')[-1500:], 'stderr': stderr.decode('utf-8', errors='replace')[-1500:]}
        except subprocess.TimeoutExpired:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], check=False, capture_output=True)
            process.wait(timeout=10)
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

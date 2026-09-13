"""Verify batch write failure and high-capacity restart in production Electron."""
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
ARTIFACTS = ROOT / '.artifacts' / 'director-batch-faults-qa'
TEMP_ROOT = ROOT / '.codex-audit-temp'
spec = importlib.util.spec_from_file_location('batch_qa_helpers', ROOT / 'scripts' / 'qa-director-desk.py')
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TITLE = 'VOX 批次保存故障验收'


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-batch-faults-', dir=TEMP_ROOT))
    settings = profile / 'control.json'
    settings.write_text(json.dumps({'failRunning': True, 'createDelayMs': 800}), encoding='utf-8')
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'STORYDREAM_BATCH_QA_DIR': str(profile), 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    env.pop('NODE_OPTIONS', None)
    env.pop('VITE_DEV_SERVER_URL', None)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runtimeErrors': [], 'paidGenerationCalls': 0, 'captures': []}
    process = browser = page = None

    def launch(playwright):
        port = base.free_port()
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        with (ARTIFACTS / 'electron.log').open('wb') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts' / 'qa-director-batch-faults.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            connected = playwright.chromium.connect_over_cdp(base.wait_cdp(port, child))
            current = connected.contexts[0].pages[0]
            current.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
            base.wait_app(current)
            return child, connected, current
        except Exception:
            child.kill()
            child.wait(timeout=10)
            raise

    try:
        with sync_playwright() as playwright:
            process, browser, page = launch(playwright)
            base.seed_services(page, 'http://127.0.0.1:1/v1')
            base.set_size(page, 1536, 1024)
            base.navigate(page, 'editorial-collage', '[data-director-create-wizard]')
            page.get_by_role('textbox', name='项目标题', exact=True).fill(TITLE)
            page.get_by_role('textbox', name='原始文案', exact=True).fill(base.PROJECT_SOURCE)
            page.get_by_role('button', name='下一步', exact=True).click()
            page.get_by_role('button', name='下一步', exact=True).click()
            page.get_by_role('button', name='创建 VOX 项目', exact=True).click()
            page.wait_for_selector('.director-desk', timeout=30000)
            task_id = page.evaluate('async title => (await window.storydream.listTasks({ taskType: "editorial-collage", limit: 50 })).items.find(item => item.title === title).id', TITLE)
            page.get_by_role('button', name='批量生成', exact=True).click()
            dialog = page.get_by_role('dialog', name='批量生成计划', exact=True)
            for name in ['AI 动态海报', '旁白音频', '最终成片']:
                dialog.get_by_role('checkbox', name=name, exact=True).uncheck()
            dialog.get_by_role('button', name='开始批量生成', exact=True).click()
            expect(page.get_by_text('正在保存批次', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='暂停批量生成', exact=True)).to_have_count(0)
            expect(page.locator('.director-batch-run-heading')).to_contain_text('批量生成已暂停', timeout=20000)
            expect(page.get_by_role('button', name='核对远端后继续批量生成', exact=True)).to_be_visible()
            expect(page.locator('.director-desk')).to_contain_text('批次状态未保存')
            first = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert first['installed'] and first['injectedFailures'] == 1 and first['generationCalls'] == [], first
            rows = page.evaluate('async id => window.storydream.listDirectorBatches({ projectId: id })', task_id)
            assert len(rows) == 1 and all(node['status'] == 'pending' for node in rows[0]['nodes']), rows
            report['writeFailure'] = {'zeroGenerationCalls': True, 'databaseNodesStillPending': True, 'batchId': rows[0]['id']}
            # Parent state changes must not replace the local recovery state with a stale DB snapshot.
            page.get_by_role('tab', name='生成', exact=True).click()
            page.get_by_role('textbox', name='编辑提示词', exact=True).fill('保存失败后修改提示词，队列仍保持暂停。')
            expect(page.locator('.director-batch-run-heading')).to_contain_text('批量生成已暂停')
            expect(page.get_by_role('button', name='核对远端后继续批量生成', exact=True)).to_be_visible()
            report['parentRefreshPreservesRecovery'] = True
            expect(page.locator('.director-batch-node.is-running')).to_have_count(0)
            expect(page.locator('.director-batch-node .director-spin')).to_have_count(0)
            for width, height in [(1536, 1024), (1040, 720)]:
                base.set_size(page, width, height)
                if width == 1040:
                    toggle = page.get_by_role('button', name='显示检查器', exact=True)
                    if toggle.count() and toggle.is_visible():
                        toggle.click()
                heading = page.locator('.director-batch-run-heading')
                heading.scroll_into_view_if_needed()
                metrics = heading.evaluate('''element => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                  buttons: [...element.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label') || button.innerText, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; }) })''')
                assert metrics['overflow'] <= 1 and all(button['inside'] for button in metrics['buttons']), metrics
                filename = f'write-failure-{width}x{height}.png'
                page.screenshot(path=ARTIFACTS / filename, animations='disabled')
                assert base.screenshot_variance(ARTIFACTS / filename) > 10
                report['captures'].append({'file': filename, 'metrics': metrics})
            settings.write_text(json.dumps({'failRunning': False, 'createDelayMs': 0}), encoding='utf-8')
            page.get_by_role('button', name='取消未开始项', exact=True).click()
            expect(page.locator('.director-batch-run-heading')).to_contain_text('最近一次批量任务已结束')
            cancelled = page.evaluate('async id => window.storydream.getDirectorBatch(id)', rows[0]['id'])
            assert cancelled['status'] == 'cancelled' and all(node['status'] == 'cancelled' for node in cancelled['nodes']), cancelled
            report['cancelWithoutLiveRunner'] = True

            save = page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)
            save.click()
            expect(save).to_be_disabled(timeout=20000)
            reentry_id = page.evaluate('''async id => {
              const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
              const shots = doc.beats.flatMap(beat => beat.shots);
              const nodes = shots.map((shot, index) => ({ id: 'image:' + shot.id, shotId: shot.id, capability: 'image', title: shot.title || shot.id,
                status: index < 2 ? 'completed' : index === 2 ? 'running' : 'pending', estimatedCost: 0, dependencies: [] }));
              const created = await window.storydream.createDirectorBatch({ workflowKind: 'director', projectId: id, status: 'running', concurrency: 2,
                plan: { scope: 'all', shots, capabilities: { image: true, video: false, voice: false, render: false }, outputReady: false, renderFailed: false }, nodes });
              return created.id;
            }''', task_id)
            base.reload_app(page)
            base.open_from_history(page, TITLE, preserve_current=True)
            expect(page.locator('.director-batch-run-heading')).to_contain_text('批量生成已暂停')
            expect(page.locator('.director-batch-run-heading')).to_contain_text('2/4 已完成')
            expect(page.locator('.director-batch-node.is-running')).to_contain_text('远端状态待核对')
            expect(page.locator('.director-batch-node .director-spin')).to_have_count(0)
            page.get_by_role('button', name='取消未开始项', exact=True).click()
            expect(page.locator('.director-batch-run-heading')).to_contain_text('最近一次批量任务已结束')
            reentered = page.evaluate('async id => window.storydream.getDirectorBatch(id)', reentry_id)
            assert [node['status'] for node in reentered['nodes']] == ['completed', 'completed', 'running', 'cancelled'], reentered
            report['sameProcessReentry'] = {'requiresReconciliation': True, 'completedPreserved': 2, 'unknownRemoteWorkNotMarkedCancelled': True}

            capacities = page.evaluate('''async () => {
              const results = [];
              for (const [count, dynamic] of [[300, false], [500, true]]) {
                const shots = Array.from({ length: count }, (_, index) => ({ id: 'shot-' + index, title: 'Shot ' + index }));
                const nodes = shots.flatMap(shot => (dynamic ? ['image', 'voice', 'video'] : ['image', 'voice']).map(capability => ({
                  id: capability + ':' + shot.id, shotId: shot.id, capability, title: shot.title,
                  status: 'pending', estimatedCost: 0, dependencies: capability === 'video' ? ['image:' + shot.id] : [],
                })));
                nodes.push({ id: 'render:all', capability: 'render', title: 'Render', status: 'pending', estimatedCost: 0, dependencies: nodes.map(node => node.id) });
                const created = await window.storydream.createDirectorBatch({ id: 'qa-capacity-' + count, workflowKind: 'director', projectId: 'qa-capacity-project', status: 'running', concurrency: 4,
                  plan: { scope: 'all', shots, capabilities: { image: true, video: true, voice: true, render: true }, outputReady: false, renderFailed: false }, nodes });
                const updated = await window.storydream.updateDirectorBatch(created.id, { expectedUpdatedAt: created.updatedAt, nodes: nodes.map((node, index) => ({ ...node, status: index < 300 ? 'completed' : index === 300 ? 'running' : 'pending' })) });
                results.push({ id: updated.id, count: updated.nodes.length, dependencies: updated.nodes.at(-1).dependencies.length });
              }
              return results;
            }''')
            assert [entry['count'] for entry in capacities] == [601, 1501], capacities
            final_ledger = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert final_ledger['generationCalls'] == [], final_ledger
            report['ledger'] = final_ledger
            browser.close()
            browser = None
            process.kill()
            process.wait(timeout=10)
            process = None
            process, browser, page = launch(playwright)
            restored = page.evaluate('''async () => {
              const records = await window.storydream.listDirectorBatches({ projectId: 'qa-capacity-project' });
              return records.map(record => ({ id: record.id, status: record.status, recovery: record.recoveryRequired, count: record.nodes.length,
                completed: record.nodes.filter(node => node.status === 'completed').length, dependencies: record.nodes.at(-1).dependencies.length, running: record.nodes.filter(node => node.status === 'running').length }));
            }''')
            assert len(restored) == 2
            for record in restored:
                assert record['status'] == 'paused' and record['recovery'] and record['completed'] == 300 and record['running'] == 0, record
                assert record['dependencies'] == record['count'] - 1, record
            report['restartCapacity'] = restored
            assert report['runtimeErrors'] == [], report['runtimeErrors']
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = repr(error)
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png', animations='disabled')
            except Exception:
                pass
    finally:
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        report['isolatedProfile'] = str(profile)
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()

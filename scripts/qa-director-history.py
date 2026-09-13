"""Production Electron history capacity, local provider fixtures, and pagination QA."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts' / 'director-history-qa'
TEMP_ROOT = ROOT / '.codex-audit-temp'


def helper(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = helper('history_director_helpers', 'qa-director-desk.py')
dialogue = helper('history_dialogue_helpers', 'qa-motion-comic-dialogue.py')


def open_project(page, title):
    back = page.get_by_role('button', name='返回全部任务', exact=True)
    if back.count() and back.first.is_visible():
        try:
            back.first.click(timeout=10000)
        except Exception:
            page.screenshot(path=ARTIFACTS / 'navigation-failure.png', animations='disabled')
            raise AssertionError({'dialogs': page.get_by_role('dialog').all_inner_texts(), 'target': title})
    else:
        page.locator('button[data-nav-view="history"]').first.click()
    page.wait_for_selector('[data-task-operations="history"]')
    page.get_by_role('textbox', name='搜索历史记录').fill(title)
    page.get_by_role('button', name=f'打开任务 {title}', exact=True).click()
    page.wait_for_selector('.director-desk', timeout=30000)


def counts(page, project_id):
    return page.evaluate('''async id => {
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      return { assets: doc.assets.length, jobs: doc.providerJobs.length, audio: doc.assets.filter(a => a.kind === 'audio').length,
        originalAssets: doc.assets.filter(a => a.id.startsWith('seed-asset-')).length,
        originalJobs: doc.providerJobs.filter(j => j.id.startsWith('seed-job-')).length };
    }''', project_id)


def measured_voice_assets(page, project_id):
    return page.evaluate('''async id => {
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      return doc.assets.filter(asset => asset.kind === 'audio').map(asset => ({ id: asset.id, durationMs: asset.durationMs, localPath: asset.localPath }));
    }''', project_id)


def wait_measured_voice_assets(page, project_id):
    deadline = time.monotonic() + 40
    measured = []
    while time.monotonic() < deadline:
        measured = measured_voice_assets(page, project_id)
        if measured and all(isinstance(item.get('durationMs'), (int, float)) and item['durationMs'] > 0 for item in measured):
            return measured
        page.wait_for_timeout(250)
    raise AssertionError(measured)


def wait_counts(page, project_id, expected):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        actual = counts(page, project_id)
        if all(actual[key] == value for key, value in expected.items()):
            return actual
        page.wait_for_timeout(200)
    raise AssertionError({'expected': expected, 'actual': actual, 'feedback': page.locator('.director-desk').inner_text()[-3500:]})


def fill_history(page, project_id, amount, image_path):
    return page.evaluate('''async ({ id, amount, imagePath }) => {
      const task = await window.storydream.getTaskDetail(id);
      const doc = JSON.parse(task.pipelineData);
      const comic = doc.workflowKind === 'motion-comic';
      const episode = comic ? doc.episodes[0] : null;
      const shot = comic ? episode.scenes[0].shots[0] : doc.beats[0].shots[0];
      const timeline = comic ? episode.timeline : doc.timeline;
      const originalAssets = doc.assets.length;
      for (let n = doc.providerJobs.length; n < amount; n += 1) {
        doc.providerJobs.push({ id: `seed-job-${n}`, workflowKind: doc.workflowKind, nodeId: shot.id,
          providerId: 'local-history', model: 'fixture', capability: 'text-to-image', status: n === 0 ? 'failed' : 'completed',
          ...(n === 0 ? { error: '最早失败记录' } : {}), inputHash: `seed-${n}`, idempotencyKey: `seed-${n}`,
          estimatedCost: 0, actualCost: 0, attempt: n % 3 + 1, createdAt: doc.createdAt, updatedAt: doc.createdAt });
      }
      for (let n = doc.assets.length; n < amount; n += 1) {
        doc.assets.push({ id: `seed-asset-${n}`, assetId: `shot-keyframe-${shot.id}`, kind: 'image', localPath: imagePath,
          providerJobId: `seed-job-${n}`, provider: 'local-history', createdAt: doc.createdAt, selected: false, pinned: false });
      }
      if (originalAssets === 0) {
        const image = doc.assets[1];
        image.selected = true;
        image.pinned = true;
        if (comic) {
          shot.firstFrameAssetVersionId = image.id;
          timeline.clips.find(c => c.shotId === shot.id).assetVersionIds = [image.id];
          const references = [
            ...doc.characters.flatMap(c => c.looks.map(target => ({ target, kind: 'look' }))),
            ...doc.sceneAssets.map(target => ({ target, kind: 'scene' })),
            ...doc.props.map(target => ({ target, kind: 'prop' }))
          ];
          references.forEach(({ target, kind }, index) => {
            const reference = doc.assets[index + 2];
            reference.assetId = `motion-comic-reference-${kind}-${target.id}`;
            reference.selected = true;
            reference.pinned = true;
            target.referenceAssetVersionIds = [reference.id];
          });
          const clip = timeline.clips.find(c => c.shotId === shot.id);
          const cueIds = ['history-dialogue-a', 'history-dialogue-b'];
          episode.dialogueCues = episode.dialogueCues.filter(c => c.shotId !== shot.id).concat([
            { id: cueIds[0], shotId: shot.id, text: '全部历史都要保留。', startMs: clip.startMs, endMs: clip.startMs + 2000, emotion: '自然' },
            { id: cueIds[1], shotId: shot.id, text: '继续生成下一句对白。', startMs: clip.startMs + 2500, endMs: clip.startMs + 4500, emotion: '自然' }
          ]);
          shot.dialogueCueIds = cueIds;
          clip.subtitleCueIds = cueIds;
        } else {
          shot.layers[0].assetVersionId = image.id;
          timeline.clips.find(c => c.shotId === shot.id).assetVersionIds = [image.id];
        }
      }
      const input = { id, document: doc, expectedUpdatedAt: doc.updatedAt };
      await (comic ? window.storydream.saveMotionComic(input) : window.storydream.saveEditorialCollage(input));
      return { id, title: doc.title, kind: doc.workflowKind, shotId: shot.id };
    }''', {'id': project_id, 'amount': amount, 'imagePath': str(image_path)})


def generate_voice(page):
    page.get_by_role('tab', name='字幕', exact=True).click()
    page.locator('.director-form-stack').get_by_role('button', name='生成旁白', exact=True).last.click()


def capture(page, report, name):
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_size(page, width, height)
        toggle = page.get_by_role('button', name='显示检查器', exact=True)
        if toggle.count() and toggle.is_visible():
            toggle.click()
        page.locator('.director-queue-heading').scroll_into_view_if_needed()
        geometry = page.evaluate('''() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          rows: document.querySelectorAll('.director-queue-item').length, assets: document.querySelectorAll('.director-asset-tile').length,
          narratorHeight: document.querySelector('.director-narrator-card')?.getBoundingClientRect().height ?? 0 })''')
        assert geometry['overflow'] <= 1 and geometry['rows'] <= 20 and geometry['assets'] <= 36 and geometry['narratorHeight'] <= 200, geometry
        filename = f'{name}-{width}x{height}.png'
        page.screenshot(path=ARTIFACTS / filename, animations='disabled')
        assert base.screenshot_variance(ARTIFACTS / filename) > 10
        report['captures'].append({'file': filename, 'geometry': geometry})
    base.set_size(page, 1536, 1024)


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-history-', dir=TEMP_ROOT))
    shutil.copyfile(ROOT / 'src/assets/director-desk/preview-city.png', profile / 'frame.png')
    (profile / 'voice.wav').write_bytes(dialogue.fixture_wav(440))
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'STORYDREAM_HISTORY_QA_DIR': str(profile), 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runtimeErrors': [], 'captures': [], 'projects': [], 'paidGenerationCalls': 0}
    process = browser = page = None
    ledger = lambda: json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))

    def launch(playwright):
        port = base.free_port()
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        with (ARTIFACTS / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-history.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            connected = playwright.chromium.connect_over_cdp(base.wait_cdp(port, child))
            deadline = time.monotonic() + 30
            current = None
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise RuntimeError(f'Electron exited before the history page was created: {child.returncode}')
                contexts = connected.contexts
                if contexts and contexts[0].pages:
                    current = contexts[0].pages[0]
                    break
                time.sleep(0.2)
            if current is None:
                raise TimeoutError('Electron CDP connected but did not create a history page.')
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
            dialogue.configure_local_tts(page)
            base.set_size(page, 1536, 1024)
            for kind in ['editorial-collage', 'motion-comic']:
                title = ('VOX' if kind == 'editorial-collage' else '漫剧') + ' 历史容量验收'
                project_id = page.evaluate('''async ({kind, title}) => {
                  if (kind === 'editorial-collage') await window.storydream.createEditorialCollage({ title, sourceText: '保留全部历史版本。继续创作新的画面。' });
                  else await window.storydream.createMotionComic({ title, premise: '保留全部历史版本，继续创作新的画面。' });
                  return (await window.storydream.listTasks({taskType: kind, limit: 50})).items.find(t => t.title === title).id;
                }''', {'kind': kind, 'title': title})
                project = fill_history(page, project_id, 499, profile / 'frame.png')
                open_project(page, title)
                page.get_by_role('button', name='生成当前镜头', exact=True).click()
                wait_counts(page, project_id, {'assets': 500, 'jobs': 500})
                generate_voice(page)
                measured = wait_measured_voice_assets(page, project_id)
                project['measuredVoiceAssets'] = measured
                expected_count = 501 if kind == 'editorial-collage' else 502
                project['crossedOldLimit'] = wait_counts(page, project_id, {'assets': expected_count, 'jobs': expected_count})
                assert project['crossedOldLimit']['originalAssets'] == 499 and project['crossedOldLimit']['originalJobs'] == 499
                assert project['crossedOldLimit']['audio'] == expected_count - 500
                fill_history(page, project_id, 4500, profile / 'frame.png')
                base.reload_app(page)
                open_project(page, title)
                expect(page.locator('.director-queue-item')).to_have_count(20)
                page.get_by_role('button', name='生成记录末页', exact=True).click()
                expect(page.get_by_role('button', name='生成记录下一页', exact=True)).to_be_disabled()
                expect(page.locator('.director-queue-panel')).to_contain_text('最早失败记录')
                page.get_by_role('tablist', name='生成记录状态', exact=True).get_by_role('tab', name='失败', exact=True).click()
                expect(page.locator('.director-queue-item')).to_have_count(1)
                expect(page.locator('.director-queue-item')).to_contain_text('最早失败记录')
                page.get_by_role('tablist', name='生成记录状态', exact=True).get_by_role('tab', name='全部', exact=True).click()
                page.get_by_role('button', name='生成记录首页', exact=True).click()
                page.get_by_role('button', name='显示全部素材', exact=False).click()
                expect(page.locator('.director-asset-tile')).to_have_count(36)
                page.get_by_role('button', name='素材末页', exact=True).click()
                expect(page.get_by_role('button', name='素材下一页', exact=True)).to_be_disabled()
                last_asset = page.locator('.director-asset-tile strong').last.inner_text()
                page.get_by_role('textbox', name='搜索素材', exact=True).fill(last_asset)
                expect(page.locator('.director-asset-tile')).to_have_count(1)
                expect(page.locator('.director-asset-tile')).to_contain_text(last_asset)
                page.get_by_role('textbox', name='搜索素材', exact=True).fill('')
                page.get_by_role('tab', name='版本', exact=True).click()
                expect(page.locator('.director-version-list button')).to_have_count(20)
                page.get_by_role('button', name='镜头版本末页', exact=True).click()
                expect(page.get_by_role('button', name='镜头版本下一页', exact=True)).to_be_disabled()
                await_counts = counts(page, project_id)
                assert await_counts['assets'] == 4500 and await_counts['jobs'] == 4500
                project['largeHistory'] = await_counts
                capture(page, report, kind + '-history')

                fill_history(page, project_id, 19999, profile / 'frame.png')
                base.reload_app(page)
                open_project(page, title)
                if kind == 'motion-comic':
                    before = ledger()
                    page.get_by_role('tab', name='字幕', exact=True).click()
                    page.get_by_role('button', name='重新生成旁白', exact=True).click()
                    expect(page.locator('.director-desk')).to_contain_text('本次需要 2 条')
                    assert ledger() == before, ledger()
                    project['twoCuesRejectedWithOneSlot'] = True
                page.get_by_role('tab', name='生成', exact=True).click()
                page.get_by_role('button', name='生成当前镜头', exact=True).click()
                wait_counts(page, project_id, {'assets': 20000, 'jobs': 20000})
                before = ledger()
                page.get_by_role('button', name='生成当前镜头', exact=True).click()
                expect(page.locator('.director-desk')).to_contain_text('容量不足')
                page.get_by_role('tab', name='字幕', exact=True).click()
                page.get_by_role('button', name='重新生成旁白', exact=True).click()
                expect(page.locator('.director-desk')).to_contain_text('容量不足')
                expect(page.locator('.director-queue-heading')).to_contain_text('失败 1')
                page.get_by_role('button', name='查看错误详情', exact=True).click()
                details = page.get_by_role('dialog', name='操作未完成', exact=True)
                expect(details).to_contain_text('容量不足')
                details.get_by_role('button', name='关闭', exact=True).click()
                page.get_by_role('tab', name='声音', exact=True).click()
                page.get_by_role('button', name='导入本地音频', exact=True).click()
                expect(page.locator('[data-director-sound-inspector]')).to_contain_text('容量不足')
                page.get_by_role('button', name='批量生成', exact=True).click()
                dialog = page.get_by_role('dialog', name='批量生成计划', exact=True)
                expect(dialog).to_contain_text('容量不足')
                expect(dialog.get_by_role('button', name='开始批量生成', exact=True)).to_be_disabled()
                for width, height in [(1536, 1024), (1040, 720)]:
                    base.set_size(page, width, height)
                    expect(dialog.get_by_role('button', name='开始批量生成', exact=True)).to_be_visible()
                    page.screenshot(path=ARTIFACTS / f'{kind}-capacity-{width}x{height}.png', animations='disabled')
                    geometry = dialog.evaluate('''element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; }''')
                    assert geometry['inside'], geometry
                    report['captures'].append({'file': f'{kind}-capacity-{width}x{height}.png', 'geometry': geometry})
                page.keyboard.press('Escape')
                base.set_size(page, 1536, 1024)
                assert ledger() == before, {'before': before, 'after': ledger()}
                project['singleAndBatchRejectedBeforeCalls'] = True
                project['mainPreflight'] = page.evaluate('''async ({id, shotId, kind}) => {
                  const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
                  const result = {};
                  for (const mode of kind === 'editorial-collage' ? ['video', 'render'] : ['render']) {
                    try {
                      if (mode === 'video') await window.storydream.generateDirectorShotVideo({ id, shotId, expectedUpdatedAt: doc.updatedAt });
                      else await window.storydream.renderDirectorProject({ id });
                      result[mode] = 'unexpected success';
                    } catch (error) {
                      const encoded = error.message.split('__STORYDREAM_SAFE_APP_ERROR_V1__:')[1];
                      result[mode] = encoded ? JSON.parse(decodeURIComponent(encoded)).message : error.message;
                    }
                  }
                  return result;
                }''', project)
                assert all('容量不足' in error for error in project['mainPreflight'].values()), project['mainPreflight']
                assert ledger()['imageRequests'] == before['imageRequests'] and ledger()['voiceRequests'] == before['voiceRequests']
                project['beforeRestart'] = counts(page, project_id)
                report['projects'].append(project)
            report['generationLedger'] = ledger()
            assert report['generationLedger']['imageRequests'] == 4 and report['generationLedger']['voiceRequests'] == 3, report['generationLedger']
            assert report['generationLedger']['blockedExternalCalls'] == 0, report['generationLedger']
            browser.close()
            browser = None
            process.kill()
            process.wait(timeout=15)
            process, browser, page = launch(playwright)
            for project in report['projects']:
                assert counts(page, project['id']) == project['beforeRestart']
                open_project(page, project['title'])
                expect(page.locator('.director-queue-item')).to_have_count(20)
                project['restartPreserved'] = True
            assert report['runtimeErrors'] == [], report['runtimeErrors']
            report['status'] = 'passed'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = repr(error)
        report['traceback'] = traceback.format_exc()
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

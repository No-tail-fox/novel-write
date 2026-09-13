"""Resume large-batch history QA and check two-episode comic image restoration."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import time
import traceback
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts/director-image-restore-qa'
spec = importlib.util.spec_from_file_location('restore_large_helpers', ROOT / 'scripts/qa-director-large-batch.py')
assert spec and spec.loader
large = importlib.util.module_from_spec(spec)
spec.loader.exec_module(large)
history = large.history
base = large.base
history.ARTIFACTS = ARTIFACTS


def document(page, project_id):
    return page.evaluate('''async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)''', project_id)


def save_version(page):
    save = page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)
    save.click()
    expect(save).to_be_disabled(timeout=20000)


def capture(page, report, name):
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_size(page, width, height)
        toggle = page.get_by_role('button', name='显示检查器', exact=True)
        if toggle.count() and toggle.is_visible():
            toggle.click()
        versions = page.locator('.director-version-list')
        versions.scroll_into_view_if_needed()
        expect(versions.locator('button[aria-pressed="true"]')).to_have_count(1)
        expect(versions.locator('button[aria-pressed="true"]')).to_be_in_viewport()
        assert page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth') <= 1
        filename = f'{name}-{width}x{height}.png'
        page.screenshot(path=ARTIFACTS / filename, animations='disabled')
        assert base.screenshot_variance(ARTIFACTS / filename) > 10
        report['captures'].append(filename)
    base.set_size(page, 1536, 1024)


def create_comic(page, title, frame):
    return page.evaluate('''async ({title, frame}) => {
      await window.storydream.createMotionComic({ title, premise: '保留分集画面和两句对白。', ratio: '16:9' });
      const id = (await window.storydream.listTasks({ taskType: 'motion-comic', limit: 50 })).items.find(t => t.title === title).id;
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const originalEpisode = doc.episodes[0];
      const originalScene = originalEpisode.scenes[0];
      const originalShot = originalScene.shots[0];
      doc.assets = []; doc.providerJobs = [];
      const references = [...doc.characters.flatMap(c => c.looks), ...doc.sceneAssets, ...doc.props];
      references.forEach((target, index) => {
        const id = 'reference-' + index;
        doc.assets.push({ id, assetId: id, kind: 'image', localPath: frame, createdAt: doc.createdAt, selected: true, pinned: true });
        target.referenceAssetVersionIds = [id];
      });
      doc.episodes = [1, 2].map(number => {
        const id = 'restore-episode-' + number;
        const shotId = id + '-shot';
        const cues = [1, 2].map(n => ({ id: shotId + '-cue-' + n, shotId, text: '第' + number + '集，第' + n + '句对白。', startMs: (n - 1) * 3000, endMs: n * 3000, emotion: '自然' }));
        const shot = { ...structuredClone(originalShot), id: shotId, episodeId: id, sceneId: id + '-scene', index: 1, title: '第' + number + '集镜头', durationMs: 6000,
          firstFrameAssetVersionId: undefined, lastFrameAssetVersionId: undefined, voiceAssetVersionId: undefined, videoJobId: undefined, dialogueCueIds: cues.map(c => c.id) };
        return { ...structuredClone(originalEpisode), id, number, title: '版本验收第' + number + '集',
          scenes: [{ ...structuredClone(originalScene), id: id + '-scene', episodeId: id, shots: [shot] }], dialogueCues: cues,
          timeline: { durationMs: 6000, audioAssetVersionIds: [], audioClips: [], clips: [{ id: id + '-clip', shotId, startMs: 0, durationMs: 6000, assetVersionIds: [], subtitleCueIds: cues.map(c => c.id), source: 'deterministic' }] } };
      });
      doc.activeEpisodeId = doc.episodes[0].id;
      await window.storydream.saveMotionComic({ id, document: doc, expectedUpdatedAt: doc.updatedAt });
      return { id, referenceCount: references.length };
    }''', {'title': title, 'frame': str(frame)})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--batch-report', type=Path, default=ROOT / '.artifacts/director-large-batch-qa/report.json')
    args = parser.parse_args()
    source = json.loads(args.batch_report.read_text(encoding='utf-8'))
    assert source['firstBatch']['completedJobs'] == 1000 and source['regenerationPreservesHistory']
    profile = Path(source['profile'])
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    ledger_path = profile / 'ledger.json'
    original_ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
    previous_report = ARTIFACTS / 'report.json'
    if previous_report.is_file():
        previous = json.loads(previous_report.read_text(encoding='utf-8'))
        if previous.get('profile') == str(profile):
            original_ledger = previous.get('originalGenerationLedger', original_ledger)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'sourceReport': str(args.batch_report),
              'profile': str(profile), 'runtimeErrors': [], 'captures': [], 'originalGenerationLedger': original_ledger}
    process = browser = page = None
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'STORYDREAM_HISTORY_QA_DIR': str(profile), 'TEMP': str(large.TEMP_ROOT), 'TMP': str(large.TEMP_ROOT)})
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)

    def launch(playwright):
        port = base.free_port()
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        with (ARTIFACTS / 'electron.log').open('ab') as log:
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(ROOT / 'scripts/qa-director-history.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
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

    def save_report():
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    save_report()
    try:
        with sync_playwright() as playwright:
            process, browser, page = launch(playwright)
            base.set_size(page, 1536, 1024)
            project_id = source['projectId']
            initial = document(page, project_id)
            old_id = initial['beats'][-1]['shots'][-1]['layers'][0]['assetVersionId']
            history.open_project(page, large.TITLE)
            page.locator('.director-shot-row').last.click()
            expect(page.locator('.director-filmstrip-card[aria-pressed="true"]')).to_be_in_viewport(ratio=.9)
            page.get_by_role('tab', name='版本', exact=True).click()
            for _ in range(2):
                page.locator('.director-version-list button[aria-pressed="false"]').click()
                save_version(page)
                state = large.inspect_project(page, project_id)
                assert state['referencesValid'] and state['assets'] == state['jobs'] == 1002
                assert len(state['selected']) == 1000
            assert state['lastShot']['layers'][0]['assetVersionId'] == old_id
            paths = [Path(asset['path']) for asset in state['assetRecords']]
            assert len(set(paths)) == 1002 and all(p.is_file() and p.stat().st_size > 0 for p in paths)
            assert document(page, project_id)['providerJobs'] == initial['providerJobs']
            capture(page, report, 'vox-restored-last-shot')
            report['largeBatch'] = {'shots': 500, 'assets': 1002, 'jobs': 1002, 'selected': 1000, 'filesValid': True, 'restoredReferenceValid': True, 'historyUnchanged': True}
            save_report()

            title = '漫剧跨分集版本恢复 ' + time.strftime('%H%M%S')
            comic = create_comic(page, title, profile / 'frame.png')
            history.open_project(page, title)
            episode_states = []
            for index in range(2):
                page.locator('.director-episode-row').nth(index).click()
                page.get_by_role('tab', name='生成', exact=True).click()
                page.get_by_role('button', name='生成当前镜头', exact=True).click()
                expected = comic['referenceCount'] + index * 4 + 1
                history.wait_counts(page, comic['id'], {'assets': expected, 'jobs': index * 4 + 1})
                first_image = document(page, comic['id'])['episodes'][index]['scenes'][0]['shots'][0]['firstFrameAssetVersionId']
                history.generate_voice(page)
                history.wait_counts(page, comic['id'], {'assets': expected + 2, 'jobs': index * 4 + 3})
                page.get_by_role('tab', name='生成', exact=True).click()
                page.get_by_role('button', name='生成当前镜头', exact=True).click()
                history.wait_counts(page, comic['id'], {'assets': expected + 3, 'jobs': index * 4 + 4})
                page.get_by_role('tab', name='版本', exact=True).click()
                expect(page.locator('.director-version-list button')).to_have_count(2)
                page.locator('.director-version-list button[aria-pressed="false"]').click()
                save_version(page)
                current = document(page, comic['id'])
                episode = current['episodes'][index]
                shot = episode['scenes'][0]['shots'][0]
                assert shot['firstFrameAssetVersionId'] == first_image
                referenced = [first_image] + [cue['voiceAssetVersionId'] for cue in episode['dialogueCues']]
                media = {asset['id']: asset for asset in current['assets']}
                jobs = {job['id']: job for job in current['providerJobs']}
                assert all(media[id]['selected'] and jobs[media[id]['providerJobId']]['nodeId'] == shot['id'] for id in referenced)
                assert episode['timeline']['clips'][0]['assetVersionIds'] == [first_image]
                assert len(episode['timeline']['audioAssetVersionIds']) == 2
                if index:
                    assert current['episodes'][0] == episode_states[0]
                episode_states.append(episode)
                capture(page, report, 'comic-episode-' + str(index + 1))
            comic_saved = document(page, comic['id'])
            assert len(comic_saved['providerJobs']) == len({job['id'] for job in comic_saved['providerJobs']}) == 8
            assert all(asset['pinned'] and asset['selected'] for asset in comic_saved['assets'] if asset['id'].startswith('reference-'))
            assert all(Path(asset['localPath']).is_file() for asset in comic_saved['assets'])
            report['comic'] = {'id': comic['id'], 'episodes': 2, 'imageGenerations': 4, 'dialogueGenerations': 4, 'historyPreserved': True, 'episodeOwnershipValid': True}
            history.open_project(page, large.TITLE)
            assert large.inspect_project(page, project_id) == state
            vox_saved = document(page, project_id)
            report['projectSwitchPreserved'] = True
            report['generationLedger'] = json.loads(ledger_path.read_text(encoding='utf-8'))
            assert report['generationLedger']['imageRequests'] == report['generationLedger']['voiceRequests'] == 4
            assert report['generationLedger']['blockedExternalCalls'] == 0
            save_report()
            browser.close()
            browser = None
            process.kill()
            process.wait(timeout=15)
            process, browser, page = launch(playwright)
            assert document(page, project_id) == vox_saved
            assert document(page, comic['id']) == comic_saved
            history.open_project(page, title)
            page.locator('.director-episode-row').first.click()
            page.get_by_role('tab', name='版本', exact=True).click()
            expect(page.locator('.director-version-list button[aria-pressed="true"]')).to_have_count(1)
            report['restartPreserved'] = True
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['status'] = 'passed'
    except Exception as error:
        report.update({'status': 'failed', 'error': repr(error), 'traceback': traceback.format_exc()})
        if page:
            try:
                page.screenshot(path=ARTIFACTS / 'failure.png', animations='disabled')
            except Exception:
                pass
    finally:
        report['finishedAt'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        save_report()
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if process and process.poll() is None:
            process.kill()
            process.wait(timeout=10)
    print(json.dumps({key: value for key, value in report.items() if key not in ['originalGenerationLedger', 'generationLedger']}, ensure_ascii=False, indent=2))
    if report['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()

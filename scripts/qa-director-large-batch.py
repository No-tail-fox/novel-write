"""Run 500 shots through production batch generation using local media responses."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts' / 'director-large-batch-qa'
TEMP_ROOT = ROOT / '.codex-audit-temp'
TITLE = 'VOX 500 镜头完整生成验收'
SHOT_COUNT = 500

spec = importlib.util.spec_from_file_location('large_batch_helpers', ROOT / 'scripts/qa-director-history.py')
assert spec and spec.loader
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)
history.ARTIFACTS = ARTIFACTS
base = history.base


def seed_project(page):
    return page.evaluate('''async ({ title, count }) => {
      await window.storydream.createEditorialCollage({ title, sourceText: '完整生成每个镜头。', durationMs: 30000 });
      const id = (await window.storydream.listTasks({ taskType: 'editorial-collage', limit: 50 })).items.find(t => t.title === title).id;
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const template = doc.beats[0].shots[0];
      doc.beats = Array.from({ length: count / 100 }, (_, beatIndex) => {
        const beatId = 'large-beat-' + beatIndex;
        const shots = Array.from({ length: 100 }, (_, offset) => {
          const index = beatIndex * 100 + offset;
          const id = 'large-shot-' + String(index + 1).padStart(3, '0');
          return { ...structuredClone(template), id, beatId, durationMs: 1000,
            scenePrompt: '本地完整生成镜头 ' + (index + 1), renderStrategy: 'deterministic-layers',
            layers: [{ ...structuredClone(template.layers[0]), id: id + '-layer', motion: template.layers[0].motion.map(k => ({ ...k, atMs: Math.round(k.atMs / template.durationMs * 1000) })) }],
            camera: template.camera.map(k => ({ ...k, atMs: Math.round(k.atMs / template.durationMs * 1000) })),
            subtitleCueIds: [id + '-cue'] };
        });
        const subtitleCues = shots.map((shot, offset) => ({ id: shot.id + '-cue', shotId: shot.id, text: '继续。', startMs: (beatIndex * 100 + offset) * 1000, endMs: (beatIndex * 100 + offset + 1) * 1000 }));
        return { id: beatId, index: beatIndex + 1, title: '节拍 ' + (beatIndex + 1), narration: subtitleCues.map(c => c.text).join(''), startMs: beatIndex * 100000, durationMs: 100000, shots, subtitleCues };
      });
      doc.sourceText = doc.beats.map(b => b.narration).join('');
      doc.assets = []; doc.providerJobs = []; doc.qualityReports = []; doc.stage = 'assets';
      doc.timeline = { durationMs: count * 1000, audioAssetVersionIds: [], clips: doc.beats.flatMap(b => b.shots).map((shot, index) => ({ id: 'clip-' + shot.id, shotId: shot.id, startMs: index * 1000, durationMs: 1000, assetVersionIds: [], subtitleCueIds: shot.subtitleCueIds, source: 'deterministic' })) };
      await window.storydream.saveEditorialCollage({ id, document: doc, expectedUpdatedAt: doc.updatedAt });
      return id;
    }''', {'title': TITLE, 'count': SHOT_COUNT})


def inspect_project(page, project_id):
    return page.evaluate('''async id => {
      const doc = JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData);
      const shots = doc.beats.flatMap(b => b.shots);
      const jobs = new Map(doc.providerJobs.map(j => [j.id, j]));
      const assets = new Map(doc.assets.map(a => [a.id, a]));
      const batches = await window.storydream.listDirectorBatches({ projectId: id });
      return { source: doc.sourceText, shots: shots.length, assets: doc.assets.length, jobs: doc.providerJobs.length,
        images: doc.assets.filter(a => a.kind === 'image').length, audio: doc.assets.filter(a => a.kind === 'audio').length,
        selected: doc.assets.filter(a => a.selected).map(a => a.id).sort(),
        completedJobs: doc.providerJobs.filter(j => j.status === 'completed').length,
        referencesValid: shots.every(s => [s.layers[0].assetVersionId, s.voiceAssetVersionId].every(id => { const a = assets.get(id); return a && a.selected && jobs.get(a.providerJobId)?.nodeId === s.id; })),
        assetRecords: doc.assets.map(a => ({ id: a.id, assetId: a.assetId, path: a.localPath, selected: a.selected, job: a.providerJobId })),
        lastShot: shots.at(-1),
        timelineImages: doc.timeline.clips.filter(c => c.assetVersionIds.length === 1).length,
        timelineAudio: doc.timeline.audioAssetVersionIds.length,
        batches: batches.map(b => ({ id: b.id, status: b.status, count: b.nodes.length, completed: b.nodes.filter(n => n.status === 'completed').length, failed: b.nodes.filter(n => n.status === 'failed'), concurrency: b.concurrency })) };
    }''', project_id)


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='director-large-batch-', dir=TEMP_ROOT))
    with Image.open(ROOT / 'src/assets/director-desk/preview-city.png') as source:
        source.resize((320, 180)).save(profile / 'frame.png')
    (profile / 'voice.wav').write_bytes(history.dialogue.fixture_wav(440))
    env = os.environ.copy()
    env.update({'NODE_ENV': 'production', 'STORYDREAM_HISTORY_QA_DIR': str(profile), 'TEMP': str(TEMP_ROOT), 'TMP': str(TEMP_ROOT)})
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    report = {'status': 'running', 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runtimeErrors': [], 'captures': [], 'profile': str(profile)}
    process = browser = page = None

    def save():
        (ARTIFACTS / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

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

    save()
    try:
        with sync_playwright() as playwright:
            process, browser, page = launch(playwright)
            base.seed_services(page, 'http://127.0.0.1:1/v1')
            history.dialogue.configure_local_tts(page)
            base.set_size(page, 1536, 1024)
            project_id = seed_project(page)
            report['projectId'] = project_id
            history.open_project(page, TITLE)
            expect(page.locator('.director-shot-row')).to_have_count(SHOT_COUNT)
            page.get_by_role('button', name='批量生成', exact=True).click()
            dialog = page.get_by_role('dialog', name='批量生成计划', exact=True)
            for name in ['AI 动态海报', '最终成片']:
                dialog.get_by_role('checkbox', name=name, exact=True).uncheck()
            dialog.get_by_role('combobox', name='并发任务', exact=True).select_option('4')
            expect(dialog.get_by_label('批量节点摘要')).to_contain_text('1000')
            dialog.get_by_role('button', name='开始批量生成', exact=True).click()
            started = time.monotonic()
            while time.monotonic() - started < 1800:
                state = inspect_project(page, project_id)
                report['progress'] = { key: state[key] for key in ['assets', 'jobs', 'images', 'audio', 'completedJobs', 'batches'] }
                report['elapsedSeconds'] = round(time.monotonic() - started, 2)
                save()
                if state['batches'] and state['batches'][0]['status'] in ['completed', 'failed', 'cancelled']:
                    break
                if state['batches'] and state['batches'][0]['failed']:
                    raise AssertionError(state['batches'][0]['failed'][:5])
                page.wait_for_timeout(5000)
            else:
                raise TimeoutError('The 1000-node batch did not finish within 30 minutes')
            assert state['batches'][0]['status'] == 'completed', state['batches']
            assert state['batches'][0]['completed'] == SHOT_COUNT * 2
            assert state['referencesValid'] and state['assets'] == state['jobs'] == state['completedJobs'] == SHOT_COUNT * 2, state
            assert state['images'] == state['audio'] == state['timelineImages'] == state['timelineAudio'] == SHOT_COUNT
            assert len(state['selected']) == SHOT_COUNT * 2
            paths = [Path(asset['path']) for asset in state['assetRecords']]
            assert len(set(paths)) == len(paths) and all(path.is_file() and path.stat().st_size > 0 for path in paths)
            report['firstBatch'] = { key: value for key, value in state.items() if key not in ['assetRecords', 'lastShot', 'selected', 'source'] }
            report['generatedFileCount'] = len(paths)
            report['generatedBytes'] = sum(path.stat().st_size for path in paths)
            original_ids = {asset['id'] for asset in state['assetRecords']}
            page.locator('.director-shot-row').last.click()
            expect(page.locator('.director-shot-row').last).to_have_attribute('aria-pressed', 'true')
            expect(page.locator('.director-filmstrip-card[aria-pressed="true"]')).to_be_in_viewport(ratio=.9)
            page.get_by_role('tab', name='生成', exact=True).click()
            page.get_by_role('button', name='生成当前镜头', exact=True).click()
            history.wait_counts(page, project_id, {'assets': SHOT_COUNT * 2 + 1, 'jobs': SHOT_COUNT * 2 + 1})
            page.get_by_role('tab', name='字幕', exact=True).click()
            page.get_by_role('button', name='重新生成旁白', exact=True).click()
            history.wait_counts(page, project_id, {'assets': SHOT_COUNT * 2 + 2, 'jobs': SHOT_COUNT * 2 + 2})
            regenerated = inspect_project(page, project_id)
            assert original_ids <= {a['id'] for a in regenerated['assetRecords']}
            assert len(regenerated['selected']) == SHOT_COUNT * 2 and regenerated['referencesValid']
            assert regenerated['lastShot']['layers'][0]['assetVersionId'] != state['lastShot']['layers'][0]['assetVersionId']
            assert regenerated['lastShot']['voiceAssetVersionId'] != state['lastShot']['voiceAssetVersionId']
            report['regenerationPreservesHistory'] = True
            page.get_by_role('tab', name='版本', exact=True).click()
            expect(page.locator('.director-version-list button')).to_have_count(2)
            page.locator('.director-version-list button[aria-pressed="false"]').click()
            page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True).click()
            expect(page.locator('.director-desk-header').get_by_role('button', name='保存版本', exact=True)).to_be_disabled(timeout=20000)
            restored = inspect_project(page, project_id)
            assert restored['lastShot']['layers'][0]['assetVersionId'] == state['lastShot']['layers'][0]['assetVersionId']
            assert restored['referencesValid']
            history.capture(page, report, 'large-batch-last-shot')
            report['generationLedger'] = json.loads((profile / 'ledger.json').read_text(encoding='utf-8'))
            assert report['generationLedger']['imageRequests'] == SHOT_COUNT + 1
            assert report['generationLedger']['voiceRequests'] == SHOT_COUNT + 1
            assert report['generationLedger']['blockedExternalCalls'] == 0
            browser.close()
            browser = None
            process.kill()
            process.wait(timeout=15)
            process, browser, page = launch(playwright)
            after_restart = inspect_project(page, project_id)
            assert after_restart == restored
            history.open_project(page, TITLE)
            page.locator('.director-shot-row').last.click()
            expect(page.locator('.director-shot-row').last).to_have_attribute('aria-pressed', 'true')
            assert not report['runtimeErrors'], report['runtimeErrors']
            report['restartPreserved'] = True
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
        save()
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

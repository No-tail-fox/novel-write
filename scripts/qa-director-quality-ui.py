"""Offline production Electron QA of review binding using a copied playable MP4.

The report fixtures exercise review controls, not automated visual quality.
No provider calls are allowed. All mutations stay in an isolated app profile.
"""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('comic_qa', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TITLE = '最终成片绑定验收'
base.PROJECT_TITLE = TITLE
ART = ROOT / '.artifacts/director-quality-binding'
ART.mkdir(parents=True, exist_ok=True)
profile = Path(tempfile.mkdtemp(prefix='quality-binding-', dir=ROOT / '.codex-temp'))
sample = ROOT / '.artifacts/animation-stage-d/local-dialogue-sample.mp4'
video = profile / 'review-final.mp4'
shutil.copyfile(sample, video)
audit = base.create_offline_electron_entry(profile)
port = base.available_port()
env = os.environ.copy()
env['NODE_ENV'] = 'production'
for key in (*base.PAID_API_ENV_VARS, 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(key, None)
process = subprocess.Popen(
    [str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={profile}', str(profile)],
    cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    creationflags=subprocess.CREATE_NO_WINDOW,
)
report = {'profile': str(profile), 'mediaSource': str(sample), 'paidCalls': 0, 'checks': [], 'screenshots': [], 'errors': []}


def read_document(page, task_id):
    return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', task_id)


def go_history(page):
    back = page.get_by_role('button', name=re.compile('^返回'))
    if back.count() and back.first.is_visible():
        back.first.click()
        page.wait_for_timeout(250)
    base.navigate_sidebar(page, 'history', "[data-task-operations='history']")


def bind(page, task_id, kind='motion-comic', scenario='valid'):
    document = read_document(page, task_id)
    document['qualityReports'] = []
    document['assets'] = [a for a in document['assets'] if a['assetId'] != 'director-final-video']
    document['providerJobs'] = [j for j in document['providerJobs'] if j['capability'] != 'deterministic-render']
    input_path = profile / 'fingerprint-input.json'
    input_path.write_text(json.dumps(document, ensure_ascii=False), encoding='utf8')
    fingerprint = subprocess.check_output(
        ['node', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts/qa-director-quality-fingerprint.ts'), str(input_path)],
        cwd=ROOT, env=env, text=True, encoding='utf8',
    )
    sha = hashlib.sha256(video.read_bytes()).hexdigest()
    scope = {'episodeId': document['activeEpisodeId']} if kind == 'motion-comic' else {}
    now = document['updatedAt']
    document['providerJobs'].append({
        'id': 'qa-final-job', 'workflowKind': kind, 'nodeId': scope.get('episodeId', task_id),
        'providerId': 'qa-offline', 'model': 'local-fixture', 'capability': 'deterministic-render',
        'status': 'completed', 'inputHash': fingerprint, 'idempotencyKey': 'qa-final-job',
        'estimatedCost': 0, 'attempt': 1, 'createdAt': now, 'updatedAt': now,
        'renderFingerprint': fingerprint, **scope,
    })
    document['assets'].append({
        'id': 'qa-final-video', 'assetId': 'director-final-video', 'kind': 'video',
        'localPath': str(video), 'sha256': sha, 'providerJobId': 'qa-final-job',
        'renderFingerprint': fingerprint, 'createdAt': now, 'selected': True, 'pinned': True, **scope,
    })
    checks = [{'id': f'qa-check-{i}', 'label': f'本地界面夹具检查 {i + 1}', 'status': 'passed',
               'severity': 'warning', 'detail': '用于核对滚动与报告展示，不代表视觉质量验收。'} for i in range(12)]
    if scenario == 'blocker':
        checks[0].update({'label': 'P1 待处理检查', 'status': 'pending', 'priority': 'P1'})
    quality = {'id': 'qa-final-report', 'workflowKind': kind, 'stage': 'export',
               'providerJobId': 'qa-final-job', 'renderFingerprint': fingerprint, 'artifactSha256': sha,
               'status': 'passed', 'createdAt': now, 'checks': checks, **scope}
    if scenario == 'legacy':
        del quality['artifactSha256']
        quality['manualReview'] = {'reportId': quality['id'], 'renderFingerprint': fingerprint,
                                   'scope': {'kind': 'project'}, 'confirmedAt': now}
    document['qualityReports'] = [quality]
    page.evaluate('''async ({id, kind, document}) => {
        const save = kind === 'motion-comic' ? window.storydream.saveMotionComic : window.storydream.saveEditorialCollage;
        await save({id, expectedUpdatedAt:document.updatedAt, document});
    }''', {'id': task_id, 'kind': kind, 'document': document})
    return sha


def open_review(page, title=TITLE, comic=True):
    go_history(page)
    search = page.get_by_role('textbox', name='搜索历史记录')
    expect(search).to_be_visible(timeout=15000)
    search.fill(title)
    page.get_by_role('button', name=f'打开任务 {title}', exact=True).click()
    if comic:
        page.wait_for_selector('[data-motion-comic-production]')
        page.locator('.motion-comic-production__stages > button').nth(7).click()
    page.wait_for_selector('.director-desk')
    page.get_by_role('button', name='审片报告', exact=True).click()
    quality = page.locator('.director-quality-review')
    expect(quality).to_be_visible(timeout=15000)
    return quality


def verified(quality):
    expect(quality.locator('[data-artifact-status]')).to_have_attribute('data-artifact-status', 'verified', timeout=15000)


def confirm(quality):
    button = quality.get_by_role('button', name='确认已复核当前版本', exact=True)
    expect(button).to_be_enabled(timeout=15000)
    button.click()
    expect(quality).to_have_attribute('data-quality-confirmed', 'true', timeout=15000)


try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        page = browser.contexts[0].pages[0]
        page.on('pageerror', lambda e: report['errors'].append(str(e)))
        base.wait_for_app(page)
        base.set_window_size(page, 1536, 1024)
        task = page.evaluate('''async title => (await window.storydream.createMotionComic({
            title, premise:'核对成片文件绑定', ratio:'16:9', source:{kind:'script', adaptationMode:'faithful-script',
            originalText:'一位行者穿过街巷。', episodes:[{title:'第一集',sourceText:'一位行者穿过街巷。'}]}
        })).task.id''', TITLE)
        base.seed_structured_motion_comic(page, task, ROOT / 'src/assets/director-desk/shot-alley.png', video)
        sha = bind(page, task)
        quality = open_review(page)
        verified(quality)
        confirm(quality)
        assert read_document(page, task)['qualityReports'][0]['manualReview']['artifactSha256'] == sha
        report['checks'].append('comic approval persists the exact playable final MP4 hash')
        for theme in ['dark', 'light']:
            base.set_theme(page, theme)
            for width, height in [(1536, 1024), (1040, 720)]:
                base.set_window_size(page, width, height)
                quality.locator('[data-artifact-status]').scroll_into_view_if_needed()
                shot = ART / f'{theme}-{width}.png'
                page.screenshot(path=str(shot))
                report['screenshots'].append(str(shot))
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')
                end = quality.get_by_role('button', name='重新生成并审片', exact=True)
                end.scroll_into_view_if_needed()
                expect(end).to_be_in_viewport()
                assert page.locator('.director-inspector-scroll').evaluate('e => e.scrollTop > 0')
        report['checks'].append('dark/light normal/compact windows scroll to the last control without horizontal overflow')
        base.set_window_size(page, 1536, 1024)
        # Change a byte at the end, retaining size; this defeats size-only checks.
        bytes_ = bytearray(video.read_bytes())
        bytes_[-1] ^= 1
        video.write_bytes(bytes_)
        page.evaluate("window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'))")
        expect(quality.locator('[data-artifact-status]')).to_have_attribute('data-artifact-status', 'changed', timeout=15000)
        expect(quality.locator('.director-quality-badge')).to_have_text('成片已变化')
        expect(quality).to_have_attribute('data-quality-confirmed', 'false')
        assert 'manualReview' not in read_document(page, task)['qualityReports'][0]
        report['checks'].append('same-size file tamper and focus return revoke and persist approval')
        go_history(page)
        shutil.copyfile(sample, video)
        bind(page, task, scenario='legacy')
        quality = open_review(page)
        expect(quality.locator('[data-artifact-status]')).to_have_attribute('data-artifact-status', 'unverified', timeout=15000)
        expect(quality.locator('.director-quality-badge')).to_have_text('成片待核验')
        expect(quality.get_by_role('button', name='核验当前成片后再确认', exact=True)).to_be_disabled()
        assert 'manualReview' not in read_document(page, task)['qualityReports'][0]
        report['checks'].append('legacy report remains readable, cannot confirm, and old approval is revoked')
        go_history(page)
        bind(page, task, scenario='blocker')
        quality = open_review(page)
        verified(quality)
        expect(quality.get_by_role('button', name='修复阻断项后再确认', exact=True)).to_be_disabled()
        expect(quality).to_contain_text('P1 待处理检查')
        report['checks'].append('pending P1 warning prevents confirmation despite a passed legacy status')
        go_history(page)
        bind(page, task)
        quality = open_review(page)
        verified(quality)
        # Editing a shot must survive subsequent disk verification of the saved snapshot.
        page.get_by_role('tab', name='画面', exact=True).click()
        prompt = page.get_by_role('textbox', name='编辑提示词', exact=True)
        draft = '未保存的提示词，成片核验不得覆盖。'
        prompt.fill(draft)
        page.get_by_role('button', name='审片报告', exact=True).click()
        expect(quality).to_contain_text('当前内容已变更')
        page.get_by_role('tab', name='画面', exact=True).click()
        expect(page.get_by_role('textbox', name='编辑提示词', exact=True)).to_have_value(draft)
        assert read_document(page, task)['episodes'][0]['scenes'][0]['shots'][0]['prompt'] != draft
        report['checks'].append('unsaved shot input remains in the editor and is not silently persisted')
        # Save the draft through the existing editor command before leaving it.
        page.get_by_role('button', name='保存版本', exact=True).first.click()
        expect(page.get_by_role('button', name='保存版本', exact=True).first).to_be_disabled(timeout=15000)
        go_history(page)
        vox_title = TITLE + ' Vox'
        vox = page.evaluate('''async title => (await window.storydream.createEditorialCollage({
            title, sourceText:'行者穿过街巷。镜头跟随脚步，呈现旧城地图。', ratio:'16:9', durationMs:30000
        })).task.id''', vox_title)
        bind(page, vox, kind='editorial-collage')
        quality = open_review(page, vox_title, comic=False)
        verified(quality)
        confirm(quality)
        assert read_document(page, vox)['qualityReports'][0]['manualReview']['artifactSha256'] == sha
        report['checks'].append('Vox page confirms and persists the exact MP4 binding')
        video.unlink()
        quality.get_by_role('button', name='重新核验成片', exact=True).click()
        expect(quality.locator('[data-artifact-status]')).to_have_attribute('data-artifact-status', 'missing', timeout=15000)
        expect(quality.locator('.director-quality-badge')).to_have_text('成片已丢失')
        assert 'manualReview' not in read_document(page, vox)['qualityReports'][0]
        report['checks'].append('Vox file removal revokes approval through the actual review control')
        assert not report['errors'], report['errors']
        report['networkAudit'] = base.read_json_lines(audit)
        assert not report['networkAudit']
        report['status'] = 'passed'
        browser.close()
except Exception as error:
    report['status'] = 'failed'
    report['error'] = repr(error)
    raise
finally:
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()

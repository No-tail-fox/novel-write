"""Check music controls in the production Electron UI with offline fixtures."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', str(ROOT / '.artifacts/music-layout')))
spec = importlib.util.spec_from_file_location('music_qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def check_music_styles(page, report):
    field = page.get_by_role('textbox', name='音乐风格', exact=True)
    trigger = page.get_by_role('button', name='选择风格 · 633', exact=True)
    original = '手写要求：副歌留白'
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_window_size(page, width, height)
        field.fill(original)
        trigger.click()
        dialog = page.get_by_role('dialog', name='选择风格', exact=True)
        expect(dialog.get_by_role('status')).to_contain_text('共 633 个标签')
        groups = dialog.get_by_role('tablist', name='风格分类', exact=True)
        expect(groups.get_by_role('tab')).to_have_count(9)
        if width == 1536:
            total = 0
            categories = 0
            for group in groups.get_by_role('tab').all():
                group.click()
                subgroups = dialog.get_by_role('tablist', name='风格子分类', exact=True)
                for category in subgroups.get_by_role('tab').all():
                    category.click()
                    total += dialog.locator('.music-style-picker__tag').count()
                    categories += 1
            assert total == 633 and categories == 46, (total, categories)
            report['styleCatalog'] = {'groups': 9, 'categories': categories, 'entries': total}
        groups.get_by_role('tab', name='曲风', exact=True).click()
        dialog.get_by_title('流行 · Pop', exact=True).click()
        search = dialog.get_by_role('textbox', name='搜索风格标签', exact=True)
        search.fill('sYnTh-PoP')
        dialog.get_by_title('合成器流行 · Synth-Pop', exact=True).click()
        search.fill('1920')
        expect(dialog.get_by_title('1920年代 · 1920s', exact=True)).to_be_visible()
        search.fill('没有这个标签xyz')
        expect(dialog.get_by_text('没有匹配的标签，仍可在音乐风格中手动填写。', exact=True)).to_be_visible()
        search.fill('')
        expect(dialog.get_by_role('status')).to_contain_text('已选 2 个')
        dialog.get_by_role('button', name='应用风格', exact=True).scroll_into_view_if_needed()
        assert dialog.evaluate('el => el.scrollWidth <= el.clientWidth + 1')
        dialog.locator('.music-style-picker').evaluate('el => el.scrollTop = 0')
        page.screenshot(path=OUTPUT / f'music-styles-{width}x{height}.png')
        apply = dialog.get_by_role('button', name='应用风格', exact=True)
        assert apply.evaluate('el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }')
        apply.click()
        expect(field).to_have_value(f'{original}, Pop, Synth-Pop')
        trigger.click()
        expect(dialog.get_by_role('status')).to_contain_text('已选 2 个')
        dialog.get_by_role('button', name='清空已选', exact=True).click()
        dialog.get_by_role('button', name='取消', exact=True).click()
        expect(field).to_have_value(f'{original}, Pop, Synth-Pop')
        expect(trigger).to_be_focused()
        trigger.click()
        dialog.get_by_role('checkbox', name='使用英文标签', exact=True).uncheck()
        dialog.get_by_role('button', name='应用风格', exact=True).click()
        expect(field).to_have_value(f'{original}, 流行, 合成器流行')
        trigger.click()
        dialog.get_by_role('button', name='清空已选', exact=True).click()
        dialog.get_by_role('button', name='应用风格', exact=True).click()
        expect(field).to_have_value(original)
        report.setdefault('styleInteractions', []).append({'size': [width, height], 'status': 'passed'})
    # The same catalog is available in remix tools without losing the parent form.
    page.get_by_role('button', name='歌曲工具', exact=True).click()
    page.get_by_role('button', name='翻唱改编', exact=True).click()
    tools = page.get_by_role('dialog', name='音频与歌曲工具', exact=True)
    target = tools.get_by_role('textbox', name='目标音乐风格', exact=True)
    target.fill('保留翻唱要求')
    tools.get_by_role('button', name='选择风格 · 633', exact=True).click()
    styles = page.get_by_role('dialog', name='选择风格', exact=True)
    styles.get_by_title('民谣 · Folk', exact=True).click()
    styles.get_by_role('button', name='应用风格', exact=True).click()
    expect(target).to_have_value('保留翻唱要求, Folk')
    page.screenshot(path=OUTPUT / 'music-styles-remix.png')
    tools.get_by_role('button', name='取消', exact=True).click()
    report['styleRemix'] = 'passed'


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    hook = profile / 'offline.cjs'
    hook.write_text("""const { app, ipcMain } = require('electron');
app.setAppPath(process.env.STORYDREAM_QA_APP_ROOT);
globalThis.fetch = () => Promise.reject(new Error('QA_OFFLINE'));
const input = { mode: 'custom', model: 'suno-v6', title: '布局回归歌曲', style: '钢琴与弦乐', lyrics: '[Verse]\\n' + '保留每一行歌词和每一个按钮\\n'.repeat(40), instrumental: false, maxMode: false, variety: 1 };
const record = { id: 'd316fb15-81fb-470d-9962-5a0ee8bbd7cd', input, model: input.model, providerId: 'suno-api', providerName: 'Suno-API', status: 'processing', estimatedCost: 0.6, errorMessage: '', createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', finishedAt: null, tracks: [{id: '6a07a5b6-efaf-44b7-92bc-6558baf1c586', songId: 'qa-song', title: input.title, style: input.style, lyrics: input.lyrics, status: 'processing', providerStatus: 'processing', downloadStatus: 'none'}] };
const rejected = { ...record, id: 'c60c08ba-8070-4ec2-877b-f7947ddc9be2', input: {...input, title:'上传拒绝回归'}, origin:'upload', status:'failed', estimatedCost:0, tracks:[], errorMessage:'MUSIC_UPLOAD_REJECTED: 这段音频与服务曲库中的现有录音匹配，服务拒绝上传。请更换音频后重试。' };
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => register(channel, (...args) => {
  if (channel === 'music-lab:service-status') return {ok:true, value:{configured:true, enabled:true, providerName:'Suno-API'}};
  if (channel === 'music-lab:list') return {ok:true, value:[record, rejected]};
  return handler(...args);
});
import(require('node:url').pathToFileURL(require('node:path').join(process.env.STORYDREAM_QA_APP_ROOT, 'dist-electron/electron/main.js')).href);
""", encoding='utf-8')
    (profile / 'package.json').write_text(json.dumps({'name': 'storydream', 'version': '1.0.0', 'main': 'offline.cjs'}), encoding='utf-8')
    env = {**os.environ, 'NODE_ENV': 'production', 'STORYDREAM_QA_APP_ROOT': str(ROOT)}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'STORYDREAM_SMOKE_OUTPUT', 'STORYDREAM_SMOKE_USER_DATA']:
        env.pop(key, None)
    report = {'status': 'running', 'checks': [], 'runtimeErrors': []}
    port = base.available_port()
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    with (OUTPUT / 'electron.log').open('wb') as log:
        process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', '--remote-allow-origins=*', f'--user-data-dir={profile}', str(profile)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=flags)
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
                page = browser.contexts[0].pages[0]
                page.on('pageerror', lambda error: report['runtimeErrors'].append(str(error)))
                base.wait_for_app(page)
                page.get_by_role('button', name='素材库', exact=True).click()
                base.navigate_sidebar(page, 'music-lab', '.music-lab')
                page.get_by_role('tab', name='高级', exact=True).click()
                check_music_styles(page, report)
                page.get_by_role('textbox', name='音乐风格', exact=True).fill('温暖的人声，钢琴、弦乐和手风琴，层次丰富的现场演奏')
                page.locator('.music-lab__track').first.click()
                for width, height in [(1536, 1024), (1320, 720), (1040, 720)]:
                    base.set_window_size(page, width, height)
                    for label in ['润色风格', '加入背景音乐库', '用于音乐 MV', '编辑、翻唱与分轨', '复用创作参数']:
                        control = page.get_by_role('button', name=label, exact=True)
                        control.evaluate("el => el.scrollIntoView({block:'center', inline:'nearest'})")
                        metrics = control.evaluate("""el => {
                          const r=el.getBoundingClientRect(), content=el.querySelector('.sd-button__content').getBoundingClientRect();
                          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                          return {height:r.height, contentHeight:content.height, contained:content.top>=r.top-1&&content.bottom<=r.bottom+1,
                            reachable:r.top>=0&&r.bottom<=innerHeight&&(el===hit||el.contains(hit))};
                        }""")
                        report['checks'].append({'size': [width, height], 'label': label, **metrics})
                    page.get_by_role('button', name='润色风格', exact=True).scroll_into_view_if_needed()
                    page.get_by_role('button', name='加入背景音乐库', exact=True).scroll_into_view_if_needed()
                    page.screenshot(path=OUTPUT / f'music-{width}x{height}.png')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                base.set_window_size(page, 1320, 720)
                page.locator('.music-lab__track').filter(has_text='上传拒绝回归').click()
                expect(page.get_by_role('heading', name='上传失败', exact=True)).to_be_visible()
                alert = page.locator('.music-lab__detail-body').get_by_role('alert')
                expect(alert).to_contain_text('这段音频与服务曲库中的现有录音匹配')
                alert.scroll_into_view_if_needed()
                assert alert.evaluate('el => el.scrollWidth <= el.clientWidth + 1')
                page.screenshot(path=OUTPUT / 'music-upload-rejected.png')
                assert not report['runtimeErrors'], report['runtimeErrors']
                # Chromium may round a 24px compact control to 23.6px at 125% scale.
                failures = [row for row in report['checks'] if row['height'] < 23 or not row['contained'] or not row['reachable']]
                assert not failures, failures
                report['status'] = 'passed'
                browser.close()
        except Exception as error:
            report['status'] = 'failed'
            report['error'] = str(error)
            raise
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
            (OUTPUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()

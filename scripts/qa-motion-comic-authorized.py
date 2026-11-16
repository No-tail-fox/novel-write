"""Real production licensing + isolated Electron QA. Secret input is environment only."""
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
PROFILE = Path(os.environ.get('STORYDREAM_QA_PROFILE', r'C:\Users\foxnotail\AppData\Local\Temp\comic-overview-zmqygek7'))
ART = ROOT / '.artifacts/comic-authorized-electron'
ART.mkdir(parents=True, exist_ok=True)
assert (PROFILE / 'script-fixture.json').is_file(), 'Existing seeded profile required'
origin = json.loads((ROOT / 'config/license-public.json').read_text(encoding='utf8'))['baseUrl']
report = {'profile': str(PROFILE), 'licenseOrigin': origin, 'checks': [], 'screenshots': [], 'errors': [], 'boundary': 'Production Electron UI/IPC/licensing; offline seeded 24-episode content; no LLM or media generation.'}
secret = os.environ.pop('STORYDREAM_QA_ACTIVATION_CODE', '')
def sanitize(value):
    text = str(value)
    if secret: text = text.replace(secret, '[REDACTED]')
    return re.sub(r'SD-(?:[A-Fa-f0-9]{8}-){3}[A-Fa-f0-9]{8}', '[REDACTED]', text)
hook = PROFILE / 'authorized-main.cjs'
hook.write_text("""const fs = require('node:fs');
const {app, session, net} = require('electron');
const {pathToFileURL} = require('node:url');
const {syncBuiltinESMExports} = require('node:module');
const root = ROOT_VALUE;
const origin = new URL(ORIGIN_VALUE).origin;
app.setAppPath(root);
const audit = (kind,u) => fs.appendFileSync(AUDIT_VALUE, JSON.stringify({kind,origin:u.origin,path:u.pathname})+'\\n');
function allowed(raw) {
 const u = new URL(raw);
 const local = ['file:','data:','devtools:'].includes(u.protocol) || ['127.0.0.1','localhost','[::1]'].includes(u.hostname);
 const license = u.origin === origin && ['/v1/license/activate','/v1/license/refresh'].includes(u.pathname);
 if (!local) audit(license ? 'allowed-license' : 'blocked-external',u);
 return local || license;
}
for (const protocol of ['http','https']) {
 const mod = require('node:'+protocol);
 const request = mod.request;
 mod.request = function(input,...rest) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : `${input.protocol || protocol+':'}//${input.hostname || input.host}${input.port ? ':'+input.port : ''}${input.path || '/'}`;
  if (!allowed(raw)) throw new Error('QA_EXTERNAL_REQUEST_BLOCKED');
  return request.call(this,input,...rest);
 };
 mod.get = function(...args) { const req = mod.request(...args); req.end(); return req; };
}
syncBuiltinESMExports();
const fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input,...rest) => allowed(typeof input === 'string' || input instanceof URL ? String(input) : input.url) ? fetch(input,...rest) : Promise.reject(new Error('QA_EXTERNAL_FETCH_BLOCKED'));
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({cancel: !allowed(details.url)})));
import(pathToFileURL(root+'/dist-electron/electron/main.js').href);
""".replace('ROOT_VALUE', json.dumps(str(ROOT))).replace('ORIGIN_VALUE', json.dumps(origin)).replace('AUDIT_VALUE', json.dumps(str(ART / 'network-audit.jsonl'))), encoding='utf8')
env = os.environ.copy()
env['NODE_ENV'] = 'production'
for key in (*base.PAID_API_ENV_VARS, 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'):
    env.pop(key, None)
port = base.available_port()
process = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', f'--user-data-dir={PROFILE}', str(hook)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(base.wait_for_cdp(port, process))
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.wait_for_event('page')
        page.on('pageerror', lambda error: report['errors'].append(sanitize(error)))
        page.wait_for_selector('body')
        page.wait_for_function('() => Boolean(window.storydream)')
        status = page.evaluate("async () => {const s=await window.storydream.getLicenseStatus();return {status:s.status,configured:s.configured,message:s.message}}")
        report['initialLicense'] = status
        print(json.dumps({'initialLicense':status,'url':page.url},ensure_ascii=False),flush=True)
        if status['status'] not in ['active', 'offline']:
            page.wait_for_selector('.license-settings, .app-shell',timeout=45000)
            if not page.get_by_role('textbox', name='激活码', exact=True).is_visible():
                page.get_by_role('button', name=re.compile('软件授权')).click(timeout=15000)
            field = page.get_by_role('textbox', name='激活码', exact=True)
            expect(field).to_be_visible(timeout=30000)
            assert secret, 'No activation submitted: refresh-only run remains inactive'
            attempt_marker = PROFILE / 'qa-activation-attempted.json'
            assert not attempt_marker.exists() or os.environ.get('STORYDREAM_QA_CONTROLLED_RETRY') == '1', 'Activation already attempted; only refresh is allowed'
            attempt_marker.write_text(json.dumps({'submitted': True, 'note': 'Never automatically resubmit; contains no activation code'}), encoding='utf8')
            report['activationSubmitted'] = True
            status = page.evaluate("""async code => {
                try { const s=await window.storydream.activateLicense(code); return {status:s.status,configured:s.configured,message:s.message}; }
                catch(error) { const s=await window.storydream.getLicenseStatus(); return {status:s.status,configured:s.configured,message:s.message,errorCode:error?.code || 'ACTIVATION_FAILED'}; }
            }""", secret)
            if field.count() and field.is_visible(): field.fill('')
            report['activationSubmitted'] = True
        else:
            report['activationSubmitted'] = False
        report['license'] = status
        print(json.dumps({'activation':status, 'profile':str(PROFILE)}, ensure_ascii=False), flush=True)
        assert status['status'] == 'active', 'Real activation did not succeed: '+status['message']
        base.wait_for_app(page)
        base.set_window_size(page,1600,1000)
        base.navigate_sidebar(page, 'motion-comic', '[data-project-home]')
        expect(page.get_by_role('combobox',name='制作类型',exact=True)).to_have_value('motion-comic')
        project_sort = page.get_by_role('combobox',name='项目排序',exact=True)
        expect(project_sort).to_be_visible()
        project_sort.select_option('title')
        expect(project_sort).to_have_value('title')
        expect(page.get_by_role('combobox',name='制作类型',exact=True)).to_have_value('motion-comic')
        project_sort.select_option('newest')
        report['checks'].append({'page':'项目全局排序切换并保留类型筛选','passed':True})
        report['checks'].append({'page':'侧栏漫剧统一项目筛选','passed':True})
        page.screenshot(path=str(ART / 'desktop-unified-projects.png'))
        base.navigate_sidebar(page, 'projects', '[data-project-home]')
        expect(page.get_by_role('combobox',name='制作类型',exact=True)).to_have_value('all')
        report['checks'].append({'page':'全局项目恢复全部类型','passed':True})
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
        page.get_by_role('textbox', name='搜索历史记录').fill('后台分集剧本流程验收')
        page.get_by_role('button', name='打开任务 后台分集剧本流程验收', exact=True).click()
        overview = page.get_by_role('region', name='漫剧项目总览')
        expect(overview).to_be_visible(timeout=30000)
        for size, width, height in [('desktop',1600,1000),('compact',1040,720)]:
            base.set_window_size(page,width,height)
            episodes = overview.locator('.comic-project-overview__episode')
            expect(episodes.first).to_be_visible()
            report['checks'].append({'size':size,'page':'总览','episodeRows':episodes.count(),'episodeTitles':episodes.locator('h3, strong').first.inner_text()})
            assert episodes.count() >= 24, 'Seeded episodes missing from overview'
            expect(page.locator('.sidebar')).to_be_visible()
            shot = ART / f'{size}-overview.png'
            page.screenshot(path=str(shot)); report['screenshots'].append(str(shot))
            overview.get_by_role('button',name='编辑剧本',exact=True).first.click()
            expect(page.locator('[data-motion-comic-script-workspace]')).to_be_visible(timeout=30000)
            tabs=page.get_by_role('tablist',name='漫剧项目功能区')
            for label,slug in [('剧本','script'),('资产','assets'),('分镜','storyboard'),('生产','production'),('预览','preview')]:
                tab=tabs.get_by_role('tab',name=label,exact=True)
                expect(tab).to_be_visible()
                if tab.is_disabled() or tab.get_attribute('aria-disabled') == 'true':
                    report['checks'].append({'size':size,'page':label,'disabled':True}); continue
                tab.click(); page.wait_for_timeout(600)
                if slug == 'preview':
                    inspector = page.locator('[data-motion-comic-timeline-layout] .director-inspector-pane > .sd-tabs')
                    metrics = inspector.locator('[role=tab]').evaluate_all("els => els.map(el => { const c=el.querySelector('.fui-Tab__content'); return {label:el.textContent, width:c?.clientWidth, scroll:c?.scrollWidth}; })")
                    assert len(metrics) == 5 and all(m['scroll'] <= m['width'] for m in metrics), f'Inspector tab labels clipped: {metrics}'
                    report['checks'].append({'size':size,'page':'预览检查器标签','metrics':metrics})
                shot=ART / f'{size}-{slug}.png'
                page.screenshot(path=str(shot)); report['screenshots'].append(str(shot))
                if slug == 'assets':
                    page.get_by_role('button', name='提取人物', exact=True).click()
                    extraction = page.get_by_role('dialog', name='独立人物提取', exact=True)
                    expect(extraction).to_be_visible()
                    extraction.evaluate("async el => { await Promise.all(el.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {}))); }")
                    extraction_shot=ART / f'{size}-asset-extraction.png'
                    page.screenshot(path=str(extraction_shot)); report['screenshots'].append(str(extraction_shot))
                    extraction.get_by_role('button', name='关闭', exact=True).last.click()
                    expect(extraction).not_to_be_visible()
                    page.get_by_role('button', name='打开阿青详情', exact=True).click()
                    page.locator('summary').filter(has_text='性格与角色配音').click()
                    sample = page.get_by_role('region', name='阿青的声音样本', exact=True)
                    sample.scroll_into_view_if_needed()
                    expect(sample.get_by_role('button', name='导入样本', exact=True)).to_be_visible()
                    voice_shot=ART / f'{size}-character-voice-sample.png'
                    page.screenshot(path=str(voice_shot)); report['screenshots'].append(str(voice_shot))
                    page.get_by_role('button', name='返回资产总览', exact=True).click()
                    expect(sample).to_have_count(0)
                report['checks'].append({'size':size,'page':label,'selected':tab.get_attribute('aria-selected'),'overflow':page.evaluate('document.documentElement.scrollWidth > innerWidth')})
            page.get_by_role('button',name='返回项目总览',exact=True).click()
            expect(overview).to_be_visible()
        # Apply the reviewed offline-seeded storyboard of episode 2 through the real UI/IPC, then verify persistence.
        base.set_window_size(page,1600,1000)
        overview.get_by_role('button',name='编辑剧本',exact=True).first.click()
        workspace = page.locator('[data-motion-comic-script-workspace]')
        expect(workspace).to_be_visible(timeout=30000)
        ep2 = workspace.get_by_role('button', name=re.compile(r'EP 02'))
        ep2.first.click(); page.wait_for_timeout(500)
        if '分镜已应用' not in ep2.first.inner_text():
            workspace.get_by_role('tablist', name='当前集内容').get_by_role('tab', name=re.compile(r'^分镜')).click()
            workspace.get_by_role('checkbox', name=re.compile('已核对当前分镜')).check()
            workspace.get_by_role('button', name='确认并应用本集分镜', exact=True).click()
            expect(page.get_by_role('tablist',name='漫剧项目功能区').get_by_role('tab',name='生产',exact=True)).to_be_enabled(timeout=30000)
            expect(page.get_by_text('当前第 2 集 · 8 场')).to_be_visible()
            report['checks'].append({'action':'apply-seeded-storyboard-ep2','result':'applied'})
        else:
            report['checks'].append({'action':'apply-seeded-storyboard-ep2','result':'already-applied'})
        page.reload(); base.wait_for_app(page)
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
        page.get_by_role('textbox', name='搜索历史记录').fill('后台分集剧本流程验收')
        page.get_by_role('button', name='打开任务 后台分集剧本流程验收', exact=True).click()
        expect(overview).to_be_visible(timeout=30000)
        report['checks'].append({'action':'reload-persistence','ep2Row':overview.locator('.comic-project-overview__episode').nth(1).inner_text().replace('\n',' / ')})
        for size, width, height in [('desktop',1600,1000),('compact',1040,720)]:
            base.set_window_size(page,width,height)
            row = overview.locator('.comic-project-overview__episode').nth(1)
            buttons = row.get_by_role('button')
            report['checks'].append({'size':size,'ep2Actions':[b.inner_text() for b in buttons.all()]})
            buttons.first.click()
            tabs=page.get_by_role('tablist',name='漫剧项目功能区')
            expect(tabs).to_be_visible(timeout=30000)
            for label,slug in [('分镜','ep2-storyboard'),('生产','ep2-production'),('预览','ep2-preview')]:
                tab=tabs.get_by_role('tab',name=label,exact=True)
                disabled = tab.is_disabled() or tab.get_attribute('aria-disabled') == 'true'
                if not disabled:
                    tab.click(); page.wait_for_timeout(800)
                    shot=ART / f'{size}-{slug}.png'
                    page.screenshot(path=str(shot)); report['screenshots'].append(str(shot))
                dirty = page.locator('[data-dirty="true"]').count() > 0 or page.get_by_text('有未保存改动', exact=True).count() > 0
                report['checks'].append({'size':size,'page':label,'episode':2,'disabled':disabled,'dirty':dirty,'overflow':page.evaluate('document.documentElement.scrollWidth > innerWidth')})
                assert not disabled, f'Episode 2 {label} unexpectedly disabled'
                assert not dirty, f'Opening episode 2 {label} marked an unedited document dirty'
            page.get_by_role('button',name='返回项目总览',exact=True).click()
            expect(overview).to_be_visible()
        base.set_window_size(page,1600,1000)
        overview.locator('.comic-project-overview__episode').nth(1).get_by_role('button').first.click()
        page.get_by_role('tablist',name='漫剧项目功能区').get_by_role('tab',name='分镜',exact=True).click()
        title = page.get_by_role('textbox',name='镜头标题',exact=True)
        original = title.input_value()
        edited = original + ' · QA保存验证'
        title.fill(edited)
        expect(page.locator('[data-dirty="true"]')).to_be_visible()
        page.get_by_role('button',name='保存分镜',exact=True).click()
        expect(page.locator('[data-dirty="false"]')).to_be_visible(timeout=30000)
        page.reload(); base.wait_for_app(page)
        base.navigate_sidebar(page, 'history', "[data-task-operations='history']")
        page.get_by_role('textbox',name='搜索历史记录').fill('后台分集剧本流程验收')
        page.get_by_role('button',name='打开任务 后台分集剧本流程验收',exact=True).click()
        overview.locator('.comic-project-overview__episode').nth(1).get_by_role('button').first.click()
        page.get_by_role('tablist',name='漫剧项目功能区').get_by_role('tab',name='分镜',exact=True).click()
        expect(title).to_have_value(edited)
        expect(page.locator('[data-dirty="false"]')).to_be_visible()
        title.fill(original)
        page.get_by_role('button',name='保存分镜',exact=True).click()
        expect(page.locator('[data-dirty="false"]')).to_be_visible(timeout=30000)
        report['checks'].append({'action':'real-title-edit-save-reload-restore','dirtyOnEdit':True,'persistedAfterReload':True,'restoredOriginal':True})
        browser.close()
except Exception as error:
    report['failure'] = sanitize(error)
    print(json.dumps({'failure':report['failure']},ensure_ascii=False),flush=True)
finally:
    process.terminate()
    process.wait(timeout=15)
    (ART / 'report.json').write_text(json.dumps(report, ensure_ascii=False,indent=2),encoding='utf8')
if report.get('failure') or report['errors']:
    raise SystemExit(1)

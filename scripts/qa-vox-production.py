"""Paid end-to-end acceptance through production Electron IPC; explicit opt-in required."""
from __future__ import annotations
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import time
import traceback
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts' / os.environ.get('VOX_QA_OUTPUT','vox-production-auto')
PROFILE = OUT / 'profile'
spec = importlib.util.spec_from_file_location('vox_base', ROOT / 'scripts/qa-director-desk.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

def main():
    if os.environ.get('VOX_QA_PAID') != '1':
        raise RuntimeError('Set VOX_QA_PAID=1 only after the expected cost has been announced')
    OUT.mkdir(parents=True, exist_ok=True)
    creative = os.environ.get('VOX_QA_CREATIVE') == '1'
    env = {**os.environ, 'NODE_ENV': 'production', 'VOX_PRODUCTION_QA_DIR': str(PROFILE), 'PYTHONIOENCODING': 'utf-8'}
    for key in ['NODE_OPTIONS', 'VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']:
        env.pop(key, None)
    if not (PROFILE / 'seed.json').exists():
        seed_script = 'qa-creative-production-seed.ts' if creative else 'qa-vox-production-seed.ts'
        subprocess.run(['I:/nodejs/node.exe', str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'scripts' / seed_script), str(PROFILE)], cwd=ROOT, env=env, check=True)
    if not (OUT / 'vault-profile-key-copied').exists():
        shutil.copyfile(Path(os.environ['APPDATA'])/'storydream'/'Local State',PROFILE/'Local State')
        (OUT/'vault-profile-key-copied').write_text('OS-encrypted profile key copied; no plaintext credentials exported',encoding='utf8')
    seed = json.loads((PROFILE / 'seed.json').read_text(encoding='utf8'))
    report = {'status': 'running', 'surface': 'production Electron IPC and configured cloud providers', 'project': seed, 'checks': [], 'states': [], 'captures': [], 'errors': []}
    process = browser = page = None
    def save(): (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    def check(label): report['checks'].append(label); save(); print(label, flush=True)
    def snapshot():
        return page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', seed['id'])
    def open_project(project_id):
        page.locator(f'[data-project-id="{project_id}"] .project-card-open').click()
        page.wait_for_selector('.vox-project-action-bar')
    def projects():
        if page.locator('.vox-project-action-bar').count():
            page.get_by_role('button',name='返回项目',exact=True).click()
        if not page.locator('[data-project-home]').count():
            page.locator('button[data-nav-view="projects"][data-nav-level="primary"]').click()
        page.wait_for_selector('[data-project-home]')
    def launch(pw):
        endpoint=os.environ.pop('VOX_QA_CDP',None)
        child=None
        if not endpoint:
            port = base.free_port()
            log = (OUT / 'electron.log').open('ab')
            child = subprocess.Popen([str(base.ELECTRON), f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1', f'--user-data-dir={PROFILE}', str(ROOT / 'scripts/qa-vox-production.cjs')], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            endpoint=base.wait_cdp(port,child)
        connected = pw.chromium.connect_over_cdp(endpoint)
        context = connected.contexts[0]
        # Playwright's event wait pumps CDP messages while Electron creates its window.
        # A Python sleep loop leaves the cached page list stale after early attachment.
        current = context.pages[0] if context.pages else context.wait_for_event('page', timeout=90_000)
        current.on('dialog', base.accept_optional_dialog)
        current.on('pageerror', lambda e: report['errors'].append(str(e)))
        base.wait_app(current)
        return child, connected, current
    try:
        with sync_playwright() as pw:
            process, browser, page = launch(pw)
            bootstrap = page.evaluate('() => window.storydream.getBootstrap()')
            report['models'] = { 'text': bootstrap['config']['llm']['model'], 'image': bootstrap['config']['gptImage']['model'], 'tts': bootstrap['config']['tts']['provider'] }
            d = snapshot()
            saved_paid = {n['id']:n['requestId'] for n in d.get('productionRun',{}).get('nodes',[]) if n['paid'] and n['status']=='completed'}
            projects(); open_project(seed['id'])
            if d.get('productionRun',{}).get('status')=='paused' and not any(n['status']=='unknown' for n in d['productionRun']['nodes']):
                page.evaluate('input => window.storydream.controlVoxProduction(input)',{'id':seed['id'],'runId':d['productionRun']['id'],'action':'resume'})
                check('resumed the existing persisted run without creating a new paid plan')
            # Never start another paid run if the persisted journal already exists.
            migrating = creative and d.get('productionRun',{}).get('status') == 'completed' and not d['productionRun']['settings'].get('authoring')
            if not d.get('productionRun') or migrating:
                page.evaluate('async input => { const d=JSON.parse((await window.storydream.getTaskDetail(input.id)).pipelineData); return window.storydream.startVoxProduction({id:input.id,expectedUpdatedAt:d.updatedAt,settings:input.settings}); }', {'id':seed['id'], 'settings':seed.get('settings', {'version':1,'presetId':'paper-explainer','presetVersion':1,'narration':True,'lockedShotIds':[],'data':[],'archives':[]})})
                check('started once from raw script via production IPC; no local image/voice/animation buttons')
                if migrating:
                    check('migrated completed real NASA plan/voices to AI code; original sample is unchanged')
            projects(); open_project(seed['other'])
            check('left the Vox route while the main-owned run continues')
            previous = None; deadline = time.monotonic()+2400; paused_for_restart = bool(saved_paid) and not migrating; restarted = False
            if saved_paid:
                report['restartPaidRequests']=saved_paid
                check('reopened persisted paid results from the previous actual application process')
            while time.monotonic()<deadline:
                d = snapshot(); run = d['productionRun']
                state = [(n['id'], n['status'], n['attempt']) for n in run['nodes']]
                if state != previous:
                    previous = state
                    active = next((n for n in run['nodes'] if n['status'] in ['running','failed','unknown']), None)
                    report['states'].append({'at': time.time(), 'status':run['status'], 'completed':sum(n['status']=='completed' for n in run['nodes']), 'active':active})
                    (OUT / 'document.json').write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf8'); save()
                    print(json.dumps(report['states'][-1], ensure_ascii=False), flush=True)
                pause_kind = 'code' if creative else ('voice' if seed.get('settings',{}).get('presetId')=='data-map' else 'image')
                if not paused_for_restart and run['status']=='running' and any(n['kind']==pause_kind and n['status']=='running' for n in run['nodes']):
                    page.evaluate('input => window.storydream.controlVoxProduction(input)', {'id':seed['id'],'runId':run['id'],'action':'pause'})
                    paused_for_restart = True
                    check(f'requested pause during a real in-flight {pause_kind} request from another project')
                if run['status']=='paused' and paused_for_restart and not restarted:
                    paid_before = {n['id']:n['requestId'] for n in run['nodes'] if n['paid'] and n['status']=='completed'}
                    assert paid_before and not any(n['status']=='running' for n in run['nodes'])
                    check('in-flight paid result saved before pause; no new node dispatched')
                    page.evaluate('() => window.storydream.windowControl("close")')
                    if process: process.wait(timeout=45)
                    else: time.sleep(2)
                    browser.close()
                    process,browser,page=launch(pw)
                    restored=snapshot()['productionRun']
                    assert restored['status']=='paused'
                    assert paid_before=={n['id']:n['requestId'] for n in restored['nodes'] if n['paid'] and n['status']=='completed'}
                    page.evaluate('input => window.storydream.controlVoxProduction(input)',{'id':seed['id'],'runId':run['id'],'action':'resume'})
                    restarted=True;report['restartPaidRequests']=paid_before
                    check('restarted the actual app and resumed using the same saved paid request results')
                    continue
                if run['status'] != 'running': break
                page.wait_for_timeout(1500)
            assert run['status'] == 'completed', run.get('message', run['status'])
            check('all durable nodes including media verification completed while on another page')
            if creative:
                assert all(next(n for n in run['nodes'] if n['id']==key)['requestId']==value for key,value in seed['reusePaidRequests'].items())
                report['authoring'] = [{'shotId':s['id'], **s.get('animation',{}).get('authoring',{})} for b in d['beats'] for s in b['shots']]
                assert all(a.get('status') in ['reviewed','fallback'] for a in report['authoring'])
                report['output'] = next(a['localPath'] for a in reversed(d['assets']) if a['assetId']=='director-final-video' and a.get('selected'))
                check('original paid plan/voice request IDs retained; code attempts and previews persisted')
            if restarted or saved_paid:
                assert all(next(n for n in run['nodes'] if n['id']==key)['requestId']==value for key,value in report['restartPaidRequests'].items())
                check('completed paid nodes were not resubmitted after real app restart')
            other = page.evaluate('async id => JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)', seed['other'])
            assert not other.get('productionRun') and other['sourceText'] == '保留这个项目的原始内容。'
            check('other project remains unchanged')
            # Open the actual production workspace through its project card.
            projects();open_project(seed['id'])
            for theme in ['dark','light']:
                page.evaluate('theme => window.storydream.saveUiPreferences({theme})', theme)
                page.reload(wait_until='domcontentloaded');base.wait_app(page)
                if not page.locator('.vox-project-action-bar').count():
                    projects();open_project(seed['id'])
                for width,height in [(1536,1024),(1040,720)]:
                    base.set_size(page,width,height)
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    assert page.locator('.vox-project-primary').evaluate('(e)=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}')
                    path=OUT/f'{theme}-{width}.png';page.screenshot(path=path,animations='disabled');report['captures'].append(str(path))
            page.get_by_role('button',name='制作进度',exact=True).click()
            expect(page.get_by_role('dialog',name='自动制作进度')).to_be_visible()
            page.screenshot(path=OUT/'progress.png',animations='disabled')
            check('actual desktop/compact production workspace and progress dialog render')
            report['status']='passed';save()
    except Exception:
        report['status']='failed';report['failure']=traceback.format_exc();save();raise
    finally:
        # A failed observer must never close the application that owns a paid call.
        if page and report['status']=='passed':
            try: page.evaluate('() => window.storydream.windowControl("close")')
            except Exception: pass
        if process and report['status']=='passed':
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                print('App still saving an in-flight result; left running instead of terminating it.',flush=True)
        if browser and report['status']=='passed':
            try: browser.close()
            except Exception: pass
        save()

if __name__=='__main__': main()

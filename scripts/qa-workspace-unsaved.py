"""Production Electron checks for recoverable edits, using an isolated profile."""
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
OUTPUT = Path(os.environ.get('STORYDREAM_QA_OUTPUT', 'E:/StoryDream-QA/workspace-unsaved'))
spec = importlib.util.spec_from_file_location('workspace_qa_base', ROOT / 'scripts/qa-motion-comic.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def navigate(page, route):
    selector = '.new-task-button' if route == 'new-task' else f'.nav-list button[data-nav-view="{route}"]'
    page.locator(selector).click()


def route_ready(page, route):
    page.wait_for_selector(f'[data-shell-view="{route}"]', timeout=15000)


def capture_dialog(page, report, name):
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_window_size(page, width, height)
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        checks = dialog.locator('button').evaluate_all('''buttons => buttons.map(button => {
          const r=button.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {text:button.textContent, visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
            hit:button===hit||button.contains(hit)};
        })''')
        assert all(item['visible'] and item['hit'] for item in checks), checks
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        path = OUTPUT / f'{name}-{width}x{height}.png'
        page.screenshot(path=path)
        report['captures'].append({'path':str(path), 'checks':checks})


def capture_sticky_action(page, report, name, selector, scroll_selector):
    for width, height in [(1536, 1024), (1040, 720)]:
        base.set_window_size(page, width, height)
        action = page.locator(selector)
        expect(action).to_be_visible()
        state = action.evaluate('''(element, scrollSelector) => {
          const scrollContainer = document.querySelector(scrollSelector);
          const position = getComputedStyle(element).position;
          const previousScrollTop = scrollContainer?.scrollTop ?? 0;
          if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
          const rect = element.getBoundingClientRect();
          const visible = rect.bottom > 0 && rect.top < innerHeight && rect.left >= 0 && rect.right <= innerWidth;
          const overflow = document.documentElement.scrollWidth - innerWidth;
          if (scrollContainer) scrollContainer.scrollTop = previousScrollTop;
          return {position, visible, overflow, scrollHeight: scrollContainer?.scrollHeight ?? 0, clientHeight: scrollContainer?.clientHeight ?? 0};
        }''', scroll_selector)
        assert state['position'] == 'sticky', state
        assert state['visible'] and state['overflow'] <= 2, state
        path = OUTPUT / f'{name}-{width}x{height}.png'
        page.screenshot(path=path)
        report['captures'].append({'path': str(path), 'sticky': state})


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='profile-', dir=OUTPUT))
    fault = profile / 'save-fault.json'
    fault.write_text('{}', encoding='utf-8')
    hook = profile / 'offline.cjs'
    hook.write_text('''require('electron').app.setAppPath(process.env.STORYDREAM_QA_APP_ROOT);
globalThis.fetch=()=>Promise.reject(new Error('QA_OFFLINE'));
{
  const {ipcMain}=require('electron'), fs=require('node:fs');
  const register=ipcMain.handle.bind(ipcMain);
  ipcMain.handle=(channel, handler)=>register(channel, async (...args)=>{
    if(channel==='app:save-config' && JSON.parse(fs.readFileSync(process.env.STORYDREAM_QA_FAULT,'utf8')).fail)
      throw new Error('QA_SAVE_FAILED: local disk write rejected');
    return handler(...args);
  });
}
import(require('node:url').pathToFileURL(require('node:path').join(process.env.STORYDREAM_QA_APP_ROOT,'dist-electron/electron/main.js')).href);
''', encoding='utf-8')
    (profile/'package.json').write_text(json.dumps({'name':'storydream','version':'1.0.0','main':'offline.cjs'}),encoding='utf-8')
    env = {**os.environ, 'NODE_ENV':'production', 'STORYDREAM_QA_APP_ROOT':str(ROOT),
           'TEMP':str(profile), 'TMP':str(profile), 'STORYDREAM_QA_FAULT':str(fault)}
    for key in ['NODE_OPTIONS','VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','STORYDREAM_SMOKE_OUTPUT','STORYDREAM_SMOKE_USER_DATA']:
        env.pop(key,None)
    report = {'status':'running','profile':str(profile),'checks':[],'captures':[], 'runtimeErrors':[], 'nativeDialogs':[], 'paidGenerationCalls':0}
    process = None
    page = None
    log = (OUTPUT / 'electron.log').open('wb')
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0

    def launch(pw):
        nonlocal process, page
        port=base.available_port()
        process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}', '--remote-debugging-address=127.0.0.1',
                                  '--remote-allow-origins=*',f'--user-data-dir={profile}',str(profile)],cwd=ROOT,env=env,stdout=log,stderr=log,creationflags=flags)
        browser=pw.chromium.connect_over_cdp(base.wait_for_cdp(port,process))
        page=browser.contexts[0].pages[0]
        page.on('pageerror',lambda error:report['runtimeErrors'].append(str(error)))
        # Electron cancels native unload itself; CDP must not auto-answer its phantom dialog.
        page.on('dialog',lambda dialog:report['nativeDialogs'].append(dialog.type))
        base.wait_for_app(page)
        return browser

    try:
        with sync_playwright() as pw:
            browser=launch(pw)
            try:
                for route, label, selector in [
                    ('music-mv','MV retained draft','.music-mv-layout input'),
                    ('voice-lab','Voice retained draft','.voice-lab-layout textarea'),
                    ('html-video','HTML retained draft','.html-video-page input'),
                ]:
                    navigate(page,route)
                    route_ready(page,route)
                    if route=='voice-lab':
                        field=page.locator('textarea').first
                    elif route=='html-video':
                        field=page.locator('.hv-create-page textarea').first
                    else:
                        field=page.locator(selector).first
                    if route == 'music-mv':
                        capture_sticky_action(page, report, 'music-mv-sticky-action', '.music-mv-layout > .task-card > .panel-title-row', '.music-mv-layout')
                    field.fill(label)
                    navigate(page,'history')
                    expect(page.get_by_role('dialog')).to_be_visible()
                    if route=='music-mv':
                        capture_dialog(page,report,'save-draft')
                    page.get_by_role('button',name='继续编辑',exact=True).click()
                    expect(field).to_have_value(label)
                    navigate(page,'history')
                    page.get_by_role('button',name='保存并离开',exact=True).click()
                    route_ready(page,'history')
                    navigate(page,route)
                    route_ready(page,route)
                    expect(field).to_have_value(label)
                    field.fill(label+' discarded')
                    navigate(page,'history')
                    page.get_by_role('button',name='放弃改动并离开',exact=True).click()
                    route_ready(page,'history')
                    navigate(page,route)
                    route_ready(page,route)
                    expect(field).to_have_value(label)
                    report['checks'].append(route+': cancel/save/reopen/discard')

                navigate(page, 'new-task')
                route_ready(page, 'new-task')
                capture_sticky_action(page, report, 'new-task-sticky-action', '.new-task-stage-footer', '.new-task-scroll')
                report['checks'].append('new-task: sticky stage actions remain reachable at both sizes')

                navigate(page,'settings')
                route_ready(page,'settings')
                name=page.get_by_role('textbox',name='配置名称',exact=True)
                name.fill('R01 persisted configuration')
                fault.write_text('{"fail":true}',encoding='utf-8')
                navigate(page,'history')
                page.get_by_role('button',name='保存并离开',exact=True).click()
                expect(page.get_by_role('dialog').get_by_role('alert')).to_be_visible()
                route_ready(page,'settings')
                capture_dialog(page,report,'failed-save')
                page.get_by_role('button',name='继续编辑',exact=True).click()
                expect(name).to_have_value('R01 persisted configuration')
                fault.write_text('{}',encoding='utf-8')
                navigate(page,'history')
                page.get_by_role('button',name='保存并离开',exact=True).click()
                route_ready(page,'history')
                navigate(page,'settings')
                expect(name).to_have_value('R01 persisted configuration')
                report['checks'].append('settings: failed save preserves draft and route; retry persists')

                for mode in ['editorial-collage','motion-comic']:
                    title='Unsaved QA '+mode
                    task_id=page.evaluate('''async ({mode,title})=>{
                      if(mode==='editorial-collage') await window.storydream.createEditorialCollage({title,sourceText:'街道的变化记录着城市的生活。从交通和社区看城市更新。',ratio:'16:9'});
                      else await window.storydream.createMotionComic({title,premise:'女孩在雨夜收到一封来信，决定去寻找写信人。',episodeTitle:'第一集',ratio:'16:9'});
                      return (await window.storydream.listTasks({taskType:mode,limit:50})).items.find(t=>t.title===title).id;
                    }''',{'mode':mode,'title':title})
                    navigate(page,'history')
                    route_ready(page,'history')
                    page.get_by_role('textbox',name='搜索历史记录').fill(title)
                    page.get_by_role('button',name=f'打开任务 {title}',exact=True).click()
                    page.wait_for_selector('.director-desk')
                    field=page.get_by_role('textbox',name='编辑提示词',exact=True)
                    field.fill('Persisted director prompt '+mode)
                    page.get_by_role('button',name='返回全部任务',exact=True).click()
                    expect(page.get_by_role('dialog')).to_be_visible()
                    page.get_by_role('button',name='继续编辑',exact=True).click()
                    expect(field).to_have_value('Persisted director prompt '+mode)
                    page.get_by_role('button',name='返回全部任务',exact=True).click()
                    page.get_by_role('button',name='保存并离开',exact=True).click()
                    route_ready(page,'history')
                    text=page.evaluate('async id=>(await window.storydream.getTaskDetail(id)).pipelineData',task_id)
                    assert 'Persisted director prompt '+mode in text
                    report['checks'].append(mode+': cancel and save on exit')

                navigate(page,'music-mv')
                field=page.locator('.music-mv-layout input').first
                expect(field).to_have_value('MV retained draft')
                field.fill('MV close and restart')
                page.evaluate('window.close()')
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button',name='继续编辑',exact=True).click()
                expect(field).to_have_value('MV close and restart')
                page.get_by_role('button',name='关闭',exact=True).click()
                expect(page.get_by_role('dialog')).to_be_visible()
                page.get_by_role('button',name='保存并离开',exact=True).click()
                process.wait(timeout=20)
                browser.close()
                browser=launch(pw)
                navigate(page,'music-mv')
                expect(page.locator('.music-mv-layout input').first).to_have_value('MV close and restart')
                report['checks'].append('native close cancel; app close save; process restart restores draft')
                assert not report['runtimeErrors'],report['runtimeErrors']
                report['status']='passed'
            except Exception:
                if page and not page.is_closed():
                    page.screenshot(path=OUTPUT/'failure.png')
                    report['failureText']=page.locator('body').inner_text()[-5500:]
                raise
            finally:
                browser.close()
    except Exception as error:
        report['status']='failed'
        report['error']=str(error)
        raise
    finally:
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        log.close()
        report['finishedAt']=time.strftime('%Y-%m-%dT%H:%M:%S%z')
        (OUTPUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'checks':report['checks'],'output':str(OUTPUT)},ensure_ascii=False))


if __name__=='__main__':
    main()

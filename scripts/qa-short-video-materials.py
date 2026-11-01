"""Real desktop material-pool form QA, isolated profile, actual catalog, no model calls."""
import importlib.util, json, os, shutil, subprocess, tempfile, traceback
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/short-video-materials-ui'
spec=importlib.util.spec_from_file_location('qa_base',ROOT/'scripts/qa-director-desk.py')
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 profile=Path(tempfile.mkdtemp(prefix='profile-',dir=OUT))
 env={**os.environ,'NODE_ENV':'production','STORYDREAM_PROJECT_QA_DIR':str(profile),'PYTHONIOENCODING':'utf-8'}
 for key in ['NODE_OPTIONS','VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE']:env.pop(key,None)
 subprocess.run(['I:/nodejs/node.exe',str(ROOT/'node_modules/tsx/dist/cli.mjs'),str(ROOT/'scripts/qa-short-video-output-seed.ts'),str(profile)],check=True,cwd=ROOT,env=env)
 subprocess.run(['I:/nodejs/node.exe',str(ROOT/'scripts/qa-short-video-output-build.mjs')],check=True,cwd=ROOT,env=env)
 env['STORYDREAM_PROJECT_QA_MAIN']=str(ROOT/'.artifacts/short-video-output-ui/main.mjs')
 for number in [1,2]:shutil.copy2(ROOT/'.artifacts/pixelle-clips-smoke/motion-source.mp4',profile/f'material-{number}.mp4')
 def select_video(value): (profile/'controls.json').write_text(json.dumps({'materialVideo':value}),encoding='utf-8')
 select_video(1)
 report={'checks':[],'captures':[],'runtimeErrors':[],'profile':str(profile),'paidRequests':0,'licenseFixture':True}
 process=browser=pw=None
 def check(name,value=True):
  report['checks'].append({'name':name,'passed':bool(value)})
  assert value,name
 try:
  pw=sync_playwright().start(); port=base.free_port()
  with (OUT/'electron.log').open('ab') as log:
   process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1',f'--user-data-dir={profile}',str(ROOT/'scripts/qa-project-home.cjs')],cwd=ROOT,env=env,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)
  browser=pw.chromium.connect_over_cdp(base.wait_cdp(port,process));context=browser.contexts[0]
  page=context.pages[0] if context.pages else context.wait_for_event('page')
  page.on('pageerror',lambda error:report['runtimeErrors'].append(str(error)))
  page.set_default_timeout(20000);base.wait_app(page)
  def capture(name):
   check(name+' no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   path=OUT/(name+'.png');page.screenshot(path=str(path),animations='disabled');report['captures'].append(str(path))
  for width,height in [(1440,900),(1040,720)]:
   base.set_size(page,width,height)
   page.locator('[data-nav-view="new-task"]').first.click()
   page.get_by_role('tab',name='2 内容',exact=True).click()
   page.get_by_label('文案内容',exact=True).fill('素材池界面实测，不调用模型。')
   selector=page.get_by_label('画面模板引擎',exact=True);selector.select_option('')
   page.get_by_role('tablist',name='素材来源',exact=True).get_by_role('tab',name='素材混剪',exact=True).click()
   pool=page.get_by_role('region',name='素材混剪视频池')
   while pool.get_by_role('button',name='移除素材 1',exact=True).count():pool.get_by_role('button',name='移除素材 1',exact=True).click()
   expect(pool).to_contain_text('请至少添加一个本地视频')
   for button in page.get_by_role('button',name='创建并开始生成',exact=True).all():expect(button).to_be_disabled()
   check(str(width)+' empty pool blocks paid generation')
   select_video(1);pool.get_by_role('button',name='添加混剪视频',exact=True).click();expect(pool.locator('li')).to_have_count(1)
   expect(pool.locator('li').nth(0)).to_contain_text('material-1.mp4')
   pool.get_by_role('button',name='添加混剪视频',exact=True).click();expect(pool.locator('li')).to_have_count(1)
   check(str(width)+' duplicate path is not added twice')
   select_video('cancel');pool.get_by_role('button',name='添加混剪视频',exact=True).click();expect(pool.locator('li')).to_have_count(1)
   check(str(width)+' cancel preserves pool')
   select_video('error');pool.get_by_role('button',name='添加混剪视频',exact=True).click()
   expect(pool.get_by_role('alert')).to_contain_text('请求处理失败，请重试。');expect(pool.locator('li')).to_have_count(1)
   expect(pool.get_by_role('alert')).not_to_contain_text('__STORYDREAM_SAFE_APP_ERROR');expect(pool.get_by_role('alert')).to_contain_text('诊断号')
   expect(pool.get_by_role('button',name='添加混剪视频',exact=True)).to_be_enabled();check(str(width)+' picker failure recovers without losing files')
   pool.get_by_role('alert').scroll_into_view_if_needed();capture(f'picker-error-{width}')
   select_video([1,2,2]);pool.get_by_role('button',name='添加混剪视频',exact=True).click();expect(pool.locator('li')).to_have_count(2)
   expect(pool.get_by_role('alert')).to_have_count(0);check(str(width)+' batch addition deduplicates paths')
   select_video(list(range(3,104)));pool.get_by_role('button',name='添加混剪视频',exact=True).click()
   expect(pool.get_by_role('alert')).to_contain_text('最多添加 100');expect(pool.locator('li')).to_have_count(2)
   check(str(width)+' over-limit batch is rejected without truncation')
   select_video('cancel');pool.get_by_role('button',name='添加混剪视频',exact=True).click();expect(pool.get_by_role('alert')).to_have_count(0)
   expect(pool.locator('li').nth(1)).to_contain_text('material-2.mp4');check(str(width)+' file order retained')
   expect(pool.get_by_label('混剪画幅适配',exact=True)).to_be_enabled()
   check(str(width)+' ordinary fit remains editable')
   pool.get_by_label('混剪画幅适配',exact=True).select_option('contain')
   pool.scroll_into_view_if_needed();capture(f'pool-{width}')
   section=page.get_by_role('region',name='Pixelle 原版视觉模板')
   selector.select_option('1080x1920/image_default.html');expect(section.get_by_role('alert')).to_contain_text('视频')
   for button in page.get_by_role('button',name='创建并开始生成',exact=True).all():expect(button).to_be_disabled()
   check(str(width)+' incompatible image template rejected')
   selector.select_option('1080x1920/static_default.html');expect(section.get_by_role('alert')).to_have_count(1)
   check(str(width)+' incompatible static template rejected')
   selector.select_option('1080x1920/video_default.html')
   expect(section.get_by_role('alert')).to_have_count(0);expect(section).to_contain_text('2 个视频，无需重复上传')
   expect(section.get_by_role('button',name='选择本地视频',exact=True)).to_have_count(0)
   check(str(width)+' video template reuses pool')
   expect(pool.get_by_label('混剪画幅适配',exact=True)).to_be_disabled()
   expect(pool).to_contain_text('Pixelle 原模板决定画幅裁切')
   check(str(width)+' template fit ownership is explicit and disabled')
   selector.select_option('1080x1920/asset_default.html');section.get_by_label('模板素材类型',exact=True).select_option('video')
   expect(section.get_by_role('alert')).to_have_count(0);check(str(width)+' asset video reuses pool')
   section.get_by_label('字幕方式',exact=True).select_option('timed-overlay')
   page.get_by_role('tab',name='3 制作设置',exact=True).click()
   page.get_by_role('checkbox',name='直接成片 MP4',exact=True).check();page.get_by_role('checkbox',name='剪映草稿',exact=True).check()
   page.wait_for_function("()=>{const v=JSON.parse(localStorage.getItem('storydream.new-task-draft.v1')||'{}').values;return v?.shortVideoMaterials?.files?.length===2&&v?.shortVideoMaterials?.fit==='contain'&&v?.materialSource==='video'&&v?.outputTargets?.length===2}")
   page.reload();base.wait_app(page);page.locator('[data-nav-view="new-task"]').first.click();page.get_by_role('tab',name='2 内容',exact=True).click()
   expect(pool.locator('li')).to_have_count(2);expect(pool.get_by_label('混剪画幅适配',exact=True)).to_have_value('contain')
   expect(selector).to_have_value('1080x1920/asset_default.html');expect(section.get_by_label('模板素材类型',exact=True)).to_have_value('video')
   expect(pool.get_by_label('混剪画幅适配',exact=True)).to_be_disabled()
   check(str(width)+' actual reload preserves pool and compatible template')
   pool.get_by_role('button',name='移除素材 1',exact=True).click();expect(pool.locator('li')).to_have_count(1)
   expect(pool.locator('li').nth(0)).to_contain_text('material-2.mp4');expect(section).to_contain_text('1 个视频，无需重复上传')
   check(str(width)+' remove reindexes without clearing other file');pool.scroll_into_view_if_needed();capture(f'restored-{width}')
   page.get_by_role('tab',name='3 制作设置',exact=True).click()
   expect(page.get_by_role('checkbox',name='直接成片 MP4',exact=True)).to_be_checked();expect(page.get_by_role('checkbox',name='剪映草稿',exact=True)).to_be_checked()
   check(str(width)+' both output choices survive actual reload')
  check('no renderer errors',not report['runtimeErrors'])
  ledger=json.loads((profile/'ledger.json').read_text(encoding='utf-8'))
  check('no generation commands invoked',ledger['blockedGeneration']==0)
  report['status']='passed'
 except Exception:
  report['status']='failed';report['error']=traceback.format_exc()
  if 'page' in locals():
   try:page.screenshot(path=str(OUT/'failure.png'));(OUT/'failure-dom.txt').write_text(page.locator('body').inner_text(),encoding='utf-8')
   except Exception:pass
  raise
 finally:
  (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  if browser:
   try:browser.close()
   except Exception:pass
  if pw:
   try:pw.stop()
   except Exception:pass
  if process and process.poll() is None:process.terminate();process.wait(timeout=15)
  print(json.dumps({'status':report.get('status'),'checks':len(report['checks'])},ensure_ascii=False))
if __name__=='__main__':main()
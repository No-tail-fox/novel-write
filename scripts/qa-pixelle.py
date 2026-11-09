"""Real desktop Pixelle form QA, isolated profile, actual catalog, no model calls."""
import importlib.util, json, os, shutil, subprocess, tempfile, traceback
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.artifacts/pixelle-ui'
PARAMETER_LABELS={'author':'作者','describe':'简介','brand':'品牌','subtitle':'副标题','signature':'署名','accent_color':'强调色','title_font_size':'标题字号','background':'背景图片地址'}
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
 shutil.copy2(ROOT/'.artifacts/pixelle-clips-smoke/motion-source.mp4',profile/'pixelle-video.mp4')
 (profile/'controls.json').write_text(json.dumps({'pixelleVideo':True}),encoding='utf-8')
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
   page.get_by_label('文案内容',exact=True).fill('Pixelle 原版模板本地界面验收，不发起付费生成。')
   selector=page.get_by_label('画面模板引擎',exact=True)
   expect(selector.locator('option')).to_have_count(32)
   catalog=page.evaluate('()=>window.storydream.getPixelleCatalog()')
   check(str(width)+' all 31 original templates',len(catalog['templates'])==31)
   section=page.get_by_role('region',name='Pixelle 原版视觉模板')
   for t in catalog['templates']:
    selector.select_option(t['ref']['path'])
    expect(section).to_contain_text(f"{t['width']} × {t['height']}")
    for key,p in t['parameters'].items():
     control=section.get_by_label(PARAMETER_LABELS[key],exact=True)
     expect(control).to_have_count(1)
     if p['type']=='bool':expect(control).to_be_checked(checked=p['default'])
     else:expect(control).to_have_value(str(p['default']))
   check(str(width)+' all localized controls retain original defaults')
   expect(selector.locator('option[value="1080x1920/video_default.html"]')).to_contain_text('经典视频')
   check(str(width)+' all template parameter controls')
   selector.select_option('1080x1920/video_default.html')
   expect(section.get_by_role('alert')).to_contain_text('真实视频素材')
   for button in page.get_by_role('button',name='创建并开始生成',exact=True).all():expect(button).to_be_disabled()
   check(str(width)+' missing video blocks paid generation')
   section.get_by_role('button',name='选择本地视频',exact=True).click()
   expect(section).to_contain_text('pixelle-video.mp4')
   expect(section.get_by_role('alert')).to_have_count(0)
   (profile/'controls.json').write_text(json.dumps({'pixelleVideo':'error'}),encoding='utf-8')
   section.get_by_role('button',name='选择本地视频',exact=True).click()
   expect(section.get_by_role('alert')).to_contain_text('请求处理失败，请重试。')
   expect(section.get_by_role('alert')).not_to_contain_text('__STORYDREAM_SAFE_APP_ERROR')
   expect(section.get_by_role('alert')).to_contain_text('诊断号')
   expect(section).to_contain_text('pixelle-video.mp4')
   expect(section.get_by_role('button',name='选择本地视频',exact=True)).to_be_enabled()
   check(str(width)+' picker failure is readable and retains selected video')
   section.get_by_role('alert').scroll_into_view_if_needed();capture(f'picker-error-{width}')
   (profile/'controls.json').write_text(json.dumps({'pixelleVideo':'cancel'}),encoding='utf-8')
   section.get_by_role('button',name='选择本地视频',exact=True).click()
   expect(section.get_by_role('alert')).to_have_count(0);expect(section).to_contain_text('pixelle-video.mp4')
   check(str(width)+' cancel clears failure without losing selected video')
   (profile/'controls.json').write_text(json.dumps({'pixelleVideo':True}),encoding='utf-8')
   section.get_by_label('字幕方式',exact=True).select_option('timed-overlay')
   section.get_by_label('视频短于配音时',exact=True).select_option('black')
   capture(f'video-{width}')
   page.get_by_role('tab',name='3 制作设置',exact=True).click()
   ratios=page.get_by_role('tablist',name='AI 出图比例',exact=True)
   for tab in ratios.get_by_role('tab').all():expect(tab).to_be_disabled()
   check(str(width)+' original aspect ratio locked visibly')
   mp4=page.get_by_role('checkbox',name='直接成片 MP4',exact=True);draft=page.get_by_role('checkbox',name='剪映草稿',exact=True)
   mp4.check();draft.check();check(str(width)+' both outputs stay selectable')
   capture(f'outputs-{width}')
   page.wait_for_function("()=>{const v=JSON.parse(localStorage.getItem('storydream.new-task-draft.v1')||'{}').values;return v?.pixelleOptions?.padStrategy==='black'&&v?.outputTargets?.length===2}")
   page.reload();base.wait_app(page);page.locator('[data-nav-view="new-task"]').first.click();page.get_by_role('tab',name='2 内容',exact=True).click()
   expect(selector).to_have_value('1080x1920/video_default.html')
   expect(section.get_by_label('字幕方式',exact=True)).to_have_value('timed-overlay')
   expect(section.get_by_label('视频短于配音时',exact=True)).to_have_value('black')
   expect(section).to_contain_text('pixelle-video.mp4');check(str(width)+' actual reload preserves template video and options')
   selector.select_option('1080x1920/static_default.html')
   expect(section).to_contain_text('静态模板不调用生图模型')
   expect(section.get_by_role('button',name='选择本地视频',exact=True)).to_have_count(0)
   check(str(width)+' static flow has no video requirement')
   selector.select_option('1080x1920/asset_default.html')
   section.get_by_label('模板素材类型',exact=True).select_option('video')
   expect(section.get_by_role('alert')).to_contain_text('真实视频素材')
   section.get_by_label('模板素材类型',exact=True).select_option('image')
   expect(section.get_by_role('alert')).to_have_count(0)
   check(str(width)+' asset mode follows selected media kind')
   selector.select_option('')
   page.get_by_role('tab',name='3 制作设置',exact=True).click()
   for tab in ratios.get_by_role('tab').all():expect(tab).to_be_enabled()
   check(str(width)+' regular short video controls restored')
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
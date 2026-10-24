"""Offline QA of actual comic production controls, persistence, and scrolling."""
import importlib.util,json,os,subprocess,tempfile,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('comic_qa',ROOT/'scripts/qa-motion-comic.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.PROJECT_TITLE='制作输入与单元验收'
art=ROOT/'.artifacts/animation-stage-d/ui';art.mkdir(parents=True,exist_ok=True)
profile=Path(tempfile.mkdtemp(prefix='comic-units-',dir=ROOT/'.codex-temp'))
audit=base.create_offline_electron_entry(profile);port=base.available_port();env=os.environ.copy();env['NODE_ENV']='production'
for key in (*base.PAID_API_ENV_VARS,'VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'):env.pop(key,None)
process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}',f'--user-data-dir={profile}',str(profile)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
report={'paidCalls':0,'screenshots':[],'errors':[],'checks':[]}
try:
 with sync_playwright() as pw:
  browser=pw.chromium.connect_over_cdp(base.wait_for_cdp(port,process));page=browser.contexts[0].pages[0]
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  base.wait_for_app(page);base.set_window_size(page,1536,1024);base.seed_isolated_provider_profiles(page)
  task=page.evaluate("""async()=>{const r=await window.storydream.createMotionComic({title:'制作输入与单元验收',premise:'核对参考与对白',ratio:'16:9',source:{kind:'script',adaptationMode:'faithful-script',originalText:'一位行者穿过街巷。',episodes:[{title:'第一集',sourceText:'一位行者穿过街巷。'}]}});return r.task.id;}""")
  image=ROOT/'src/assets/director-desk/shot-alley.png';video=ROOT/'.artifacts/animation-stage-d/native-0.mp4'
  base.seed_structured_motion_comic(page,task,image,video)
  page.evaluate("""async id=>{const t=await window.storydream.getTaskDetail(id);const d=JSON.parse(t.pipelineData);for(const ep of d.episodes){for(const s of ep.scenes)for(const shot of s.shots){shot.videoProduction={version:1,referenceMode:'frames',audioMode:'post-mix'};delete shot.videoAssetVersionId;delete shot.videoJobId;}const shot=ep.scenes[0].shots[0];shot.durationMs=24000;shot.dialogueCueIds=['qa-line-a','qa-line-b','qa-line-c'];ep.dialogueCues=[{id:'qa-line-a',shotId:shot.id,text:'先核对角色、场景与道具参考。',startMs:0,endMs:9000,speakerRole:'narrative'},{id:'qa-line-b',shotId:shot.id,text:'这一整句对白应完整保留，按句子边界拆分。',startMs:9000,endMs:17000,speakerRole:'dialogue',characterId:d.characters[0].id,speakerName:'林夏'},{id:'qa-line-c',shotId:shot.id,text:'最后检查方向，再出发。',startMs:17000,endMs:24000,speakerRole:'monologue',characterId:d.characters[0].id,speakerName:'林夏'}];for(const cue of ep.dialogueCues)cue.emotion='平静';let start=0;for(const clip of ep.timeline.clips){const target=ep.scenes.flatMap(s=>s.shots).find(s=>s.id===clip.shotId);clip.startMs=start;clip.durationMs=target.durationMs;clip.subtitleCueIds=target.dialogueCueIds;start+=target.durationMs;}ep.timeline.durationMs=start;}d.providerJobs=[];d.stage='shot-board';await window.storydream.saveMotionComic({id,expectedUpdatedAt:d.updatedAt,document:d});}""",task)
  base.reopen_created_project(page)
  page.locator('.motion-comic-production__stages > button').nth(5).click();page.wait_for_selector('[data-stage="video"]')
  ready=page.get_by_label('镜头制作方式与准备度',exact=True);expect(ready).to_be_visible(timeout=15000)
  print('controls',ready.locator('select').evaluate_all('(nodes)=>nodes.map(n=>({label:n.labels?.[0]?.textContent,value:n.value}))'),flush=True)
  page.get_by_label('参考输入方式',exact=True).select_option('references')
  expect(page.get_by_label('实际提交参考列表')).to_be_visible();expect(page.get_by_label('实际提交参考列表').locator('li')).to_have_count(4)
  page.get_by_label('声音制作',exact=True).select_option('native');expect(page.get_by_label('声音制作',exact=True)).to_have_value('native')
  ready.locator('details summary').click();expect(ready).to_contain_text('这一整句对白应完整保留')
  for theme in ['light','dark']:
   base.set_theme(page,theme)
   for w,h in [(1536,1024),(1040,720)]:
    base.set_window_size(page,w,h)
    ready.locator('select').first.scroll_into_view_if_needed();path=art/f'{theme}-{w}.png';page.screenshot(path=str(path));report['screenshots'].append(str(path))
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2'),'window horizontal overflow'
    split=page.get_by_role('button',name='按模型时长拆分制作单元',exact=True);split.scroll_into_view_if_needed();expect(split).to_be_visible()
  base.set_window_size(page,1536,1024)
  page.get_by_role('button',name='保存版本',exact=True).first.click();expect(page.get_by_role('button',name='保存版本',exact=True).first).to_be_disabled(timeout=15000)
  page.get_by_role('button',name=re.compile('^返回')).first.click();base.reopen_created_project(page);page.locator('.motion-comic-production__stages > button').nth(5).click()
  expect(page.get_by_label('参考输入方式',exact=True)).to_have_value('references');expect(page.get_by_label('声音制作',exact=True)).to_have_value('native');report['checks'].append('input modes persist after reopen')
  page.get_by_role('button',name='按模型时长拆分制作单元',exact=True).click();page.get_by_role('button',name='保存版本',exact=True).first.click();expect(page.get_by_role('button',name='保存版本',exact=True).first).to_be_disabled(timeout=15000)
  saved=page.evaluate("""async id=>JSON.parse((await window.storydream.getTaskDetail(id)).pipelineData)""",task)
  units=[s for ep in saved['episodes'] for scene in ep['scenes'] for s in scene['shots'] if s.get('productionUnit')]
  assert len(units)>=2,units
  assert len([c for ep in saved['episodes'] for c in ep['dialogueCues']])==3
  report['checks'].append('split persists complete dialogue and unit boundaries');report['units']=units
  assert not report['errors'],report['errors'];assert not base.read_json_lines(audit)
  report['status']='passed';browser.close()
except Exception as error:
 report['status']='failed';report['error']=repr(error);raise
finally:
 (art/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
 process.terminate()
 try:process.wait(timeout=10)
 except subprocess.TimeoutExpired:process.kill()

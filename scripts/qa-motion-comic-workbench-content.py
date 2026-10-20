"""Isolated screenshots and local-only image generation QA for the comic desk."""
from __future__ import annotations
import argparse,base64,importlib.util,json,os,subprocess,tempfile,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('comic_qa',ROOT/'scripts/qa-motion-comic.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
TITLE='漫剧工作台 · 内容与生图验证'
base.PROJECT_TITLE=TITLE
ART=ROOT/'.artifacts/motion-comic-workbench-content'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--before',action='store_true');args=parser.parse_args()
    ART.mkdir(parents=True,exist_ok=True)
    temp=ROOT/'.codex-temp';temp.mkdir(exist_ok=True)
    profile=Path(tempfile.mkdtemp(prefix='comic-content-',dir=temp))
    requests=[]
    response_mode={"fail":False,"delay":0}
    image=ROOT/'src/assets/director-desk/shot-alley.png'
    payload=base64.b64encode(image.read_bytes()).decode()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
            if self.headers.get('Content-Type','').startswith('multipart/'):
                import email.parser,email.policy
                message=email.parser.BytesParser(policy=email.policy.default).parsebytes(('Content-Type: '+self.headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
                body={part.get_param('name',header='content-disposition'):part.get_payload(decode=True).decode('utf-8') for part in message.iter_parts() if part.get_content_type().startswith('text/')}
            else:body=json.loads(raw)
            requests.append({'path':self.path,'prompt':body.get('prompt'),'model':body.get('model')})
            time.sleep(response_mode['delay'])
            if response_mode['fail']:
                self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"message":"QA_REFERENCE_FAILURE"}}');return
            data=json.dumps({'data':[{'b64_json':payload}]}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(data)
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
    video=base.create_video_fixture(image,profile/'fixture.mp4')
    audit=base.create_offline_electron_entry(profile)
    env=os.environ.copy();env['NODE_ENV']='production';env['TEMP']=str(profile);env['TMP']=str(profile)
    for key in (*base.PAID_API_ENV_VARS,'VITE_DEV_SERVER_URL','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'):env.pop(key,None)
    port=base.available_port()
    process=subprocess.Popen([str(base.ELECTRON),f'--remote-debugging-port={port}','--remote-debugging-address=127.0.0.1',f'--user-data-dir={profile}',str(profile)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    report={'status':'running','externalPaidCalls':0,'screenshots':[],'runtimeErrors':[]}
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.connect_over_cdp(base.wait_for_cdp(port,process));context=browser.contexts[0];page=context.pages[0]
            context.route('**/*',lambda route:route.abort() if base.external_http_url(route.request.url) else route.continue_())
            page.on('pageerror',lambda e:report['runtimeErrors'].append(str(e)))
            base.wait_for_app(page);base.set_window_size(page,1536,1024)
            base.seed_isolated_provider_profiles(page)
            task_id=page.evaluate('''async ({title,origin})=>{
              const boot=await window.storydream.getBootstrap();const config=boot.config;
              config.gptImage.baseUrl=origin;config.imageProfiles[0].gptImage.baseUrl=origin;
              await window.storydream.saveConfig({config,secretChanges:{}});
              const r=await window.storydream.createMotionComic({title,premise:'女孩在雨夜收到来自未来的信，在天亮前寻找真相。',ratio:'9:16',source:{kind:'script',adaptationMode:'faithful-script',originalText:'雨夜，林夏收到来自未来的信。她走向旧邮局，决定核对邮戳。',episodes:[{title:'雨夜来信',sourceText:'雨夜，林夏收到来自未来的信。她走向旧邮局，决定核对邮戳。'}]}});
              return r.task.id;
            }''',{'title':TITLE,'origin':f'http://127.0.0.1:{server.server_address[1]}'})
            base.seed_structured_motion_comic(page,task_id,image,video)
            page.evaluate('''async id=>{const t=await window.storydream.getTaskDetail(id);const d=JSON.parse(t.pipelineData);d.assets=[];d.providerJobs=[];for(const ep of d.episodes)for(const clip of ep.timeline.clips)clip.assetVersionIds=[];for(const c of d.characters)for(const l of c.looks)l.referenceAssetVersionIds=[];for(const x of [...d.sceneAssets,...d.props])x.referenceAssetVersionIds=[];for(const ep of d.episodes)for(const s of ep.scenes)for(const shot of s.shots){delete shot.firstFrameAssetVersionId;delete shot.videoAssetVersionId;delete shot.videoJobId;}await window.storydream.saveMotionComic({id,expectedUpdatedAt:d.updatedAt,document:d});}''',task_id)
            base.reopen_created_project(page)
            def stage(index,name):
                button=page.locator('.motion-comic-production__stages > button').nth(index);expect(button).to_be_enabled();button.click();page.wait_for_selector(f'[data-motion-comic-production][data-stage="{name}"]')
            def capture(name):
                path=ART/f'{"before" if args.before else "after"}-{name}.png';page.screenshot(path=str(path));report['screenshots'].append(str(path))
            stage(2,'scenes');capture('scenes-desktop')
            stage(3,'assets');capture('assets-desktop')
            if not args.before:
                expect(page.get_by_label('资产生图模型',exact=True)).to_be_visible()
                expect(page.get_by_text('角色定妆图',exact=True)).to_be_visible()
                generate=page.get_by_role('button',name='生成 林夏 · 雨夜造型 参考图',exact=True)
                expect(generate).to_be_enabled();generate.click()
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(1,timeout=30000)
                stored=page.evaluate('''async id=>{const t=await window.storydream.getTaskDetail(id);const d=JSON.parse(t.pipelineData);return {refs:d.characters[0].looks[0].referenceAssetVersionIds,assets:d.assets.map(a=>({provider:a.provider,model:a.model,localPath:!!a.localPath})),jobs:d.providerJobs.map(j=>({status:j.status,capability:j.capability}))};}''',task_id)
                assert len(stored['refs'])==1 and stored['assets'][0]['localPath'],stored
                assert stored['assets'][0]['provider']!='local-import',stored
                report['generatedReference']=stored;capture('reference-generated')
                # Save/reopen must retain the generated version and leave other targets missing.
                base.reopen_created_project(page);stage(3,'assets')
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(1)
                expect(page.locator('[data-motion-comic-reference="missing"]')).to_have_count(2)
                base.set_window_size(page,1040,720);capture('assets-compact')
                page.get_by_role('button',name='查看场景资产',exact=True).click()
                expect(page.get_by_role('textbox',name='场景名称',exact=True)).to_be_visible()
                # A failed first scene request leaves the target empty and offers retry.
                response_mode['fail']=True
                scene_button=page.get_by_role('button',name='生成 旧城邮局与钟楼 参考图',exact=True)
                scene_button.click()
                expect(page.get_by_role('alert').first).to_be_visible(timeout=30000)
                expect(scene_button).to_be_enabled(timeout=30000)
                expect(page.locator('[data-motion-comic-reference="missing"]')).to_have_count(2)
                capture('reference-error')
                response_mode['fail']=False
                scene_button.click()
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(2,timeout=30000)
                page.get_by_role('button',name='查看道具资产',exact=True).click()
                page.get_by_role('button',name='生成 来自未来的信 参考图',exact=True).click()
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(3,timeout=30000)
                # Shared field edits remain drafts when switching sections.
                page.get_by_role('textbox',name='道具说明',exact=True).fill('带有十年后邮戳的信封，封口有蜡印。')
                page.get_by_role('button',name='查看角色资产',exact=True).click()
                page.get_by_role('button',name='查看道具资产',exact=True).click()
                expect(page.get_by_role('textbox',name='道具说明',exact=True)).to_have_value('带有十年后邮戳的信封，封口有蜡印。')
                page.get_by_role('button',name='保存',exact=True).click()
                expect(page.get_by_role('button',name='保存',exact=True)).to_be_disabled(timeout=15000)
                page.get_by_role('button',name='查看角色资产',exact=True).click()
                page.get_by_role('button',name='新增造型',exact=True).click()
                expect(page.get_by_role('textbox',name='造型名称',exact=True)).to_have_count(2)
                new_prompt=page.get_by_role('textbox',name='外观与服装',exact=True).last
                new_prompt.fill('同一人物，白色衬衫，清楚的面部特征')
                response_mode['delay']=0.7
                page.get_by_role('button',name='生成 林夏 · 造型 2 参考图',exact=True).click()
                # Change its dependencies while the local request is in flight.
                new_prompt.fill('同一人物，红色外套，保持原有面部特征')
                expect(page.get_by_role('alert').first).to_contain_text('资产设定已修改',timeout=30000)
                response_mode['delay']=0
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(3)
                expect(page.locator('[data-motion-comic-reference="missing"]')).to_have_count(1)
                capture('reference-stale-result')
                page.get_by_role('button',name='生成 林夏 · 造型 2 参考图',exact=True).click()
                expect(page.locator('[data-motion-comic-reference="fixed"]')).to_have_count(4,timeout=30000)
                expect(page.get_by_role('button',name='保存',exact=True)).to_be_disabled(timeout=15000)
                page.locator('.director-series-editor').evaluate('(node)=>{node.scrollTop=0}')
                # Dark/light and normal/compact windows share the same real controls.
                for theme in ['light','dark']:
                    base.set_theme(page,theme)
                    for size in [(1536,1024),(1040,720)]:
                        base.set_window_size(page,*size);capture(f'assets-{theme}-{size[0]}')
                        page.get_by_role('button',name='查看场景资产',exact=True).click()
                        expect(page.get_by_role('textbox',name='场景名称',exact=True)).to_be_visible()
                        page.get_by_role('button',name='查看道具资产',exact=True).click()
                        expect(page.get_by_role('textbox',name='道具名称',exact=True)).to_be_visible()
                        page.get_by_role('button',name='查看系列设定资产',exact=True).click()
                        expect(page.get_by_role('textbox',name='世界规则',exact=True)).to_be_visible()
                        page.get_by_role('button',name='查看角色资产',exact=True).click()
                page.get_by_role('textbox',name='角色 1',exact=True).focus()
                # Successful reference generation also persists the added look.
                expect(page.get_by_role('button',name='保存',exact=True)).to_be_disabled(timeout=15000)
                stage(2,'scenes');capture('scenes-compact')
                expect(page.get_by_text('镜头 1',exact=True).first).to_be_visible()
                for size in [(1536,1024),(1040,720)]:
                    base.set_window_size(page,*size)
                    overflow=page.evaluate('''()=>({body:document.documentElement.scrollWidth>innerWidth+2,root:document.querySelector('[data-motion-comic-production]').getBoundingClientRect().right>innerWidth+2})''')
                    assert not any(overflow.values()),overflow
                # Configured but missing-secret status must disable generation with an actionable reason.
                page.evaluate('''async()=>{const b=await window.storydream.getBootstrap();await window.storydream.saveConfig({config:b.config,secretChanges:{'image/qa-gpt-image/gptImage/apiKey':null}});}''')
                base.reopen_created_project(page);stage(3,'assets')
                expect(page.get_by_role('button',name='生成 林夏 · 雨夜造型 参考图',exact=True)).to_be_disabled()
                capture('assets-unconfigured')
            assert not report['runtimeErrors'],report['runtimeErrors']
            report['requests']=requests;report['blockedExternal']=base.read_json_lines(audit)
            assert not report['blockedExternal'],report['blockedExternal']
            assert len(requests)==(0 if args.before else 6),requests
            if not args.before:
                assert '短视频海报' not in requests[0]['prompt'] and 'premium social video cover' not in requests[0]['prompt'],requests[0]
                assert all(r['path'] in ['/v1/images/generations','/v1/images/edits'] for r in requests),requests
                assert requests[-1]['path']=='/v1/images/edits' and '红色外套' in requests[-1]['prompt'],requests[-1]
                assert '白色衬衫' in requests[-2]['prompt'],requests[-2]
            report['status']='passed'
            browser.close()
    except Exception as error:
        report['status']='failed';report['error']=str(error)
        raise
    finally:
        report['localRequests']=requests
        report['blockedExternal']=base.read_json_lines(audit)
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        server.shutdown();server.server_close()
        report['profile']=str(profile)
        (ART/f'{"before" if args.before else "after"}-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':report['status'],'screenshots':report['screenshots'],'localRequests':len(requests)},ensure_ascii=False))
if __name__=='__main__':main()

from pathlib import Path
import json, os, shutil, socket, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]; ART=ROOT/'.artifacts'/'director-r07-batch-qa'; TMP=ROOT/'.codex-audit-temp'; ELECTRON=ROOT/'node_modules'/'electron'/'dist'/'electron.exe'; USER=Path(os.environ.get('STORYDREAM_HISTORY_DATA_DIR',str(Path(os.environ.get('APPDATA',''))/'storydream'/'storydream')))

def free():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
def wait(p,c):
 end=time.time()+30
 while time.time()<end:
  if c.poll() is not None: raise RuntimeError(c.returncode)
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{p}/json/version',timeout=1) as r:return json.loads(r.read())['webSocketDebuggerUrl']
  except:time.sleep(.2)
 raise TimeoutError()
def launch(profile,pw):
 p=free(); env=os.environ.copy();env['NODE_ENV']='production';env.pop('VITE_DEV_SERVER_URL',None);env.pop('ELECTRON_RUN_AS_NODE',None)
 c=subprocess.Popen([str(ELECTRON),f'--remote-debugging-port={p}','--remote-debugging-address=127.0.0.1','--remote-allow-origins=*',f'--user-data-dir={profile}',str(ROOT)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 b=pw.chromium.connect_over_cdp(wait(p,c));page=b.contexts[0].pages[0];page.wait_for_selector('.app-shell',state='visible',timeout=30000);return c,b,page
ART.mkdir(parents=True,exist_ok=True); profile=TMP/f'r07-batch-{int(time.time()*1000)}'; (profile/'storydream').mkdir(parents=True,exist_ok=True)
for n in ('data.db','data.db-wal','data.db-shm'):
 s=USER/n
 if s.exists():shutil.copy2(s,profile/'storydream'/n)
report={'status':'running','steps':[]}
with sync_playwright() as pw:
 c,b,p=launch(profile,pw)
 try:
  result=p.evaluate('''async () => { const plan={scope:'all',capabilities:{image:true,video:true,voice:true,render:true},outputReady:false,renderFailed:false,shots:[]}; const node=(id,status,cap='image')=>({id,capability:cap,shotId:id,title:id,status,estimatedCost:0,dependencies:[]}); const id='qa-r07-batch-main'; const old=await window.storydream.getDirectorBatch(id); if(old) await window.storydream.deleteDirectorBatch(id); const created=await window.storydream.createDirectorBatch({id,workflowKind:'director',projectId:'qa-project-a',episodeId:'episode-1',status:'running',concurrency:2,plan,nodes:[node('completed-1','completed'),node('pending-1','pending'),node('pending-2','pending')]}); const paused=await window.storydream.updateDirectorBatch(id,{expectedUpdatedAt:created.updatedAt,status:'paused',pauseRequested:true}); const resumed=await window.storydream.updateDirectorBatch(id,{expectedUpdatedAt:paused.updatedAt,status:'running',pauseRequested:false}); const cancelling=await window.storydream.updateDirectorBatch(id,{expectedUpdatedAt:resumed.updatedAt,status:'cancelling',cancelRequested:true}); const a=await window.storydream.listDirectorBatches({projectId:'qa-project-a',episodeId:'episode-1'}); const z=await window.storydream.listDirectorBatches({projectId:'qa-project-b',episodeId:'episode-2'}); return {created:{status:created.status},paused:{status:paused.status,pauseRequested:paused.pauseRequested},resumed:{status:resumed.status},cancelling:{status:cancelling.status,cancelRequested:cancelling.cancelRequested},filterA:a.map(x=>x.id),filterB:z.map(x=>x.id)} }''')
  report['steps'].append({'name':'create_filter_pause_cancel','result':result})
  b.close(); c.kill(); c.wait(timeout=10)
  c2,b2,p2=launch(profile,pw)
  rec=p2.evaluate('''async () => { const r=await window.storydream.getDirectorBatch('qa-r07-batch-main'); return r ? {status:r.status,recoveryRequired:r.recoveryRequired,recoveryReason:r.recoveryReason,pauseRequested:r.pauseRequested,cancelRequested:r.cancelRequested,nodes:r.nodes.map(n=>({id:n.id,status:n.status,error:n.error}))} : null }''')
  report['steps'].append({'name':'restart_recovery','result':rec})
  ack=p2.evaluate('''async () => { const r=await window.storydream.getDirectorBatch('qa-r07-batch-main'); const nodes=r.nodes.map(n=>n.status==='completed'?n:{...n,status:'pending',error:undefined}); const u=await window.storydream.updateDirectorBatch(r.id,{expectedUpdatedAt:r.updatedAt,status:'paused',pauseRequested:true,recoveryRequired:false,recoveryReason:'',nodes}); return {status:u.status,recoveryRequired:u.recoveryRequired,completed:u.nodes.filter(n=>n.status==='completed').map(n=>n.id),pending:u.nodes.filter(n=>n.status==='pending').map(n=>n.id)} }''')
  report['steps'].append({'name':'ack_remote_only_pending','result':ack});report['status']='passed'
 except Exception as e: report['status']='failed';report['error']=repr(e)
 finally:
  (ART/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
  try:b.close()
  except:pass
  try:c.kill()
  except:pass
  shutil.rmtree(profile,ignore_errors=True)
print(json.dumps(report,ensure_ascii=False,indent=2))

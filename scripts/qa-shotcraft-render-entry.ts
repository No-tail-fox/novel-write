import {app,BrowserWindow,session} from 'electron';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {renderDirectorVideo} from '../electron/director-renderer';
import {createVoxAnimation} from '../src/shared/vox-animation';
import type {DirectorRenderScene} from '../src/shared/director-render';
import {setDefaultPythonRuntimeAppRoot} from '../src/shared/python-runtime';

const {root,out}=JSON.parse(process.env.STORYDREAM_SHOTCRAFT_RENDER_QA!);
if(!app.isReady())app.disableHardwareAcceleration();
app.setPath('userData',join(out,'electron-profile'));
setDefaultPythonRuntimeAppRoot(root);
const report:Record<string,any>={status:'running',externalCalls:0,externalRequests:[],sceneIds:[]};
let keeper:BrowserWindow|undefined;
globalThis.fetch=async()=>{report.externalCalls++;throw new Error('No providers or external network are allowed in ShotCraft QA');};
async function run() {
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const external=/^https?:/.test(details.url);
    if(external)report.externalRequests.push(details.url);
    callback({cancel:external});
  });
  keeper=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const fixture=JSON.parse(await readFile(join(out,'fixture.json'),'utf8'));
  report.runtimeSha256=createHash('sha256').update(await readFile(join(out,'runtime.js'))).digest('hex');
  const runtimePath=join(out,`render-runtime-${report.runtimeSha256}.js`);
  await copyFile(join(out,'runtime.js'),runtimePath);
  const scenes:DirectorRenderScene[]=fixture.ids.map((id:string,i:number)=>{
    const animation=fixture.cases.find((item:{id:string})=>item.id===id).animation;
    return {id,index:i+1,title:animation.template.props.title,caption:'',durationMs:4000,renderStrategy:'remotion',animation,
      subtitleCues:[{id:`cue-${i}`,text:'本地镜头 · 文字和图片均可编辑',startMs:900,endMs:3300}],
      animationAssets:['cover','page'].map(id=>({id,kind:'image',path:join(out,`${id}.png`)})),
      layers:[],camera:[],audioPath:'',audioClips:[]};
  });
  const legacy=createVoxAnimation('已有模板保持可用','中文标题与副标题仍可正常渲染');
  scenes.push({id:'legacy-text-opening',index:7,title:legacy.template.props.title,caption:'',durationMs:2000,renderStrategy:'remotion',animation:legacy,animationAssets:[],subtitleCues:[],layers:[],camera:[],audioPath:'',audioClips:[]});
  report.sceneIds=scenes.map(scene=>scene.id);
  report.result=await renderDirectorVideo({workDir:join(out,'render'),projectTitle:'ShotCraft 镜头集成验收',modeLabel:'VOX',ratio:'16:9',scenes,animationRuntimePath:runtimePath});
  assert.equal(report.result.width,1920);assert.equal(report.result.height,1080);
  assert(Math.abs(report.result.durationMs-26000)<100,JSON.stringify(report.result));
  assert.equal(report.result.subtitleLayout.scenes.length,7);
  for(const scene of report.result.subtitleLayout.scenes) {
    assert.equal(scene.status,'ok',JSON.stringify(scene));
    assert.equal(scene.cues.length,scene.shotId==='legacy-text-opening'?0:1);
  }
  await copyFile(report.result.outputPath,join(out,'shotcraft-integration.mp4'));
  assert.equal(report.externalCalls,0);assert.equal(report.externalRequests.length,0);
  assert.equal(BrowserWindow.getAllWindows().length,1,'All temporary capture windows must be closed');
  report.status='passed';
}
app.whenReady().then(run).catch(error=>{report.status='failed';report.error=error.stack??String(error);}).finally(async()=>{await writeFile(join(out,'render-report.json'),JSON.stringify(report,null,2),'utf8');keeper?.destroy();app.exit(report.status==='passed'?0:1);});

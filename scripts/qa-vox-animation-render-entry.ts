import {app,BrowserWindow} from 'electron';
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {renderDirectorVideo} from '../electron/director-renderer';
import {createVoxAnimation,voxItemSchema} from '../src/shared/vox-animation';
import type {DirectorRenderScene} from '../src/shared/director-render';
import {setDefaultPythonRuntimeAppRoot} from '../src/shared/python-runtime';
const {root,out}=JSON.parse(process.env.STORYDREAM_VOX_RENDER_QA!);
await writeFile(join(out,'electron-started.txt'),`module loaded ${new Date().toISOString()} ready=${app.isReady()}`,'utf8');
if(!app.isReady())app.disableHardwareAcceleration();app.setPath('userData',join(out,'electron-profile'));setDefaultPythonRuntimeAppRoot(root);
const report:Record<string,any>={status:'running',externalCalls:0};let keep:BrowserWindow;
globalThis.fetch=async()=>{report.externalCalls++;throw new Error('No network allowed in this QA');};
async function run(){
  await writeFile(join(out,'electron-ready.txt'),'ready','utf8');
  keep=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  const fixture=JSON.parse(await readFile(join(out,'fixture.json'),'utf8'));
  const scenes:DirectorRenderScene[]=[];
  for(const [i,id] of ['text-opening','book-3d','code','layers'].entries()){
    const animation=createVoxAnimation(['知识如何改变生活','打开一本书','用代码生成动画','原有拼贴镜头'][i],'可编辑、可预览、可导出');
    animation.template.id=id==='code'?'text-opening':id;
    animation.template.props.assetIds=id==='book-3d'?['cover','page']:[];
    if(id==='code'){animation.mode='code';animation.code={...fixture.code,prompt:''};}
    scenes.push({id:`shot-${i}`,index:i+1,title:animation.template.props.title,caption:'这是本地生成的验收字幕',subtitleCues:[{id:`cue-${i}-a`,text:'动画、字幕与声音共同导出',startMs:0,endMs:1000},{id:`cue-${i}-b`,text:'模板可以与拼贴镜头混合',startMs:1000,endMs:2000}],durationMs:2000,renderStrategy:id==='layers'?'deterministic-layers':'remotion',animation,
      animationAssets:['cover','page'].map(id=>({id,kind:'image',path:join(out,`${id}.png`)})),
      layers:id==='layers'?[{id:'bg',label:'背景',imagePath:join(out,'page.png'),kind:'background',zIndex:0,depth:0,width:1,height:1,motion:[{atMs:0,x:.5,y:.5,scale:1,rotation:0,opacity:1}]}]:[],camera:[],audioPath:join(out,'audio.wav')});
  }
  report.result=await renderDirectorVideo({workDir:join(out,'render'),projectTitle:'VOX 动画集成验收',modeLabel:'VOX',ratio:'16:9',scenes,animationRuntimePath:join(root,'dist-electron/electron/vox-animation-runtime.js')});
  assert.equal(report.result.width,1920);assert.equal(report.result.height,1080);assert(Math.abs(report.result.durationMs-8000)<100);
  assert.equal(report.result.subtitleLayout.scenes.length,4);
  for(const scene of report.result.subtitleLayout.scenes){assert.equal(scene.status,'ok',JSON.stringify(scene));assert.equal(scene.cues.length,2);assert.equal(scene.visibilitySamples.at(-1).activeCueIds.length,0);}
  await copyFile(report.result.outputPath,join(out,'vox-animation-integration.mp4'));
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>renderDirectorVideo({workDir:join(out,'cancel'),projectTitle:'Cancel',modeLabel:'VOX',ratio:'16:9',scenes,signal:controller.signal}));report.cancelled=true;
  const activeController=new AbortController(),timer=setTimeout(()=>activeController.abort(),500);
  try {await assert.rejects(()=>renderDirectorVideo({workDir:join(out,'cancel-active'),projectTitle:'Cancel during capture',modeLabel:'VOX',ratio:'16:9',scenes,signal:activeController.signal,animationRuntimePath:join(root,'dist-electron/electron/vox-animation-runtime.js')}));}
  finally {clearTimeout(timer);}
  assert.equal(BrowserWindow.getAllWindows().length,1,'cancel must destroy capture window');
  report.cancelDuringCapture=true;
  report.singleShot=await renderDirectorVideo({workDir:join(out,'single-shot'),projectTitle:'单镜头导出',modeLabel:'VOX',ratio:'16:9',scenes:scenes.slice(0,1),animationRuntimePath:join(root,'dist-electron/electron/vox-animation-runtime.js')});
  assert(Math.abs(report.singleShot.durationMs-2000)<100);
  assert.equal(report.externalCalls,0);report.status='passed';
}
app.whenReady().then(run).catch(e=>{report.status='failed';report.error=e.stack??String(e);}).finally(async()=>{await writeFile(join(out,'render-report.json'),JSON.stringify(report,null,2),'utf8');keep?.destroy();app.exit(report.status==='passed'?0:1);});

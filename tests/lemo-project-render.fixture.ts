/** Offline fixture: the production assembler, compiler and playback host; no providers or database. */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assembleLemoProject, type LemoProject } from '../src/shared/creative-animation/native-project';
import { compileLemoNative } from '../electron/lemo-native-compiler';
import { buildVoxAnimationHtml, createVoxAnimation, type VoxAnimationPayload } from '../src/shared/vox-animation';

const output = resolve(process.argv[2]);
const runtime = await readFile('dist-electron/electron/vox-animation-runtime.js', 'utf8');
const shared = `const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=360;document.body.style.margin='0';document.body.append(canvas);
const image=new Image();const resources={canvas,ctx:canvas.getContext('2d'),image,loaded:false};
const ready=new Promise((resolve,reject)=>{image.onload=()=>{resources.loaded=true;resolve()};image.onerror=reject;});
image.src=input.assets[input.materials.texture];return {resources,ready};`;
const scene = (index: number) => `if(!shared.resources.loaded)throw Error('Shared assets were not ready before scene initialization');
return {render(t){const {ctx,image}=shared.resources;ctx.fillStyle='${index === 1 ? '#f0e8d8' : '#dce9f2'}';ctx.fillRect(0,0,640,360);ctx.fillStyle='#b1452f';ctx.fillRect(40+core.clamp(t/8)*400,120,80,80);ctx.drawImage(image,600,20,20,20);ctx.fillStyle='#172537';ctx.font='24px sans-serif';ctx.fillText('Scene ${index} '+t.toFixed(2),30,48);},texts(t){return [{id:'label',text:'Scene ${index} '+t.toFixed(2),x0:30,y0:24,x1:250,y1:52,fontFamily:'sans-serif',fontSize:24}];}};`;
const sources = [shared, scene(1), scene(2), `return {render(t){const active=t<4?scenes['scene-1']:scenes['scene-2'];active.render(t);},texts(t){return (t<4?scenes['scene-1']:scenes['scene-2']).texts(t);}};`];
const project: LemoProject = { version:2, materials:[],bindings:{texture:'fixture-texture'},repairFileIds:[],samplePaths:[],files:[
  {id:'shared',kind:'shared',shotIds:[]}, {id:'scene-1',kind:'scene',shotIds:['first']}, {id:'scene-2',kind:'scene',shotIds:['second']}, {id:'director',kind:'director',shotIds:[]},
].map((f,i)=>({...f,source:sources[i],status:'valid',attempts:[]})) as LemoProject['files'] };
const asset = {id:'fixture-texture',label:'Offline prepared image',kind:'image' as const,url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#2455bb"/></svg>')};
for (const [name,offset,sample] of [['first',0,false],['second',4000,false],['sample',0,true]] as const) {
  const source = assembleLemoProject(project,{script:'完整文案',materials:project.bindings},8000,sample);
  const compiled = compileLemoNative(source);
  const animation = createVoxAnimation();
  animation.mode='code';animation.code={...animation.code,...compiled};
  animation.native={filmId:'offline-film',startMs:offset,durationMs:4000,filmDurationMs:8000,width:640,height:360,fps:24,assetIds:[asset.id]};
  const payload:VoxAnimationPayload={animation,width:640,height:360,durationMs:4000,fps:24,cues:[],assets:[asset]};
  await writeFile(join(output,'film-'+name+'.html'),buildVoxAnimationHtml(runtime,payload),'utf8');
}

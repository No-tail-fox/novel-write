import { app, BrowserWindow } from 'electron';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildHtmlVideoExportInput } from '../src/shared/html-video';
import { upgradeHtmlSceneComposition } from '../src/shared/html-video-composition';
import { createElectronHtmlVideoRenderer } from '../electron/html-video-renderer';
import { HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS } from '../src/shared/html-video-captions';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { prepareQaNarration } from './qa-animation-media';
import type { PipelineArtifact, HtmlVideoScenePlan } from '../src/shared/types';
const root = resolve(process.cwd()), work = join(root, '.artifacts/animation-stage-b');
app.disableHardwareAcceleration(); app.setPath('userData', join(work, 'profile')); setDefaultPythonRuntimeAppRoot(root); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
 const keep = new BrowserWindow({ show: false });
 try {
  await mkdir(work, {recursive:true});
  const cutouts = join(root,'.artifacts/cutout-stage-a');
  const paper = join(work,'paper.jpg');
  const sentences = [
   ['这张室内照片，记录了一个疲惫的瞬间。','先保留原图，再把人物单独分离。'],
   ['人物移到画面右侧。','左侧的留白，用来交代主题。'],
   ['换一个方向，人物位于左侧。','文字与视线之间，也需要呼吸。'],
   ['留白，让信息更容易被看见。','一句话出现时，画面可以安静下来。'],
   ['左边是原始照片，右边是分离的人物。','对比构图，让变化一眼可见。'],
   ['先看人物，再把焦点交给原始照片。','动作跟随这句话，字幕也跟随声音。'],
  ];
  const voices = await prepareQaNarration(join(work,'voices'), sentences);
  const caption = sentences.flat().join('');
  const templates = ['center-focus','left-text-right-object','right-text-left-object','full-quote','split-compare','parallax-focus'];
  const titles = ['从照片，到一段动画','人物与留白','文字与视线','留白，让信息被看见','原始照片 · 分离人物','焦点，跟随叙述'];
  const plans:HtmlVideoScenePlan[] = templates.map((sceneTemplate,i) => upgradeHtmlSceneComposition({index:i+1,narration:sentences[i].join(''),title:titles[i],captions:sentences[i],sceneTemplate,background:{prompt:'复用真实纸张纹理'}, elements:Array.from({length:i===3?0:i>=4?2:1},(_,slot)=>({slot,prompt:slot?'原始照片':'独立人物'}))}));
  if(process.env.HTML_QA_HIGHRES==='1')plans.splice(1);
  const artifact:PipelineArtifact = {reviewedText:caption,rewrittenCopy:caption,cover:{title:titles[0],subtitle:[],summary:caption,tags:[],comments:[]},scenes:plans.map((plan,i)=>({id:plan.index,cap:plan.narration,descPrompt:'',durationMs:voices[i].durationMs})),imagePrompts:[],subtitles:{cues:[],srt:''}};
  const source = JSON.parse(await readFile(join(cutouts,'report.json'),'utf8')).source as string;
  const reports=[];
  for (const portrait of (process.env.HTML_QA_HIGHRES==='1'?[false]:[false,true])) {
   const dir=join(work,portrait?'portrait':'landscape'); await mkdir(join(dir,'html-scenes'),{recursive:true});
   await copyFile(join(root,'node_modules/gsap/dist/gsap.min.js'),join(dir,'html-scenes/gsap.min.js'));
   await copyFile(join(root,'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js'),join(dir,'html-scenes/hyperframe.runtime.gsap.iife.js'));
   const input=buildHtmlVideoExportInput({workDir:dir,outputPath:join(work,process.env.HTML_QA_HIGHRES==='1'?'highres-1920.mp4':portrait?'portrait.mp4':'landscape.mp4'),title:titles[0],artifact,generatedImages:plans.map(plan=>({sceneId:plan.index,path:paper})),foregroundImages:plans.flatMap(plan=>plan.elements.map(element=>({sceneId:plan.index,slot:element.slot,path:plan.index===5 ? (element.slot ? join(cutouts,'natural-person-shared.png') : source) : (element.slot ? source : join(cutouts,'natural-person-shared.png'))}))),narrationAudio:plans.map((plan,i)=>({sceneId:plan.index,path:voices[i].path,captionCues:voices[i].captionCues})),fps:24,canvas_w:portrait?608:process.env.HTML_QA_HIGHRES==='1'?1920:1080,canvas_h:portrait?1080:process.env.HTML_QA_HIGHRES==='1'?1080:608,captionConfig:{captionPreset:'editorial',captionAnim:'none',captionLayout:{...HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS,fontSize:52}},scenePlans:plans});
   const bounds=[];
   // Exercise arbitrary and reverse seek with the actual DOM/GSAP runtime.
   for (const scene of input.scenes) {
    const file=join(dir,'html-scenes',`inspect-${scene.sceneId}.html`);await writeFile(file,scene.html,'utf8');
    const win=new BrowserWindow({show:false,width:input.canvas_w,height:input.canvas_h,useContentSize:true,webPreferences:{nodeIntegration:false,contextIsolation:true,webSecurity:false}});
    await win.loadFile(file);await win.webContents.executeJavaScript('document.fonts.ready');
    for (const time of [0,scene.duration*.7,scene.duration*.2,scene.duration-.1]) {
     const result=await win.webContents.executeJavaScript(`window.__tl.seek(${time},false);JSON.stringify(Array.from(document.querySelectorAll('#scene-title,.caption')).map(el=>({text:el.textContent,opacity:getComputedStyle(el).opacity,rect:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height},overflow:el.scrollHeight>el.clientHeight+2})))`);
     const items=JSON.parse(result);
     if(time>0.1&&time<scene.duration-.15&&!items.slice(1).some((item:{opacity:string})=>Number(item.opacity)>.1))throw new Error(`Caption missing after seek: scene ${scene.sceneId} time ${time}`);
     bounds.push({sceneId:scene.sceneId,time,items});
     await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     if(time===scene.duration*.7)await writeFile(join(dir,`scene-${scene.sceneId}.png`),(await win.webContents.capturePage()).toPNG());
    }
    win.destroy();
   }
   console.log('render',portrait?'portrait':'landscape');
   const started=Date.now();const rendered=process.env.HTML_QA_STILLS_ONLY === '1' ? { outputPath: input.outputPath } : await createElectronHtmlVideoRenderer().render(input); reports.push({portrait,rendered,bounds,elapsedMs:Date.now()-started});
  }
  await writeFile(join(work,process.env.HTML_QA_HIGHRES==='1'?'highres-report.json':'report.json'),JSON.stringify({plans,reports,timingSource:'tts-measured-sentence-boundaries',voices,paidCalls:0},null,2),'utf8');
  keep.destroy();app.exit(0);
 }catch(error){console.error(error);await writeFile(join(work,'error.txt'),error instanceof Error ? error.stack ?? error.message : String(error),'utf8');keep.destroy();app.exit(1);}
});

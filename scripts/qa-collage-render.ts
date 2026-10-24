import { app, BrowserWindow } from 'electron';
import { readFile, mkdir, copyFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createEditorialMotionLayers } from '../src/shared/editorial-motion';
import { createEditorialCuePlan, resolveEditorialCuePlan } from '../src/shared/editorial-cue-plan';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { renderDirectorVideo } from '../electron/director-renderer';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { prepareQaNarration, prepareQaNarrationWithWordTimings } from './qa-animation-media';
import { alignSubtitleCue } from '../src/shared/audio-alignment';
import { removeImageBackground } from '../electron/background-removal';
const wordTiming = process.env.VOX_QA_WORDS === '1';
const root = resolve(process.cwd()), work = resolve(process.env.VOX_QA_WORK ?? join(root, wordTiming ? '.artifacts/animation-stage-c-words' : '.artifacts/animation-stage-c'));
app.disableHardwareAcceleration(); app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
 const keep = new BrowserWindow({show:false});
 try {
  await mkdir(work,{recursive:true});
  const cuts=join(root,'.artifacts/cutout-stage-a');
  const a=JSON.parse(await readFile(join(cuts,'report.json'),'utf8'));
  const sentences = [
   ['原始照片记录了人物，也保留了房间里的细节。','分离背景以后，人物成为可以独立摆放的素材。'],
   ['左边是原始照片，右边是分离的人物。','原图保留完整环境，抠图让构图更自由。'],
   ['先让人物出现在画面的左侧。','说到向右移动，人物再沿着画面前进。','抵达终点后，停下来，让观众看清。'],
  ];
  const voices=await (wordTiming ? prepareQaNarrationWithWordTimings : prepareQaNarration)(join(work,'voices'),sentences);
  const card=join(work,'original-photo-card.png');
  // A transparent paper photograph is an explicit framed source, not a claimed model cutout.
  const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util');
  await promisify(execFile)(join(root,'vendor/python/python.exe'),['-c',`from PIL import Image
im=Image.open(${JSON.stringify(a.source)}).convert('RGBA'); im.thumbnail((900,1050)); out=Image.new('RGBA',(1000,1150)); out.paste(im,((1000-im.width)//2,(1150-im.height)//2)); out.save(${JSON.stringify(card)})`],{windowsHide:true});
  const cardMetadata=await removeImageBackground(card,join(work,'original-photo-card-alpha.png'),{
   method:'native-alpha',modelDirectory:join(work,'models'),workerPath:join(root,'src/shared/remove-background-worker.py'),
  });
  const durationMs=voices.reduce((n,v)=>n+v.durationMs,0);
  let doc=createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'stage-c',title:'让画面跟随叙述',ratio:'16:9'}),sentences.flat().join(''));
  const templateBeat=structuredClone(doc.beats[0]), templateShot=structuredClone(templateBeat.shots[0]);
  doc.beats=[];doc.assets=[];
  let absolute=0;
  for(let i=0;i<3;i++) {
   const duration=voices[i].durationMs, style=(['evidence-stack','comparison','path-progress'] as const)[i];
   const shotId=`semantic-shot-${i}`, beatId=`semantic-beat-${i}`;
   const title=['照片与独立素材','原始照片 · 分离人物','从起点，到终点'][i];
   const cues=voices[i].captionCues.map((cue,j)=>{
    const base={id:`c-${i}-${j}`,shotId,startMs:absolute+Math.round(cue.startSec*1000),endMs:absolute+Math.round(cue.endSec*1000),text:cue.text};
    if(!wordTiming||!('words' in cue))return base;
    const words=cue.words as Array<{text:string;startSec:number;endSec:number}>;
    return alignSubtitleCue(base,{source:'provider',audioAssetVersionId:`voice-${i}`,timestamps:words.map(word=>({
     text:word.text,startMs:absolute+Math.round(word.startSec*1000),endMs:Math.min(base.endMs,absolute+Math.round(word.endSec*1000)),
    }))});
   });
   let layers=createEditorialMotionLayers({shotId,title,narration:sentences[i].join(''),durationMs:duration,ratio:'16:9',index:i,motionStyle:style});
   if(i===1&&!layers.some(l=>l.id.endsWith('subject-secondary'))) {
    const subject=layers.find(l=>l.kind==='subject')!;
    layers.splice(2,0,{...structuredClone(subject),id:`${shotId}-subject-secondary`,motion:subject.motion.map(f=>({...f,x:.74}))});
   }
   let subjectIndex=0;
   layers=layers.map(layer=>{
    if(layer.kind==='background')return {...layer,assetVersionId:`bg-${i}`};
    if(['subject','archival'].includes(layer.kind)) {
     const useCard=subjectIndex++===0&&i!==2;
     return {...layer,assetVersionId:useCard?`card-${i}`:`subject-${i}`};
    }
    return layer;
   });
   const cuePlan=createEditorialCuePlan(cues,layers,style);
   if(wordTiming&&i===2){
    const phrase='向右移动，',offset=cues[0].text.length+cues[1].text.indexOf(phrase);
    Object.assign(cuePlan.beats[1],{text:phrase,sourceStart:offset,sourceEnd:offset+phrase.length,occurrence:1,action:'move'});
   }
   const shot={...structuredClone(templateShot),id:shotId,title,durationMs:duration,subtitleCueIds:cues.map(c=>c.id),motionStyle:style,layers,camera:[{atMs:0,x:.5,y:.5,zoom:1},{atMs:duration,x:.5,y:.5,zoom:1}],voiceAssetVersionId:`voice-${i}`,renderStrategy:'remotion' as const,
    cuePlan,
    animation:{version:1 as const,mode:'template' as const,template:{id:'paper-actors',props:{title,subtitle:'',author:'',source:'',accent:'#c7513b',background:'#eee8dc',foreground:'#242820',unit:'',highlight:'',items:[],assetIds:[`card-${i}`,`subject-${i}`,`bg-${i}`],geoJson:'',focus:{x:.25,y:.25,width:.5,height:.5}}},code:{source:'',compiled:'',prompt:''}}};
   doc.beats.push({...structuredClone(templateBeat),id:beatId,title,narration:sentences[i].join(''),startMs:absolute,durationMs:duration,subtitleCues:cues,shots:[shot]});
   doc.assets.push(
    {id:`bg-${i}`,assetId:`bg-${i}`,kind:'image',localPath:join(root,'.artifacts/animation-stage-b/paper.jpg'),createdAt:doc.createdAt},
    {id:`card-${i}`,assetId:`card-${i}`,kind:'image',localPath:card,backgroundRemoval:cardMetadata,createdAt:doc.createdAt},
    {id:`subject-${i}`,assetId:`subject-${i}`,kind:'image',localPath:a.foreground,backgroundRemoval:a.metadata,createdAt:doc.createdAt},
    {id:`voice-${i}`,assetId:`voice-${i}`,kind:'audio',localPath:voices[i].path,durationMs:duration,createdAt:doc.createdAt});
   absolute+=duration;
  }
  doc=rebuildEditorialTimeline(doc);
  const semantic=doc.beats.map(beat=>({title:beat.title,source:beat.narration,actions:resolveEditorialCuePlan(beat.shots[0].cuePlan!,beat.subtitleCues,beat.startMs,beat.durationMs)}));
  if(wordTiming&&semantic.some(beat=>beat.actions.some(action=>action.timingPrecision!=='token-boundary')))throw new Error('Real word QA unexpectedly fell back to estimated timing');
  const runtime=join(root,'dist-electron/electron/vox-animation-runtime.js');await access(runtime);
  const outputs=[];
  for(const engine of ['remotion','deterministic-layers'] as const) {

   const current=structuredClone(doc);for(const beat of current.beats)beat.shots[0].renderStrategy=engine;
   const scenes=buildDirectorRenderScenes(rebuildEditorialTimeline(current));
   console.log('render',engine,scenes.length,durationMs);
   const rendered=await renderDirectorVideo({workDir:join(work,engine),projectTitle:doc.title,modeLabel:'VOX',ratio:'16:9',scenes,animationRuntimePath:runtime});
   await copyFile(rendered.outputPath,join(work,`${engine}.mp4`));
   outputs.push({engine,rendered,scenes});
   await writeFile(join(work,'report.json'),JSON.stringify({doc,semantic,voices,outputs,paidProviderCalls:0,visualReview:'pending',subtitleTiming:wordTiming?'Offline SAPI SpeakProgress word starts; token ends derived from the next start/audio end. No acoustic confidence, ASR accuracy or VLM validation claimed.':'measured TTS sentence boundaries; semantic precision estimated; no word timestamps'},null,2),'utf8');
  }
  console.log(JSON.stringify({durationMs,outputs:outputs.map(o=>o.rendered.outputPath)}));keep.destroy();app.exit(0);
 } catch(e) { console.error(e);await writeFile(join(work,'error.txt'),e instanceof Error?e.stack??e.message:String(e),'utf8');keep.destroy();app.exit(1); }
});

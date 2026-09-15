import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileVoxCode, VoxTemplateStore, prepareVoxHtml } from '../electron/vox-animation-runtime';
import { createVoxAnimation, voxItemSchema, voxAnimationSchema, validateVoxAnimation, VOX_TEMPLATES, voxAnimationAssetIds } from '../src/shared/vox-animation';
import { createEditorialCollageDraft, rebuildEditorialTimeline, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createDirectorBatchPlan } from '../src/features/director-desk/director-batch';
import { ipcInputSchemas } from '../src/shared/ipc-contract';

const source='import React from "react"; import {AbsoluteFill,useCurrentFrame} from "remotion"; export default function Scene({title}) { const f=useCurrentFrame(); return <AbsoluteFill style={{opacity:Math.min(1,f/20)}}>{title}</AbsoluteFill>; }';
describe('VOX animation integration',()=>{
  it('validates inputs and missing media without seeding fake content',()=>{
    const a=createVoxAnimation();expect(a.template.props.items).toEqual([]);expect(validateVoxAnimation(a).length).toBeGreaterThan(0);
    a.template.id='book-3d';a.template.props.title='中文书籍';a.template.props.assetIds=['cover'];
    expect(validateVoxAnimation(a)).toContain('此模板需要至少 2 张图片');
    a.template.props.assetIds.push('page');expect(validateVoxAnimation(a,[{id:'cover',kind:'image'}])).toContain('有图片素材不存在，请重新选择');
    a.template.id='map-region';a.template.props.geoJson='{"type":"Polygon","coordinates":[[1,2]]}';
    expect(validateVoxAnimation(a).join()).toContain('有效的 Polygon');
    expect(new Set(VOX_TEMPLATES.map(x=>x.id)).size).toBe(VOX_TEMPLATES.length);
  });
  it('compiles valid TSX and rejects invalid or unsupported execution',()=>{
    expect(compileVoxCode(source).compiled).toContain('exports.default');
    for(const s of ['import x from "fs"; export default x', 'export default ()=>window.location', 'export default ()=>fetch("x")', 'export default ()=>import("react")', 'export default ()=> <iframe/>', 'const a=1', 'export default function( {'])expect(()=>compileVoxCode(s)).toThrow();
    expect(ipcInputSchemas['vox:generate'].safeParse({requestId:'1',prompt:'需求',props:createVoxAnimation().template.props,templateId:'text-opening',durationMs:-1,ratio:'16:9'}).success).toBe(false);
  });
  it('persists both drafts, reopens, updates, and deletes personal templates',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'vox-template-'));try{
      const a=createVoxAnimation('书籍标题');a.code={...compileVoxCode(source),prompt:'简洁开场'};
      const store=new VoxTemplateStore(dir),row={id:'personal',name:'书籍开场',animation:a,updatedAt:new Date().toISOString()};
      await store.save(row);expect((await new VoxTemplateStore(dir).list())[0].animation).toEqual(a);
      await store.save({...row,name:'修改名称'});expect((await store.list()).length).toBe(1);
      expect((await store.remove(row.id)).length).toBe(0);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
  it('renders text without image generation and invalidates output after parameter changes',()=>{
    const d=createEditorialCollageDraft({id:'animation',title:'测试',ratio:'16:9'});
    d.assets=[{id:'audio',assetId:'audio',kind:'audio',localPath:'test.wav',createdAt:d.createdAt}];
    const animation=createVoxAnimation('中文标题');
    d.beats=[{id:'beat',index:1,title:'开场',narration:'真实输入',startMs:0,durationMs:3000,subtitleCues:[{id:'cue',shotId:'shot',text:'真实输入',startMs:0,endMs:3000}],shots:[{id:'shot',beatId:'beat',durationMs:3000,renderStrategy:'remotion',animation,scenePrompt:'',motionPrompt:'',layers:[],camera:[],subtitleCueIds:['cue'],voiceAssetVersionId:'audio'}]}];
    const ready=rebuildEditorialTimeline(d),reopened=parseEditorialCollagePipelineData(JSON.stringify(ready));
    const scenes=buildDirectorRenderScenes(reopened);expect(scenes[0].renderStrategy).toBe('remotion');expect(scenes[0].layers).toEqual([]);
    expect(buildDirectorRenderScenes(reopened,undefined,{shotIds:['shot']})).toHaveLength(1);
    const before=directorDocumentRenderFingerprint(ready);animation.template.props.title='新标题';expect(directorDocumentRenderFingerprint(ready)).not.toBe(before);
    animation.template.props.assetIds=['picture'];expect(voxAnimationAssetIds(animation)).toEqual(['picture']);
    const plan=createDirectorBatchPlan({scope:'all',capabilities:{image:true,video:true,voice:true,render:true},outputReady:false,shots:[{id:'shot',title:'模板',renderStrategy:'remotion',imageReady:false,videoReady:false,voiceReady:false,imageFailed:false,videoFailed:false,voiceFailed:false}]});
    expect(plan.imageCount).toBe(0);expect(plan.videoCount).toBe(0);expect(plan.voiceCount).toBe(1);
  });
  it('never trusts cached compiled code on export',async()=>{
    const a=createVoxAnimation('标题');a.mode='code';a.code={source,compiled:'throw new Error("poison-cache")',prompt:''};
    const html=await prepareVoxHtml('dist-electron/electron/vox-animation-runtime.js',{animation:a,width:960,height:540,durationMs:2000,fps:24,assets:[],cues:[]});
    expect(html).not.toContain('poison-cache');expect(html).toContain('Content-Security-Policy');expect(voxAnimationSchema.parse(a).mode).toBe('code');
  });
});

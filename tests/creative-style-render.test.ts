import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreativeScene } from '../src/features/vox-animation/CreativeScene';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, editorialCollagePipelineSchema, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createVoxAnimation, validateVoxAnimation, voxAnimationSchema, type VoxAnimationPayload } from '../src/shared/vox-animation';
import { voxProductionSettings, buildVoxProductionNodes } from '../src/shared/vox-production';
import { applyCreativeStyleToDocument, assembleCreativeShot } from '../src/shared/creative-animation/assemble';
import { CREATIVE_RENDER_SPECS, creativeLayout, creativeMotion, creativeRenderSpec } from '../src/shared/creative-animation/render-spec';
import { buildCreativeTextSvg, fitCreativeText, creativeCueAnnotation } from '../src/shared/creative-animation/text-layer';
import { creativeStyleStatus } from '../src/shared/creative-animation/status';
import { CREATIVE_STYLES, LEMO_REVISION } from '../src/shared/creative-animation/styles';

function fixture() {
  const d=createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'style-test',title:'城市降温',ratio:'16:9'}),'城市白天吸收热量。树荫帮助街道降温。','2026-10-27T00:00:00.000Z',15000);
  return d;
}
const settings=(styleId:string)=>({...voxProductionSettings(),narration:false,authoring:{mode:'template' as const,styleId}});
const shot=(d:ReturnType<typeof fixture>)=>d.beats[0].shots[0];
function payload(styleId:string):VoxAnimationPayload {
  const d=fixture(),s=assembleCreativeShot(d,shot(d),settings(styleId));
  return {animation:s.animation!,width:1920,height:1080,durationMs:s.durationMs,fps:24,cues:[{text:'城市白天吸收热量。',startMs:0,endMs:s.durationMs}],assets:[{id:'subject',label:'subject',kind:'image',url:'data:image/png;base64,AA=='}],semanticLayers:[{id:'subject',assetId:'subject',kind:'subject',zIndex:10,depth:.1,width:.3,height:.4,motion:[{atMs:0,x:.4,y:.5,scale:1,rotation:0,opacity:1}]}]};
}
describe('applied creative style renderer',()=>{
  it('refuses to replace AI native authoring with a local template',()=>{
    expect(()=>applyCreativeStyleToDocument(fixture(),{...settings('whiteboard'),authoring:{mode:'ai-code',styleId:'whiteboard'}})).toThrow('不能应用本地模板');
  });
  it('covers every selectable style explicitly and changes type, layout, material and motion beyond palette',()=>{
    expect(Object.keys(CREATIVE_RENDER_SPECS).sort()).toEqual(CREATIVE_STYLES.map(s=>s.slug).sort());
    expect(creativeRenderSpec('not-a-style')).toBeUndefined();
    const specs=CREATIVE_STYLES.map(s=>creativeRenderSpec(s.slug));
    expect(new Set(specs.map(s=>JSON.stringify(s))).size).toBe(59);
    expect(new Set(specs.map(s=>s.layout)).size).toBeGreaterThan(12);
    expect(new Set(specs.map(s=>s.title)).size).toBeGreaterThan(12);
    expect(new Set(specs.map(s=>s.reveal)).size).toBeGreaterThan(10);
    for(const spec of specs)for(const [w,h] of [[1920,1080],[1080,1920]]) {
      const boxes=creativeLayout(spec,w,h);
      for(const box of Object.values(boxes)) {
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x+box.width).toBeLessThanOrEqual(1);expect(box.y+box.height).toBeLessThanOrEqual(.84);
      }
    }
  });
  it('persists the actual style separately from saved next-run settings; old projects remain valid',()=>{
    const d=fixture(),base=directorDocumentRenderFingerprint(d);
    d.productionSettings=settings('watercolor');
    expect(directorDocumentRenderFingerprint(d)).toBe(base);
    const applied=applyCreativeStyleToDocument(d,settings('whiteboard'));
    expect(shot(applied).animation?.creativeStyle).toEqual({styleId:'whiteboard',rendererRevision:1,upstreamRevision:LEMO_REVISION,source:'local',composition:'scene'});
    expect(directorDocumentRenderFingerprint(applied)).not.toBe(base);
    expect(editorialCollagePipelineSchema.safeParse(applied).success).toBe(true);
    expect(voxAnimationSchema.safeParse(createVoxAnimation()).success).toBe(true);
    expect(validateVoxAnimation({...shot(applied).animation!,creativeStyle:{...shot(applied).animation!.creativeStyle!,styleId:'missing'}})).toContain('镜头采用的风格不存在，请重新应用风格');
    expect(creativeStyleStatus(shot(applied).animation,settings('watercolor'))).toContain('待应用：');
    expect(creativeStyleStatus(shot(applied).animation,settings('whiteboard'))).not.toContain('待应用：');
    expect(creativeStyleStatus(shot(applied).animation,{...settings('whiteboard'),authoring:{mode:'ai-code',styleId:'whiteboard'}})).toContain('待创作：白板讲解 · Lemo 原生全片');
    const native={...shot(applied).animation!,mode:'code' as const,code:{...shot(applied).animation!.code,engine:'lemo-native' as const},authoring:{owner:'creative-production' as const,revision:1 as const,upstreamRevision:LEMO_REVISION,styleId:'whiteboard',status:'reviewed' as const,attempts:[]}};
    expect(creativeStyleStatus(native,{...settings('watercolor'),authoring:{mode:'ai-code',styleId:'watercolor'}})).toContain('已应用：白板讲解 · Lemo 原生全片 · 待创作：水彩笔刷 · Lemo 原生全片');
    expect(creativeStyleStatus(native,{...settings('whiteboard'),authoring:{mode:'ai-code',styleId:'whiteboard'}})).not.toContain('待创作：');
  });
  it('preserves original IDs, assets, narration, locks and manually authored code when applying locally',()=>{
    const d=fixture();const all=d.beats.flatMap(b=>b.shots);expect(all.length).toBeGreaterThan(1);
    const locked=structuredClone(all[1]);
    all[0].animation=createVoxAnimation(all[0].title);all[0].animation.code.source='manual code';
    const original=structuredClone(d),config={...settings('blueprint'),lockedShotIds:[locked.id]};
    const result=applyCreativeStyleToDocument(d,config);
    expect(result.beats.flatMap(b=>b.shots)).toEqual(original.beats.flatMap(b=>b.shots));
    expect(result.assets).toEqual(original.assets);expect(result.sourceText).toBe(original.sourceText);
    expect(result.beats.map(b=>b.subtitleCues)).toEqual(original.beats.map(b=>b.subtitleCues));
    delete all[0].animation;
    const changed=applyCreativeStyleToDocument(d,config);
    expect(shot(changed).id).toBe(all[0].id);expect(changed.beats.flatMap(b=>b.shots).find(s=>s.id===locked.id)).toEqual(locked);
    expect(shot(changed).layers.map(l=>l.id)).toEqual(all[0].layers.map(l=>l.id));
  });
  it('retains paid attempt history and cancels the old run so resume cannot restore its previous style',()=>{
    const d=fixture(),config=settings('whiteboard');
    shot(d).animation=createVoxAnimation(shot(d).title);
    shot(d).animation!.authoring={owner:'creative-production',revision:1,upstreamRevision:LEMO_REVISION,styleId:'watercolor',status:'fallback',attempts:[{requestId:'old-request',source:'original paid source'}],error:'old failure'};
    shot(d).animation!.code.source='original paid source';
    d.productionRun={version:1,id:'run',status:'paused',settings:settings('watercolor'),sourceHash:'',runtimeIdentity:'',createdAt:d.createdAt,updatedAt:d.updatedAt,nodes:buildVoxProductionNodes(d,settings('watercolor'))};
    const result=applyCreativeStyleToDocument(d,config);
    expect(result.productionRun?.status).toBe('cancelled');expect(result.productionRun?.nodes).toEqual(d.productionRun.nodes);
    expect(shot(result).animation?.authoring).toEqual(shot(d).animation?.authoring);
    expect(shot(result).animation?.code.source).toBe('original paid source');
    expect(creativeStyleStatus(shot(result).animation,config)).toContain('本地风格编排');
    d.productionRun.status='running';expect(()=>applyCreativeStyleToDocument(d,config)).toThrow('暂停');
    d.productionRun.status='paused';d.productionRun.nodes[0].status='unknown';expect(()=>applyCreativeStyleToDocument(d,config)).toThrow('核对');
  });
  it('exports actual creative layers even without an image cue plan and preserves subsequent authored geometry',()=>{
    const d=applyCreativeStyleToDocument(fixture(),{...settings('blueprint'),generateImages:false});
    const s=shot(d);expect(s.cuePlan).toBeUndefined();
    const label=s.layers.find(l=>l.content)!;
    label.visible=false;label.motion=[{atMs:0,x:.33,y:.22,scale:.9,rotation:3,opacity:.7}];
    s.voiceAssetVersionId='voice';d.assets.push({id:'voice',assetId:'voice',kind:'audio',localPath:'I:/fixtures/voice.wav',createdAt:d.createdAt});
    const scene=buildDirectorRenderScenes(rebuildEditorialTimeline(d),undefined,{shotIds:[s.id]})[0];
    expect(scene.layers.map(l=>l.id)).toEqual(s.layers.map(l=>l.id));
    expect(scene.layers.find(l=>l.id===label.id)).toMatchObject({visible:false,motion:label.motion});
  });
  it('keeps stepped poses separate from smooth camera motion and holds the resolved ending',()=>{
    const spec=creativeRenderSpec('pixel-rpg');
    const a=creativeMotion(spec,105,0,2000,3000),b=creativeMotion(spec,120,0,2000,3000);
    expect(a.progress).toBe(b.progress);expect(a.camera).not.toBe(b.camera);
    expect(creativeMotion(spec,2800,0,2000,3000)).toEqual(creativeMotion(spec,2999,0,2000,3000));
    const wash=creativeRenderSpec('watercolor');
    expect(creativeMotion(wash,500,0,3000,4000).progress).toBeLessThan(.5);
    expect(creativeMotion(wash,2749,2700,3000,3000).progress).toBeGreaterThan(.99);
  });
  it('does not resurrect hidden titles or subjects and respects edited text geometry',()=>{
    const p=payload('whiteboard');
    const title=p.animation.template.props.title;
    p.semanticLayers!.push({id:'title',kind:'label',content:{type:'text',text:title},visible:false,zIndex:20,depth:0,motion:[{atMs:0,x:.23,y:.34,scale:1,rotation:0,opacity:1}],width:.2,height:.1});
    p.semanticLayers![0].visible=false;p.animation.template.props.assetIds=['subject'];
    let html=renderToStaticMarkup(createElement(CreativeScene,{payload:p,frame:48}));
    expect(html).not.toContain('data-creative-subject');expect(html).not.toContain('aria-label="'+title+'"');
    p.semanticLayers![1].visible=true;
    html=renderToStaticMarkup(createElement(CreativeScene,{payload:p,frame:48}));
    expect(html).toContain('left:13%');expect(html).toContain('width:20%');expect(html).toContain('height:10%');
  });
  it('keeps the actual data and source while styling data presentation',()=>{
    const d=fixture(),config={...settings('blueprint'),presetId:'data-map' as const,data:[{label:'A',value:1,source:'dataset A'},{label:'B',value:2,source:'dataset B'}]};
    const s=assembleCreativeShot(d,shot(d),config);
    expect(s.animation?.creativeStyle?.composition).toBe('data');
    expect(s.animation?.template.props.items.map(i=>({label:i.label,value:i.value}))).toEqual([{label:'A',value:1},{label:'B',value:2}]);
    expect(s.animation?.template.props.source).toBe('dataset A；dataset B');
    expect(s.layers).toEqual(shot(d).layers);
  });
  it('escapes supplied text, uses style-specific title art and reveals through a mask with a fixed text viewport',()=>{
    const text='树荫 <10% & 城市降温';
    const board=buildCreativeTextSvg(text,1000,220,'whiteboard',{progress:.5});
    const pixel=buildCreativeTextSvg(text,1000,220,'pixel-rpg');
    expect(board).toContain('树荫 &lt;10% &amp; 城市降温');expect(board).not.toContain(text);
    expect(board).not.toBe(pixel);expect(board).toContain('<clipPath');
    expect(board).toContain('viewBox="0 0 1000 220"');expect(board).not.toContain('<svg width="500"');
  });
  it('balances short Chinese titles and keeps annotations verbatim without duplicating full narration',()=>{
    const fitted=fitCreativeText('无法专注的阅读',540,200,82);
    expect(fitted.lines).toEqual(['无法专注','的阅读']);
    expect(fitted.lines.join('')).toBe('无法专注的阅读');
    expect(creativeCueAnnotation('完一本书了？ 不是因为你变笨了，')).toBe('不是因为你变笨了');
    expect(creativeCueAnnotation('而是因为有一台精密运转的机器，')).toBe('而是因为有一台精密运转的机器');
    expect(creativeCueAnnotation('一个非常长的句子应该只作为旁白出现而不挤进图形里的说明标签当中')).toBe('');
    const english=fitCreativeText('Shade keeps cities cooler',320,160,50);
    expect(english.lines.join(' ')).toBe('Shade keeps cities cooler');
  });
});

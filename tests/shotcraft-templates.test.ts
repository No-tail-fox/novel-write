import { describe, expect, it } from 'vitest';
import { createVoxAnimation, validateVoxAnimation, voxAnimationSchema, voxItemSchema, voxAnimationAssetIds, VOX_TEMPLATES } from '../src/shared/vox-animation';
import { SHOTCRAFT_COMMIT, SHOTCRAFT_TEMPLATES } from '../src/shared/shotcraft-recipes';
import { voxAnimationMessages } from '../src/shared/vox-animation-prompt';
import { paperTitleTokens, popupState, tapeState } from '../src/features/vox-animation/shotcraft/PaperShots';
import { timelineCameraAt, timelinePopFrame, timelineTravelTiming, timelineZoomAt } from '../src/features/vox-animation/shotcraft/timeline-motion';
import { VoxTemplateStore } from '../electron/vox-animation-runtime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function sample(id: string) {
  const a=createVoxAnimation('从观察到理解','把分散的信息组织起来');
  a.template={...a.template,id,revision:1};
  a.template.props.items=[voxItemSchema.parse({label:'观察',detail:'记录事物变化',date:'第一阶段'}),voxItemSchema.parse({label:'理解',detail:'建立联系',date:'第二阶段'})];
  return a;
}

describe('ShotCraft additions and existing project compatibility',()=>{
  it('retains all legacy choices and gives new choices pinned provenance',()=>{
    expect(VOX_TEMPLATES.filter(t=>!t.recipe)).toHaveLength(49);
    expect(new Set(VOX_TEMPLATES.map(t=>t.id)).size).toBe(55);
    for(const t of SHOTCRAFT_TEMPLATES){
      expect(t.recipe?.source).toContain(SHOTCRAFT_COMMIT);
      expect(t.recipe?.implementation).toContain('/demos/');
      expect(validateVoxAnimation(sample(t.id))).toEqual([]);
    }
  });
  it('loads old drafts without rewriting their identity and rejects future revisions',()=>{
    const old=createVoxAnimation('已有动画');old.template.id='paper-title';
    expect(voxAnimationSchema.parse(old)).toEqual(old);
    expect(voxAnimationSchema.safeParse({...sample('shotcraft-paper-title'),template:{...sample('shotcraft-paper-title').template,revision:2}}).success).toBe(false);
  });
  it('round-trips new parameters and revision through the real personal template store',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'storydream-shotcraft-'));
    try {
      const a=sample('shotcraft-timeline-travel');a.template.props.assetIds=['asset-id'];a.template.props.accent='#123456';
      const row={id:'shotcraft-custom',name:'我的中文时间轴',animation:a,updatedAt:'2026-09-15T12:00:00Z'};
      await new VoxTemplateStore(dir).save(row);
      expect((await new VoxTemplateStore(dir).list())[0]).toEqual(row);
    } finally {await rm(dir,{recursive:true,force:true});}
  });
  it('rejects overflow and missing images without silently discarding user content',()=>{
    const a=sample('shotcraft-ring-reveal');a.template.props.items[0].detail='长'.repeat(61);
    expect(validateVoxAnimation(a)).toContain('条目 1 说明最多 32 字');
    expect(a.template.props.items[0].detail).toHaveLength(61);
    a.template.props.items[0].detail='说明';a.template.props.assetIds=['missing'];
    expect(validateVoxAnimation(a,[])).toContain('有图片素材不存在，请重新选择');
    a.template.props.items=Array.from({length:5},()=>voxItemSchema.parse({label:'层'}));
    expect(validateVoxAnimation(a)).toContain('此模板最多显示 4 个条目，请删除多余条目');
  });
  it('supplies only the selected recipe to AI requests and retains sandbox constraints',()=>{
    const a=sample('shotcraft-source-merge');
    const messages=voxAnimationMessages({requestId:'qa',prompt:'按当前内容绘制',templateId:a.template.id,props:a.template.props,durationMs:5600,ratio:'9:16'});
    const request=JSON.parse(messages[1].content);
    expect(request.shotRecipe.card).toBe('bezier-source-converge-merge');
    expect(request.shotRecipe.motion).toContain('贝塞尔');
    expect(messages[1].content).not.toContain('paper-craft-moves');
    expect(messages[0].content).toContain('只允许 react/remotion');
  });
  it('retains inactive assets across choices without loading or validating them',()=>{
    const a=sample('shotcraft-paper-title');a.template.props.assetIds=['prior-image'];a.template.props.audioAssetId='prior-audio';
    a.template.props.items[0].detail='长'.repeat(1200);
    expect(validateVoxAnimation(a,[])).toEqual([]);
    expect(voxAnimationAssetIds(a)).toEqual([]);
    a.template.id='shotcraft-paper-tape';
    expect(voxAnimationAssetIds(a)).toEqual(['prior-image']);
    expect(validateVoxAnimation(a,[])).toContain('有图片素材不存在，请重新选择');
  });
});

describe('motion timing and retained content',()=>{
  it('holds taped paper after the second landing without lingering oscillation',()=>{
    expect(tapeState(84)).toEqual(tapeState(139));
    expect(tapeState(84).rotation).toBe(0);
    expect(tapeState(80).shadowBlur).toBeGreaterThan(tapeState(84).shadowBlur);
  });
  it('settles every supported paper card on its hinge',()=>{
    for(let n=1;n<=6;n++)for(let i=0;i<n;i++){
      expect(popupState(1,i,n).rotation).toBe(-90);
      expect(popupState(1,i,n).shadow).toBe(0);
      expect(popupState(.99,i,n)).toEqual(popupState(1,i,n));
    }
  });
  it('preserves Chinese, Latin words, punctuation and spaces; emphasizes a single occurrence',()=>{
    const text='知识改变生活，知识 connecting ideas!';
    const tokens=paperTitleTokens(text,'知识,生活');
    expect(tokens.map(t=>t.text).join('')).toBe(text);
    expect(tokens.filter(t=>t.accent).map(t=>t.text)).toEqual(['知识']);
  });
  it.each([24,30])('finishes timeline movement before a full final second at %i fps',fps=>{
    const timing=timelineTravelTiming(fps,6*fps,5);
    expect(timing.holdStart).toBeLessThanOrEqual(5*fps);
    for(const f of [5*fps,6*fps-1]){
      expect(timelineCameraAt(f,timing,1000)).toBeCloseTo(1000);
      expect(timelineZoomAt(f,timing)).toBeCloseTo(1.28);
    }
    const pop=timelinePopFrame(4,5,timing);
    expect(pop).toBeLessThan(timing.travelEnd);
  });
  it('maps the same wall-clock camera progression across 24 and 30 fps',()=>{
    const a=timelineTravelTiming(24,144,5),b=timelineTravelTiming(30,180,5);
    for(const seconds of [0,1,2,3,5])expect(Math.abs(timelineCameraAt(seconds*24,a,1000)-timelineCameraAt(seconds*30,b,1000))).toBeLessThan(18);
  });
  it('keeps very short or single-item timelines finite',()=>{
    for(const n of [0,1,5])for(const duration of [1,8,24]){
      const timing=timelineTravelTiming(24,duration,n);
      expect(Number.isFinite(timelineCameraAt(0,timing,500))).toBe(true);
      expect(Number.isFinite(timelineZoomAt(duration-1,timing))).toBe(true);
    }
  });
});

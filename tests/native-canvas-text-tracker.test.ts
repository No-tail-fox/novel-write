import {describe,expect,it} from 'vitest';
import {installNativeCanvasTextTracker,projectCachedCanvasText} from '../src/shared/creative-animation/native-canvas-text-tracker';
const context={globalAlpha:1,canvas:{width:1920,height:1080},getTransform:()=>({a:1,b:0,c:0,d:1,e:10,f:20})} as unknown as CanvasRenderingContext2D;
const row={text:'缓存字幕',font:'20px sans-serif',fontFamily:'sans-serif',fontSize:20,x0:20,y0:20,x1:180,y1:50};
describe('cached canvas glyph evidence',()=>{
 it('projects cached glyphs through drawImage destination scale and context transform',()=>{
  expect(projectCachedCanvasText(context,{width:200,height:100},[100,200,400,200],row)).toMatchObject({x0:150,y0:260,x1:470,y1:320,fontSize:40});
 });
 it('cannot prove text cut out by source cropping or rendered offstage',()=>{
  expect(projectCachedCanvasText(context,{width:200,height:100},[30,0,100,100,0,0,100,100],row)).toMatchObject({clipped:true,text:row.text});
  expect(projectCachedCanvasText(context,{width:200,height:100},[3000,0],row)).toBeUndefined();
  expect(projectCachedCanvasText(context,{width:200,height:100},[185,0,15,100,0,0,15,100],row)).toBeUndefined();
 });
});

it('retains clipping through multiple cached layers and destination transforms',()=>{
 const fragment=projectCachedCanvasText(context,{width:200,height:100},[0,0],{...row,x0:-30})!;
 expect(fragment.clipped).toBe(true);
 expect(projectCachedCanvasText(context,{width:220,height:120},[50,50,440,240],fragment)).toMatchObject({clipped:true,text:row.text,fontSize:40});
});

function tintedContext(solid: boolean, denied = false) {
 const canvas = {width:200,height:100,isConnected:true};
 const prototype = {fillText(){},strokeText(){},drawImage(){},fillRect(){},clearRect(){}} as unknown as CanvasRenderingContext2D;
 const tracker = installNativeCanvasTextTracker(prototype,()=>{});
 const ctx = Object.assign(Object.create(prototype), {
  canvas,globalAlpha:1,globalCompositeOperation:'source-over',font:'20px sans-serif',
  getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),
  measureText:()=>({width:80,actualBoundingBoxLeft:0,actualBoundingBoxRight:80,actualBoundingBoxAscent:20,actualBoundingBoxDescent:2}),
  getImageData:()=>{
   if(denied) throw new Error('readback unavailable');
   const data = new Uint8ClampedArray(200*100*4).fill(255);
   if(!solid) data[(25*200+35)*4+3]=0;
   return {width:200,height:100,data};
  },
 }) as CanvasRenderingContext2D;
 ctx.fillText('纸牌标题',20,40);
 ctx.globalCompositeOperation='source-in';
 return {ctx,tracker};
}

it('discards lettering erased by a flat paper silhouette but preserves tinted glyphs',()=>{
 const solid=tintedContext(true);solid.ctx.fillRect(0,0,200,100);
 expect(solid.tracker.frameTexts()).toEqual([]);
 const glyph=tintedContext(false);glyph.ctx.fillRect(0,0,200,100);
 expect(glyph.tracker.frameTexts()).toHaveLength(1);
});
it('keeps evidence for partial tint or unavailable pixel readback',()=>{
 const partial=tintedContext(true);partial.ctx.fillRect(0,0,20,20);
 expect(partial.tracker.frameTexts()).toHaveLength(1);
 const denied=tintedContext(true,true);denied.ctx.fillRect(0,0,200,100);
 expect(denied.tracker.frameTexts()).toHaveLength(1);
});

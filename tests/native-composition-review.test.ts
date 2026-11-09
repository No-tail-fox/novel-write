import { describe, expect, it } from 'vitest';
import { nativeCompositionIssue, nativeFrameDetailCoverage } from '../src/shared/creative-animation/composition-review';
const w = 320, h = 180;
function gradient() {
  const pixels = new Uint8Array(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=(y*w+x)*4; pixels[i]=100+y/2; pixels[i+1]=120+y/2; pixels[i+2]=140+y/2; pixels[i+3]=255;
  }
  return pixels;
}
function rect(p:Uint8Array,x:number,y:number,width:number,height:number) {
 for(let dy=y;dy<y+height;dy++)for(let dx=x;dx<x+width;dx++)p.fill(0,(dy*w+dx)*4,(dy*w+dx)*4+3);
}
describe('native composition readability',()=>{
 it('does not mistake gradients, subtitles or capture borders for readable foreground',()=>{
  const p=gradient();rect(p,50,160,220,12);rect(p,0,0,320,2);
  expect(nativeFrameDetailCoverage(p,w,h)).toBe(0);
 });
 it('distinguishes tiny scattered subjects from a legible composition',()=>{
  const tiny=gradient();rect(tiny,100,110,2,4);rect(tiny,230,115,4,2);
  expect(nativeFrameDetailCoverage(tiny,w,h)).toBeLessThan(.01);
  const artwork=gradient();rect(artwork,65,40,80,90);rect(artwork,180,50,70,60);
  expect(nativeFrameDetailCoverage(artwork,w,h)).toBeGreaterThan(.04);
 });
 it('requires persistent sparse reading poses, permits a brief sparse transition, and checks the resolved end',()=>{
  const samples=[0,.1,.25,.5,.75,.9,.999].map(f=>({atMs:1000*f,coverage:f===.1?.005:.12}));
  expect(nativeCompositionIssue(samples,1000)).toBeUndefined();
  expect(nativeCompositionIssue(samples.map(s=>({...s,coverage:s.atMs>=250&&s.atMs<=750?.025:s.coverage})),1000)).toContain('三个稳定阅读时刻');
  expect(nativeCompositionIssue(samples.map(s=>({...s,coverage:s.atMs>990?.005:s.coverage})),1000)).toBeUndefined();
  expect(nativeCompositionIssue(samples.map(s=>({...s,coverage:s.atMs>=900?.005:s.coverage})),1000)).toContain('收尾连续采样');
 });
});


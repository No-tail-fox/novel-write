import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureLemoSubtitleLayout } from '../src/shared/creative-animation/native-subtitles';

afterEach(() => vi.unstubAllGlobals());
describe('continuous Lemo film subtitle windows', () => {
  it('allows the next shot caption at the exclusive endpoint and still reports foreign captions inside the shot', async () => {
    let time = 0;
    const row = (cueId: string) => ({ id: cueId, cueId, text: 'Lyric', x0: 100, y0: 100, x1: 300, y1: 150, fontFamily: 'sans-serif', fontSize: 40 });
    const native = { texts: () => [row(time >= 1 ? 'next-shot-cue' : 'current-cue'), ...(time === 0 ? [row('unexpected-cue')] : [])], frameTexts: () => [{...row('current-cue'),font:'40px sans-serif'}] };
    vi.stubGlobal('window', { __lemo: native, __tl: { seek: async (seconds: number) => { time = seconds; } } });
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() }, querySelectorAll: () => [] });
    vi.stubGlobal('innerWidth', 1920); vi.stubGlobal('innerHeight', 1080);
    const result = await measureLemoSubtitleLayout({ shotId: 'shot', startMs: 0, durationMs: 1000, width: 1920, height: 1080, cues: [{ id: 'current-cue', text: 'Lyric', startMs: 0, endMs: 1000 }] });
    if (result.status !== 'ok') throw new Error('Expected measured layout');
    expect(result.visibilitySamples).toEqual([{ atMs: 0, activeCueIds: ['current-cue', 'unexpected-cue'] }, { atMs: 1000, activeCueIds: [] }]);
    expect(result.cues[0].text).toBe('Lyric');
  });
});

const input = {shotId:'shot',startMs:0,durationMs:1000,width:1920,height:1080,cues:[{id:'cue',text:'Hello',startMs:0,endMs:1000}]};
function installEvidence(frame: (time:number)=>Array<Record<string,unknown>>) {
  let time=0;
  const row={id:'cue',cueId:'cue',text:'Hello',x0:100,y0:100,x1:300,y1:150,fontFamily:'sans-serif',fontSize:40};
  vi.stubGlobal('window',{__lemo:{texts:()=>[row],drawnTexts:()=>[{text:'Hello',font:'40px sans-serif'}],frameTexts:()=>frame(time)},__tl:{seek:async(t:number)=>{time=t;}}});
  vi.stubGlobal('document',{fonts:{ready:Promise.resolve()},querySelectorAll:()=>[]});
  vi.stubGlobal('innerWidth',1920);vi.stubGlobal('innerHeight',1080);
  return row;
}
it('rejects truthful-looking metadata backed only by historical glyph records',async()=>{
  installEvidence(()=>[]);
  await expect(measureLemoSubtitleLayout(input)).rejects.toThrow(/缺少当帧实际绘制/);
});
it('waits for a readable pose and accepts character-by-character drawing',async()=>{
  const row=installEvidence(t=>t<.3?[]:Array.from('Hello').map((text,i)=>({...row,text,font:'40px sans-serif',x0:100+i*30,x1:130+i*30})));
  const result=await measureLemoSubtitleLayout(input);
  expect(result.status).toBe('ok');
  if(result.status==='ok')expect(result.cues[0].renderedFontFamilies).toEqual(['sans-serif']);
});
it('does not count fill/stroke duplicates as a missing repeated character',async()=>{
  const row=installEvidence(()=>[{...row,text:'Helo',font:'40px sans-serif'},{...row,text:'Helo',font:'40px sans-serif'}]);
  await expect(measureLemoSubtitleLayout(input)).rejects.toThrow(/缺少当帧实际绘制/);
});
it('measures actual glyph overflow instead of trusting an in-bounds declaration',async()=>{
  const row=installEvidence(()=>[{...row,font:'40px sans-serif',x1:2100}]);
  const result=await measureLemoSubtitleLayout(input);
  if(result.status!=='ok')throw Error('measurement missing');
  expect(result.cues[0].issues).toContain('outside-safe-area');
});

it('does not accept a cropped cached caption as complete subtitle evidence',async()=>{
 const row=installEvidence(()=>[{...row,font:'40px sans-serif',clipped:true}]);
 await expect(measureLemoSubtitleLayout(input)).rejects.toThrow(/缺少当帧实际绘制/);
});

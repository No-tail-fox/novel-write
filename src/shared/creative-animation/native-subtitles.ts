import type { ProductionSubtitleSceneLayout } from '../production-subtitle-layout';
import type { NativeCanvasText } from './native-canvas-text';

/** Self-contained: measures style-owned text inside the actual native render browser. */
export async function measureLemoSubtitleLayout(input: {
  shotId: string; startMs: number; durationMs: number; width: number; height: number; localOffsetMs?: number;
  cues: readonly { id?: string; text: string; startMs: number; endMs: number }[];
}): Promise<ProductionSubtitleSceneLayout> {
  const native = (window as unknown as { __lemo?: { texts(): Array<{id:string;text:string;cueId?:string;x0:number;y0:number;x1:number;y1:number;fontFamily:string;fontSize:number}>; frameTexts(): NativeCanvasText[] } }).__lemo;
  if (!native || !window.__tl || typeof native.frameTexts !== 'function') throw new Error('LEMO_TEXTS: 原生文字测量协议不可用。');
  await document.fonts.ready;
  const plain = (text: string) => text.replace(/\s/gu, '');
  const cueKey = (cue: {id?:string}, index: number) => cue.id ?? '#' + index;
  const keys = input.cues.map(cueKey);
  const seek = async (ms: number) => { await window.__tl!.seek(((input.localOffsetMs ?? 0) + ms) / 1000); return native.texts(); };
  const visibleDom = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    let opacity = 1;
    for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor); opacity *= Number(style.opacity);
      if (ancestor.hidden || style.visibility === 'hidden' || style.display === 'none' || opacity <= .05) return false;
    }
    return box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight;
  };
  const cues: Extract<ProductionSubtitleSceneLayout, {status:'ok'}>['cues'] = [];
  for (const [index, cue] of input.cues.entries()) {
    // Let the style animate text in and out. Find a complete reading pose rather than
    // demanding the whole caption at its first instant or a fixed midpoint.
    let rows: ReturnType<typeof native.texts> = [];
    let actual: NativeCanvasText[] = [];
    let visibleCaptions: HTMLElement[] = [];
    let evidence: unknown; 
    for (const fraction of [.15, .3, .45, .6, .75, .9]) {
      const candidate = (await seek(cue.startMs + (cue.endMs - cue.startMs) * fraction)).filter(row => row.cueId === keys[index]);
      evidence = { atMs: cue.startMs + (cue.endMs - cue.startMs) * fraction, expected: cue.text.slice(0, 500), metadata: candidate.map(row => row.text).join('').slice(0, 500), drawn: native.frameTexts().map(row => row.text).join(' | ').slice(0, 500) };
      if (!candidate.length || plain(candidate.map(row => row.text).join('')) !== plain(cue.text)) continue;
      const current = native.frameTexts().filter(draw => !draw.clipped && candidate.some(row => draw.x1 >= row.x0 - 8 && draw.x0 <= row.x1 + 8 && draw.y1 >= row.y0 - 8 && draw.y0 <= row.y1 + 8));
      // fill + stroke/shadow on the same glyph do not prove repeated letters.
      const unique = [...new Map(current.map(draw => [JSON.stringify([draw.text,draw.x0,draw.y0,draw.x1,draw.y1]),draw])).values()];
      const counts = new Map<string,number>();
      for (const draw of unique) for (const char of plain(draw.text)) counts.set(char,(counts.get(char) ?? 0)+1);
      const canvasHasText = Array.from(plain(cue.text)).every(char => {
        const count = counts.get(char) ?? 0; counts.set(char,count-1); return count > 0;
      });
      const dom = Array.from(document.querySelectorAll<HTMLElement>('[data-cue-id]')).filter(element => element.dataset.cueId === keys[index] && visibleDom(element) && plain(element.textContent ?? '') === plain(cue.text));
      if (canvasHasText || dom.length) { rows = candidate; actual = canvasHasText ? unique : []; visibleCaptions = dom; break; }
    }
    if (!rows.length) throw new Error('LEMO_TEXTS: 字幕 ' + keys[index] + ' 缺少当帧实际绘制的完整文案；TEXTS 元数据或历史绘字记录不能证明字幕可见。请检查绘图状态、画布位置和可读停留。采样证据：' + JSON.stringify(evidence));
    if (rows.some(row => ![row.x0,row.y0,row.x1,row.y1,row.fontSize].every(Number.isFinite) || row.x1 <= row.x0 || row.y1 <= row.y0 || !row.fontFamily || row.fontSize <= 0)) throw new Error('LEMO_TEXTS: 字幕边界或字体数据无效。');
    const measured = [...rows,...actual];
    const x = Math.min(...measured.map(row => row.x0)), y = Math.min(...measured.map(row => row.y0));
    const right = Math.max(...measured.map(row => row.x1)), bottom = Math.max(...measured.map(row => row.y1));
    const bounds = {x,y,width:right-x,height:bottom-y};
    const issues: Extract<ProductionSubtitleSceneLayout, {status:'ok'}>['cues'][number]['issues'] = [];
    if (x < -1 || y < -1 || right > input.width + 1 || bottom > input.height + 1) issues.push('outside-safe-area');
    const actualFonts = new Set(actual.map(draw=>draw.fontFamily));
    for (const element of visibleCaptions) actualFonts.add(getComputedStyle(element).fontFamily);
    cues.push({ cueId: cue.id, startMs: input.startMs + cue.startMs, endMs: input.startMs + cue.endMs,
      bounds, textBounds: bounds, lineCount: rows.reduce((sum,row) => sum + row.text.split('\n').length,0), fontFamily: rows.map(row=>row.fontFamily).join(', '), fontSize: Math.min(...rows.map(row=>row.fontSize)), issues,
      text: cue.text, renderedFontFamilies: [...actualFonts].slice(0,32) });
  }
  const visibilitySamples: {atMs:number;activeCueIds:string[]}[] = [];
  for (const ms of [...new Set(input.cues.flatMap(cue=>[cue.startMs,cue.endMs]))].sort((a,b)=>a-b)) {
    // A native film continues into the next shot. Its right endpoint is outside
    // this shot's [start, end) window and may legitimately show the next lyric.
    const visible = ms >= input.durationMs ? [] : [...new Set((await seek(ms)).map(row=>row.cueId).filter((id):id is string=>Boolean(id)))];
    visibilitySamples.push({atMs:input.startMs+ms,activeCueIds:visible});
  }
  await window.__tl.seek(0);
  return {status:'ok',shotId:input.shotId,width:input.width,height:input.height,fontsReady:true,viewportWidth:innerWidth,viewportHeight:innerHeight,
    safeArea:{x:0,y:0,width:input.width,height:input.height},titleBounds:null,titleOutsideSafeArea:false,cues,visibilitySamples,visibilityMode:'native-animation'};
}

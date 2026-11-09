import { creativeFont, creativePalette, creativeRenderSpec, creativeClamp, type CreativeTitle } from './render-spec';
const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[value]!);
const measure = (value: string) => Array.from(value).reduce((sum,char)=>sum+(/[^\u0000-\u00ff]/u.test(char)?1:/\s/u.test(char)?.34:.6),0);
export function fitCreativeText(text: string, width: number, height: number, maxFontSize: number) {
  const wrap = (size: number) => text.split('\n').flatMap(paragraph => {
    const tokens=paragraph.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*|\s+|[^\s]/gu)??[];
    const units=tokens.flatMap(token=>measure(token)*size>width?Array.from(token):[token]);
    const result:string[]=[];let line='';
    for(const token of units) {
      if(line && measure(line+token)*size>width){result.push(line);line='';}
      if(line||token.trim())line+=token;
    }
    if(line.trim())result.push(line);
    // Balance the last two lines without splitting Latin words or leaving a lone Han glyph.
    if(result.length>1) {
      const last=result.length-1,combined=result[last-1]+result[last];
      const pieces=combined.match(/[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*|\s+|[^\s]/gu)??[];
      let best=[result[last-1],result[last]],difference=Math.abs(measure(best[0])-measure(best[1]));
      for(let i=1;i<pieces.length;i++) {
        const a=pieces.slice(0,i).join('').trimEnd(),b=pieces.slice(i).join('').trimStart();
        const delta=Math.abs(measure(a)-measure(b));
        if(a&&b&&!/^[，。！？、；：,.!?;:]/u.test(b)&&Math.max(measure(a),measure(b))*size<=width&&(delta<difference||(delta===difference&&measure(a)>=measure(b)))){best=[a,b];difference=delta;}
      }
      result.splice(last-1,2,...best);
    }
    return result.map(value=>value.trim());
  });
  let fontSize=Math.max(5,maxFontSize), lines=wrap(fontSize);
  while(fontSize>5 && lines.length*fontSize*1.24>height){fontSize-=1;lines=wrap(fontSize);}
  return {fontSize,lines,lineHeight:fontSize*1.24};
}

/** A short verbatim clause can annotate an object; full narration remains in subtitles. */
export function creativeCueAnnotation(text: string): string {
  const clauses=text.split(/[，。！？；\n]+|[,!?;]\s+|[.]\s+(?=[A-Z])/u).map(value=>value.trim()).filter(Boolean);
  return clauses.filter(value=>/[\p{L}\p{N}]/u.test(value)&&Array.from(value).length<=(/[^\u0000-\u00ff]/u.test(value)?18:56)).at(-1)??'';
}

/** Native SVG is shared by the Remotion canvas, layered preview and layered export. */
export function buildCreativeTextSvg(text: string, width: number, height: number, styleId: string, options: {note?: boolean;progress?: number} = {}): string {
  const spec=creativeRenderSpec(styleId), palette=creativePalette(styleId);
  if(!spec||!palette) throw new Error('CREATIVE_STYLE_RENDER: 缺少风格渲染规则：'+styleId);
  width=Math.max(10,Math.min(4000,width));height=Math.max(10,Math.min(4000,height));
  const {foreground:ink,background:paper,accent}=palette;
  const title: CreativeTitle=options.note && !['pixel','terminal','comic','hud','broadcast'].includes(spec.title)?'plain':spec.title;
  const pad=Math.min(width,height)*(['stamp','cutout','comic','intertitle','pixel','broadcast','glass'].includes(title)?.13:.055);
  const align=['note','plain','marker','poster','caption','draft','terminal','hud','overprint'].includes(title)?'start':'middle';
  const anchor=align==='start'?pad:width/2;
  const maxSize=Math.min(options.note?48:128,height*(options.note?.34:.65));
  const font=creativeFont(spec.font), weight=options.note?500:['note','ink','deco','intertitle'].includes(title)?500:800;
  const fit=fitCreativeText(text, width-pad*2, height-pad*2,maxSize);
  const y=(height-fit.lines.length*fit.lineHeight)/2+fit.fontSize*.95;
  let deco=''; let textFill=ink;
  const line=(x1:number,y1:number,x2:number,y2:number,color=accent,stroke=2)=>'<path d="M'+x1+' '+y1+' L'+x2+' '+y2+'" fill="none" stroke="'+color+'" stroke-width="'+stroke+'"/>';
  const box=(x:number,y:number,w:number,h:number,fill:string,stroke='none',sw=2)=>'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"/>';
  if(title==='marker') deco='<path d="M'+pad+' '+(height-pad)+' Q'+width*.45+' '+(height-pad*1.6)+' '+(width-pad)+' '+(height-pad*.8)+'" fill="none" stroke="'+accent+'" stroke-width="'+Math.max(2,height*.023)+'" stroke-linecap="round"/>';
  if(title==='note') deco=line(pad,height-pad,width*.65,height-pad,accent,1.6);
  if(title==='ink') deco=box(width-pad*1.7,height-pad*1.7,pad*1.1,pad*1.1,accent);
  if(title==='stamp') deco=box(3,3,width-6,height-6,paper,ink,3)+line(pad,height-pad,width-pad,height-pad,accent,5);
  if(title==='draft') deco=line(2,height*.35,2,height-2,ink)+line(2,height-2,width*.22,height-2,ink)+line(width*.7,2,width-2,2,accent)+line(width-2,2,width-2,height*.4,accent);
  if(title==='terminal') deco=line(pad,pad,width-pad,pad,accent)+line(pad,height-pad,width-pad,height-pad,ink,1);
  if(title==='pixel') deco=box(6,0,width-12,height,paper,ink,3)+box(0,6,width,height-12,'none',ink,3)+box(width-pad*1.2,height-pad*1.2,Math.max(3,pad*.3),Math.max(3,pad*.3),accent);
  if(title==='poster') deco=box(pad,pad,Math.min(width*.16,70),Math.max(3,height*.035),accent);
  if(title==='caption') deco=box(pad,height-pad-fit.fontSize*.2,width*.58,Math.max(4,fit.fontSize*.22),accent);
  if(title==='broadcast'){deco=box(0,0,width,height,ink)+box(0,0,width*.022,height,accent);textFill=paper;}
  if(title==='deco') deco=line(pad,pad,width-pad,pad,accent)+line(pad*1.4,pad*1.4,width-pad*1.4,pad*1.4,accent,1)+line(pad,height-pad,width-pad,height-pad,accent)+line(width/2,0,width/2,pad*.6,accent);
  if(title==='intertitle') deco=box(2,2,width-4,height-4,paper,ink,2)+box(7,7,width-14,height-14,'none',ink,1);
  if(title==='hud') deco='<path d="M'+pad+' 2 H2 V'+height*.3+' M'+(width-pad)+' 2 H'+(width-2)+' V'+height*.3+' M2 '+height*.7+' V'+(height-2)+' H'+pad+' M'+(width-2)+' '+height*.7+' V'+(height-2)+' H'+(width-pad)+'" fill="none" stroke="'+accent+'" stroke-width="2"/>';
  if(title==='cutout') deco='<path d="M2 9 L'+width*.25+' 3 L'+width*.5+' 7 L'+(width-7)+' 2 L'+(width-2)+' '+(height-8)+' L'+width*.6+' '+(height-2)+' L5 '+(height-5)+' Z" fill="'+paper+'" stroke="'+ink+'" stroke-width="1.5"/>';
  if(title==='glass') deco=box(2,2,width-4,height-4,paper+'e8',accent,1)+line(pad,pad,width*.4,pad,ink,1);
  if(title==='comic') deco='<path d="M3 3 H'+(width-3)+' V'+(height-pad)+' H'+width*.68+' L'+width*.6+' '+(height-2)+' L'+width*.59+' '+(height-pad)+' H3 Z" fill="'+paper+'" stroke="'+ink+'" stroke-width="3"/>';
  const tspans=fit.lines.map((value,index)=>'<tspan x="'+anchor+'" dy="'+(index?fit.lineHeight:0)+'">'+escape(value)+'</tspan>').join('');
  const type='<text x="'+anchor+'" y="'+y+'" font-family="'+font+'" font-size="'+fit.fontSize+'" font-weight="'+weight+'" text-anchor="'+align+'" fill="'+textFill+'" xml:space="preserve">'+tspans+'</text>';
  let artwork=deco+type;
  if(title==='overprint') artwork=deco+'<g transform="translate(2 1)" opacity=".33">'+type.replace('fill="'+textFill+'"','fill="'+accent+'"')+'</g>'+type;
  // Vertical columns are reserved for sparse scroll titles, never forced on Latin copy.
  if(title==='ink' && !options.note && height>width*1.35 && /^[\p{Script=Han}\p{P}。、，！？：；\s]+$/u.test(text)) {
    const chars=Array.from(text.replace(/\s/gu,''));const size=Math.min(70,(height-pad*2)/Math.min(8,Math.max(1,chars.length)),(width-pad*2)/Math.max(1,Math.ceil(chars.length/8)));
    artwork=deco+chars.map((char,index)=>'<text x="'+(width-pad-size*(.6+Math.floor(index/8)))+'" y="'+(pad+size*(1+index%8))+'" font-family="'+font+'" font-size="'+size+'" fill="'+ink+'" text-anchor="middle">'+escape(char)+'</text>').join('');
  }
  const progress=creativeClamp(options.progress??1);
  // Keep the text viewport fixed. Only the intentional reveal mask changes.
  let hash=2166136261;for(const char of styleId+text+width+height)hash=Math.imul(hash^char.codePointAt(0)!,16777619);
  const clip='creative-text-'+(hash>>>0).toString(16);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+escape(text)+'" data-creative-title="'+spec.title+'" style="width:100%;height:100%;overflow:hidden"><defs><clipPath id="'+clip+'"><rect width="'+width*progress+'" height="'+height+'"/></clipPath></defs><g clip-path="url(#'+clip+')" opacity="'+(progress>0?1:0)+'">'+artwork+'</g></svg>';
}
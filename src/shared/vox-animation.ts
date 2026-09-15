import { z } from 'zod';

export const VOX_ANIMATION_VERSION = 1;
export const VOX_ANIMATION_CATEGORIES = ['纸张拼贴', '证据讲解', '时间叙事', '对比分析', '数据解释', '地图叙事', '原理流程', '书籍推荐', '文字与图片', '音频与字幕', '转场与标注'] as const;
export type VoxAnimationCategory = typeof VOX_ANIMATION_CATEGORIES[number];
export type VoxTemplateKind = 'paper' | 'evidence' | 'timeline' | 'compare' | 'data' | 'map' | 'flow' | 'book' | 'text' | 'gallery' | 'audio' | 'transition' | 'label';
export interface VoxTemplate { id: string; name: string; category: VoxAnimationCategory; kind: VoxTemplateKind; description: string; minImages?: number; maxItems?: number; maxImages?: number; items?: boolean; numeric?: boolean; map?: boolean; audio?: boolean; }
const group = (category: VoxAnimationCategory, kind: VoxTemplateKind, rows: Array<[string,string,string]>, flags: Partial<VoxTemplate> = {}): VoxTemplate[] => rows.map(([id,name,description]) => ({id,name,description,category,kind,...flags}));
export const VOX_TEMPLATES: readonly VoxTemplate[] = [
  ...group('纸张拼贴','paper',[
    ['paper-actors','分层纸片入场','背景与透明主体错峰进入'],['paper-polaroids','拍立得拼贴','照片与说明逐张落版'],['paper-popup','立体纸卡','纸卡沿折线立起'],['paper-title','纸张标题压印','标题逐段压印到纸面'],
  ],{items:true}),
  ...group('证据讲解','evidence',[
    ['evidence-headline','新闻划重点','逐段强调标题中的重点词'],['evidence-quote','引文与出处','引文、作者与来源依次展开'],['evidence-stack','证据叠放','证据卡片堆叠并聚焦当前条目'],['evidence-focus','局部放大解释','按选定区域放大图片并显示注释'],['evidence-chat','对话气泡叙事','发言人和消息按顺序进入画面'],
  ],{items:true}),
  ...group('时间叙事','timeline',[
    ['time-milestones','事件时间线','日期和事件逐项显示'],['time-travel','时间轴巡游','镜头沿时间轴逐站推进'],['time-chapters','章节揭示','章节号与标题展开'],['time-year-counter','年代推进','从起始年代推进到结束年代'],
  ],{items:true}),
  ...group('对比分析','compare',[
    ['compare-split','左右观点对照','两组图文并排展示'],['compare-slider','前后图片揭示','滑动分界线对比两张图片'],['compare-values','指标比较','两组数值按同一尺度展开'],['compare-claims','观点与反证','先展示观点，再揭示反证'],
  ],{items:true}),
  ...group('数据解释','data',[
    ['data-counter','关键数字','滚动显示数值与单位'],['data-bars','柱状图','按数值绘制柱形与标签'],['data-line','趋势线','沿数据点绘制趋势'],['data-share','占比拆解','扇区逐步展开并显示占比'],['data-ranking','动态排行榜','按数据排序并依次揭示名次'],
  ],{items:true,numeric:true}),
  ...group('地图叙事','map',[
    ['map-a-to-b','两地路线','在地图上绘制两地路径'],['map-multi-stop','多站点行程','逐段连接途经点'],['map-region','地区聚焦','突出 GeoJSON 区域并显示说明'],['map-history','历史路径变化','按时间点逐段揭示路径'],
  ],{items:true,map:true}),
  ...group('原理流程','flow',[
    ['flow-steps','步骤推进','按顺序展示步骤'],['flow-converge','多路汇合','多个来源沿曲线汇入中心'],['flow-rings','分层原理','逐层展开结构与说明'],['flow-causal','因果连线','按顺序建立原因与结果'],['flow-energy','过程流动','连线中的光点展示传递方向'],
  ],{items:true}),
  ...group('书籍推荐','book',[
    ['book-identity','书籍登场','真实书封、书名与作者入场'],['book-takeaways','阅读收获','围绕书封展示阅读收获'],['book-excerpt','书摘重点','强调摘录并标注页码与出处'],['book-reading-list','同主题书单','轮播书封与推荐语'],['book-directory','目录展开','逐章显示目录与内容介绍'],['book-3d','立体翻书','封面打开，内页围绕书脊翻转'],
  ],{items:true}),
  ...group('文字与图片','text',[
    ['text-opening','大字开场','主标题与副标题错峰出现'],['text-keywords','关键词强调','按阅读顺序强调关键词'],
  ]),
  ...group('文字与图片','gallery',[
    ['gallery-grid','多图网格','等比排列图片与说明'],['gallery-space','空间卡片巡游','镜头在立体卡片间移动'],
  ],{items:true}),
  ...group('音频与字幕','audio',[
    ['audio-captions','逐词字幕','使用镜头已有真实字幕时间戳'],['audio-podcast','播客音频卡','音频波形、封面与标题'],['audio-spectrum','音乐频谱','从实际音频计算频谱'],['audio-lyrics','歌词切换','按字幕时间点切换歌词'],
  ]),
  ...group('转场与标注','transition',[
    ['transition-page','纸张翻页','围绕页面边缘翻转前后画面'],['transition-ink','墨迹揭示','从中心扩散揭示下一画面'],['transition-zoom','焦点推近','围绕选定焦点推近切换'],
  ]),
  ...group('转场与标注','label', [['label-lower-third','人物与地点说明','名称与补充说明从下方展开']]),
].map(t => ({...t,
  items: !['paper-title','evidence-headline','evidence-quote','evidence-focus','compare-slider','book-identity','book-excerpt','book-3d'].includes(t.id) && t.items,
  maxItems: t.id==='data-counter'||t.id==='time-chapters'?1:['compare-split','compare-claims','compare-values','time-year-counter','map-a-to-b'].includes(t.id)?2:t.id==='book-takeaways'?6:['flow','timeline'].includes(t.kind)||t.id==='evidence-stack'||t.id==='book-directory'?10:t.kind==='data'&&t.id!=='data-ranking'?12:24,
  maxImages: ['paper','gallery'].includes(t.kind)?8:24,
  minImages: ['paper-actors','compare-slider','book-3d'].includes(t.id) ? 2 : ['paper-polaroids','paper-popup','evidence-focus','book-identity','book-reading-list','gallery-grid','gallery-space'].includes(t.id) ? 1 : 0,
  audio: ['audio-podcast','audio-spectrum'].includes(t.id),
}));
export const voxItemSchema = z.object({
  label:z.string().max(160), detail:z.string().max(1200).default(''), value:z.number().finite().min(-1e12).max(1e12).default(0),
  date:z.string().max(80).default(''), lat:z.number().min(-90).max(90).default(0), lng:z.number().min(-180).max(180).default(0),
}).strict();
export const voxPropsSchema = z.object({
  title:z.string().max(300), subtitle:z.string().max(1800).default(''), author:z.string().max(180).default(''), source:z.string().max(400).default(''),
  accent:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c7513b'), background:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#eee8dc'), foreground:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#242820'),
  unit:z.string().max(30).default(''), highlight:z.string().max(400).default(''),
  items:z.array(voxItemSchema).max(24).default([]), assetIds:z.array(z.string().min(1).max(256)).max(24).default([]),
  audioAssetId:z.string().max(256).optional(), geoJson:z.string().max(500000).default(''),
  focus:z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.05).max(1),height:z.number().min(.05).max(1)}).default({x:.25,y:.25,width:.5,height:.5}),
}).strict();
export type VoxAnimationProps = z.infer<typeof voxPropsSchema>;
export type VoxAnimationItem = z.infer<typeof voxItemSchema>;
export const voxAnimationSchema = z.object({
  version:z.literal(1), mode:z.enum(['template','code']),
  template:z.object({id:z.string().min(1).max(120),props:voxPropsSchema}).strict(),
  code:z.object({source:z.string().max(100000).default(''), compiled:z.string().max(180000).default(''), prompt:z.string().max(10000).default('')}).strict(),
}).strict();
export type VoxAnimation = z.infer<typeof voxAnimationSchema>;
export interface VoxAnimationAsset { id:string; label:string; kind:'image'|'audio'; url:string; }
export interface VoxAnimationCue {id?:string;text:string;startMs:number;endMs:number;tokens?:{text:string;startMs:number;endMs:number}[];}
export interface VoxAnimationAudioClip {assetVersionId?:string;startMs:number;durationMs:number;sourceStartMs?:number;muted?:boolean;gainDb?:number;}
export interface VoxAnimationPayload {animation:VoxAnimation;width:number;height:number;fps:number;durationMs:number;assets:VoxAnimationAsset[];cues:VoxAnimationCue[];subtitleStyle?:string;audioClips?:readonly VoxAnimationAudioClip[];}
export const voxSavedTemplateSchema=z.object({id:z.string().min(1).max(128),name:z.string().trim().min(1).max(100),animation:voxAnimationSchema,updatedAt:z.string().max(64)}).strict();
export type VoxSavedTemplate=z.infer<typeof voxSavedTemplateSchema>;
export interface VoxGenerateRequest {requestId:string;prompt:string;source?:string;templateId:string;props:VoxAnimationProps;durationMs:number;ratio:string;}
export interface VoxCompileResult {source:string;compiled:string;}
export const voxTemplate = (id:string) => VOX_TEMPLATES.find(t=>t.id===id);
export function createVoxAnimation(title='',subtitle=''):VoxAnimation {
  return {version:1,mode:'template',template:{id:'text-opening',props:voxPropsSchema.parse({title,subtitle})},code:{source:'',compiled:'',prompt:''}};
}
export function voxAnimationAssetIds(animation:VoxAnimation):string[] {return [...new Set([...animation.template.props.assetIds,...(animation.template.props.audioAssetId?[animation.template.props.audioAssetId]:[])])];}
export function validateVoxAnimation(animation:VoxAnimation, assets?:readonly {id:string;kind:string}[]):string[] {
  const parsed=voxAnimationSchema.safeParse(animation);if(!parsed.success)return ['动画参数格式无效'];
  const a=parsed.data,p=a.template.props,t=voxTemplate(a.template.id),issues:string[]=[];
  if(!t)return ['模板不存在，请重新选择'];
  if(a.mode==='code'){if(!a.code.source.trim()||!a.code.compiled.trim())issues.push('请生成或检查动画代码后再应用');}
  else {
    if(!p.title.trim()&&!p.subtitle.trim()&&!p.items.length&&!p.assetIds.length)issues.push('请填写文字、条目或选择素材');
    if((t.minImages??0)>p.assetIds.length)issues.push(`此模板需要至少 ${t.minImages} 张图片`);
    if(t.items&&p.items.length>(t.maxItems??24))issues.push(`此模板最多显示 ${t.maxItems} 个条目，请删除多余条目`);
    if(p.assetIds.length>(t.maxImages??24))issues.push(`此模板最多显示 ${t.maxImages} 张图片`);
    if(t.items&&['timeline','data','flow','compare'].includes(t.kind)&&!p.items.length&&!['time-chapters','compare-slider'].includes(t.id))issues.push('请添加至少一个内容条目');
    if(t.id==='compare-values'&&p.items.length<2)issues.push('指标比较需要两组数值');
    if(t.id==='data-share'&&(p.items.some(x=>x.value<0)||p.items.reduce((n,x)=>n+x.value,0)<=0))issues.push('占比数据需要非负数，且总量大于 0');
    if(t.audio&&!p.audioAssetId)issues.push('请选择用于波形或频谱的真实音频');
    if(t.map&&t.id!=='map-region'&&p.items.length<2)issues.push('地图路线至少需要两个地点和坐标');
    if(t.id==='map-region'&&!p.geoJson.trim())issues.push('请填写区域 GeoJSON');
    if(p.geoJson.trim()){
      try {
        const g=JSON.parse(p.geoJson), geometries=g.type==='FeatureCollection'?g.features?.map((f:any)=>f.geometry):[g.type==='Feature'?g.geometry:g];
        const point=z.tuple([z.number().finite().min(-180).max(180),z.number().finite().min(-90).max(90)]).rest(z.number());
        const polygon=z.array(z.array(point).min(4)).min(1);
        const geometry=z.discriminatedUnion('type',[z.object({type:z.literal('Polygon'),coordinates:polygon}),z.object({type:z.literal('MultiPolygon'),coordinates:z.array(polygon).min(1)})]);
        if(!z.array(geometry).min(1).safeParse(geometries).success)issues.push('GeoJSON 需要有效的 Polygon / MultiPolygon 区域坐标');
      } catch {issues.push('GeoJSON 不是有效的 JSON');}
    }
  }
  if(assets){for(const id of p.assetIds)if(!assets.some(x=>x.id===id&&x.kind==='image'))issues.push('有图片素材不存在，请重新选择');if(p.audioAssetId&&!assets.some(x=>x.id===p.audioAssetId&&x.kind==='audio'))issues.push('音频素材不存在，请重新选择');}
  return [...new Set(issues)];
}
export function buildVoxAnimationHtml(runtime:string,payload:VoxAnimationPayload):string {
  const json=JSON.stringify(payload).replace(/</g,'\\u003c');
  const safe=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
  const code=payload.animation.mode==='code'?`const module={exports:{}};const exports=module.exports;const require=window.VoxRuntime.require;${safe(payload.animation.code.compiled)}\nwindow.VoxRuntime.mount(${json},module.exports.default);`:`window.VoxRuntime.mount(${json});`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-storydream-html-video'; style-src 'unsafe-inline'; img-src data: blob: file: storydream-media:; media-src data: blob: file: storydream-media:; connect-src data: blob: storydream-media:; font-src data:; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}.caption[hidden]{display:block;visibility:hidden}</style></head><body><div id="root"></div><script nonce="storydream-html-video">window.addEventListener('error',e=>{window.__htmlVideoMediaError=e.message;parent.postMessage({type:'vox-error',message:e.message},'*')});</script><script nonce="storydream-html-video">${safe(runtime)}</script><script nonce="storydream-html-video">(()=>{${code}})();</script></body></html>`;
}

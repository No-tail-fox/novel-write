import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DirectorDeskWorkspace,type DirectorShot} from '../src/features/director-desk/DirectorDeskWorkspace';
import {VoxAnimationPreview,type VoxApi} from '../src/features/vox-animation/VoxAnimationPreview';
import {StoryDreamProvider} from '../src/ui';
import {createVoxAnimation,VOX_TEMPLATES,voxItemSchema,type VoxAnimation} from '../src/shared/vox-animation';
import '../src/styles.css';
const fixture=await (await fetch('/fixture.json')).json();
const api:VoxApi={getVoxAnimationRuntime:async()=>await(await fetch('/runtime.js')).text(),readVoxAnimationAsset:async path=>fixture.assets.find((a:any)=>a.path===path).url,
  compileVoxAnimation:async source=>{if(source!==fixture.code.source)throw new Error('测试代码语法错误');return fixture.code;},
  generateVoxAnimation:async()=>{await new Promise(resolve=>setTimeout(resolve,400));return fixture.code;},cancelVoxAnimation:async()=>{},
  listVoxTemplates:async()=>JSON.parse(localStorage.getItem('qa-vox-templates')??'[]'),saveVoxTemplate:async row=>{const rows=[row,...await api.listVoxTemplates()];localStorage.setItem('qa-vox-templates',JSON.stringify(rows));return rows;},deleteVoxTemplate:async id=>{const rows=(await api.listVoxTemplates()).filter(r=>r.id!==id);localStorage.setItem('qa-vox-templates',JSON.stringify(rows));return rows;}};
function sample(id:string){const a=createVoxAnimation('知识如何改变生活','从证据出发，理解事物之间的联系');a.template.id=id;const p=a.template.props;p.author='作者姓名';p.source='仅供功能验收的合成内容';p.unit='%';p.highlight='知识,证据';p.items=[['观察','记录问题与事实',20,'2000',116.4,39.9],['理解','建立清晰的联系',50,'2010',121.5,31.2],['行动','把知识用于实践',80,'2020',114.1,22.5]].map(([label,detail,value,date,lng,lat])=>voxItemSchema.parse({label,detail,value,date,lng,lat}));
  p.items=p.items.slice(0,VOX_TEMPLATES.find(t=>t.id===id)?.maxItems??24);p.assetIds=fixture.assets.filter((x:any)=>x.kind==='image').map((x:any)=>x.id);p.audioAssetId='audio';if(id==='map-region')p.geoJson=JSON.stringify({type:'Polygon',coordinates:[[[100,20],[125,20],[125,42],[100,42],[100,20]]]});return a;}
const initial:DirectorShot={id:'sample',index:1,title:'知识如何改变生活',scene:'',framing:'',characterLabel:'',subtitle:'这段字幕跟随真实时间线切换',durationMs:4000,prompt:'',motionPrompt:'',renderStrategy:'remotion',animation:sample('book-identity'),imageReady:true,voiceReady:true,subtitleCues:[{id:'cue-a',text:'这段字幕跟随真实时间线切换',startMs:0,endMs:2000},{id:'cue-b',text:'动画和字幕共同导出',startMs:2000,endMs:4000}]};
const catalog=new URLSearchParams(location.search).has('catalog');
function Host(){const [shot,setShot]=useState(initial),[ratio,setRatio]=useState<'16:9'|'9:16'>('16:9'),[time,setTime]=useState(2600);
  Object.assign(window,{voxQA:{ids:VOX_TEMPLATES.map(t=>t.id),set:(id:string,r='16:9')=>{setShot({...initial,animation:sample(id)});setRatio(r as '16:9'|'9:16');},seek:setTime,code:()=>setShot({...initial,animation:{...sample('text-opening'),mode:'code',code:{...fixture.code,prompt:'标题进入'}}}),snapshot:()=>shot}});
  if(catalog)return <div style={{position:'absolute',inset:0}}><VoxAnimationPreview animation={shot.animation!} api={api} assets={fixture.assets} ratio={ratio} durationMs={4000} timeMs={time} cues={[...(initial.subtitleCues??[])]}/></div>;
  return <DirectorDeskWorkspace mode="vox" projectTitle="VOX 动画工作台" projectMeta="本地合成素材验收" episodeTitle="第一集" onExportAnimationShot={async()=>true} stageLabel="镜头生成" ratio={ratio} shots={[shot]} selectedShotId={shot.id} dirty={false} animationApi={api} animationAssets={fixture.assets} onSelectShot={()=>{}} onSave={()=>localStorage.setItem('qa-project',JSON.stringify(shot))} onUpdateShot={(_,patch)=>setShot(current=>({...current,...patch}))} onImportAnimationAsset={async()=>{}} onGenerateShot={async()=>{throw new Error('模板不应触发图片模型');}}/>;
}
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme="dark"><Host/></StoryDreamProvider>);

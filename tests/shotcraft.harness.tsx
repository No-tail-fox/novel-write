import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DirectorDeskWorkspace,type DirectorShot} from '../src/features/director-desk/DirectorDeskWorkspace';
import type {VoxApi} from '../src/features/vox-animation/VoxAnimationPreview';
import {StoryDreamProvider} from '../src/ui';
import {VOX_TEMPLATES, type VoxAnimation} from '../src/shared/vox-animation';
import '../src/styles.css';

const fixture = await (await fetch('/fixture.json')).json();
let forbiddenCalls = 0;
const forbidden = async():Promise<never> => {forbiddenCalls++;throw new Error('This local QA must not generate content or call a provider.');};
const api:VoxApi = {
  getVoxAnimationRuntime:async()=>await(await fetch('/runtime.js')).text(),
  readVoxAnimationAsset:async path=>fixture.assets.find((a:{path:string})=>a.path===path).url,
  compileVoxAnimation:forbidden,generateVoxAnimation:forbidden,cancelVoxAnimation:async()=>{},
  listVoxTemplates:async()=>JSON.parse(localStorage.getItem('shotcraft-qa-templates')??'[]'),
  saveVoxTemplate:async row=>{const rows=[row,...await api.listVoxTemplates()];localStorage.setItem('shotcraft-qa-templates',JSON.stringify(rows));return rows;},
  deleteVoxTemplate:async id=>{const rows=(await api.listVoxTemplates()).filter(r=>r.id!==id);localStorage.setItem('shotcraft-qa-templates',JSON.stringify(rows));return rows;},
};
const initial:DirectorShot = {id:'shotcraft-local-fixture',index:1,title:'镜头动画验收',scene:'',framing:'',characterLabel:'',subtitle:'',durationMs:4000,prompt:'',motionPrompt:'',renderStrategy:'remotion',animation:fixture.cases[0].animation,imageReady:true,voiceReady:true,subtitleCues:[]};
const theme = new URLSearchParams(location.search).get('theme')==='light'?'light':'dark';
document.documentElement.dataset.theme=theme;
function Host() {
  const [shot,setShot] = useState<DirectorShot>(()=>JSON.parse(localStorage.getItem('shotcraft-qa-project')??'null')??initial);
  const [dirty,setDirty] = useState(false);
  Object.assign(window,{shotcraftQA:{
    ids:fixture.ids,
    templates:VOX_TEMPLATES.filter(t=>fixture.ids.includes(t.id)),
    snapshot:()=>shot,
    forbiddenCalls:()=>forbiddenCalls,
    reset:()=>{localStorage.removeItem('shotcraft-qa-project');setShot(initial);setDirty(false);},
    saved:()=>JSON.parse(localStorage.getItem('shotcraft-qa-project')??'null') as {animation:VoxAnimation}|null,
  }});
  return <DirectorDeskWorkspace mode="vox" projectTitle="ShotCraft 镜头验收" projectMeta="本地合成素材" episodeTitle="第一集" stageLabel="镜头生成" ratio="16:9" shots={[shot]} selectedShotId={shot.id} dirty={dirty} animationApi={api} animationAssets={fixture.assets} onSelectShot={()=>{}} onSave={()=>{localStorage.setItem('shotcraft-qa-project',JSON.stringify(shot));setDirty(false);}} onUpdateShot={(_,patch)=>{setShot(current=>({...current,...patch}));setDirty(true);}} onImportAnimationAsset={async()=>{}} onGenerateShot={forbidden}/>;
}
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme={theme}><Host/></StoryDreamProvider>);

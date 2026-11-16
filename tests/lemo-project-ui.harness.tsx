import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { DirectorDeskWorkspace } from '../src/features/director-desk/DirectorDeskWorkspace';
import { ProjectModelBar } from '../src/features/projects/ProjectModelFields';
import { defaultConfig } from '../src/shared/config';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { VoxProductionDialog } from '../src/features/editorial-collage/VoxProductionDialog';
import { VoxProductionProgress } from '../src/features/editorial-collage/VoxProductionProgress';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, voxProductionSettings, type VoxProductionRun } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/vox-process-workspace.css';

const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({id:'lemo-ui-fixture', title:'城市热岛', ratio:'16:9'}), '道路与建筑吸收阳光。树荫可以降低地表温度。', '2026-10-28T00:00:00.000Z', 15000);
document.productionSettings = {...voxProductionSettings(), narration:false, generateImages:false, authoring:{mode:'ai-code',styleId:'watercolor'}};
document.assets.push({id:'archive',assetId:'archive',kind:'image',localPath:'fixture.png',provider:'local-import',prompt:'已导入的城市资料',createdAt:document.createdAt});
function App() {
  const holdExport = useRef(false);
  const pendingExport = useRef<(() => void) | undefined>(undefined);
  const exportCount = useRef(0);
  const [surface,setSurface] = useState<'settings'|'progress'|'workspace'|'closed'>('workspace');
  const [busy,setBusy] = useState(false);
  const [unknown,setUnknown] = useState(false);
  const [upstream,setUpstream] = useState(false);
  const [theme,setTheme] = useState<'dark'|'light'>('dark');
  const [revision,setRevision] = useState(0);
  const [longRun,setLongRun] = useState(false);
  const [runState,setRunState] = useState<'failed'|'running'|'completed'>('failed');
  const [mixed,setMixed] = useState(false);
  const [advanced,setAdvanced] = useState(false);
  const settings = document.productionSettings!;
  const nodes = buildVoxProductionNodes(document,settings,LEMO_NATIVE_ENGINE,3);
  for (const node of nodes) { if (node.kind === 'timing') { node.status = 'completed'; node.attempt = 1; } }
  let target = nodes.find(node => node.kind === 'film-edit')!;
  if (advanced) target=nodes[nodes.length-1];
  target.status=unknown?'unknown':'failed';target.requestId='saved-provider-request';target.attempt=1;
  target.error=unknown?'LLM_STREAM_INTERRUPTED: 已保留当前轮的回复，云端结果待核对。':'LEMO_AGENT_BUDGET: 已达到本次创作轮数上限。';
  if (longRun) {
    const history: VoxProductionRun['nodes'] = Array.from({length:40},(_,i)=>({...target,id:'history-'+i,status:'completed' as const,error:undefined}));
    if (mixed) { history[1]={...history[1],status:'failed'}; history[2]={...history[2],status:'unknown'}; }
    nodes.unshift(...history);
  }
  if (runState==='running') {target.status='running';target.error=undefined;}
  if (runState==='completed') for (const node of nodes) {node.status='completed';node.error=undefined;}
  const run:VoxProductionRun={version:1,id:'fixture-run',engine:LEMO_NATIVE_ENGINE,authoringVersion:3,status:runState,settings,nodes,sourceHash:'fixture',runtimeIdentity:'fixture',createdAt:document.createdAt,updatedAt:document.updatedAt,message:target.error};
  const record = async (action:string,value?:unknown)=>{Object.assign(window,{lastLemoAction:{action,value}})};
  Object.assign(window,{lemoQA:{holdExport:()=>{holdExport.current=true;},finishExport:()=>{holdExport.current=false;pendingExport.current?.();pendingExport.current=undefined;},targetId:target.id,advance:()=>setAdvanced(true),close:()=>setSurface('closed'),show(view:'settings'|'progress'|'workspace',options:{busy?:boolean;unknown?:boolean;upstream?:boolean;theme?:'dark'|'light';longRun?:boolean;runState?:'failed'|'running'|'completed';mixed?:boolean}={}){setAdvanced(false);setLongRun(Boolean(options.longRun));setRunState(options.runState??'failed');setMixed(Boolean(options.mixed));setBusy(Boolean(options.busy));setUnknown(Boolean(options.unknown));setUpstream(Boolean(options.upstream));setTheme(options.theme??'dark');setSurface(view);setRevision(v=>v+1);return revision+1;}}});
  // Keep the opener mounted beneath dialogs, as in the real authoring workspace.
  return <StoryDreamProvider theme={theme}>
    <main className="app-shell" data-shell-view="editorial-collage" data-runtime="electron" data-lemo-qa-revision={revision}>
      <div className="window-line">StoryDream · 离线布局回归</div>
      <div className="shell-grid"><section className="content"><div data-editorial-collage-workbench="true">
        <ProjectModelBar task={{id:'layout-only',title:'布局回归',status:'completed',llmProfileId:'offline'}} config={defaultConfig} api={{} as StoryDreamApi} onUpdated={()=>{}} disabled />
        <DirectorDeskWorkspace mode="vox" projectTitle="创意视频工作区布局回归" projectMeta="离线夹具，不调用生成服务" episodeTitle="" stageLabel="镜头生成"
          shots={[{id:'shot',index:1,title:'镜头布局',scene:'',durationMs:5000,framing:'',characterLabel:'',prompt:'',motionPrompt:'',subtitle:'',...(upstream?{renderStrategy:'remotion' as const,nativeCaptions:false,upstreamProject:{ready:runState==='completed',turn:6}}:{})}]}
          onExportAnimationShot={async id=>{Object.assign(window,{lemoExportCalls:++exportCount.current});await record('export-shot',id);if(holdExport.current)await new Promise<void>(resolve=>{pendingExport.current=resolve;});return true;}}
          selectedShotId="shot" dirty={false} providerConnected onSelectShot={()=>{}} onUpdateShot={()=>{}} onSave={()=>{}}
          production={{running:false,phase:'制作完成',progress:{current:46,total:46},summary:'自动制作完成，成片与媒体检查已保存。',label:'生成成片',disabled:false,onAction:()=>{},onPause:()=>{},onCancel:()=>{},onSettings:()=>{},onMusic:()=>{},onDetails:()=>setSurface('progress')}} />
      </div></section></div>
    </main>
    {surface==='settings'?<VoxProductionDialog key={revision} document={document} busy={busy} onClose={()=>setSurface('closed')} onSave={s=>record('save',s)} onStart={s=>record('start',s)} onApply={s=>record('apply',s)} onOpenUrl={async()=>{throw Error('offline QA')}} musicLibrary={[]} api={{importBgmAudio:async()=>{throw Error('offline QA')}}}/>:null}
    {surface==='progress'?<VoxProductionProgress key={revision} run={run} shots={document.beats.flatMap(beat=>beat.shots)} busy={busy} onClose={()=>setSurface('closed')} onControl={async(action,extra)=>{await record(action,extra)}}/>:null}
  </StoryDreamProvider>;
}
createRoot(window.document.getElementById('root')!).render(<App/>);

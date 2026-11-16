import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { MotionComicScriptWorkspace } from '../src/features/motion-comic/MotionComicScriptWorkspace';
import { createMotionComicDraft, createMotionComicImportedProject } from '../src/shared/motion-comic';
import { motionComicScriptDraftSchema, splitMotionComicSource, validateMotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { MotionComicScriptSnapshot } from '../src/shared/motion-comic-script-batch';
import '../src/styles.css';
const now='2026-11-16T00:00:00.000Z';
const project=createMotionComicImportedProject(createMotionComicDraft({id:'validation-qa',title:'章节校验验收',premise:'雨夜来信',now}),{kind:'novel',adaptationMode:'novel-adaptation',originalText:'第2章\n她推开木门。',episodes:[{title:'第2章',sourceText:'第2章\n她推开木门。'},{title:'第3章',sourceText:'第3章\n她读完来信。'}]},now);
const script=motionComicScriptDraftSchema.parse({title:'雨夜来信',logline:'她收到一封来信。',characters:[],sceneAssets:[{key:'room',label:'门厅',description:'雨夜门厅',prompt:'木门',continuityNotes:'左侧光',createNew:true}],props:[],scenes:[{key:'scene-0',title:'门厅',actIndex:1,actTitle:'来信',actBoundaryReason:'来信改变决定',summary:'雨夜收到来信',locationKey:'room',beats:[{key:'title',kind:'narration',text:'第2章。',sourceUnitIds:['S1']},{key:'action',kind:'action',text:'她推开木门。',sourceUnitIds:['S2']}]}]});
const task={id:'task',projectId:project.id,sourceEpisodeId:project.sourceDocument!.episodes[0].id,status:'script-ready',inputFingerprint:'fixture',seriesBibleVersion:'1',previousStateVersion:'1',provider:'offline',model:'offline',promptVersion:'fixture',instructions:'保持人物口吻',targetDurationSec:180,outputRevision:1,attempt:1,progress:100,createdAt:now,updatedAt:now} as const;
let snapshot:MotionComicScriptSnapshot={projectId:project.id,paused:false,tasks:[task],candidates:[{taskId:'task',outputRevision:1,script,adjustments:[],issues:[],origin:'model',createdAt:now}],approvals:[],storyboards:[]};
const calls:unknown[]=[]; Object.assign(window,{qaCalls:calls,qaCurrentSourceId:task.sourceEpisodeId,qaOtherSourceId:project.sourceDocument!.episodes[1].id});
const api=new Proxy({
 getMotionComicScripts:async()=>structuredClone(snapshot),
 editMotionComicScript:async(input:Parameters<StoryDreamApi['editMotionComicScript']>[0])=>{
  calls.push({type:'save',input});
  const issues=validateMotionComicScriptDraft(input.script,splitMotionComicSource(project.sourceDocument!.episodes[0].sourceText),project,task.instructions);
  snapshot={...snapshot,tasks:[{...snapshot.tasks[0],outputRevision:2,status:issues.length?'review':'script-ready'}],candidates:[{...snapshot.candidates[0],script:input.script,outputRevision:2,issues}]};
  return structuredClone(snapshot);
 },
 enqueueMotionComicScripts:async(input:Parameters<StoryDreamApi['enqueueMotionComicScripts']>[0])=>{calls.push({type:'enqueue',input});snapshot={...snapshot,tasks:[{...snapshot.tasks[0],id:'regenerated',status:'queued',outputRevision:0}],candidates:[]};return structuredClone(snapshot);},
}, {get(t,k){if(k in t)return t[k as keyof typeof t];return ()=>{throw new Error(`Unexpected API ${String(k)}`);};}}) as unknown as StoryDreamApi;
const noop=()=>{};
function Fixture(){const[selected,setSelected]=useState(project.sourceDocument!.episodes[0].id);return <StoryDreamProvider theme="dark"><WorkspaceNavigationProvider><main style={{height:'100vh',padding:16,boxSizing:'border-box',display:'flex',flexDirection:'column'}}><MotionComicScriptWorkspace api={api} document={project} model="offline" runtimeIdentity={{ provider: 'offline', model: 'offline' }} selectedSourceEpisodeId={selected} plannedSourceEpisodeIds={new Set()} onSelectSourceEpisode={setSelected} onOpenEpisode={noop} onDraftGuardChange={noop} withSavedProject={async operation=>operation(project)} onApplyStoryboard={async()=>{throw Error('Unexpected apply');}} onApproveScripts={async()=>{throw Error('Unexpected approve');}} onOpenProjectAssets={noop}/></main></WorkspaceNavigationProvider></StoryDreamProvider>}
createRoot(document.getElementById('root')!).render(<Fixture/>);

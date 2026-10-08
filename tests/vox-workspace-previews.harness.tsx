import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DirectorDeskWorkspace, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { StoryDreamProvider } from '../src/ui';
import { EDITORIAL_STYLE_PRESETS } from '../src/shared/editorial-collage';
import { editorialStylePreviewUrl } from '../src/shared/editorial-style-previews';
import '../src/styles.css';

const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
const calls: string[] = [];
const initial: DirectorShot[] = [1, 2].map(index => ({ id: `shot-${index}`, index, title: index === 1 ? '城市记忆从哪里开始' : '旧物怎样连接今天', scene: '风格与动作预览验收', framing: '中景', characterLabel: '', subtitle: '同一座城市，不同的生活视角。', durationMs: 5000, prompt: '独立背景和透明主体', motionPrompt: '主体进入画面', renderStrategy: 'deterministic-layers', motionStyle: 'cutout-slide', imageReady: true, voiceReady: true, thumbnail: editorialStylePreviewUrl('archival-red') }));
function Host() {
  const [shots,setShots]=useState(initial),[selected,setSelected]=useState('shot-1'),[style,setStyle]=useState('archival-red');
  Object.assign(window,{workspacePreviewQA:{calls,snapshot:()=>({shots,selected,style})}});
  return <StoryDreamProvider theme={theme}><DirectorDeskWorkspace mode="vox" activeProjectId="local-qa" projectTitle="城市记忆" projectMeta="本地交互验收" episodeTitle="第一集" stageLabel="镜头生成" ratio="16:9" dirty={false}
    shots={shots} selectedShotId={selected} onSelectShot={setSelected} onUpdateShot={(id,patch)=>setShots(current=>current.map(shot=>shot.id===id?{...shot,...patch}:shot))} onSave={()=>{}}
    providerConnected voiceConnected videoProviderConnected providerLabel="本地模拟" voiceProviderLabel="本地模拟" providerModel="本地" voiceOptions={[{value:'test',label:'示例音色'}]}
    styleCandidates={EDITORIAL_STYLE_PRESETS.map(s=>({...s,selected:s.id===style}))} selectedStyleId={style} onSelectStyle={setStyle}
    onGenerateShot={async id=>{calls.push(`image:${id}`);return{provider:'mock',thumbnail:editorialStylePreviewUrl('archival-red')!};}} onGenerateVoice={async id=>{calls.push(`voice:${id}`);return{provider:'mock',audioUrl:''};}} onRender={async()=>{calls.push('render');}}
  /></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Host/>);

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectModelBar } from '../src/features/projects/ProjectModelFields';
import { StoryDreamProvider } from '../src/ui';
import { defaultConfig } from '../src/shared/config';
import type { Task, ProjectModels } from '../src/shared/types';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import '../src/styles.css';
const config = structuredClone(defaultConfig);
config.llmProfiles = [0, 1].map(i => ({ ...config.llm, id: `llm-${i}`, name: `LLM ${i}`, model: `text-${i}` }));
config.imageProfiles = [0, 1].map(i => ({ ...config.imageProfiles[0], id: `image-${i}`, name: `生图 ${i}` }));
config.video.providers = [0, 1].map(i => ({ ...config.video.providers[0], id: `video-${i}`, name: `视频 ${i}`, model: `video-${i}` }));
const changes: ProjectModels[] = [];
Object.assign(window, { modelQA: { changes } });
function Fixture() {
  const [task, setTask] = useState({ id: 'fixture', title: '后台生成中的项目', taskType: 'motion-comic', status: 'running', projectModels: { llmProfileId: 'llm-0', imageProfileId: 'image-0', videoProviderId: 'video-0' } } as Task);
  const api = { setProjectModels: async (_id: string, models: ProjectModels) => { changes.push(models); setTask(current => ({ ...current, projectModels: models })); return {}; } } as unknown as StoryDreamApi;
  return <StoryDreamProvider theme="dark"><main style={{ padding: 24 }}><ProjectModelBar inline task={task} config={config} api={api} onUpdated={() => {}} disabled /><p>后台任务运行中 · 新选择仅影响后续任务</p></main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicProductionWorkspace } from '../src/features/motion-comic/MotionComicProductionWorkspace';
import { MotionComicProjectOverview } from '../src/features/motion-comic/MotionComicProjectOverview';
import { createMotionComicDraft, createMotionComicImportedProject, type MotionComicWorkflowStage } from '../src/shared/motion-comic';
import { resolveMotionComicStageState } from '../src/features/motion-comic/motion-comic-stage-state';
import '../src/styles.css';
import '../src/styles/features/motion-comic.css';
const document = createMotionComicImportedProject(createMotionComicDraft({ id: 'source-count-check', title: '单集导入统计验证', premise: '雨夜来信', now: '2026-11-14T00:00:00Z' }), { kind: 'script', adaptationMode: 'faithful-script', originalText: '雨夜，小林收到一封信。', episodes: [{ title: '雨夜归途', sourceText: '雨夜，小林收到一封信。' }] });
const noop = () => {};
function Fixture() {
  const [stage, setStage] = useState<MotionComicWorkflowStage>('episodes');
  return <StoryDreamProvider theme="dark"><main style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <MotionComicProductionWorkspace document={document} stage={stage} stageState={resolveMotionComicStageState(document, new Set<string>(), false)} dirty={false} busy={false} onStageChange={setStage} onSave={noop} onBack={noop} onNewProject={noop}>
      <MotionComicProjectOverview document={document} busy={false} onOpenEpisode={noop} onOpenScript={noop} onOpenAssets={noop} onContinue={noop} onBack={noop} />
    </MotionComicProductionWorkspace>
  </main></StoryDreamProvider>;
}
createRoot(window.document.getElementById('root')!).render(<Fixture />);

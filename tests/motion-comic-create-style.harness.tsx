import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionComicCreateFlow } from '../src/features/motion-comic/MotionComicCreateFlow';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';
import '../src/styles/features/motion-comic.css';

const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
const noop = () => {};
function Host() {
  const [visualStyle, setVisualStyle] = useState('');
  const [step, setStep] = useState(0);
  const ai = new URLSearchParams(location.search).has('ai');
  const [episodes, setEpisodes] = useState(Array.from({ length: 149 }, (_, index) => ({
    title: `雨夜来信 · 第 ${index + 1} 章`, sourceText: '雨夜，林夏收到一封来自三年前失踪哥哥的信。'.repeat(60),
    startUnitId: `u${index}`, endUnitId: `u${index}`, splitReason: '章节边界', continuityHook: '信中线索',
  })));
  return <StoryDreamProvider theme={theme}><div data-motion-comic-workbench="true" style={{ height: '100vh', minHeight: 0, overflow: 'hidden' }}>
    <MotionComicCreateFlow step={step} title="雨夜来信" ratio="16:9" visualStyle={visualStyle} onVisualStyleChange={setVisualStyle}
      sourceKind="script" adaptationMode="faithful-script" sourceFileName="雨夜来信.md" sourceText="雨夜，林夏收到一封来自三年前失踪哥哥的信。"
      targetCharacters="2400" targetDurationSec="" splitInstructions="" episodes={episodes} busy={false}
      splitStrategy={ai ? 'ai-story' : 'chapter'} splitEvidence={ai ? {
        strategy: 'ai-story', version: 1, unitizationVersion: 1, sourceFingerprint: 'fixture',
        targetCharacters: 2400, createdAt: '2026-11-13T00:00:00Z',
      } : undefined}
      onStepChange={setStep} onTitleChange={noop} onRatioChange={noop} onSourceKindChange={noop} onAdaptationModeChange={noop}
      onSourceTextChange={noop} onTargetCharactersChange={noop} onTargetDurationSecChange={noop} onSplitInstructionsChange={noop}
      onEpisodeChange={(index, update) => setEpisodes((current) => current.map((episode, i) => i === index ? { ...episode, ...update } : episode))} onImportFile={noop} onPrepareEpisodes={() => setStep(1)} onCreate={noop} />
  </div></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<Host />);

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionComicCreateFlow, type MotionComicEpisodeDraft } from '../src/features/motion-comic/MotionComicCreateFlow';
import type { MotionComicSourceSplitEvidence } from '../src/shared/motion-comic-episode-planning';
import { StoryDreamProvider } from '../src/ui';
import '../src/styles.css';
import '../src/styles/features/motion-comic.css';

const sourceText = [
  '第1章 雨夜来信\n雨夜，林夏收到一封来自三年前失踪哥哥的信。信中要求她午夜前到旧车站，并警告她不要相信穿红雨衣的人。',
  '第2章 午夜广播\n林夏抵达站台后，广播提前说出她下一步的动作。轨道尽头的红雨衣人抬起头，露出与哥哥相同的脸。',
].join('\n\n');

const initialEpisodes: MotionComicEpisodeDraft[] = [
  {
    title: '雨夜来信',
    sourceText: sourceText.split('\n\n')[0],
    startUnitId: 'U0001',
    endUnitId: 'U0002',
    splitReason: '来信完成第一阶段目标，并在旧车站邀约处形成明确行动转折。',
    continuityHook: '红雨衣警告成为下一集进入车站后的直接悬念。',
  },
  {
    title: '午夜广播',
    sourceText: sourceText.split('\n\n')[1],
    startUnitId: 'U0003',
    endUnitId: 'U0004',
    splitReason: '广播预言与哥哥面孔完成本段信息升级。',
    continuityHook: '全篇收束，并为后续结构化保留身份谜题。',
  },
];

const evidence: MotionComicSourceSplitEvidence = {
  version: 1,
  unitizationVersion: 1,
  strategy: 'ai-story',
  sourceFingerprint: 'motion-comic-source-v1-fixture',
  targetCharacters: 2_400,
  targetDurationSec: 90,
  instructions: '每集结尾保留悬念。',
  model: '离线验收模型',
  createdAt: '2026-09-24T01:00:00.000Z',
  repaired: true,
  sourceUnitCount: 4,
  batchCount: 1,
};

const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;

function Host() {
  const [episodes, setEpisodes] = useState(initialEpisodes);
  return <StoryDreamProvider theme={theme}>
    <div data-motion-comic-workbench="true" style={{ height: '100vh', minHeight: 0, overflow: 'hidden' }}>
      <MotionComicCreateFlow
        step={1}
        title="雨夜来信"
        ratio="16:9"
        sourceKind="novel"
        adaptationMode="novel-adaptation"
        sourceFileName="雨夜来信.md"
        sourceText={sourceText}
        targetCharacters="2400"
        targetDurationSec="90"
        splitInstructions="每集结尾保留悬念。"
        splitStrategy="ai-story"
        splitEvidence={evidence}
        splitWarnings={['第 2 集略短，剧情边界已保留。']}
        episodes={episodes}
        busy={false}
        onStepChange={() => {}}
        onTitleChange={() => {}}
        onRatioChange={() => {}}
        onSourceKindChange={() => {}}
        onAdaptationModeChange={() => {}}
        onSourceTextChange={() => {}}
        onTargetCharactersChange={() => {}}
        onTargetDurationSecChange={() => {}}
        onSplitInstructionsChange={() => {}}
        onSplitStrategyChange={() => {}}
        onEpisodeChange={(index, update) => setEpisodes((current) => current.map((episode, candidate) => candidate === index ? { ...episode, ...update } : episode))}
        onImportFile={() => {}}
        onPrepareEpisodes={() => {}}
        onCreate={() => {}}
      />
    </div>
  </StoryDreamProvider>;
}

createRoot(document.getElementById('root')!).render(<Host />);

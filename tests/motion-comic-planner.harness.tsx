import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionComicPlanDialog } from '../src/features/motion-comic/MotionComicPlanDialog';
import type { MotionComicPlanResult, MotionComicPlanRecovery, MotionComicScriptFailure } from '../src/shared/motion-comic-planning';
import { Button, StoryDreamProvider } from '../src/ui';
import '../src/styles.css';

const sourceText = '雨夜，林夏收到一封署名为三年前失踪的哥哥的信。\n信中让她午夜前赶到停运的旧车站，不要相信穿红雨衣的人。\n她抵达站台时，广播却念出了她下一步要做的事。';
const result: MotionComicPlanResult = {
  model: 'qa-remote-planner',
  repaired: false,
  warnings: [],
  summary: { characters: 2, acts: 2, scenes: 2, shots: 4, dialogueLines: 2, durationSec: 28, sourceUnits: 3, coveredSourceUnits: 3 },
  plan: {
    version: 1,
    sourceText,
    sourceUnits: [
      { id: 'S1', text: '雨夜，林夏收到一封署名为三年前失踪的哥哥的信。' },
      { id: 'S2', text: '信中让她午夜前赶到停运的旧车站，不要相信穿红雨衣的人。' },
      { id: 'S3', text: '她抵达站台时，广播却念出了她下一步要做的事。' },
    ],
    script: {
      title: '第一集：午夜广播',
      logline: '一封来自失踪者的信，把林夏引向会预言行动的废弃车站。',
      characters: [
        { key: 'lin-xia', name: '林夏', aliases: [], role: '主角', identityPrompt: '二十七岁女性，冷静警觉', personality: '理性但无法放下哥哥失踪之谜', voiceNotes: '克制、语速偏慢', looks: [{ key: 'lin-rain', label: '雨夜造型', appearancePrompt: '短发，疲惫眼神', wardrobe: '深色风衣', continuityNotes: '风衣始终被雨水打湿' }] },
        { key: 'red-coat', name: '红雨衣人', aliases: [], role: '神秘人', identityPrompt: '面孔隐藏在红色雨帽阴影下', personality: '未知', voiceNotes: '不说话', looks: [{ key: 'red-coat-look', label: '站台造型', appearancePrompt: '看不清面孔', wardrobe: '鲜红雨衣', continuityNotes: '始终站在光线边缘' }] },
      ],
      sceneAssets: [
        { key: 'apartment', label: '林夏公寓', description: '停电后的狭小公寓', prompt: 'rainy apartment at night', continuityNotes: '窗外蓝冷光从右侧进入' },
        { key: 'station', label: '旧车站', description: '停运多年的郊区站台', prompt: 'abandoned train platform in rain', continuityNotes: '顶灯间歇闪烁，雨从左向右' },
      ],
      props: [{ key: 'letter', label: '旧信封', description: '边缘发黄，带雨水痕迹', prompt: 'aged envelope with rain stains' }],
      scenes: [
        { key: 'scene-letter', actIndex: 1, actTitle: '警告闯入日常', actBoundaryReason: '来信打破林夏的日常，并明确旧车站这一行动目标。', title: '来自过去的信', summary: '林夏确认笔迹并读到警告。', locationKey: 'apartment', beats: [
          { key: 'beat-letter', sourceUnitIds: ['S1'], kind: 'action', text: '林夏拆开署名为哥哥的旧信。', characterKey: 'lin-xia' },
          { key: 'beat-warning', sourceUnitIds: ['S2'], kind: 'narration', text: '午夜前到旧车站，不要相信红雨衣的人。' },
        ] },
        { key: 'scene-platform', actIndex: 2, actTitle: '预言升级威胁', actBoundaryReason: '地点转入旧车站，广播从警告升级为能预知行动的直接威胁。', title: '广播预言', summary: '林夏到达站台，被广播提前说出动作。', locationKey: 'station', beats: [
          { key: 'beat-arrive', sourceUnitIds: ['S3'], kind: 'action', text: '林夏踏上空无一人的站台。', characterKey: 'lin-xia' },
          { key: 'beat-broadcast', sourceUnitIds: ['S3'], kind: 'narration', text: '广播：她会抬头，看见轨道尽头的人。' },
        ] },
      ],
    },
    shots: [
      { key: 'shot-1', sceneKey: 'scene-letter', title: '信封落在门内', durationSec: 6, prompt: '低机位特写，旧信封贴着湿地板', motionPrompt: '缓慢推进，雨水从信封边缘滑落', framing: '特写', characterLookKeys: [], propKeys: ['letter'], beatKeys: ['beat-letter'], continuity: { startState: '门缝空着', endState: '信封完全进入画面', screenDirection: '信封从右向左', actionBeats: ['信封滑入', '雨水滴落'] } },
      { key: 'shot-2', sceneKey: 'scene-letter', title: '熟悉的笔迹', durationSec: 7, prompt: '林夏在窗边展开信纸，眼神停住', motionPrompt: '轻微手持呼吸感，焦点从字迹移到眼睛', framing: '近景', characterLookKeys: ['lin-rain'], propKeys: ['letter'], beatKeys: ['beat-warning'], continuity: { startState: '信纸折叠', endState: '警告文字完全显露', screenDirection: '视线由下向上', actionBeats: ['展开信纸', '认出笔迹'] } },
      { key: 'shot-3', sceneKey: 'scene-platform', title: '踏入废弃站台', durationSec: 8, prompt: '广角建立镜头，林夏走入闪烁顶灯下', motionPrompt: '横向跟拍，保持人物轮廓稳定', framing: '全景', characterLookKeys: ['lin-rain'], propKeys: [], beatKeys: ['beat-arrive'], continuity: { startState: '站台空旷', endState: '林夏停在黄线前', screenDirection: '人物从左向右', actionBeats: ['走入站台', '停在黄线'] } },
      { key: 'shot-4', sceneKey: 'scene-platform', title: '广播先一步响起', durationSec: 7, prompt: '顶灯熄灭再亮，远处红雨衣人出现', motionPrompt: '快速拉焦到远处，再缓慢推近', framing: '中远景', characterLookKeys: ['lin-rain', 'red-coat-look'], propKeys: [], beatKeys: ['beat-broadcast'], continuity: { startState: '轨道尽头空无一人', endState: '红雨衣人站在灯下', screenDirection: '林夏面向画面右侧', actionBeats: ['广播响起', '顶灯闪烁', '人影出现'] } },
    ],
    targetDurationSec: 30,
    instructions: '开场三秒建立异常，结尾保留悬念。',
    model: 'qa-remote-planner',
    createdAt: '2026-09-18T06:00:00.000Z',
  },
};
const auditedResult: MotionComicPlanResult = {
  ...result,
  plan: {
    ...result.plan,
    adjustments: Array.from({ length: 48 }, (_, index) => ({
      path: `script.characters[0].looks[0].wardrobe[${index}]`,
      kind: 'filled' as const,
      before: '（缺失）',
      after: `第 ${index + 1} 项自动补齐的造型审核说明，保留具体上下文供确认。`,
    })),
  },
};

const query = new URLSearchParams(location.search);
const initialPreview = query.get('view') !== 'source';
const manualResult: MotionComicPlanResult = { ...auditedResult, repaired: true, plan: { ...auditedResult.plan, adjustments: [{ path: 'script.scenes[0].beats[0].text', kind: 'manual', before: '原始台词', after: '人工修改后的台词' }] } };
const currentResult = query.get('fixture') === 'manual' ? manualResult : query.get('fixture') === 'adjustments' ? auditedResult : result;
const retainedScript = {
  ...result.plan.script,
  scenes: Array.from({ length: 8 }, (_, index) => ({
    ...result.plan.script.scenes[index % result.plan.script.scenes.length],
    key: `retained-scene-${index + 1}`,
    title: `保留场次 ${index + 1}`,
    beats: result.plan.script.scenes[index % result.plan.script.scenes.length].beats.map((beat, beatIndex) => ({
      ...beat, key: `retained-beat-${index + 1}-${beatIndex + 1}`,
    })),
  })),
};
const recovery: MotionComicPlanRecovery | null = ['recovery', 'review'].includes(query.get('fixture') ?? '') ? {
  phase: query.get('fixture') === 'review' ? 'script-review' : 'storyboard-failed',
  adjustments: [{ path: 'script.scenes[0].actTitle', kind: 'normalized', before: '（缺失）', after: '夜间异常' }],
  token: '6f50e5ee-9774-4ea9-83dd-75a987968f8a',
  projectId: 'planner-qa-project',
  sourceText,
  instructions: '开场三秒建立异常，结尾保留悬念。',
  targetDurationSec: 30,
  title: result.plan.script.title,
  scenes: retainedScript.scenes.length,
  script: retainedScript,
  createdAt: '2026-09-26T00:00:00.000Z',
} : null;
const failure: MotionComicScriptFailure | null = query.get('fixture') === 'failure' ? {
  token: '6f50e5ee-9774-4ea9-83dd-75a987968f8a', projectId: 'planner-qa-project', sourceText,
  instructions: '开场三秒建立异常，结尾保留悬念。', targetDurationSec: 30,
  draft: { ...retainedScript, scenes: retainedScript.scenes.map((scene) => ({ ...scene, beats: scene.beats.map((beat) => ({ ...beat, kind: 'dialogue', characterKey: undefined })) })) },
  issues: retainedScript.scenes.flatMap((scene, si) => scene.beats.map((_, bi) => ({ path: 'script.scenes[' + si + '].beats[' + bi + ']', code: 'DIALOGUE_SPEAKER_MISSING', message: '对白必须指定说话角色；旁白请使用 narration。' }))),
  adjustments: [], createdAt: '2026-09-28T00:00:00.000Z',
} : null;
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;

function Host() {
  const [open, setOpen] = useState(true);
  const [review, setReview] = useState<MotionComicPlanRecovery | null>(() => recovery ? JSON.parse(localStorage.getItem('planner-qa-review') || 'null') ?? recovery : null);
  const [scriptFailure, setScriptFailure] = useState<MotionComicScriptFailure | null>(() => failure ? JSON.parse(localStorage.getItem('planner-qa-failure') || 'null') ?? failure : null);
  const [story, setStory] = useState(initialPreview || recovery || failure ? sourceText : '');
  const [instructions, setInstructions] = useState('开场三秒建立异常，结尾保留悬念。');
  const [duration, setDuration] = useState('30');
  const [preview, setPreview] = useState<MotionComicPlanResult | null>(initialPreview ? currentResult : null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingMode, setApplyingMode] = useState<'append' | 'replace'>('append');
  const [error, setError] = useState(query.get('error') === '1' ? '规划服务暂时不可用，请保留原文后重试。' : '');
  const [calls, setCalls] = useState<string[]>([]);

  Object.assign(window, { motionComicPlannerQA: { calls, scriptFailure, showSource: () => setPreview(null), showPreview: () => setPreview(currentResult), setError } });
  const generate = () => {
    setBusy(true);
    setError('');
    setCalls((current) => [...current, 'generate']);
    window.setTimeout(() => { setBusy(false); setPreview(result); }, 220);
  };
  const apply = (mode: 'append' | 'replace') => {
    setApplyingMode(mode);
    setApplying(true);
    setCalls((current) => [...current, mode === 'replace' ? 'replace' : 'apply']);
    window.setTimeout(() => setApplying(false), 220);
  };

  return <StoryDreamProvider theme={theme}>
    {!open ? <Button onClick={() => setOpen(true)}>重新打开规划</Button> : null}
    <MotionComicPlanDialog
    open={open}
    sourceText={story}
    instructions={instructions}
    targetDurationSec={duration}
    episodeNumber={3}
    result={preview}
    recovery={review}
    onReviewScriptChange={(script) => {
      if (!review) return;
      const next = { ...review, script, needsValidation: true };
      setReview(next);
      localStorage.setItem('planner-qa-review', JSON.stringify(next));
    }}
    onEditScript={() => setPreview(null)}
    scriptFailure={scriptFailure}
    onScriptDraftChange={(draft) => {
      if (!scriptFailure) return;
      const next = { ...scriptFailure, draft };
      setScriptFailure(next);
      localStorage.setItem('planner-qa-failure', JSON.stringify(next));
    }}
    onRepairScript={() => setCalls((current) => [...current, 'repair'])}
    onResume={() => {
      if (!review) return;
      setCalls((current) => [...current, review.needsValidation ? 'validate' : 'resume']);
      if (review.needsValidation) {
        const next = { ...review, token: crypto.randomUUID(), needsValidation: false };
        setReview(next);
        localStorage.setItem('planner-qa-review', JSON.stringify(next));
      } else setPreview(result);
    }}
    busy={busy}
    applying={applying}
    applyingMode={applyingMode}
    canReplaceStarter={query.get('starter') === '1'}
    errorMessage={error || undefined}
    onOpenChange={setOpen}
    onSourceTextChange={setStory}
    onInstructionsChange={setInstructions}
    onTargetDurationSecChange={setDuration}
    onGenerate={generate}
    onApply={() => apply('append')}
    onReplaceStarter={() => apply('replace')}
    onEdit={() => setPreview(null)}
    onCreateBlankEpisode={() => setCalls((current) => [...current, 'blank'])}
  /></StoryDreamProvider>;
}

createRoot(document.getElementById('root')!).render(<Host />);

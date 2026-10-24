import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import type { MotionComicScriptDraft, MotionComicStoryboardDraft } from '../src/shared/motion-comic-planning';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import { MotionComicScriptBatchService } from '../electron/motion-comic-script-batch-service';

// Deterministic isolated artifacts exercise the production IPC/UI, not model quality.
const profile = process.argv[2];
if (!profile) throw new Error('An isolated profile directory is required.');
await mkdir(join(profile, 'storydream'), { recursive: true });
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
const title = '后台分集剧本流程验收';
const sourceLines = Array.from({ length: 32 }, (_, index) => `雨夜门厅中，阿青检查第${index + 1}处信件线索。`);
const sourceText = sourceLines.join('\n');
const script: MotionComicScriptDraft = {
  title: '雨夜来信：阿青与旧友追查一封迟到多年的信件',
  logline: '阿青逐一核对来信中的线索，发现旧友提供的时间与门厅记录矛盾。雨声中，四人从门厅来到书房，重新检查信纸、旧钥匙和一张褪色照片，决定在天亮前寻找寄信人。'.repeat(3),
  characters: ['阿青', '白杨', '林夏', '老陈'].map((name, index) => ({
    key: `person-${index}`, name, aliases: [`来信人${index + 1}`], role: index === 0 ? '主角' : '配角',
    identityPrompt: `${name}，参与追查雨夜来信的身份与来历。`, personality: '谨慎，关注细节。', voiceNotes: '平静低声，语速适中。',
    looks: [{ key: `look-${index}`, label: '雨夜常服', appearancePrompt: `${name}的固定外貌与雨夜常服。`, wardrobe: '深色外套、浅色衬衣', continuityNotes: '外套肩部有雨水，保持湿润状态。' }],
  })),
  props: ['信纸', '旧钥匙', '褪色照片'].map((label, index) => ({ key: `prop-${index}`, label, description: `核对线索使用的${label}。`, prompt: `${label}，保持纹理与磨损位置一致。` })),
  sceneAssets: ['门厅', '书房'].map((label, index) => ({ key: index === 0 ? 'hall' : 'study', label, description: `雨夜${label}`, prompt: `雨夜${label}的固定陈设与灯光。`, continuityNotes: '左侧灯光' })),
  scenes: Array.from({ length: 8 }, (_, sceneIndex) => ({
    key: `scene-${sceneIndex}`, actIndex: sceneIndex < 4 ? 1 : 2, actTitle: sceneIndex < 4 ? '核对来信' : '追查矛盾', actBoundaryReason: sceneIndex < 4 ? '信件到来后开始核对线索。' : '发现时间记录矛盾，转向追查寄信人。',
    title: `线索场次 ${sceneIndex + 1}`, summary: '阿青与旧友检查信件，核对旧钥匙和照片中的线索。', locationKey: sceneIndex < 4 ? 'hall' : 'study',
    beats: Array.from({ length: 4 }, (_, beatIndex) => {
      const index = sceneIndex * 4 + beatIndex;
      return { key: `beat-${index}`, kind: 'action' as const, sourceUnitIds: [`S${index + 1}`], text: sourceLines[index] };
    }),
  })),
};
const storyboard: MotionComicStoryboardDraft = {
  shots: script.scenes.map((scene, index) => ({
    key: `shot-${index}`, sceneKey: scene.key, title: scene.title, durationSec: 8,
    prompt: '雨夜门厅，阿青查看来信。', motionPrompt: '手指沿着信纸缓慢移动，镜头缓推。', framing: '中景',
    characterLookKeys: ['look-0'], propKeys: ['prop-0'], beatKeys: scene.beats.map((beat) => beat.key),
    continuity: { startState: '站在门厅检查信件', endState: '继续检查下一条线索', screenDirection: '面向左侧', actionBeats: ['看信', '核对线索'] },
  })),
};
let service: MotionComicScriptBatchService | undefined;
try {
  const task = await db.createMotionComicTask({ title, premise: '验证后台任务、审核与独立分镜。', ratio: '16:9', source: {
    kind: 'novel', adaptationMode: 'novel-adaptation', originalText: sourceText.repeat(24), fileName: '验收小说.txt',
    episodes: Array.from({ length: 24 }, (_, index) => ({ title: `雨夜来信 ${index + 1}`, sourceText })),
  } });
  const document = parseMotionComicPipelineData(task.pipelineData);
  const config = { provider: 'offline-fixture', model: 'deterministic-fixture' };
  await db.motionComicScripts.enqueue({ id: task.id, expectedUpdatedAt: document.updatedAt, scope: 'missing' }, config);
  for (let index = 0; index < 24; index += 1) {
    const job = (await db.motionComicScripts.claim(task.id))!;
    if (index === 23) await db.motionComicScripts.fail(job, '离线验收：可独立重试的失败任务。');
    else await db.motionComicScripts.finish(job, { script: index === 3 ? { ...script, characters: [], props: [] } : script, adjustments: [], issues: [] });
  }
  const snapshot = await db.motionComicScripts.snapshot(task.id);
  const second = snapshot.tasks[1];
  await db.motionComicScripts.approve({ id: task.id, expectedUpdatedAt: document.updatedAt, revisions: [{ taskId: second.id, outputRevision: 1 }] });
  const revision = { id: task.id, expectedUpdatedAt: (await db.motionComicScripts.readProject(task.id)).updatedAt, taskId: second.id, outputRevision: 1 };
  service = new MotionComicScriptBatchService(db.motionComicScripts, async () => ({ ...config,
    llm: { protocol: 'openai', run: async () => ({ json: storyboard }) } as unknown as ConfiguredJsonLlm,
  }));
  await service.startStoryboard(revision);
  await service.storyboardIdle(task.id);
  const ready = await db.motionComicScripts.snapshot(task.id);
  if (ready.storyboards.length !== 1) throw new Error(JSON.stringify(ready.tasks[1]));
  await db.motionComicScripts.control(task.id, 'pause');
  await writeFile(join(profile, 'script-fixture.json'), JSON.stringify({ id: task.id, title, first: snapshot.tasks[0].id, second: second.id }), 'utf8');
} finally {
  await service?.stop();
  await db.close();
}

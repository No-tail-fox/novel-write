import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfiguredJsonLlm } from '@shared/llm-provider';
import {
  createMotionComicDraft,
  createMotionComicImportedProject,
  createMotionComicStarterProject,
  parseMotionComicPipelineData,
  renameMotionComicAct,
  resolveMotionComicSceneAct,
  setMotionComicActBoundary,
} from '@shared/motion-comic';
import {
  applyMotionComicPlan,
  isUntouchedMotionComicStarter,
  nextUnplannedMotionComicSourceEpisodeId,
  parseMotionComicPlanDraft,
  splitMotionComicSource,
  validateMotionComicScriptDraft,
  validateMotionComicStoryboard,
  type MotionComicPlanDraft,
  type MotionComicScriptDraft,
  type MotionComicStoryboardDraft,
  normalizeMotionComicScriptRaw,
  normalizeMotionComicStoryboardRaw,
  collectMotionComicPlanAdjustments,
  motionComicScriptDraftSchema,
  motionComicPlanRecoverySchema,
  motionComicScriptCheckpointSchema,
} from '@shared/motion-comic-planning';
import { generateMotionComicPlan } from '@shared/motion-comic-planner';
import { MotionComicPlanningService } from '../electron/motion-comic-planning-service';

const now = '2026-09-18T00:00:00.000Z';
const sourceText = '雨夜里，阿青收到一封信。她打开信，发现署名来自十年后的自己。';

function document() {
  return createMotionComicStarterProject(createMotionComicDraft({
    id: 'planning-comic', title: '未来来信', premise: sourceText, now,
  }), '第一集', now);
}

function script(): MotionComicScriptDraft {
  return {
    title: '未来来信 · 新集',
    logline: '一封未来来信迫使阿青面对今晚的选择。',
    characters: [{
      key: 'char-qing', name: '阿青', aliases: ['青'], role: '主角', identityPrompt: '二十多岁短发女性，眉尾有小痣',
      personality: '谨慎但果断', voiceNotes: '克制的青年女声', looks: [{ key: 'look-qing-rain', label: '雨夜造型', appearancePrompt: '短发女性', wardrobe: '深色雨衣', continuityNotes: '雨衣全程湿润' }],
    }],
    sceneAssets: [{ key: 'loc-room', label: '旧公寓', description: '雨夜的旧公寓门厅', prompt: 'cinematic old apartment at night', continuityNotes: '主光从左侧窗户进入' }],
    props: [{ key: 'prop-letter', label: '未来来信', description: '边缘被雨水浸湿的信封', prompt: 'wet paper envelope' }],
    scenes: [{
      key: 'scene-letter', actIndex: 1, actTitle: '来信打破日常', actBoundaryReason: '本集从信件闯入日常生活开始，建立异常事件与主角目标。',
      title: '来信', summary: '阿青收到并打开来信。', locationKey: 'loc-room',
      beats: [
        { key: 'beat-arrive', sourceUnitIds: ['S1'], kind: 'action', text: '阿青在门厅拾起湿信封。', characterKey: 'char-qing' },
        { key: 'beat-open', sourceUnitIds: ['S2'], kind: 'narration', text: '署名来自十年后的自己。', characterKey: 'char-qing', emotion: '震惊' },
      ],
    }],
  };
}

function storyboard(): MotionComicStoryboardDraft {
  return { shots: [
    {
      key: 'shot-arrive', sceneKey: 'scene-letter', title: '拾起信封', durationSec: 5, prompt: '阿青在旧公寓门厅拾起湿信封',
      motionPrompt: '缓慢俯身，手指触碰信封，镜头轻推', framing: '中近景', characterLookKeys: ['look-qing-rain'], propKeys: ['prop-letter'], beatKeys: ['beat-arrive'],
      continuity: { startState: '阿青站在门口', endState: '阿青拿起信封', screenDirection: '人物由画面右侧朝左看', actionBeats: ['低头', '俯身', '拾起信封'] },
    },
    {
      key: 'shot-open', sceneKey: 'scene-letter', title: '看见署名', durationSec: 6, prompt: '阿青展开来信看见署名',
      motionPrompt: '手指展开信纸，视线凝住，轻微呼吸', framing: '手部特写转面部近景', characterLookKeys: ['look-qing-rain'], propKeys: ['prop-letter'], beatKeys: ['beat-open'],
      continuity: { startState: '阿青手持信封', endState: '阿青凝视信纸', screenDirection: '保持人物面向画面左侧', actionBeats: ['抽出信纸', '展开', '看见署名'] },
    },
  ] };
}

function plan(): MotionComicPlanDraft {
  return parseMotionComicPlanDraft({
    version: 1,
    sourceText,
    sourceUnits: splitMotionComicSource(sourceText),
    script: script(),
    shots: storyboard().shots,
    targetDurationSec: 11,
    model: 'planner-model',
    createdAt: now,
  }, document());
}

describe('motion comic AI planning', () => {
  it('pauses at script review, persists it, and generates only storyboard after token confirmation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-script-review-'));
    try {
      const run = vi.fn().mockResolvedValueOnce({ json: script() }).mockResolvedValueOnce({ json: storyboard() });
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'test', protocol: 'openai' };
      const ready = await service.plan({ ...input, stage: 'script' }, document(), llm, config);
      expect(ready.status).toBe('script-ready');
      expect(run).toHaveBeenCalledTimes(1);
      if (ready.status !== 'script-ready') throw new Error('expected review');
      expect(ready.recovery.phase).toBe('script-review');
      const reopened = await new MotionComicPlanningService(() => directory).plan({ ...input, stage: 'script' }, document(), llm, config);
      expect(reopened).toEqual(ready);
      expect(run).toHaveBeenCalledTimes(1);
      await expect(service.plan({ ...input, stage: 'storyboard' }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      await expect(service.plan({ ...input, stage: 'storyboard', resumeToken: ready.recovery.token, instructions: 'changed' }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      const complete = await service.plan({ ...input, stage: 'storyboard', resumeToken: ready.recovery.token }, document(), llm, config);
      expect(complete.status).toBe('complete');
      expect(run).toHaveBeenCalledTimes(2);
      expect(run.mock.calls[1][0].name).toBe('motion-comic-storyboard');
      // Preview can go back to the same durable script without another model call.
      expect(await service.plan({ ...input, stage: 'script' }, document(), llm, config)).toEqual(ready);
      expect(run).toHaveBeenCalledTimes(2);
      const cleared = structuredClone(ready.recovery);
      cleared.script.scenes[0].beats[0].text = '';
      cleared.needsValidation = true;
      expect(motionComicPlanRecoverySchema.safeParse(cleared).success).toBe(true);
      expect(motionComicScriptCheckpointSchema.safeParse({ script: cleared.script, repaired: false, adjustments: [] }).success).toBe(false);

    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('revalidates edited script without LLM, replaces revision token, and rejects old revisions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-script-revision-'));
    try {
      const run = vi.fn().mockResolvedValue({ json: storyboard() });
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'test', protocol: 'openai' };
      const first = await service.plan({ ...input, stage: 'script', scriptDraft: script() }, document(), llm, config);
      if (first.status !== 'script-ready') throw new Error('expected review');
      const edited = script();
      edited.scenes[0].beats[1].text = '署名竟来自未来的自己。';
      const second = await service.plan({ ...input, stage: 'script', scriptDraft: edited, scriptRevisionToken: first.recovery.token }, document(), llm, config);
      if (second.status !== 'script-ready') throw new Error('expected review');
      expect(second.recovery.token).not.toBe(first.recovery.token);
      await expect(service.plan({ ...input, stage: 'script', scriptDraft: edited, scriptRevisionToken: first.recovery.token }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      expect(second.recovery.adjustments).toContainEqual(expect.objectContaining({ path: 'script.scenes[0].beats[1].text', after: edited.scenes[0].beats[1].text }));
      expect(run).not.toHaveBeenCalled();
      await expect(service.plan({ ...input, stage: 'storyboard', resumeToken: first.recovery.token }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      const invalid = structuredClone(edited);
      invalid.scenes[0].beats[1].kind = 'dialogue';
      delete invalid.scenes[0].beats[1].characterKey;
      expect((await service.plan({ ...input, stage: 'script', scriptDraft: invalid }, document(), llm, config)).status).toBe('script-invalid');
      await expect(service.plan({ ...input, stage: 'storyboard', resumeToken: second.recovery.token }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      expect(run).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(['speaker', 'speakerName', 'character'])('resolves explicit %s aliases without mutating model output', (field) => {
    const raw = script() as any;
    raw.scenes[0].beats[1] = { key: 'beat-open', sourceUnitIds: ['S2'], kind: 'dialogue', text: '是我写的。', [field]: '青' };
    const normalized = motionComicScriptDraftSchema.parse(normalizeMotionComicScriptRaw(raw));
    expect(normalized.scenes[0].beats[1].characterKey).toBe('char-qing');
    expect(raw.scenes[0].beats[1].characterKey).toBeUndefined();
    expect(collectMotionComicPlanAdjustments(raw, normalized, 'script').some((item) => item.path.endsWith('.characterKey'))).toBe(true);
  });

  it('does not guess missing, ambiguous, conflicting or invalid speakers', () => {
    for (const fields of [{}, { speakerName: '陌生人' }, { speaker: '青', speakerName: '陌生人' }, { characterKey: 'invalid', speaker: '青' }]) {
      const raw = script() as any;
      raw.scenes[0].beats[1] = { key: 'beat-open', sourceUnitIds: ['S2'], kind: 'dialogue', text: '是我写的。', ...fields };
      const normalized = motionComicScriptDraftSchema.parse(normalizeMotionComicScriptRaw(raw));
      expect(normalized.scenes[0].beats[1].kind).toBe('dialogue');
      expect(validateMotionComicScriptDraft(normalized, splitMotionComicSource(sourceText)).some((item) => item.code)).toBe(true);
    }
    const raw = script() as any;
    raw.characters.push({ ...raw.characters[0], key: 'other', name: '另一个人', looks: [{ ...raw.characters[0].looks[0], key: 'other-look' }] });
    raw.scenes[0].beats[1] = { key: 'beat-open', sourceUnitIds: ['S2'], kind: 'dialogue', text: '是我写的。', speaker: '青' };
    const normalized = motionComicScriptDraftSchema.parse(normalizeMotionComicScriptRaw(raw));
    expect(normalized.scenes[0].beats[1].characterKey).toBeUndefined();
  });

  it('repairs only failed speaker fields and requires review before applying', async () => {
    const raw = script();
    raw.scenes[0].beats[1].kind = 'dialogue';
    delete raw.scenes[0].beats[1].characterKey;
    const before = structuredClone(raw);
    const run = vi.fn()
      .mockResolvedValueOnce({ json: raw })
      .mockResolvedValueOnce({ json: { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: 'char-qing' }] } })
      .mockResolvedValueOnce({ json: storyboard() });
    const result = await generateMotionComicPlan({ id: 'planning-comic', expectedUpdatedAt: now, sourceText }, document(),
      { protocol: 'openai', run } as unknown as ConfiguredJsonLlm, { model: 'test', now });
    expect(run.mock.calls[1][0].name).toBe('motion-comic-speaker-repair');
    expect(JSON.parse(run.mock.calls[1][0].messages[1].content).targets).toHaveLength(1);
    expect(result.plan.script).toEqual({ ...raw, scenes: [{ ...raw.scenes[0], beats: [raw.scenes[0].beats[0], { ...raw.scenes[0].beats[1], characterKey: 'char-qing' }] }] });
    expect(raw).toEqual(before);
    expect(result.plan.adjustments?.some((item) => item.path.endsWith('.characterKey'))).toBe(true);
    expect(() => applyMotionComicPlan(document(), result.plan)).toThrow(/REVIEW_REQUIRED/u);
  });

  it.each([
    { patches: [] },
    { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: null }] },
    { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: 'unknown' }] },
    { patches: [{ beatKey: 'beat-arrive', kind: 'dialogue', characterKey: 'char-qing' }] },
    { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: 'char-qing', text: '改写剧情' }] },
    { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: 'char-qing' }, { beatKey: 'beat-open', kind: 'dialogue', characterKey: 'char-qing' }] },
  ])('blocks invalid speaker patches without starting storyboard: %j', async (patch) => {
    const raw = script();
    raw.scenes[0].beats[1].kind = 'dialogue';
    delete raw.scenes[0].beats[1].characterKey;
    const checkpoint = vi.fn();
    const run = vi.fn().mockResolvedValueOnce({ json: raw }).mockResolvedValueOnce({ json: patch });
    await expect(generateMotionComicPlan({ id: 'planning-comic', expectedUpdatedAt: now, sourceText }, document(),
      { protocol: 'openai', run } as unknown as ConfiguredJsonLlm, { model: 'test', now, onScriptReady: checkpoint }))
      .rejects.toThrow(/第 1 场第 2 条/u);
    expect(run).toHaveBeenCalledTimes(2);
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('restores missing source references from unique text matches through both planning and import', async () => {
    const units = splitMotionComicSource(sourceText);
    const raw = script();
    raw.scenes[0].beats.forEach((beat, index) => {
      beat.sourceUnitIds = [];
      beat.text = units[index].text;
    });
    const run = vi.fn()
      .mockResolvedValueOnce({ json: raw, raw: '{}', requestId: null })
      .mockResolvedValueOnce({ json: storyboard(), raw: '{}', requestId: null });
    const generated = await generateMotionComicPlan({ id: 'planning-comic', expectedUpdatedAt: now, sourceText }, document(),
      { protocol: 'openai', run } as unknown as ConfiguredJsonLlm, { model: 'test', now });
    expect(run).toHaveBeenCalledTimes(2);
    expect(generated.plan.script.scenes[0].beats.map((beat) => beat.sourceUnitIds)).toEqual([['S1'], ['S2']]);
    expect(parseMotionComicPlanDraft({ ...generated.plan, script: raw }).script).toEqual(generated.plan.script);
    expect(raw.scenes[0].beats[0].sourceUnitIds).toEqual([]);
  });

  it('does not fabricate source coverage when text is unmatched or ambiguous', () => {
    const raw = script();
    raw.scenes[0].beats[0].sourceUnitIds = [];
    raw.scenes[0].beats[0].text = '未在原文出现的剧情';
    const missing = normalizeMotionComicScriptRaw(raw, splitMotionComicSource(sourceText));
    expect(motionComicScriptDraftSchema.safeParse(missing).success).toBe(false);
    raw.scenes[0].beats[0].text = '同一句台词';
    const ambiguous = normalizeMotionComicScriptRaw(raw, [{ id: 'S1', text: '同一句台词' }, { id: 'S2', text: '同一句台词' }]);
    expect(motionComicScriptDraftSchema.safeParse(ambiguous).success).toBe(false);
  });

  it('requires real contiguous act assignments and preserves source order', () => {
    const base = script();
    const [firstBeat, secondBeat] = base.scenes[0].beats;
    const twoActs: MotionComicScriptDraft = {
      ...base,
      scenes: [
        { ...base.scenes[0], beats: [firstBeat] },
        {
          ...base.scenes[0],
          key: 'scene-reveal',
          actIndex: 2,
          actTitle: '未来署名揭示',
          actBoundaryReason: '信件署名把异常升级为来自未来的直接威胁。',
          title: '署名',
          summary: '阿青发现信来自十年后的自己。',
          beats: [secondBeat],
        },
      ],
    };
    expect(validateMotionComicScriptDraft(twoActs, splitMotionComicSource(sourceText), document())).toEqual([]);

    const jumped = structuredClone(twoActs);
    jumped.scenes[1].actIndex = 3;
    expect(validateMotionComicScriptDraft(jumped, splitMotionComicSource(sourceText), document())
      .some((issue) => issue.path === 'script.scenes[1].actIndex' && issue.message.includes('必须连续'))).toBe(true);

    const inconsistentTitle = structuredClone(twoActs);
    inconsistentTitle.scenes[1].actIndex = 1;
    expect(validateMotionComicScriptDraft(inconsistentTitle, splitMotionComicSource(sourceText), document())
      .some((issue) => issue.path === 'script.scenes[1].actTitle' && issue.message.includes('一致标题'))).toBe(true);

    const reversed = structuredClone(twoActs);
    reversed.scenes.reverse();
    expect(validateMotionComicScriptDraft(reversed, splitMotionComicSource(sourceText), document())
      .some((issue) => issue.path === 'script.scenes' && issue.message.includes('原文句段顺序'))).toBe(true);

    const missingReason = structuredClone(twoActs) as unknown as Record<string, any>;
    delete missingReason.scenes[0].actBoundaryReason;
    expect(motionComicScriptDraftSchema.safeParse(missingReason).success).toBe(false);
  });

  it('keeps ordered exactly-once beat claims and rejects dialogue that cannot fit', () => {
    const valid = storyboard().shots;
    expect(validateMotionComicStoryboard(script(), valid, 11)).toEqual([]);
    expect(validateMotionComicStoryboard(script(), [
      { ...valid[0], beatKeys: ['beat-open'] },
      { ...valid[1], beatKeys: ['beat-open'] },
    ], 11).some((issue) => issue.path === 'shots.beatKeys')).toBe(true);

    const longDialogue = script();
    longDialogue.scenes[0].beats[1] = { ...longDialogue.scenes[0].beats[1], text: '我终于明白这封信为什么会在十年后的今天重新回到我的手里，因为所有选择都从今晚开始。' };
    expect(validateMotionComicStoryboard(longDialogue, valid, 11).some((issue) => issue.path.endsWith('durationSec'))).toBe(true);
  });

  it('previews without mutation, appends by default, and only replaces an untouched starter explicitly', () => {
    const original = document();
    const draft = plan();
    expect(original.episodes).toHaveLength(1);
    expect(isUntouchedMotionComicStarter(original)).toBe(true);

    const appended = applyMotionComicPlan(original, draft, { episodeId: 'generated-episode' });
    expect(original.episodes).toHaveLength(1);
    expect(appended.episodes).toHaveLength(2);
    expect(appended.activeEpisodeId).toBe('generated-episode');
    expect(appended.episodes[1].planningEvidence?.sourceUnits).toEqual(splitMotionComicSource(sourceText));
    expect(appended.episodes[1].planningEvidence?.actAssignments).toEqual([{
      sceneId: 'generated-episode-scene-1',
      actIndex: 1,
      actTitle: '来信打破日常',
      actBoundaryReason: '本集从信件闯入日常生活开始，建立异常事件与主角目标。',
    }]);
    expect(appended.episodes[1].scenes[0]).toMatchObject({
      actIndex: 1,
      actTitle: '来信打破日常',
      actSource: 'ai-planned',
    });
    expect(appended.episodes[1].scenes[0].shots.every((shot) => shot.renderStrategy === 'remote-video')).toBe(true);
    expect(parseMotionComicPipelineData(appended)).toEqual(appended);

    const replaced = applyMotionComicPlan(original, draft, { episodeId: 'generated-first', replaceStarter: true });
    expect(replaced.episodes.map((episode) => episode.id)).toEqual(['generated-first']);
    expect(replaced.characters.map((character) => character.name)).toEqual(['阿青']);
    expect(replaced.sceneAssets.map((asset) => asset.label)).toEqual(['旧公寓']);

    const edited = structuredClone(original);
    edited.episodes[0].scenes[0].shots[0].title = '用户手工改过的镜头';
    expect(isUntouchedMotionComicStarter(edited)).toBe(false);
    expect(() => applyMotionComicPlan(edited, draft, { replaceStarter: true })).toThrow(/MOTION_COMIC_STARTER_CHANGED/u);
  });

  it('requires adjustment review before import and preserves the reviewed audit evidence', () => {
    const draft = plan();
    draft.adjustments = [{ path: 'script.characters[0].personality', kind: 'filled', before: '（缺失）', after: '性格沉稳' }];
    expect(() => applyMotionComicPlan(document(), draft, { episodeId: 'unreviewed' })).toThrow(/MOTION_COMIC_PLAN_REVIEW_REQUIRED/u);
    const applied = applyMotionComicPlan(document(), draft, { episodeId: 'reviewed', reviewedAdjustments: true, now });
    expect(applied.episodes[1].planningEvidence?.adjustments).toEqual(draft.adjustments);
    expect(applied.episodes[1].planningEvidence?.adjustmentsReviewedAt).toBe(now);
  });

  it('records local defaults and refuses to invent missing beat text or a dialogue speaker', () => {
    const raw = structuredClone(script()) as unknown as Record<string, any>;
    delete raw.characters[0].personality;
    delete raw.characters[0].looks[0].wardrobe;
    delete raw.scenes[0].beats[1].characterKey;
    const normalized = normalizeMotionComicScriptRaw(raw, splitMotionComicSource(sourceText));
    const adjustments = collectMotionComicPlanAdjustments(raw, normalized, 'script');
    expect(adjustments).toContainEqual(expect.objectContaining({ path: 'script.characters[0].personality', kind: 'filled', before: '（缺失）', after: '性格沉稳' }));
    expect(adjustments).toContainEqual(expect.objectContaining({ path: 'script.characters[0].looks[0].wardrobe', kind: 'filled', after: '日常服饰' }));
    expect((normalized as any).scenes[0].beats[1]).not.toHaveProperty('characterKey');

    const missingText = structuredClone(raw);
    delete missingText.scenes[0].beats[0].text;
    missingText.scenes[0].beats[0].narrativeGoal = '从窗口望向街道';
    expect(motionComicScriptDraftSchema.safeParse(normalizeMotionComicScriptRaw(missingText, splitMotionComicSource(sourceText))).success).toBe(false);
  });

  it('reports removed array items individually instead of hiding them in a truncated array diff', () => {
    const adjustments = collectMotionComicPlanAdjustments(
      [{ name: 'kept' }, { name: 'discarded' }], [{ name: 'kept' }], 'script.characters',
    );
    expect(adjustments).toEqual([expect.objectContaining({
      path: 'script.characters[1]', kind: 'normalized', before: '{"name":"discarded"}',
    })]);
    expect(collectMotionComicPlanAdjustments([1], [], 'storyboard.shots')).toHaveLength(1);
  });
  it('persists an invalid script draft with structured issues and repairs it without rerunning the script stage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-invalid-'));
    try {
      const invalid = structuredClone(script());
      invalid.scenes[0].beats[1] = { ...invalid.scenes[0].beats[1], kind: 'dialogue' };
      delete invalid.scenes[0].beats[1].characterKey;
      const run = vi.fn()
        .mockResolvedValueOnce({ json: invalid, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: null }] }, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: storyboard(), raw: '{}', requestId: null });
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'custom:https://example.test', protocol: 'openai' };

      const failed = await service.plan(input, document(), llm, config);
      expect(failed.status).toBe('script-invalid');
      if (failed.status !== 'script-invalid') throw new Error('expected invalid script response');
      expect(failed.failure.draft.scenes[0].beats[1].text).toBe('署名来自十年后的自己。');
      expect(failed.failure.issues.some((issue) => issue.code === 'DIALOGUE_SPEAKER_MISSING')).toBe(true);
      expect(run).toHaveBeenCalledTimes(2);

      const rediscovered = await service.plan(input, document(), llm, config);
      expect(rediscovered.status).toBe('script-invalid');
      expect(run).toHaveBeenCalledTimes(2);
      if (rediscovered.status !== 'script-invalid') throw new Error('expected saved invalid script');
      expect(rediscovered.failure.token).toBe(failed.failure.token);

      const repaired = await service.plan({ ...input, scriptDraft: script() }, document(), llm, config);
      expect(repaired.status).toBe('complete');
      expect(run).toHaveBeenCalledTimes(3);
      expect(run.mock.calls[2][0].name).toContain('storyboard');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers the storyboard after manual repair without including transient draft data in its binding', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-manual-resume-'));
    try {
      const invalid = structuredClone(script());
      delete (invalid.characters[0] as Partial<MotionComicScriptDraft['characters'][number]>).personality;
      invalid.scenes[0].beats[1].kind = 'dialogue';
      delete invalid.scenes[0].beats[1].characterKey;
      const run = vi.fn()
        .mockResolvedValueOnce({ json: invalid, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: { patches: [{ beatKey: 'beat-open', kind: 'dialogue', characterKey: null }] }, raw: '{}', requestId: null })
        .mockRejectedValueOnce(new Error('storyboard timed out'))
        .mockResolvedValueOnce({ json: storyboard(), raw: '{}', requestId: null });
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'custom:https://example.test', protocol: 'openai' };
      expect((await service.plan(input, document(), llm, config)).status).toBe('script-invalid');
      const failed = await service.plan({ ...input, scriptDraft: script() }, document(), llm, config);
      expect(failed.status).toBe('storyboard-failed');
      if (failed.status !== 'storyboard-failed') throw new Error('expected storyboard failure');
      const rediscovered = await service.plan(input, document(), llm, config);
      expect(rediscovered.status).toBe('storyboard-failed');
      expect(run).toHaveBeenCalledTimes(3);
      if (rediscovered.status !== 'storyboard-failed') throw new Error('expected stored checkpoint');
      expect(rediscovered.recovery.token).toBe(failed.recovery.token);
      await expect(service.plan({ ...input, resumeToken: failed.recovery.token, instructions: 'changed' }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      await expect(service.plan({ ...input, resumeToken: failed.recovery.token, scriptDraft: script() }, document(), llm, config)).rejects.toThrow('RECOVERY_INVALID');
      const resumed = await service.plan({ ...input, resumeToken: failed.recovery.token }, document(), llm, config);
      expect(resumed.status).toBe('complete');
      expect(run).toHaveBeenCalledTimes(4);
      expect(run.mock.calls[3][0].name).toContain('storyboard');
      if (resumed.status !== 'complete') throw new Error('expected complete');
      expect(resumed.result.plan.adjustments).toContainEqual(expect.objectContaining({
        path: 'script.characters[0].personality', kind: 'filled', before: '（缺失）',
      }));
      expect(resumed.result.plan.adjustments).toContainEqual(expect.objectContaining({
        path: 'script.scenes[0].beats[1].kind', kind: 'manual', before: 'dialogue', after: 'narration',
      }));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('rediscovers a still-invalid manual draft without generating a new script', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-manual-invalid-'));
    try {
      const invalid = structuredClone(script());
      invalid.scenes[0].beats[1].kind = 'dialogue';
      delete invalid.scenes[0].beats[1].characterKey;
      const run = vi.fn();
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'custom:https://example.test', protocol: 'openai' };
      expect((await service.plan({ ...input, scriptDraft: invalid }, document(), llm, config)).status).toBe('script-invalid');
      expect((await service.plan(input, document(), llm, config)).status).toBe('script-invalid');
      expect(run).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('persists a validated script checkpoint and resumes only the storyboard stage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-motion-comic-'));
    try {
      const invalidStoryboard = structuredClone(storyboard());
      invalidStoryboard.shots[0].beatKeys = ['beat-open'];
      const run = vi.fn()
        .mockResolvedValueOnce({ json: script(), raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: invalidStoryboard, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: invalidStoryboard, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: script(), raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: invalidStoryboard, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: invalidStoryboard, raw: '{}', requestId: null })
        .mockResolvedValueOnce({ json: storyboard(), raw: '{}', requestId: null });
      const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;
      const service = new MotionComicPlanningService(() => directory);
      const input = { id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11 };
      const config = { model: 'planner-model', providerScope: 'custom:https://example.test', protocol: 'openai' };

      const failed = await service.plan(input, document(), llm, config);
      expect(failed.status).toBe('storyboard-failed');
      if (failed.status !== 'storyboard-failed') throw new Error('expected storyboard failure');
      expect(run).toHaveBeenCalledTimes(3);

      const restartedService = new MotionComicPlanningService(() => directory);
      const discovered = await restartedService.plan(input, document(), llm, config);
      expect(discovered.status).toBe('storyboard-failed');
      expect(run).toHaveBeenCalledTimes(3);
      if (discovered.status !== 'storyboard-failed') throw new Error('expected saved recovery');
      expect(discovered.recovery.token).toBe(failed.recovery.token);

      const restarted = await restartedService.plan({ ...input, restart: true }, document(), llm, config);
      expect(restarted.status).toBe('storyboard-failed');
      expect(run).toHaveBeenCalledTimes(6);
      if (restarted.status !== 'storyboard-failed') throw new Error('expected a new script run to fail at storyboard');
      expect(restarted.recovery.token).not.toBe(discovered.recovery.token);
      await expect(restartedService.plan({ ...input, resumeToken: discovered.recovery.token }, document(), llm, config))
        .rejects.toThrow(/MOTION_COMIC_PLAN_RECOVERY_INVALID/u);
      expect(run).toHaveBeenCalledTimes(6);

      const changedInput = { ...input, instructions: '换一个故事方向' };
      await expect(restartedService.plan({ ...changedInput, resumeToken: restarted.recovery.token }, document(), llm, config))
        .rejects.toThrow(/MOTION_COMIC_PLAN_RECOVERY_INVALID/u);
      expect(run).toHaveBeenCalledTimes(6);

      const resumed = await restartedService.plan({ ...input, resumeToken: restarted.recovery.token }, document(), llm, config);
      expect(resumed.status).toBe('complete');
      expect(run).toHaveBeenCalledTimes(7);
      expect(run.mock.calls.slice(6).every(([request]) => request.name.includes('storyboard'))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('labels legacy acts as rule inferred and keeps manual boundary edits contiguous', () => {
    const original = document();
    const episodeId = original.activeEpisodeId;
    const legacy = structuredClone(original);
    legacy.episodes[0].scenes.forEach((scene) => {
      delete scene.actIndex;
      delete scene.actTitle;
      delete scene.actBoundaryReason;
      delete scene.actSource;
    });
    const resolved = legacy.episodes[0].scenes.map((scene, index) => resolveMotionComicSceneAct(scene, index, legacy.episodes[0].scenes.length));
    expect(resolved.map((act) => act.actIndex)).toEqual([1, 2, 3]);
    expect(resolved.every((act) => act.actSource === 'rule-inferred')).toBe(true);

    const merged = setMotionComicActBoundary(legacy, episodeId, legacy.episodes[0].scenes[1].id, false);
    expect(merged.episodes[0].scenes.map((scene) => scene.actIndex)).toEqual([1, 1, 2]);
    expect(merged.episodes[0].scenes.every((scene) => scene.actSource === 'manual')).toBe(true);
    const renamed = renameMotionComicAct(merged, episodeId, 1, '  异常建立  ');
    expect(renamed.episodes[0].scenes.slice(0, 2).every((scene) => scene.actTitle === '异常建立')).toBe(true);
    expect(() => renameMotionComicAct(merged, episodeId, 1, '   ')).toThrow('MOTION_COMIC_ACT_TITLE_REQUIRED');
    expect(() => renameMotionComicAct(merged, episodeId, 1, '幕'.repeat(513))).toThrow('MOTION_COMIC_ACT_TITLE_LIMIT');
  });

  it('links imported plans to stable source episodes and enforces episode order', () => {
    const imported = createMotionComicImportedProject(createMotionComicDraft({
      id: 'imported-planning-comic', title: '未来来信', premise: sourceText, now,
    }), {
      kind: 'script',
      adaptationMode: 'faithful-script',
      originalText: `${sourceText}\n\n第二集：她按信中线索前往旧车站。`,
      episodes: [
        { title: '第一集', sourceText },
        { title: '第二集', sourceText: '她按信中线索前往旧车站。' },
      ],
    }, now);
    const [firstSource, secondSource] = imported.sourceDocument!.episodes;

    expect(imported.characters).toEqual([]);
    expect(imported.sceneAssets).toEqual([]);
    expect(imported.episodes[0].scenes).toEqual([]);
    expect(imported.episodes[0].dialogueCues).toEqual([]);
    expect(isUntouchedMotionComicStarter(imported)).toBe(true);
    expect(parseMotionComicPipelineData(imported)).toEqual(imported);

    expect(nextUnplannedMotionComicSourceEpisodeId(imported)).toBe(firstSource.id);
    expect(() => applyMotionComicPlan(imported, plan(), {
      sourceEpisodeId: secondSource.id,
      episodeId: 'out-of-order',
    })).toThrow(/MOTION_COMIC_SOURCE_EPISODE_ORDER/u);

    const first = applyMotionComicPlan(imported, plan(), {
      sourceEpisodeId: firstSource.id,
      episodeId: 'generated-first',
      replaceStarter: true,
    });
    expect(first.episodes[0].planningEvidence?.sourceEpisodeId).toBe(firstSource.id);
    expect(first.episodes[0].scenes.every((scene) => scene.actIndex && scene.actTitle)).toBe(true);
    expect(nextUnplannedMotionComicSourceEpisodeId(first)).toBe(secondSource.id);
    expect(() => applyMotionComicPlan(first, plan(), {
      sourceEpisodeId: firstSource.id,
      episodeId: 'duplicate-first',
    })).toThrow(/MOTION_COMIC_SOURCE_EPISODE_PLANNED/u);
  });

  it('uses two stages and allows at most one deterministic repair across the whole plan', async () => {
    const invalidScript = { ...script(), scenes: [{ ...script().scenes[0], beats: [script().scenes[0].beats[0]] }] };
    const invalidStoryboard = { shots: [{ ...storyboard().shots[0], beatKeys: ['beat-open'] }] };
    const run = vi.fn()
      .mockResolvedValueOnce({ json: invalidScript, raw: '{}', requestId: null })
      .mockResolvedValueOnce({ json: script(), raw: '{}', requestId: null })
      .mockResolvedValueOnce({ json: invalidStoryboard, raw: '{}', requestId: null });
    const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;

    await expect(generateMotionComicPlan({
      id: 'planning-comic', expectedUpdatedAt: now, sourceText, targetDurationSec: 11,
    }, document(), llm, { model: 'planner-model', now })).rejects.toThrow(/MOTION_COMIC_PLAN_INVALID/u);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.every(([request]) => request.maxRetries === 0)).toBe(true);
  });

  it('handles and normalizes irregular scene beat schemas from LLM', () => {
    const rawWithIrregularBeats = {
      title: "测试漫剧",
      characters: [
        {
          name: "主角",
          role: "主角",
          archetype: "少年",
          visualSummary: "黑发少年",
          looks: [{ label: "日常造型", appearancePrompt: "黑发" }],
        },
      ],
      sceneAssets: [{ label: "树林", prompt: "密林" }],
      props: [],
      scenes: [
        {
          key: "scene-1",
          actIndex: 1,
          actTitle: "密林异响",
          actBoundaryReason: "少年进入密林后听见呼救，建立本集第一个异常阶段。",
          title: "密林相遇",
          locationKey: "scene-1",
          beats: [
            {
              narrativeGoal: "少年穿过树林",
              shots: [{ id: "shot-1" }],
              kind: "suspense",
            },
            {
              narrativeGoal: "突然听到呼救声",
              shots: [{ id: "shot-2" }],
              kind: "plot_point",
            },
          ],
        },
      ],
    };

    const normalized = normalizeMotionComicScriptRaw(rawWithIrregularBeats, splitMotionComicSource('少年穿过树林\n突然听到呼救声'));
    const parsed = motionComicScriptDraftSchema.safeParse(normalized);
    expect(parsed.success).toBe(false);
    expect((normalized as any).scenes[0].beats[0].text).toBeUndefined();
  });

  it('handles and sanitizes irregular LLM outputs (empty looks, name/environmentPrompt in sceneAssets)', () => {
    const irregularScript = {
      title: '测试剧本',
      logline: '测试对白整理与清洗',
      characters: [
        {
          key: 'char-1',
          name: '主角A',
          role: '主角',
          looks: [], // empty looks should be auto-filled
        },
        {
          key: 'char-2',
          name: '龙套B',
          // no looks provided at all
        }
      ],
      sceneAssets: [
        {
          name: '密室',
          environmentPrompt: '幽暗封闭密室',
          lightingPrompt: '顶部微弱射灯',
        }
      ],
      props: [],
      scenes: [
        {
          key: 'scene-1',
          actIndex: 1,
          actTitle: '密室初遇',
          actBoundaryReason: '陌生声音打破密室中的静止状态。',
          title: '第一幕',
          summary: '初遇',
          locationKey: 'scene-1',
          beats: [
            {
              key: 'beat-1',
              sourceUnitIds: ['unit-1'],
              kind: 'dialogue',
              text: '是谁在那里？',
              characterKey: 'char-1',
            }
          ]
        }
      ]
    };

    const normalized = normalizeMotionComicScriptRaw(irregularScript) as any;
    expect(normalized.characters[0].looks).toHaveLength(1);
    expect(normalized.characters[0].looks[0].appearancePrompt).toBeTruthy();
    expect(normalized.characters[1].looks).toHaveLength(1);
    expect(normalized.sceneAssets[0].label).toBe('密室');
    expect(normalized.sceneAssets[0].prompt).toContain('幽暗封闭密室');
    expect(normalized.sceneAssets[0].environmentPrompt).toBeUndefined();

    const parseResult = motionComicScriptDraftSchema.safeParse(normalized);
    expect(parseResult.success).toBe(true);
  });
  it("handles duplicate look labels, character names, and scene labels without throwing validation errors", () => {
    const duplicateData = {
      title: "重复命名测试剧本",
      logline: "测试重复名称自动去重消歧",
      characters: [
        {
          key: "char-1",
          name: "主角",
          role: "主角",
          looks: [
            { key: "look-1", label: "日常造型", appearancePrompt: "日常服装", wardrobe: "夹克", continuityNotes: "保持发型" },
            { key: "look-2", label: "日常造型", appearancePrompt: "另一套日常服装", wardrobe: "卫衣", continuityNotes: "保持发型" },
          ],
        },
        {
          key: "char-2",
          name: "主角",
          role: "配角",
          looks: [
            { key: "look-3", label: "日常造型", appearancePrompt: "配角便服", wardrobe: "衬衫", continuityNotes: "保持眼镜" },
          ],
        },
      ],
      sceneAssets: [
        { label: "藏书阁", prompt: "古风书阁", continuityNotes: "保持卷轴分布" },
        { label: "藏书阁", prompt: "书阁二层", continuityNotes: "保持木质色调" },
      ],
      props: [],
      scenes: [
        {
          key: "scene-1",
          actIndex: 1,
          actTitle: "藏书阁初遇",
          actBoundaryReason: "角色在藏书阁首次相遇并建立冲突。",
          title: "第一幕",
          summary: "初遇",
          locationKey: "loc-1",
          beats: [
            { key: "beat-1", sourceUnitIds: ["unit-1"], kind: "dialogue", text: "你好", characterKey: "char-1" },
          ],
        },
      ],
    };

    const normalized = normalizeMotionComicScriptRaw(duplicateData) as any;
    expect(normalized.characters[0].looks[0].label).toBe("日常造型");
    expect(normalized.characters[0].looks[1].label).toBe("日常造型 (2)");
    expect(normalized.characters[1].name).toBe("主角 (2)");
    expect(normalized.sceneAssets[0].label).toBe("藏书阁");
    expect(normalized.sceneAssets[1].label).toBe("藏书阁 (2)");

    const parseResult = motionComicScriptDraftSchema.safeParse(normalized);
    expect(parseResult.success).toBe(true);
  });
  it("automatically expands shot durationSec to match long dialogue", () => {
    const scriptDraft = {
      title: "长对白测试",
      logline: "测试对白自适应时长",
      characters: [
        {
          key: "char-1",
          name: "主角",
          role: "protagonist",
          description: "主角",
          looks: [
            {
              key: "look-1",
              label: "日常造型",
              appearancePrompt: "少年",
              wardrobe: "便服",
              continuityNotes: "无",
            },
          ],
        },
      ],
      sceneAssets: [
        {
          key: "loc-1",
          label: "房间",
          description: "房间",
          prompt: "室内场景",
          continuityNotes: "无",
        },
      ],
      props: [],
      scenes: [
        {
          key: "scene-1",
          title: "第1场",
          summary: "长对白场景",
          locationKey: "loc-1",
          beats: [
            {
              key: "beat-long",
              sourceUnitIds: ["unit-1"],
              kind: "dialogue",
              characterKey: "char-1",
              lookKey: "look-1",
              text: "这是一段非常非常长的对白台词，文字很多很多，足足有一百多个汉字，用来测试系统是否能够自动把镜头原本只有四秒或者七秒的时长，智能自适应调宽到足够念完全部台词的时长，避免因为语速过快或者时长不够而被校验逻辑拦截报错！",
            },
          ],
        },
      ],
    };

    const rawStoryboard = {
      shots: [
        {
          key: "shot-1",
          sceneKey: "scene-1",
          title: "长镜头",
          durationSec: 4, // 初始只有4秒
          prompt: "主角在说话",
          motionPrompt: "推近",
          framing: "特写",
          characterLookKeys: ["look-1"],
          propKeys: [],
          beatKeys: ["beat-long"],
          continuity: {
            startState: "入镜",
            endState: "出镜",
            screenDirection: "center",
            actionBeats: ["说话"],
          },
        },
      ],
    };

    const normalized = normalizeMotionComicStoryboardRaw(rawStoryboard, scriptDraft as any) as any;
    expect(normalized.shots[0].durationSec).toBeGreaterThan(15);
  });
});

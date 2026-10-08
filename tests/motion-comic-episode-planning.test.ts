import { describe, expect, it, vi } from 'vitest';
import type { ConfiguredJsonLlm, LlmJsonRequest } from '../src/shared/llm-provider';
import {
  buildMotionComicEpisodePlanningBatches,
  buildMotionComicEpisodeSourceUnits,
  fingerprintMotionComicEpisodeSource,
  materializeMotionComicEpisodePlan,
  normalizeMotionComicEpisodeSource,
  validateMotionComicEpisodeBoundaries,
  type MotionComicEpisodeBoundaryPlan,
} from '../src/shared/motion-comic-episode-planning';
import { generateMotionComicEpisodePlan } from '../src/shared/motion-comic-episode-planner';
import {
  createMotionComicDraft,
  createMotionComicImportedProject,
  motionComicCreateInputSchema,
  parseMotionComicPipelineData,
} from '../src/shared/motion-comic';

const now = '2026-09-24T01:00:00.000Z';

describe('motion comic episode planning', () => {
  it('builds stable units without dropping or rewriting canonical source text', () => {
    const source = `第1章 雨夜\r\n${'林夏沿着站台向前走。'.repeat(90)}\r\n\r\n第2章 广播\r\n${'广播提前说出她的动作。'.repeat(90)}`;
    const units = buildMotionComicEpisodeSourceUnits(source);

    expect(units.length).toBeGreaterThan(1);
    expect(units.map((unit) => unit.id)).toEqual(units.map((_, index) => `U${String(index + 1).padStart(4, '0')}`));
    expect(units.map((unit) => unit.text).join('')).toBe(normalizeMotionComicEpisodeSource(source));
    expect(buildMotionComicEpisodeSourceUnits(source)).toEqual(units);
    expect(fingerprintMotionComicEpisodeSource(source)).toBe(fingerprintMotionComicEpisodeSource(source.replace(/\r\n/gu, '\n')));
  });

  it('rejects gaps, overlaps, reverse ranges and unknown unit ids', () => {
    const units = [
      { id: 'U0001', index: 1, text: '开场。', characterCount: 3 },
      { id: 'U0002', index: 2, text: '升级。', characterCount: 3 },
      { id: 'U0003', index: 3, text: '钩子。', characterCount: 3 },
    ];
    const base = { title: '第一集', splitReason: '事件完成', continuityHook: '留下线索' };

    expect(validateMotionComicEpisodeBoundaries({ episodes: [
      { ...base, startUnitId: 'U0002', endUnitId: 'U0003' },
    ] }, units)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/遗漏/u) })]));

    expect(validateMotionComicEpisodeBoundaries({ episodes: [
      { ...base, startUnitId: 'U0001', endUnitId: 'U0002' },
      { ...base, title: '第二集', startUnitId: 'U0002', endUnitId: 'U0003' },
    ] }, units)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/重叠/u) })]));

    expect(validateMotionComicEpisodeBoundaries({ episodes: [
      { ...base, startUnitId: 'U0002', endUnitId: 'U0001' },
    ] }, units)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/不能早于/u) })]));

    expect(validateMotionComicEpisodeBoundaries({ episodes: [
      { ...base, startUnitId: 'U9999', endUnitId: 'U0003' },
    ] }, units)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/不存在/u) })]));
  });

  it('repairs one invalid model response and rebuilds episode text only from source units', async () => {
    const sourceText = Array.from({ length: 5 }, (_, index) => `段落${index + 1}：${'剧情推进。'.repeat(150)}`).join('\n\n');
    const units = buildMotionComicEpisodeSourceUnits(sourceText);
    const splitAt = Math.max(0, Math.floor(units.length / 2) - 1);
    const valid: MotionComicEpisodeBoundaryPlan = { episodes: [
      {
        title: '雨夜来信',
        startUnitId: units[0].id,
        endUnitId: units[splitAt].id,
        splitReason: '主角完成第一阶段目标并发现异常。',
        continuityHook: '异常广播把行动推向下一集。',
      },
      {
        title: '广播之后',
        startUnitId: units[splitAt + 1].id,
        endUnitId: units.at(-1)!.id,
        splitReason: '线索完成第二阶段升级。',
        continuityHook: '全篇收束。',
      },
    ] };
    const invalid = { episodes: [{ ...valid.episodes[0], startUnitId: units[1].id, sourceText: '模型改写正文' }] };
    const run = vi.fn()
      .mockResolvedValueOnce({ json: invalid, raw: '{}', requestId: null })
      .mockResolvedValueOnce({ json: valid, raw: '{}', requestId: null });
    const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;

    const result = await generateMotionComicEpisodePlan({
      sourceText,
      sourceKind: 'novel',
      adaptationMode: 'novel-adaptation',
      targetCharacters: Math.max(500, Math.round(sourceText.length / 2)),
      targetDurationSec: 90,
      instructions: '每集尾部保留悬念。',
    }, llm, { model: 'episode-planner-test', now, maxBatchCharacters: 100_000 });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.every((args) => (args[0] as LlmJsonRequest).maxRetries === 0)).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.episodes).toEqual(materializeMotionComicEpisodePlan(valid, units));
    expect(result.episodes.every((episode) => !('modelSourceText' in episode))).toBe(true);
    expect(result.evidence).toMatchObject({
      strategy: 'ai-story',
      model: 'episode-planner-test',
      repaired: true,
      sourceUnitCount: units.length,
      batchCount: 1,
    });
  });

  it('plans long input in ordered batches and validates the merged coverage', async () => {
    const sourceText = Array.from({ length: 12 }, (_, index) => `第${index + 1}段\n${`事件${index + 1}持续推进。`.repeat(110)}`).join('\n\n');
    const units = buildMotionComicEpisodeSourceUnits(sourceText);
    const batches = buildMotionComicEpisodePlanningBatches(units, 2_000);
    let call = 0;
    const run = vi.fn(async (request: LlmJsonRequest) => {
      const payload = JSON.parse(request.messages.at(-1)!.content) as { sourceUnits: Array<{ id: string }> };
      call += 1;
      return {
        json: { episodes: [{
          title: `长篇第 ${call} 集`,
          startUnitId: payload.sourceUnits[0].id,
          endUnitId: payload.sourceUnits.at(-1)!.id,
          splitReason: '当前批次事件形成完整阶段。',
          continuityHook: call === batches.length ? '全篇收束。' : '下一阶段继续升级。',
        }] },
        raw: '{}',
        requestId: null,
      };
    });
    const llm = { protocol: 'openai', run } as unknown as ConfiguredJsonLlm;

    const result = await generateMotionComicEpisodePlan({
      sourceText,
      sourceKind: 'script',
      adaptationMode: 'faithful-script',
      targetCharacters: 2_000,
    }, llm, { model: 'batch-test', now, maxBatchCharacters: 2_000 });

    expect(batches.length).toBeGreaterThan(1);
    expect(run).toHaveBeenCalledTimes(batches.length);
    expect(result.evidence.batchCount).toBe(batches.length);
    expect(result.episodes).toHaveLength(batches.length);
    expect(result.warnings[0]).toMatch(/分为 .* 批规划/u);
    expect(result.episodes.map((episode) => episode.sourceText).join('')).not.toContain('模型');
  });

  it('persists audited AI boundaries and rejects rewritten episode text', () => {
    const sourceText = `${'第一阶段推进。'.repeat(90)}\n\n${'第二阶段收束。'.repeat(90)}`;
    const units = buildMotionComicEpisodeSourceUnits(sourceText);
    const boundaryPlan: MotionComicEpisodeBoundaryPlan = { episodes: [{
      title: '完整一集',
      startUnitId: units[0].id,
      endUnitId: units.at(-1)!.id,
      splitReason: '事件在末尾完成闭环。',
      continuityHook: '全篇收束。',
    }] };
    const episodes = materializeMotionComicEpisodePlan(boundaryPlan, units);
    const source = {
      kind: 'novel' as const,
      adaptationMode: 'novel-adaptation' as const,
      originalText: normalizeMotionComicEpisodeSource(sourceText),
      episodes,
      splitEvidence: {
        version: 1 as const,
        unitizationVersion: 1 as const,
        strategy: 'ai-story' as const,
        sourceFingerprint: fingerprintMotionComicEpisodeSource(sourceText),
        targetCharacters: 2_400,
        model: 'persist-test',
        createdAt: now,
        sourceUnitCount: units.length,
        batchCount: 1,
      },
    };
    const parsedInput = motionComicCreateInputSchema.parse({ title: '边界档案', premise: '测试', source });
    const draft = createMotionComicDraft({ id: 'episode-boundary-project', title: '边界档案', premise: '测试', now });
    const project = createMotionComicImportedProject(draft, parsedInput.source!, now);

    expect(parseMotionComicPipelineData(project).sourceDocument?.episodes[0]).toMatchObject({
      startUnitId: units[0].id,
      endUnitId: units.at(-1)!.id,
      splitReason: '事件在末尾完成闭环。',
    });

    const rewritten = structuredClone(project);
    rewritten.sourceDocument!.episodes[0].sourceText = '模型擅自改写的正文';
    expect(() => parseMotionComicPipelineData(rewritten)).toThrow(/正文与原文边界不一致/u);
  });
});

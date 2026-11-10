import { describe, expect, it } from 'vitest';
import {
  compactImageBudgetPolicy,
  describeImageBudget,
  estimateHtmlVideoImageCalls,
  htmlVideoCoverReusesScene,
  htmlVideoForegroundEnabled,
  imageBudgetFromControl,
  isDefaultImageBudget,
  normalizeImageBudgetPolicy,
  parseImageBudgetPolicy,
  planHtmlVideoImageBudget,
  planImageBudget,
  planTemplateImageBudget,
  sameImageBudget,
  type ImageBudgetPolicy,
  type ImageBudgetSlot,
} from '@shared/image-budget';

const scenes = (count: number): ImageBudgetSlot[] =>
  Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, scene: index + 1, kind: 'scene' as const }));
const elements = (sceneCount: number): ImageBudgetSlot[] =>
  Array.from({ length: sceneCount }, (_, index) => ({ id: `e${index + 1}`, scene: index + 1, kind: 'element' as const }));
const cover: ImageBudgetSlot = { id: 'cover', scene: Number.MAX_SAFE_INTEGER, kind: 'cover' };
const ids = (slots: readonly ImageBudgetSlot[]) => slots.map((slot) => slot.id);
const reuseMap = (plan: ReturnType<typeof planImageBudget>) => Object.fromEntries(plan.reuse.map((entry) => [entry.slot.id, entry.from.id]));

describe('image budget policy parsing', () => {
  it('parses valid policies strictly and rejects invalid ones', () => {
    expect(parseImageBudgetPolicy({ mode: 'economy' })).toEqual({ mode: 'economy' });
    expect(parseImageBudgetPolicy({ mode: 'minimal', maxImages: 100, shareEvery: 10 })).toEqual({ mode: 'minimal', maxImages: 100, shareEvery: 10 });
    for (const invalid of [
      null, [], 'economy', {}, { mode: 'cheap' }, { mode: 'standard', maxImages: 0 }, { mode: 'standard', maxImages: 101 },
      { mode: 'standard', maxImages: 2.5 }, { mode: 'minimal', shareEvery: 1 }, { mode: 'minimal', shareEvery: 11 }, { mode: 'economy', extra: true },
    ]) {
      expect(() => parseImageBudgetPolicy(invalid), JSON.stringify(invalid)).toThrow();
      expect(normalizeImageBudgetPolicy(invalid)).toBeUndefined();
    }
  });

  it('treats absent and uncapped standard as the default and never persists it', () => {
    expect(isDefaultImageBudget(undefined)).toBe(true);
    expect(isDefaultImageBudget({ mode: 'standard' })).toBe(true);
    expect(isDefaultImageBudget({ mode: 'standard', maxImages: 5 })).toBe(false);
    expect(isDefaultImageBudget({ mode: 'economy' })).toBe(false);
    expect(compactImageBudgetPolicy({ mode: 'standard' })).toBeUndefined();
    expect(compactImageBudgetPolicy({ mode: 'minimal', maxImages: 3 })).toEqual({ mode: 'minimal', maxImages: 3 });
    expect(sameImageBudget(undefined, { mode: 'standard' })).toBe(true);
    expect(sameImageBudget({ mode: 'economy', maxImages: 4 }, { maxImages: 4, mode: 'economy' })).toBe(true);
    expect(sameImageBudget({ mode: 'economy' }, { mode: 'minimal' })).toBe(false);
  });

  it('builds the policy from the UI control (blank or out-of-range cap = no cap)', () => {
    expect(imageBudgetFromControl('standard', '')).toBeUndefined();
    expect(imageBudgetFromControl('standard', '6')).toEqual({ mode: 'standard', maxImages: 6 });
    expect(imageBudgetFromControl('economy', ' ')).toEqual({ mode: 'economy' });
    expect(imageBudgetFromControl('minimal', '0')).toEqual({ mode: 'minimal' });
    expect(imageBudgetFromControl('minimal', '101')).toEqual({ mode: 'minimal' });
    expect(imageBudgetFromControl('minimal', '2.5')).toEqual({ mode: 'minimal' });
    expect(describeImageBudget(undefined)).toBe('标准');
    expect(describeImageBudget({ mode: 'minimal', maxImages: 4 })).toBe('极省（每 3 个分镜共用 1 张） · 最多 4 张');
  });
});

describe('planImageBudget', () => {
  it('standard (absent policy) generates every slot', () => {
    const slots = [...scenes(4), ...elements(4), cover];
    for (const policy of [undefined, null, { mode: 'standard' } as ImageBudgetPolicy]) {
      const plan = planImageBudget(slots, policy);
      expect(ids(plan.generate)).toEqual(ids(slots));
      expect(plan.reuse).toEqual([]);
      expect(plan.omit).toEqual([]);
      expect(plan.expectedCalls).toBe(9);
    }
  });

  it('economy: one image per scene, foreground omitted, cover reuses the first scene', () => {
    const plan = planImageBudget([...scenes(4), ...elements(4), cover], { mode: 'economy' });
    expect(ids(plan.generate)).toEqual(['s1', 's2', 's3', 's4']);
    expect(ids(plan.omit)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(reuseMap(plan)).toEqual({ cover: 's1' });
    expect(plan.expectedCalls).toBe(4);
  });

  it('minimal: one image per group of shareEvery scenes (default 3)', () => {
    const plan = planImageBudget([...scenes(7), cover], { mode: 'minimal' });
    expect(ids(plan.generate)).toEqual(['s1', 's4', 's7']);
    expect(reuseMap(plan)).toEqual({ s2: 's1', s3: 's1', s5: 's4', s6: 's4', cover: 's1' });
    expect(plan.expectedCalls).toBe(3);

    const pairs = planImageBudget(scenes(5), { mode: 'minimal', shareEvery: 2 });
    expect(ids(pairs.generate)).toEqual(['s1', 's3', 's5']);
    expect(reuseMap(pairs)).toEqual({ s2: 's1', s4: 's3' });
  });

  it('maxImages picks evenly spaced scenes and reuses the nearest one (ties go earlier)', () => {
    const plan = planImageBudget(scenes(10), { mode: 'economy', maxImages: 4 });
    // round(i * 9 / 3) → positions 0, 3, 6, 9
    expect(ids(plan.generate)).toEqual(['s1', 's4', 's7', 's10']);
    expect(reuseMap(plan)).toEqual({ s2: 's1', s3: 's4', s5: 's4', s6: 's7', s8: 's7', s9: 's10' });
    expect(plan.expectedCalls).toBe(4);

    const tie = planImageBudget(scenes(3), { mode: 'economy', maxImages: 2 });
    expect(ids(tie.generate)).toEqual(['s1', 's3']);
    expect(reuseMap(tie)).toEqual({ s2: 's1' });

    const single = planImageBudget([...scenes(5), cover], { mode: 'standard', maxImages: 1 });
    expect(ids(single.generate)).toEqual(['s1']);
    expect(reuseMap(single)).toEqual({ s2: 's1', s3: 's1', s4: 's1', s5: 's1', cover: 's1' });
  });

  it('maxImages applies to minimal groups too', () => {
    const plan = planImageBudget(scenes(12), { mode: 'minimal', shareEvery: 2, maxImages: 3 });
    // 6 group leaders (positions 0,2,4,6,8,10) → round(i*5/2) = leaders 0, 3, 5 → positions 0, 6, 10
    expect(ids(plan.generate)).toEqual(['s1', 's7', 's11']);
    expect(plan.expectedCalls).toBe(3);
    expect(plan.reuse).toHaveLength(9);
    // a whole group follows its leader; group s9/s10 is equidistant from s7 and s11 → earlier (s7)
    expect(reuseMap(plan)).toEqual({ s2: 's1', s3: 's1', s4: 's1', s5: 's7', s6: 's7', s8: 's7', s9: 's7', s10: 's7', s12: 's11' });
  });

  it('standard with a cap keeps the foreground only when all of it fits, then the cover', () => {
    const slots = [...scenes(3), ...elements(3), cover];
    const fits = planImageBudget(slots, { mode: 'standard', maxImages: 7 });
    expect(fits.expectedCalls).toBe(7);
    expect(fits.omit).toEqual([]);

    const noCover = planImageBudget(slots, { mode: 'standard', maxImages: 6 });
    expect(ids(noCover.generate)).toEqual(['s1', 's2', 's3', 'e1', 'e2', 'e3']);
    expect(reuseMap(noCover)).toEqual({ cover: 's1' });

    const noForeground = planImageBudget(slots, { mode: 'standard', maxImages: 5 });
    expect(ids(noForeground.generate)).toEqual(['s1', 's2', 's3', 'cover']);
    expect(ids(noForeground.omit)).toEqual(['e1', 'e2', 'e3']);
  });

  it('never exceeds the cap and covers every non-omitted slot exactly once', () => {
    for (const mode of ['standard', 'economy', 'minimal'] as const) {
      for (let sceneCount = 0; sceneCount <= 13; sceneCount += 1) {
        for (const maxImages of [undefined, 1, 2, 3, 5, 8, 100]) {
          for (const withCover of [false, true]) {
            const slots = [...scenes(sceneCount), ...elements(sceneCount), ...(withCover ? [cover] : [])];
            const plan = planImageBudget(slots, { mode, ...(maxImages ? { maxImages } : {}) });
            const label = `${mode}/${sceneCount}/${maxImages}/${withCover}`;
            if (maxImages !== undefined) expect(plan.expectedCalls, label).toBeLessThanOrEqual(maxImages);
            expect(plan.expectedCalls, label).toBe(plan.generate.length);
            expect(plan.generate.length + plan.reuse.length + plan.omit.length, label).toBe(slots.length);
            const generated = new Set(plan.generate);
            for (const entry of plan.reuse) expect(generated.has(entry.from), label).toBe(true);
            expect(plan.omit.every((slot) => slot.kind === 'element'), label).toBe(true);
            if (sceneCount > 0) expect(plan.generate.some((slot) => slot.kind === 'scene'), label).toBe(true);
            // deterministic
            expect(planImageBudget(slots, { mode, ...(maxImages ? { maxImages } : {}) }), label).toEqual(plan);
          }
        }
      }
    }
  });

  it('a cover alone (no scenes) is generated', () => {
    expect(planImageBudget([cover], { mode: 'economy' }).expectedCalls).toBe(1);
    expect(planImageBudget([], { mode: 'minimal', maxImages: 1 }).expectedCalls).toBe(0);
  });
});

describe('route helpers', () => {
  const htmlScenes = [
    { index: 1, elements: [{ slot: 0 }] },
    { index: 2, elements: [{ slot: 0 }, { slot: 1 }] },
    { index: 3, elements: [] },
  ];

  it('HTML: slots follow bg / fg / cover and the foreground switch', () => {
    const standard = planHtmlVideoImageBudget(htmlScenes, { coverImageMode: 'auto' });
    expect(ids(standard.generate)).toEqual(['bg:1', 'fg:1:0', 'bg:2', 'fg:2:0', 'fg:2:1', 'bg:3', 'cover']);
    expect(planHtmlVideoImageBudget(htmlScenes, { foreground: false }).expectedCalls).toBe(3);
    expect(planHtmlVideoImageBudget(htmlScenes, { coverImageMode: 'auto' }, { includeCover: false }).expectedCalls).toBe(6);

    const minimal = planHtmlVideoImageBudget(htmlScenes, { coverImageMode: 'auto', imageBudget: { mode: 'minimal', shareEvery: 2 } });
    expect(ids(minimal.generate)).toEqual(['bg:1', 'bg:3']);
    expect(ids(minimal.omit)).toEqual(['fg:1:0', 'fg:2:0', 'fg:2:1']);
    expect(reuseMap(minimal)).toEqual({ 'bg:2': 'bg:1', cover: 'bg:1' });

    expect(htmlVideoForegroundEnabled(htmlScenes, {})).toBe(true);
    expect(htmlVideoForegroundEnabled(htmlScenes, { foreground: false })).toBe(false);
    expect(htmlVideoForegroundEnabled(htmlScenes, { imageBudget: { mode: 'economy' } })).toBe(false);
    expect(htmlVideoForegroundEnabled(htmlScenes, { imageBudget: { mode: 'standard', maxImages: 6 } })).toBe(true);
    expect(htmlVideoCoverReusesScene(htmlScenes, { coverImageMode: 'auto' })).toBe(false);
    expect(htmlVideoCoverReusesScene(htmlScenes, { coverImageMode: 'auto', imageBudget: { mode: 'economy' } })).toBe(true);
    expect(htmlVideoCoverReusesScene(htmlScenes, { coverImageMode: 'off', imageBudget: { mode: 'economy' } })).toBe(false);
  });

  it('HTML create-form estimate assumes one foreground element per scene', () => {
    expect(estimateHtmlVideoImageCalls(6, { coverImageMode: 'auto' })).toBe(13);
    expect(estimateHtmlVideoImageCalls(6, { foreground: false })).toBe(6);
    expect(estimateHtmlVideoImageCalls(6, { coverImageMode: 'auto', imageBudget: { mode: 'economy' } })).toBe(6);
    expect(estimateHtmlVideoImageCalls(6, { coverImageMode: 'auto', imageBudget: { mode: 'minimal' } })).toBe(2);
    expect(estimateHtmlVideoImageCalls(6, { imageBudget: { mode: 'standard', maxImages: 4 } })).toBe(4);
  });

  it('template: scene ids plus optional cover', () => {
    expect(planTemplateImageBudget([1, 2, 3, 4], { cover: true }).expectedCalls).toBe(5);
    const minimal = planTemplateImageBudget([1, 2, 3, 4], { cover: true, policy: { mode: 'minimal' } });
    expect(minimal.generate.map((slot) => slot.sceneId)).toEqual([1, 4]);
    expect(minimal.reuse.map((entry) => [entry.slot.sceneId, entry.from.sceneId])).toEqual([[2, 1], [3, 1], [0, 1]]);
  });
});

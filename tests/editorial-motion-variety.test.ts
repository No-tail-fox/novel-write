import { describe, expect, it } from 'vitest';
import { createEditorialMotionLayers, EDITORIAL_MOTION_STYLE_IDS, editorialComparisonSubjects, editorialMotionDescription, recomposeEditorialMotionLayers, selectEditorialMotionStyle, type EditorialMotionLayerInput, type EditorialMotionStyle } from '../src/shared/editorial-motion';

const input: EditorialMotionLayerInput = { shotId: 'shot', title: '咖啡馆改变城市', narration: '咖啡馆改变城市的生活', durationMs: 6000, ratio: '16:9', index: 0 };
const make = (motionStyle: EditorialMotionStyle, overrides: Partial<EditorialMotionLayerInput> = {}) => createEditorialMotionLayers({ ...input, motionStyle, ...overrides });

describe('editorial motion compositions', () => {
  it('chooses compositions from concrete comparisons, evidence and process language, with sequence variety otherwise', () => {
    expect(selectEditorialMotionStyle({ ...input, narration: '过去人们依靠马车，如今人们搭乘火车。' })).toBe('comparison');
    expect(selectEditorialMotionStyle({ ...input, narration: '调查记录了街道的变化。' })).toBe('evidence-stack');
    expect(selectEditorialMotionStyle({ ...input, narration: '报纸随后传入各地的咖啡馆。' })).toBe('path-progress');
    expect(selectEditorialMotionStyle({ ...input, narration: '关键是这些咖啡馆的公共空间。' })).toBe('focus-reveal');
    expect(new Set([0, 1, 2, 3].map((index) => selectEditorialMotionStyle({ ...input, index }))).size).toBe(4);
    expect(selectEditorialMotionStyle({ ...input, narration: '调查显示变化', motionStyle: 'focus-reveal' })).toBe('focus-reveal');
  });

  it('has five distinct trajectories and compositions rather than mirrored slide directions', () => {
    const subjects = EDITORIAL_MOTION_STYLE_IDS.map((style) => make(style).find((layer) => layer.id === 'shot-subject')!);
    expect(new Set(subjects.map((layer) => JSON.stringify({ width: layer.width, height: layer.height, motion: layer.motion }))).size).toBe(5);
    const [slide, reveal, evidence, path, compare] = subjects;
    expect(Math.abs(slide.motion[0].x - slide.motion[3].x)).toBeGreaterThan(0.8);
    expect(new Set(reveal.motion.map((frame) => frame.x)).size).toBe(1);
    expect(reveal.motion[0].scale).toBeLessThan(0.2);
    expect(Math.min(...evidence.motion.map((frame) => frame.y))).toBeLessThan(0);
    expect(new Set(path.motion.map((frame) => frame.x)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(path.motion.map((frame) => frame.y)).size).toBeGreaterThanOrEqual(3);
    expect(compare.motion.some((frame) => frame.scale > 1)).toBe(true);
    expect(EDITORIAL_MOTION_STYLE_IDS.every((style) => editorialMotionDescription(style).length > 15)).toBe(true);
  });

  it('keeps one independent background and actual title, valid timed frames and transparency prompts in every ratio', () => {
    for (const ratio of ['9:16', '16:9', '1:1', '4:3']) for (const style of EDITORIAL_MOTION_STYLE_IDS) {
      const layers = make(style, { ratio });
      expect(layers).toHaveLength(3);
      expect(layers.filter((layer) => layer.kind === 'background')).toHaveLength(1);
      expect(layers.find((layer) => layer.id === 'shot-label')!.content?.text).toBe(input.title);
      for (const layer of layers) {
        expect(layer.required).toBe(true);
        expect(layer.motion[0].atMs).toBe(0);
        expect(layer.motion.at(-1)!.atMs).toBe(6000);
        expect(layer.motion.every((frame, index) => index === 0 || frame.atMs >= layer.motion[index - 1].atMs)).toBe(true);
        expect(layer.motion.every((frame) => frame.scale > 0 && frame.opacity >= 0 && frame.opacity <= 1)).toBe(true);
        if (['subject', 'archival'].includes(layer.kind)) expect(layer.prompt).toContain('Solid pure green');
      }
    }
  });

  it('compares only stated subjects, with separately generated artwork and synchronized native labels', () => {
    const narration = '过去人们乘坐马车，如今人们搭乘火车。';
    expect(editorialComparisonSubjects(narration)).toEqual(['人们乘坐马车', '人们搭乘火车']);
    expect(editorialComparisonSubjects('红茶与绿茶的区别')).toEqual(['红茶', '绿茶']);
    expect(editorialComparisonSubjects('看似普通，但其实不然。')).toBeUndefined();
    const layers = make('comparison', { narration });
    const actors = layers.filter((layer) => ['subject', 'archival'].includes(layer.kind));
    expect(layers).toHaveLength(6);
    expect(layers.filter((layer) => layer.source === 'generated-image')).toHaveLength(3);
    expect(actors[0].prompt).toContain('人们乘坐马车');
    expect(actors[0].prompt).not.toContain('火车');
    expect(actors[1].prompt).toContain('人们搭乘火车');
    expect(actors[1].prompt).not.toContain('马车');
    expect(actors[1].motion.find((frame) => frame.opacity > 0)!.atMs).toBeGreaterThan(actors[0].motion.find((frame) => frame.opacity > 0)!.atMs);
    expect(layers.filter((layer) => layer.content).map((layer) => layer.content!.text)).toEqual([input.title, '人们乘坐马车', '人们搭乘火车']);
    // An explicit split composition without a pair never invents or duplicates an object.
    expect(make('comparison').filter((layer) => layer.source === 'generated-image')).toHaveLength(2);
  });

  it('stacks concrete evidence excerpts in order with independent prompts', () => {
    const layers = make('evidence-stack', { narration: '报纸记录咖啡馆的开张。档案保存街道的照片。' });
    const actors = layers.filter((layer) => layer.kind === 'archival');
    expect(actors).toHaveLength(2);
    expect(layers.filter((layer) => layer.source === 'generated-image')).toHaveLength(3);
    expect(actors[0].prompt).toContain('报纸记录咖啡馆的开张');
    expect(actors[0].prompt).not.toContain('档案');
    expect(actors[1].prompt).toContain('档案保存街道的照片');
    expect(actors[0].motion.find((frame) => frame.scale === 0.64)!.atMs).toBeLessThan(actors[1].motion.find((frame) => frame.opacity === 1)!.atMs);
  });

  it('retains artwork, custom prompts, extra layers and prior comparison media when changing choreography', () => {
    const narration = '过去人们乘坐马车，如今人们搭乘火车。';
    const layers = make('comparison', { narration });
    for (const layer of layers.filter((item) => !item.content)) layer.assetVersionId = `${layer.id}-asset`;
    layers[1].prompt = 'A custom user-owned horse carriage cutout';
    layers[0].visible = false;
    const focus = recomposeEditorialMotionLayers(layers, { ...input, narration, motionStyle: 'focus-reveal', title: '交通工具的改变' });
    expect(focus.find((layer) => layer.id === 'shot-subject')!.assetVersionId).toBe('shot-subject-asset');
    expect(focus.find((layer) => layer.id === 'shot-subject')!.prompt).toBe('A custom user-owned horse carriage cutout');
    expect(focus.find((layer) => layer.id === 'shot-background')!.visible).toBe(false);
    expect(focus.find((layer) => layer.id === 'shot-label')!.content?.text).toBe('交通工具的改变');
    expect(focus.find((layer) => layer.id === 'shot-subject-secondary')).toMatchObject({ assetVersionId: 'shot-subject-secondary-asset', visible: false, required: false });
    const comparison = recomposeEditorialMotionLayers(focus, { ...input, narration, motionStyle: 'comparison' });
    expect(comparison).toHaveLength(6);
    expect(comparison.find((layer) => layer.id === 'shot-subject-secondary')).toMatchObject({ assetVersionId: 'shot-subject-secondary-asset', visible: true, required: true });
    const extra = { ...layers[1], id: 'authored-decoration', required: false };
    expect(recomposeEditorialMotionLayers([...make('cutout-slide'), extra], { ...input, motionStyle: 'focus-reveal' })).toContainEqual(extra);
  });
});

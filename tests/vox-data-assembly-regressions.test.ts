import { describe, expect, it } from 'vitest';
import { applyCreativeStyleToDocument } from '../src/shared/creative-animation/assemble';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { createVoxAnimation, VOX_DATA_VALUE_MAX, voxAnimationSchema, voxDataValueSchema, voxItemSchema } from '../src/shared/vox-animation';
import { formatVoxDataValue, voxBarGeometry } from '../src/shared/vox-data-chart';
import { voxProductionInputErrors, voxProductionSettings, voxProductionSettingsSchema } from '../src/shared/vox-production';

function fixture() {
  const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'data-regression', title: '真实数据', ratio: '16:9' }), '第一组数据。第二组数据。', '2026-10-24T00:00:00.000Z', 15000);
  const settings = { ...voxProductionSettings('data-map'), narration: false, authoring: { mode: 'template' as const, styleId: 'dataviz' }, data: [{ label: 'A', value: -2e12, source: 'source' }, { label: 'B', value: 2e12, source: 'source' }] };
  return { document, settings };
}

describe('data settings and local style assembly regressions', () => {
  it('assembles and reopens sourced values above the former trillion limit without changing them', () => {
    const { document, settings } = fixture();
    const parsed = voxProductionSettingsSchema.parse(settings);
    expect(voxProductionInputErrors(document, parsed)).toEqual([]);
    const result = applyCreativeStyleToDocument(document, parsed);
    const reopened = parseEditorialCollagePipelineData(JSON.stringify(result));
    for (const shot of reopened.beats.flatMap(beat => beat.shots)) {
      expect(shot.animation!.template.props.items.map(item => item.value)).toEqual([-2e12, 2e12]);
      expect(voxBarGeometry(2e12, [-2e12, 2e12])).toEqual({ zero: 50, left: 50, width: 50 });
      expect(formatVoxDataValue(shot.animation!.template.props.items[1].value)).toBe('2,000,000,000,000');
    }
  });

  it('accepts chart-safe extremes consistently and rejects finite values that overflow chart arithmetic', () => {
    const { settings } = fixture();
    for (const value of [-VOX_DATA_VALUE_MAX, VOX_DATA_VALUE_MAX]) {
      expect(voxItemSchema.parse({ label: 'extreme', value }).value).toBe(value);
      expect(voxProductionSettingsSchema.parse({ ...settings, data: [{ label: 'extreme', value, source: 'source' }] }).data[0].value).toBe(value);
      expect(Object.values(voxBarGeometry(value, [-VOX_DATA_VALUE_MAX, VOX_DATA_VALUE_MAX])).every(Number.isFinite)).toBe(true);
    }
    const total = Array.from({ length: 24 }, () => voxDataValueSchema.parse(VOX_DATA_VALUE_MAX)).reduce((sum, value) => sum + value, 0);
    expect(Number.isFinite(total)).toBe(true);
    expect(VOX_DATA_VALUE_MAX / total).toBeCloseTo(1 / 24);
    expect(Number.isFinite(VOX_DATA_VALUE_MAX - -VOX_DATA_VALUE_MAX)).toBe(true);
    for (const value of [-Number.MAX_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
      expect(voxItemSchema.safeParse({ label: 'unsafe', value }).success).toBe(false);
      expect(voxProductionSettingsSchema.safeParse({ ...settings, data: [{ label: 'unsafe', value, source: 'source' }] }).success).toBe(false);
    }
  });

  it('preserves a locked source and its narration continuation and reveals the first editable chart', () => {
    const { document, settings } = fixture();
    const beat = document.beats[0], source = beat.shots[0];
    source.animation = createVoxAnimation('保留原镜头');
    source.animation.template.props.accent = '#123456';
    const continuation = { ...source, id: 'continuation', narrationSplit: { sourceShotId: source.id, sourceStartMs: 1000, sourceDurationMs: source.durationMs } };
    const editable = { ...source, id: 'editable' };
    beat.shots = [source, continuation, editable];
    document.beats = [beat];
    settings.lockedShotIds = [source.id];
    const before = structuredClone([source, continuation]);
    const result = applyCreativeStyleToDocument(document, settings);
    expect(result.beats[0].shots.slice(0, 2)).toEqual(before);
    expect(result.beats[0].shots[2].animation!.template.props.dataPresentation?.reveal).toBe(true);
    expect(result.beats[0].shots[2].animation!.template.id).toBe('data-bars');
  });

  it('persists explicit template rendering ownership with creative styling', () => {
    const animation = createVoxAnimation('保留模板');
    animation.creativeStyle = { styleId: 'dataviz', rendererRevision: 1, upstreamRevision: 'test', source: 'local', composition: 'template' };
    expect(voxAnimationSchema.parse(JSON.parse(JSON.stringify(animation))).creativeStyle?.composition).toBe('template');
  });
});

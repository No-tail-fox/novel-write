import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDraftTemplate } from '@shared/draft-template-contract';
import { draftImageFitLabel, draftImageFitOptions, draftTemplates, normalizeDraftTemplate } from '@shared/templates';
import { draftImageFrameRect, draftImageMediaRect } from '../src/features/templates/DraftCanvas';

describe('draft image display mode', () => {
  it('presents crop and full-image modes with clear Chinese labels', async () => {
    expect(draftImageFitOptions).toEqual([
      { value: 'cover', label: '裁切填满' },
      { value: 'contain', label: '完整缩放' },
    ]);
    expect(draftImageFitLabel('cover')).toBe('裁切填满');
    expect(draftImageFitLabel('contain')).toBe('完整缩放');

    const source = await readFile(new URL('../src/features/templates/DraftTemplatesPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('label="图片显示"');
    expect(source).toContain('labels={draftImageFitOptions.map((option) => option.label)}');
    expect(source).toContain('label="编辑对象"');
    expect(source).toContain("['展示框', '实际图片']");
    expect(source).toContain('label="图片缩放"');
    expect(source).not.toContain('label="裁切位置"');
    expect(source).toContain('draftImageFitLabel(template.image.fit)');
    expect(source).not.toContain('label="适配" value={draft.image.fit}');
  });

  it('keeps crop as the backward-compatible default and preserves full-image mode', () => {
    expect(draftTemplates.every((template) => template.image.fit === 'cover')).toBe(true);

    const template = structuredClone(draftTemplates[1]);
    template.image.fit = 'contain';
    expect(normalizeDraftTemplate(template).image.fit).toBe('contain');
    expect(parseDraftTemplate(template).image.fit).toBe('contain');
  });

  it('defaults legacy templates to a full-frame centered image transform', () => {
    const legacy = structuredClone(draftTemplates[0]) as any;
    delete legacy.image.focusX;
    delete legacy.image.focusY;
    delete legacy.image.left;
    delete legacy.image.width;
    delete legacy.image.mediaScale;
    const parsed = parseDraftTemplate(legacy);
    expect(parsed.image).toMatchObject({ focusX: 0.5, focusY: 0.5, left: 0, width: 1, mediaScale: 1 });
    expect(draftImageFrameRect(parsed)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(draftImageMediaRect(parsed)).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });

  it('passes the selected mode to Jianying max-scale or min-scale layout', async () => {
    const source = await readFile(new URL('../src/shared/jianying-bridge.ts', import.meta.url), 'utf8');
    expect(source).toContain('max(scale_x, scale_y) * clamp_number(image_area.get("mediaScale"), 1, 0.1, 8)');
    expect(source).toContain('(visible_width - area_width_px) * (0.5 - focus_x)');
    expect(source).toContain('area_left * 2 + area_width - 1 + focus_shift_x * 2 / canvas_width');
    expect(source).toContain('if image_layout["use_mask"]');
  });
});

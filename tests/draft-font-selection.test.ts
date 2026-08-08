import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDraftTemplate } from '@shared/draft-template-contract';
import {
  draftFontCssFamily,
  draftFontFamilies,
  draftFontGroups,
  draftFontOptions,
  draftTemplates,
  normalizeDraftTemplate,
} from '@shared/templates';
import { resolveOrdinaryTaskCoverTitle } from '@shared/ordinary-task-cover';

describe('draft font selection', () => {
  it('offers grouped common Chinese font choices with a backward-compatible system default', () => {
    expect(draftFontOptions.map((option) => option.label)).toEqual([
      '系统默认',
      '鸿蒙黑体 · 常规',
      '鸿蒙黑体 · 中黑',
      '鸿蒙黑体 · 粗体',
      '思源黑体 · 常规',
      '思源黑体 · 中黑',
      '思源黑体 · 粗体',
      '经典雅黑',
      '经典宋体',
      '思源宋体 · 常规',
      '思源宋体 · 粗体',
      '思源中宋',
      '烟波宋',
      '经典圆体',
      '资源圆体 · 常规',
      '资源圆体 · 中粗',
      '资源圆体 · 粗体',
      '简中圆',
      '霞鹜文楷 · 常规',
      '霞鹜文楷 · 粗体',
      '毛笔行楷',
      '柳公权楷书',
      '得意黑',
      '站酷酷黑',
      '站酷文艺体',
      '汉仪英雄体',
      '综艺体',
      '江湖体',
    ]);
    expect(draftFontGroups).toEqual(['默认', '黑体', '宋体', '圆体', '楷体与手写', '标题设计']);
    expect(new Set(draftFontOptions.map((option) => option.group))).toEqual(new Set(draftFontGroups));
    expect(new Set(draftFontOptions.map((option) => option.value)).size).toBe(draftFontOptions.length);
    expect(draftTemplates.every((template) => (
      template.title.fontFamily === 'system'
      && template.subtitle.fontFamily === 'system'
      && template.caption.fontFamily === 'system'
      && template.disclaimer.fontFamily === 'system'
    ))).toBe(true);
    expect(draftFontCssFamily('宋体')).toContain('SimSun');
    expect(draftFontCssFamily('LXGWWenKai_Regular')).toContain('KaiTi');
    expect(draftFontCssFamily('SourceHanSansCN_Regular')).toContain('Source Han Sans CN');
    expect(draftFontCssFamily('ResourceHanRoundedCN_Bold')).toContain('Resource Han Rounded CN Bold');
  });

  it('maps every selectable Jianying font to a free font resource with a non-empty ID', async () => {
    const source = await readFile(new URL('../vendor/python/Lib/site-packages/pyJianYingDraft/metadata/font_meta.py', import.meta.url), 'utf8');

    for (const fontFamily of draftFontFamilies.filter((value) => value !== 'system')) {
      const escaped = fontFamily.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const declaration = source.match(new RegExp(`^\\s+${escaped}\\s*=\\s*EffectMeta\\([^\\r\\n]+`, 'mu'))?.[0];
      expect(declaration, `${fontFamily} must exist in pyJianYingDraft.FontType`).toBeTruthy();
      expect(declaration, `${fontFamily} must stay available without a VIP dependency`).toContain('False');
      const resourceId = declaration?.match(/EffectMeta\("[^"]+",\s*False,\s*"([^"]+)"/u)?.[1];
      expect(resourceId, `${fontFamily} must have a Jianying font resource ID`).toMatch(/^\d+$/u);
    }
  });

  it('normalizes legacy or invalid values while preserving valid per-layer choices', () => {
    const legacy = structuredClone(draftTemplates[0]) as any;
    delete legacy.title.fontFamily;
    delete legacy.subtitle.fontFamily;
    delete legacy.caption.fontFamily;
    legacy.disclaimer.fontFamily = 'unknown-font';

    const normalizedLegacy = normalizeDraftTemplate(legacy);
    expect([
      normalizedLegacy.title.fontFamily,
      normalizedLegacy.subtitle.fontFamily,
      normalizedLegacy.caption.fontFamily,
      normalizedLegacy.disclaimer.fontFamily,
    ]).toEqual(['system', 'system', 'system', 'system']);

    const selected = structuredClone(draftTemplates[0]);
    selected.title.fontFamily = '得意黑';
    selected.subtitle.fontFamily = 'LXGWWenKai_Regular';
    selected.caption.fontFamily = '宋体';
    selected.disclaimer.fontFamily = 'HarmonyOS_Sans_SC_Regular';
    expect(parseDraftTemplate(normalizeDraftTemplate(selected))).toMatchObject({
      title: { fontFamily: '得意黑' },
      subtitle: { fontFamily: 'LXGWWenKai_Regular' },
      caption: { fontFamily: '宋体' },
      disclaimer: { fontFamily: 'HarmonyOS_Sans_SC_Regular' },
    });
  });

  it('inherits the main-title font on the independent cover page', () => {
    const template = structuredClone(draftTemplates[0]);
    template.title.fontFamily = '圆体';
    expect(resolveOrdinaryTaskCoverTitle(template, '封面标题').fontFamily).toBe('圆体');
  });

  it('renders one accessible font selector for every draft text layer', async () => {
    const source = await readFile(new URL('../src/features/templates/DraftTemplatesPage.tsx', import.meta.url), 'utf8');
    expect(source.match(/<DraftFontFamilyField\b/gu)).toHaveLength(4);
    for (const label of ['主标题字体', '副标题字体', '字幕字体', '免责声明字体']) {
      expect(source).toContain(`aria-label={\`${'${layerLabel}'}字体\`}`);
      expect(source).toContain(`layerLabel="${label.replace('字体', '')}"`);
    }
    expect(source).toContain('draftFontGroups.map((group)');
    expect(source).toContain('draftFontOptions.filter((option) => option.group === group).map((option)');
    expect(source).toContain('<optgroup key={group} label={group}>');
    expect(source).toContain('style={{ fontFamily: draftFontCssFamily(value) }}');
  });
});

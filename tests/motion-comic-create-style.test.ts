import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { MotionComicCreateFlow } from '../src/features/motion-comic/MotionComicCreateFlow';
import { defaultCustomStyles } from '../src/shared/config';

const noop = () => {};
const props: ComponentProps<typeof MotionComicCreateFlow> = {
  step: 0, title: '来信', ratio: '16:9', sourceKind: 'script', adaptationMode: 'faithful-script',
  sourceFileName: '', sourceText: '邮局来信', targetCharacters: '2400', targetDurationSec: '', splitInstructions: '',
  episodes: [], busy: false, onStepChange: noop, onTitleChange: noop, onRatioChange: noop,
  onSourceKindChange: noop, onAdaptationModeChange: noop, onSourceTextChange: noop,
  onTargetCharactersChange: noop, onTargetDurationSecChange: noop, onSplitInstructionsChange: noop,
  onEpisodeChange: noop, onImportFile: noop, onPrepareEpisodes: noop, onCreate: noop,
};

describe('motion comic creation visual style', () => {
  it('shows existing Chinese presets beside project parameters without requiring a selection', () => {
    const html = renderToStaticMarkup(createElement(MotionComicCreateFlow, props));
    for (const text of ['项目名称', '成片画幅', '视觉风格（可选）', '暂不指定', '写实彩色', '现代电影', '吉卜力', '水彩治愈', '皮克斯 3D', '中国水墨', '自定义', '上传 TXT / MD']) expect(html).toContain(text);
    expect(html).not.toContain('自定义视觉风格（可选）');
  });

  it('restores a custom description into its visible input and review summary', () => {
    const html = renderToStaticMarkup(createElement(MotionComicCreateFlow, { ...props, visualStyle: '铅笔线稿，纸张颗粒' }));
    expect(html).toContain('自定义视觉风格（可选）');
    expect(html).toContain('value="铅笔线稿，纸张颗粒"');
    expect(renderToStaticMarkup(createElement(MotionComicCreateFlow, { ...props, step: 2, visualStyle: '铅笔线稿，纸张颗粒' }))).toContain('<dd>铅笔线稿，纸张颗粒</dd>');
  });

  it('reviews the preset label while retaining its actual prompt description as the value', () => {
    const preset = defaultCustomStyles.find((style) => style.id === 'watercolor')!;
    const visualStyle = `${preset.name}：${preset.prefix}；${preset.suffix}`;
    const html = renderToStaticMarkup(createElement(MotionComicCreateFlow, { ...props, visualStyle }));
    expect(html).toContain('<dd>水彩治愈</dd>');
    expect(html).toContain(preset.prefix);
    expect(html).not.toContain('自定义视觉风格（可选）');
  });
});

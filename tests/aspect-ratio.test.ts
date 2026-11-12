import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ASPECT_RATIOS, isAspectRatio, normalizeAspectRatio } from '../src/shared/aspect-ratio';
import { EDITORIAL_COLLAGE_RATIOS } from '../src/shared/editorial-collage';
import { MOTION_COMIC_RATIOS } from '../src/shared/motion-comic';
import { HTML_VIDEO_RATIOS } from '../src/shared/html-video-config';
import { AspectRatioField, type AspectRatioFieldProps } from '../src/components/AspectRatioField';
import type { SegmentedControlProps } from '../src/ui/SegmentedControl';

function control(props: AspectRatioFieldProps) {
  const field = AspectRatioField(props);
  return field.props.children[1] as ReactElement<SegmentedControlProps<string>>;
}

describe('shared aspect ratios', () => {
  it('keeps all historical enum values and their order byte-for-byte compatible', () => {
    expect(ASPECT_RATIOS).toEqual(['9:16', '16:9', '1:1', '4:3']);
    for (const alias of [EDITORIAL_COLLAGE_RATIOS, MOTION_COMIC_RATIOS, HTML_VIDEO_RATIOS]) {
      expect(alias).toBe(ASPECT_RATIOS);
      expect(JSON.stringify(alias)).toBe('["9:16","16:9","1:1","4:3"]');
    }
  });

  it('only recognizes exact supported ratios and normalizes only when explicitly requested', () => {
    for (const ratio of ASPECT_RATIOS) {
      expect(isAspectRatio(ratio)).toBe(true);
      expect(normalizeAspectRatio(ratio)).toBe(ratio);
    }
    for (const value of [undefined, null, 1, 'auto', ' 16:9', '16:9 ', '3:2']) {
      expect(isAspectRatio(value)).toBe(false);
      expect(normalizeAspectRatio(value)).toBe('16:9');
      expect(normalizeAspectRatio(value, '9:16')).toBe('9:16');
    }
  });
});

describe('AspectRatioField behavior', () => {
  it('renders the canonical order with visible labels, selected state and swatches', () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(createElement(AspectRatioField, { value: '1:1', onChange }));
    expect(html).toContain('aria-label="画幅"');
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/class="aspect-ratio-swatch"/g)).toHaveLength(4);
    const picker = control({ value: '1:1', onChange });
    expect(picker.props.value).toBe('1:1');
    expect(picker.props.options.map(option => option.value)).toEqual(ASPECT_RATIOS);
    for (const ratio of ASPECT_RATIOS) picker.props.onChange(ratio);
    expect(onChange.mock.calls.map(call => call[0])).toEqual(ASPECT_RATIOS);
  });

  it('preserves unsupported draft strings without changing or selecting a default', () => {
    const onChange = vi.fn();
    const picker = control({ value: 'legacy-custom-ratio', onChange });
    expect(picker.props.value).toBe('legacy-custom-ratio');
    const html = renderToStaticMarkup(createElement(AspectRatioField, { value: 'legacy-custom-ratio', onChange }));
    expect(html).not.toContain('aria-selected="true"');
    expect(onChange).not.toHaveBeenCalled();
    picker.props.onChange('3:2');
    expect(onChange).not.toHaveBeenCalled();
    picker.props.onChange('4:3');
    expect(onChange).toHaveBeenCalledWith('4:3');
  });

  it('disables every option and rejects changes while disabled', () => {
    const onChange = vi.fn();
    const picker = control({ value: '16:9', disabled: true, onChange });
    expect(picker.props.options.every(option => option.disabled)).toBe(true);
    picker.props.onChange('9:16');
    expect(onChange).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(AspectRatioField, { value: '16:9', disabled: true, onChange }));
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });

  it('honors an explicit subset and wraps only this field in narrow columns', () => {
    const onChange = vi.fn();
    const picker = control({ label: '成片画幅', value: '16:9', ratios: ['16:9', '9:16'], onChange });
    expect(picker.props.label).toBe('成片画幅');
    expect(picker.props.options.map(option => option.value)).toEqual(['16:9', '9:16']);
    expect(picker.props.style).toMatchObject({ flexWrap: 'wrap', minWidth: 0 });
    picker.props.onChange('1:1');
    expect(onChange).not.toHaveBeenCalled();
    picker.props.onChange('9:16');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('9:16');
  });
});

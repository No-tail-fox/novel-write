import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CodeVideoDurationStatus, CodeVideoPolicyFields } from '../src/features/editorial-collage/CodeVideoPolicyFields';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
import type { CodeVideoPolicyFieldsProps } from '../src/features/editorial-collage/CodeVideoPolicyFields';

const controls = vi.hoisted(() => new Map<string, Record<string, any>>());
vi.mock('../src/ui', () => {
  const field = (props: Record<string, any>) => { controls.set(props.label, props); return createElement('div', null, props.label, props.hint); };
  return { SelectField: field, TextField: field, CheckboxField: field };
});
function render(props: Partial<CodeVideoPolicyFieldsProps> = {}) {
  controls.clear();
  const onChange = vi.fn();
  const html = renderToStaticMarkup(createElement(CodeVideoPolicyFields, { onChange, ...props }));
  return { html, onChange };
}
function change(label: string, value: string) { controls.get(label)!.onChange(null, { value }); }

describe('code video policy controls', () => {
  it('does not initialize a legacy policy on mount and displays historical host captions', () => {
    const { html, onChange } = render();
    expect(onChange).not.toHaveBeenCalled();
    expect(controls.get('字幕方式')!.value).toBe('host');
    expect(controls.get('目标时长')!.value).toBe('');
    expect(html).toContain('沿用原有时长和宿主字幕');
  });
  it('exposes all duration presets and preserves legacy captions when another field is changed', () => {
    const { onChange } = render();
    expect(controls.get('目标时长')!.options.map((option: { value: string }) => option.value)).toEqual(['', '30', '60', '90', '120', '180', 'custom']);
    change('目标时长', '90');
    expect(onChange).toHaveBeenLastCalledWith({ ...newCodeVideoPolicy(), targetDurationSeconds: 90, captionMode: 'host' });
  });
  it('retains explicit film policy and updates each independent setting', () => {
    const value = newCodeVideoPolicy();
    const { onChange } = render({ value });
    expect(controls.get('目标时长')!.value).toBe('60');
    expect(controls.get('字幕方式')!.value).toBe('film');
    change('字幕方式', 'host');
    expect(onChange).toHaveBeenLastCalledWith({ ...value, captionMode: 'host' });
    change('长文处理', 'condense');
    expect(onChange).toHaveBeenLastCalledWith({ ...value, longTextMode: 'condense' });
    controls.get('允许旁白留白')!.onChange(null, { checked: false });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, allowNarrationPauses: false });
  });
  it('keeps invalid custom text out of saved policy and blocks submission until corrected', () => {
    const onValidityChange = vi.fn();
    const value = { ...newCodeVideoPolicy(), targetDurationSeconds: 45 };
    const { onChange } = render({ value, onValidityChange });
    for (const input of ['', '14', '181', '30.5']) {
      change('自定义目标时长（秒）', input);
      expect(onValidityChange).toHaveBeenLastCalledWith(false);
    }
    expect(onChange).not.toHaveBeenCalled();
    for (const input of ['15', '180']) {
      change('自定义目标时长（秒）', input);
      expect(onValidityChange).toHaveBeenLastCalledWith(true);
      expect(onChange).toHaveBeenLastCalledWith({ ...value, targetDurationSeconds: Number(input) });
    }
  });
  it('disables unsupported v3 policies and busy controls without modifying settings', () => {
    for (const props of [{ authoringVersion: 3 }, { busy: true }]) {
      const { onChange, html } = render(props);
      expect([...controls.values()].every(control => control.disabled)).toBe(true);
      change('字幕方式', 'film');
      expect(onChange).not.toHaveBeenCalled();
      if ('authoringVersion' in props) expect(html).toContain('当前是旧版制作任务');
    }
  });
  it('reports actual duration separately and never invents a legacy target', () => {
    const html = renderToStaticMarkup(createElement(CodeVideoDurationStatus, { policy: newCodeVideoPolicy(), actualDurationSeconds: 72.25 }));
    expect(html).toContain('60 秒'); expect(html).toContain('72.25 秒');
    const legacy = renderToStaticMarkup(createElement(CodeVideoDurationStatus, {}));
    expect(legacy).toContain('未设置（沿用原有时长）'); expect(legacy).toContain('待生成');
  });
});

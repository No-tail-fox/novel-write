import { describe, expect, it } from 'vitest';
import { draftTextLayerStyle } from '../src/features/templates/DraftCanvas';

const textStyle = {
  color: '#ffde00',
  alpha: 1,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 0,
};

describe('draft canvas text style', () => {
  it('turns underline off without removing the stable decoration metrics', () => {
    const enabled = draftTextLayerStyle({ ...textStyle, underline: true }, 24, 800);
    const disabled = draftTextLayerStyle({ ...textStyle, underline: false }, 24, 800);

    expect(enabled.textDecorationLine).toBe('underline');
    expect(disabled.textDecorationLine).toBe('none');
    expect(disabled.textDecorationStyle).toBe('solid');
    expect(disabled.textDecorationThickness).toBe('0.09em');
    expect(disabled.textUnderlineOffset).toBe('0.13em');
    expect(disabled).not.toHaveProperty('textDecoration');
    expect(disabled.color).toBe(enabled.color);
    expect(disabled.fontSize).toBe(enabled.fontSize);
  });
});

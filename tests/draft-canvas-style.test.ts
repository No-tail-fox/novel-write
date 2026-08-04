import { describe, expect, it } from 'vitest';
import { draftTextLayerStyle } from '../src/features/templates/DraftCanvas';
import { readFile } from 'node:fs/promises';

const textStyle = {
  color: '#ffde00',
  alpha: 1,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 0,
};

describe('draft canvas text style', () => {
  it('keeps native text decoration out of the stroked text compositor path', () => {
    const style = draftTextLayerStyle(textStyle, 24, 800);

    expect(style).not.toHaveProperty('textDecoration');
    expect(style).not.toHaveProperty('textDecorationLine');
    expect(style).not.toHaveProperty('textDecorationStyle');
    expect(style).not.toHaveProperty('textDecorationThickness');
    expect(style).not.toHaveProperty('textUnderlineOffset');
    expect(style.color).toBe(textStyle.color);
    expect(style.fontSize).toBe(24);
  });

  it('renders underline as an isolated inline fragment that can be removed without repainting the canvas layer', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('../src/features/templates/DraftCanvas.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain("data-draft-underline={underline ? 'on' : 'off'}");
    expect(source).toContain("className={underline ? 'draft-text-content underlined' : 'draft-text-content'}");
    expect(styles).toContain('.draft-text-content.underlined {');
    expect(styles).toContain('border-bottom: 0.09em solid currentColor;');
    expect(styles).not.toMatch(/\.draft-text-content\.underlined\s*\{[^}]*text-decoration:/su);
  });
});

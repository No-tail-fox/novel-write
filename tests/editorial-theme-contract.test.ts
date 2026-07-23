import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const tokenNames = [
  'shell-bg', 'shell-surface', 'shell-surface-raised', 'shell-border',
  'shell-text', 'shell-muted', 'shell-accent', 'shell-accent-strong',
  'shell-focus', 'shell-focus-contrast',
] as const;
const mediaTokenNames = ['media-bg', 'media-surface', 'media-border', 'media-text', 'media-muted'] as const;

describe('editorial workbench theme contract', () => {
  it('defines every shell theme token and each invariant media token', async () => {
    const tokens = await source('../src/styles/tokens.css');
    for (const name of tokenNames) expect(matches(tokens, `--${name}:`)).toHaveLength(2);
    for (const name of mediaTokenNames) expect(matches(tokens, `--${name}:`)).toHaveLength(1);
    expect(tokens).toContain(':root[data-theme=\'light\']');
  });

  it('uses the approved typography, compact geometry, and semantic focus tokens', async () => {
    const files = await Promise.all([
      source('../src/styles/tokens.css'),
      source('../src/styles/base.css'),
      source('../src/styles/components.css'),
      source('../src/styles/media-canvas.css'),
    ]);
    const css = files.join('\n');
    expect(css).toContain('"Segoe UI Variable"');
    expect(css).toContain('"Microsoft YaHei UI"');
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 500');
    expect(css).toContain('letter-spacing: 0');
    expect(css).toContain('var(--shell-focus)');
    expect(css).toContain('var(--shell-focus-contrast)');
    expect(css).not.toMatch(/border-radius:\s*(?:[9]|[1-9]\d+)px/u);
    expect(css).not.toMatch(/gradient-orb|bokeh|glow-orb/iu);
  });

  it('keeps media canvases theme-invariant with readable contrast', async () => {
    const tokens = await source('../src/styles/tokens.css');
    const media = await source('../src/styles/media-canvas.css');
    expect(media).toContain('[data-media-canvas]');
    expect(media).toContain('background: var(--media-bg)');
    expect(media).toContain('color: var(--media-text)');
    expect(contrast('#f4f6f8', '#101316')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#aeb6bd', '#101316')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#cf3f2d', '#ffffff')).toBeGreaterThanOrEqual(3);
    for (const name of mediaTokenNames) {
      expect(lightThemeBlock(tokens)).not.toContain(`--${name}:`);
    }
  });

  it.each([
    ['task artifact', '../src/features/tasks/TaskDetailPage.tsx', 'task-artifact'],
    ['HTML video', '../src/features/html-video/HtmlVideoPage.tsx', 'html-video'],
    ['image lab', '../src/features/labs/ImageLabPage.tsx', 'image-lab'],
    ['voice lab', '../src/features/labs/VoiceLabPage.tsx', 'voice-lab'],
    ['draft canvas', '../src/features/templates/DraftCanvas.tsx', 'draft-canvas'],
    ['Music MV', '../src/features/music-mv/MusicMvPage.tsx', 'music-mv-timeline-audio'],
    ['Viral source', '../src/features/viral/ViralAnalyzerPage.tsx', 'viral-source'],
    ['Viral report', '../src/features/viral/ViralReport.tsx', 'viral-report'],
  ])('marks the %s media owner', async (_label, path, id) => {
    expect(await source(path)).toContain(`data-media-canvas="${id}"`);
  });
});

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function matches(value: string, needle: string): string[] {
  return value.split(needle).slice(1);
}

function lightThemeBlock(css: string): string {
  return css.slice(css.indexOf(":root[data-theme='light']"));
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

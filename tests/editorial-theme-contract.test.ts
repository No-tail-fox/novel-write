import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const tokenNames = [
  'shell-bg', 'shell-surface', 'shell-surface-raised', 'shell-border',
  'shell-text', 'shell-muted', 'shell-accent', 'shell-accent-strong',
  'shell-focus', 'shell-focus-contrast',
] as const;
const mediaTokenNames = [
  'media-bg', 'media-surface', 'media-border', 'media-text', 'media-muted',
  'media-accent', 'media-accent-contrast', 'media-timeline-blue', 'media-reel-amber', 'media-ok',
] as const;

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

  it('keeps shared segmented controls readable across shell themes', async () => {
    const css = await source('../src/styles.css');
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return css.slice(start, css.indexOf('}', start) + 1);
    };

    expect(rule('.segmented button')).toContain('background: var(--shell-surface-raised);');
    expect(rule('.segmented button')).toContain('color: var(--shell-text);');
    expect(rule('.segmented button.selected')).toContain('background: var(--shell-accent);');
    expect(rule('.segmented button.selected')).toContain('color: var(--shell-focus-contrast);');
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
    expect(contrast('#101214', '#f2614b')).toBeGreaterThanOrEqual(4.5);
    for (const name of mediaTokenNames) {
      expect(lightThemeBlock(tokens)).not.toContain(`--${name}:`);
    }
  });

  it('keeps the Music MV preview entirely inside the invariant media palette', async () => {
    const css = await source('../src/styles.css');

    expect(css).toMatch(/\.music-mv-preview\[data-media-canvas\] \{[\s\S]*?background: var\(--media-bg\);[\s\S]*?color: var\(--media-text\);/u);
    expect(css).toMatch(/\.music-mv-preview h3,[\s\S]*?\.music-mv-preview \.artifact-scene-list strong \{[\s\S]*?color: var\(--media-text\);/u);
    expect(css).toMatch(/\.music-mv-preview \.task-metrics small,[\s\S]*?color: var\(--media-muted\);/u);
    expect(css).toMatch(/\.music-mv-preview \.artifact-scene-list div \{[\s\S]*?border-color: var\(--media-border\);[\s\S]*?background: var\(--media-surface\);/u);
  });

  it('keeps the Viral input form in the operational shell and its report in the media palette', async () => {
    const input = await source('../src/features/viral/ViralAnalyzerPage.tsx');
    const report = await source('../src/features/viral/ViralReport.tsx');

    expect(input).not.toContain('data-media-canvas="viral-source"');
    expect(input).toContain('className="panel viral-input-panel"');
    expect(report).toContain('data-media-canvas="viral-report"');
  });

  it('keeps Viral operational selections and counts readable in both shell themes', async () => {
    const css = await source('../src/styles.css');
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      return css.slice(start, css.indexOf('}', start) + 1);
    };

    expect(rule('.panel-count')).toContain('color: var(--shell-accent-strong);');
    expect(rule('.viral-choice-button.active')).toContain('background: color-mix(in srgb, var(--shell-accent) 10%, var(--shell-surface-raised));');
    expect(rule('.viral-choice-button.active')).toContain('color: var(--shell-accent-strong);');
    expect(rule('.viral-choice-button.active small')).toContain('color: var(--shell-accent-strong);');
  });

  it.each([
    ['task artifact', '../src/features/tasks/TaskArtifactPreview.tsx', 'task-artifact'],
    ['HTML video', '../src/features/html-video/HtmlVideoPage.tsx', 'html-video'],
    ['image lab', '../src/features/labs/ImageLabPage.tsx', 'image-lab'],
    ['voice lab', '../src/features/labs/VoiceLabPage.tsx', 'voice-lab'],
    ['draft canvas', '../src/features/templates/DraftCanvas.tsx', 'draft-canvas'],
    ['Music MV', '../src/features/music-mv/MusicMvPage.tsx', 'music-mv-timeline-audio'],
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

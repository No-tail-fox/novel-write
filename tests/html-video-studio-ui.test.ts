import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('HTML video editorial studio', () => {
  it('owns the approved three-region workspace without dropping task creation or editing controls', async () => {
    const [page, styles] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/styles/features/html-video.css'),
    ]);
    expect(page).toContain("import '../../styles/features/html-video.css';");
    expect(page).toContain('data-html-video-studio="html-video"');
    expect(page).toContain('className="hv-studio-parameters"');
    expect(page).toContain('className="hv-studio-canvas"');
    expect(page).toContain('className="hv-studio-run-rail"');
    expect(page).toContain('aria-label="切换 HTML 动画视频任务"');
    expect(page).toContain('createHtmlVideoTask');
    expect(page).toContain('<HtmlVideoConfigEditor');
    expect(page).toContain('data-media-canvas="html-video"');
    expect(page).toContain('className="hv-timeline"');
    expect(styles).toContain('grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(220px, 250px);');
    expect(styles).toContain('background: var(--media-bg);');
    expect(styles).toContain('@media (max-width: 1080px)');
    expect(styles).toMatch(/\.hv-studio-run-rail \.hv-step \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/u);
  });

  it('projects all governed controls and the real six-stage lifecycle into the studio', async () => {
    const [page, tabPanel, manifest] = await Promise.all([
      source('../src/features/html-video/HtmlVideoPage.tsx'),
      source('../src/features/html-video/HtmlVideoTabPanel.tsx'),
      source('../src/shared/html-video-control-manifest.ts'),
    ]);
    expect(manifest).toContain('HTML_VIDEO_CONTROL_MANIFEST_V1');
    expect((manifest.match(/availability: 'editable'/g) ?? []).length).toBe(17);
    expect(page).toContain('htmlVideoSteps.map');
    expect(page).toContain('taskProgressLabel');
    expect(page).toContain("setTaskStatus('paused')");
    expect(page).toContain("setTaskStatus('running')");
    expect(page).toContain("setTaskStatus('cancelled')");
    expect(page).toContain('retryTask');
    expect(page).toContain('openOutputDirectory');
    expect(tabPanel).toContain('HtmlVideoCaptionEditor');
    expect(tabPanel).toContain('HtmlVideoCoverEditor');
    expect(tabPanel).toContain('controls');
    expect(tabPanel).toContain('onError');
    expect(tabPanel).toContain('onCanPlay');
  });

  it('uses theme-aware contrast ink on solid studio controls and lifecycle states', async () => {
    const styles = await source('../src/styles/features/html-video.css');
    const solidForegroundRules = [
      '.hv-studio-panel-heading .primary-action',
      '.hv-studio-parameters .segmented button.selected',
      '.hv-studio-run-rail .hv-step.done > span',
      '.hv-studio-run-rail .hv-step.running > span',
      '.hv-studio-run-rail .hv-step.failed > span',
    ];

    for (const selector of solidForegroundRules) {
      const rule = styles.slice(styles.indexOf(`${selector} {`));
      expect(rule, selector).toMatch(/^.*?\{[\s\S]*?color: var\(--shell-focus-contrast\);/u);
    }
    for (const selector of [
      '.hv-studio .hv-tab.active',
      '.hv-studio .hv-tab-content .segmented button.selected',
    ]) {
      const rule = styles.slice(styles.indexOf(`${selector} {`));
      expect(rule, selector).toMatch(/^.*?\{[\s\S]*?background: var\(--media-accent\);[\s\S]*?color: var\(--media-accent-contrast\);/u);
    }
    expect(styles).toContain('var(--media-timeline-blue) 55%');
    expect(styles).toContain('var(--media-reel-amber) 52%');
    expect(styles).toContain('var(--media-ok) 52%');
    expect(styles).toMatch(/\.hv-studio \.hv-caption-color-item,[\s\S]*?\.hv-studio \.hv-media-loading \{[\s\S]*?color: var\(--media-muted\);/u);
    expect(styles).toMatch(/\.hv-studio \.hv-tab-content \.field > \.form-field-label \{[\s\S]*?color: var\(--media-text\);/u);
    expect(styles).toMatch(/\.hv-studio \.hv-caption-color-reset \{[\s\S]*?border-color: var\(--media-border\);[\s\S]*?background: #101316;[\s\S]*?color: var\(--media-muted\);/u);
  });

  it('adds a dedicated real-Electron capture scope for desktop and compact HTML studio states', async () => {
    const [qa, electronMain, htmlVideoQa] = await Promise.all([
      source('../electron/editorial-qa.ts'),
      source('../electron/main.ts'),
      source('../scripts/qa-html-video-ui.mjs'),
    ]);
    expect(qa).toContain("'html-video'");
    expect(qa).toContain('htmlVideoStudioStates');
    expect(qa).toContain("{ id: 'html-video-studio-light-desktop'");
    expect(qa).toContain("{ id: 'html-video-studio-light-compact'");
    expect(qa).toContain('data-html-video-studio');
    expect(qa).toContain('htmlVideoCompactParameterOrder');
    expect(qa).toContain("textContent?.includes('4/6')");
    expect(qa).toContain('naturalWidth > 0');
    expect(qa).toContain("document.querySelector('.hv-timeline-track span')");
    expect(electronMain).toContain('seedHtmlVideoEditorialQa');
    expect(electronMain).toContain('createHtmlVideoTaskInput');
    expect(electronMain).toContain('ensureHtmlVideoTaskWorkDir');
    expect(htmlVideoQa).toContain("document.querySelector('.hv-studio-panel-heading h2')");
    expect(htmlVideoQa).toContain("document.querySelector('.hv-studio-canvas-heading strong')");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-config h2')");
    expect(htmlVideoQa).not.toContain("document.querySelector('.hv-workspace h3')");
  });
});

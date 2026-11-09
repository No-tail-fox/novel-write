import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildDirectorSceneHtml } from '../src/shared/director-render';
const input = { title: '旧逐镜标题', caption: '程序字幕', videoUrl: 'file:///native-picture.mp4',
  videoStartMs: 6038, durationMs: 9000, index: 2, layoutTemplate: '漫画 · 分格',
  subtitleCues: [{ id: 'cue', text: '程序字幕', startMs: 0, endMs: 5000 }] };
describe('native picture composition', () => {
  it.each(['VOX', 'native-shot-local-QA', 'native-subtitle-recheck-QA'])('preserves authored visuals in %s while rendering timed captions', modeLabel => {
    const html = buildDirectorSceneHtml({ ...input, modeLabel, preserveSourcePicture: true });
    expect(html).toContain('class="frame native-picture"');
    expect(html).not.toContain('<div class="shade">');
    expect(html).not.toContain('<div class="meta">');
    expect(html).not.toContain('<div class="title">');
    expect(html).toContain('data-cue-id="cue" data-cue-start="0" data-cue-end="5000"');
    expect(html).toContain('程序字幕');
    expect(html).toContain('const videoStart = 6.038');
  });
  it('does not change legacy composition defaults', () => {
    const html = buildDirectorSceneHtml({ ...input, modeLabel: 'Legacy' });
    expect(html).toContain('<div class="shade">');
    expect(html).toContain('<div class="meta">');
    expect(html).toContain('<div class="title">旧逐镜标题</div>');
  });
  it('forwards picture preservation to the real capture renderer', async () => {
    const source = await readFile(new URL('../electron/director-renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('preserveSourcePicture: scene.preserveSourcePicture');
  });
});

import { describe, expect, it } from 'vitest';
import { buildDirectorSceneHtml, directorCanvasForRatio } from '../src/shared/director-render';

describe('director render contracts', () => {
  it('uses stable production canvases for every supported project ratio', () => {
    expect(directorCanvasForRatio('16:9')).toEqual({ width: 1920, height: 1080 });
    expect(directorCanvasForRatio('9:16')).toEqual({ width: 1080, height: 1920 });
    expect(directorCanvasForRatio('1:1')).toEqual({ width: 1440, height: 1440 });
    expect(directorCanvasForRatio('4:3')).toEqual({ width: 1440, height: 1080 });
  });

  it('builds a seekable local render scene and escapes project text', () => {
    const html = buildDirectorSceneHtml({
      title: '<script>bad()</script>',
      caption: '城市 & 旧街巷',
      imageUrl: 'file:///I:/director/shot-01.png',
      durationMs: 6000,
      modeLabel: 'VOX',
      index: 1,
    });
    expect(html).toContain('window.__tl');
    expect(html).toContain('window.__ready = true');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).toContain('城市 &amp; 旧街巷');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).not.toContain('linear-gradient');
  });

  it('applies persisted layout, motion, and subtitle settings to rendered scenes', () => {
    const html = buildDirectorSceneHtml({
      title: '关键帧',
      caption: '字幕内容',
      imageUrl: 'file:///I:/director/shot-02.png',
      durationMs: 5000,
      modeLabel: 'AI 漫剧',
      index: 2,
      layoutTemplate: '漫画分格 · 角色优先',
      motionPreset: '固定机位',
      subtitleStyle: '简体中文 · 下方黑底',
    });
    expect(html).toContain('frame comic');
    expect(html).toContain('caption backplate');
    expect(html).toContain("motionPreset === '固定机位'");
    expect(html).toContain('scale(1) translate3d(0,0,0)');
  });
});

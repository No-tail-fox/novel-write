import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DirectorDeskWorkspace, directorLayerStyle, directorPreviewTitleVisible, type DirectorPreviewLayer, type DirectorShot } from '../src/features/director-desk/DirectorDeskWorkspace';
import { buildDirectorSceneHtml, buildDirectorTextLayerSvg } from '../src/shared/director-render';
import { EDITORIAL_MOTION_STYLES } from '../src/shared/editorial-motion';

const layer: DirectorPreviewLayer = {
  id: 'subject', label: '独立主体', kind: 'subject', src: 'data:image/png;base64,AA==', zIndex: 1, depth: 0.2,
  width: 0.4, height: 0.6, fit: 'contain',
  motion: [
    { atMs: 0, x: -0.2, y: 0.6, scale: 0.8, rotation: -12, opacity: 0 },
    { atMs: 1200, x: 0.55, y: 0.48, scale: 1, rotation: 2, opacity: 1 },
    { atMs: 3000, x: 0.6, y: 0.48, scale: 1.05, rotation: 0, opacity: 1 },
  ],
};

function workspaceMarkup(shot: Partial<DirectorShot>, mode: 'vox' | 'motion-comic' = 'vox') {
  return renderToStaticMarkup(createElement(DirectorDeskWorkspace, {
    mode, projectTitle: '分层预览', projectMeta: '', episodeTitle: '', stageLabel: '镜头生成',
    selectedShotId: 'shot', dirty: false, providerConnected: true,
    shots: [{ id: 'shot', index: 1, title: '镜头', scene: '', durationMs: 3000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', ...shot }],
    onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
  }));
}

describe('VOX dimensioned layer preview', () => {
  it('matches export position, dimensions and motion while seeking the timeline', async () => {
    const { src, ...renderLayer } = layer;
    const html = buildDirectorSceneHtml({ title: '', caption: '', durationMs: 3000, modeLabel: 'VOX', index: 1, layers: [{ ...renderLayer, motion: [...renderLayer.motion], imageUrl: src }] });
    const element = { style: {} as Record<string, string> };
    const window: { __tl?: { seek: (seconds: number) => Promise<void> } } = {};
    runInNewContext(html.match(/<script nonce="director-render">([\s\S]+)<\/script>/)![1], {
      window, document: { getElementById: (id: string) => id === 'scene-video' ? null : { style: {} }, querySelectorAll: () => [], querySelector: () => element },
      performance: { now: () => 0 }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    });
    for (const atMs of [0, 300, 1200, 2100, 3000, 700]) {
      await window.__tl!.seek(atMs / 1000);
      const preview = directorLayerStyle(layer, atMs);
      for (const property of ['left', 'top', 'width', 'height', 'inset', 'transform', 'opacity', 'zIndex'] as const) {
        expect(element.style[property]).toBe(String(preview[property]));
      }
    }
    const settled = directorLayerStyle(layer, 1200);
    expect(parseFloat(String(settled.left))).toBeCloseTo(55);
    expect(settled).toMatchObject({ top: '48%', width: '40%', height: '60%', inset: 'auto' });
  });

  it('renders exact text with the export SVG and never waits for nonexistent image media', () => {
    const text = '销量 <10% & 正在增长';
    const markup = workspaceMarkup({ previewLayers: [{ id: 'label', label: '数据标签', zIndex: 2, depth: 0, width: 0.5, height: 0.2, motion: [], content: { type: 'text', text } }] });
    expect(markup).toContain(buildDirectorTextLayerSvg(text));
    expect(markup).toContain('data-preview-layer-id="label"');
    expect(markup).not.toContain('正在恢复镜头画面');
    expect(markup).not.toContain('没有可见图层');
    expect(markup).not.toContain('销量 <10%');
  });

  it('names the actual generation action without changing comic generation', () => {
    expect(workspaceMarkup({})).toContain('生成分层素材');
    expect(workspaceMarkup({ thumbnail: layer.src, imageReady: false, imageUnavailableReason: '缺少主体素材' })).toContain('补齐分层素材');
    const video = workspaceMarkup({ renderStrategy: 'living-poster' });
    expect(video).toContain('生成关键帧');
    expect(video).toContain('先生成完整关键帧');
    expect(workspaceMarkup({}, 'motion-comic')).toContain('生成当前镜头');
    expect(workspaceMarkup({}, 'motion-comic')).not.toContain('生成分层素材');
  });

  it('shows editable content titles and all narrative actions only for local VOX', () => {
    const local = workspaceMarkup({ title: '一张咖啡桌，改变一座城', motionStyle: 'path-progress' });
    expect(local).toContain('上屏标题');
    expect(local).toContain('叙事动作');
    expect(local).toContain('相机运动');
    expect(local).toContain('value="path-progress" selected=""');
    for (const style of EDITORIAL_MOTION_STYLES) expect(local).toContain(style.label);
    const video = workspaceMarkup({ renderStrategy: 'living-poster' });
    expect(video).toContain('上屏标题');
    expect(video).not.toContain('叙事动作');
    expect(video).not.toContain('相机运动');
    const comic = workspaceMarkup({}, 'motion-comic');
    expect(comic).not.toContain('上屏标题');
    expect(comic).not.toContain('叙事动作');
    expect(comic).toContain('运动控制');
  });

  it('lets the native title own its entrance and exit without a second persistent overlay', () => {
    const title = '一张咖啡桌，改变一座城';
    const previewLayers: DirectorPreviewLayer[] = [{ id: 'title', label: title, kind: 'label', zIndex: 2, depth: 0, motion: [{ atMs: 0, x: 0.2, y: 0.2, scale: 1, rotation: 0, opacity: 0 }], content: { type: 'text', text: title } }];
    const shot = { title, previewLayers };
    expect(directorPreviewTitleVisible(shot, 'vox')).toBe(false);
    expect(workspaceMarkup(shot)).not.toContain('class="director-preview-title"');
    expect(workspaceMarkup(shot)).not.toContain('class="director-preview-kicker"');
    expect(directorPreviewTitleVisible({ ...shot, renderStrategy: 'living-poster' }, 'vox')).toBe(true);
    expect(directorPreviewTitleVisible(shot, 'motion-comic')).toBe(true);
    expect(directorPreviewTitleVisible({ ...shot, previewLayers: [{ ...previewLayers[0], visible: false }] }, 'vox')).toBe(true);
    expect(directorPreviewTitleVisible({ ...shot, previewLayers: [{ ...previewLayers[0], content: { type: 'text', text: '25%' } }] }, 'vox')).toBe(true);
    expect(directorPreviewTitleVisible({ ...shot, title: ' ' }, 'vox')).toBe(false);
    expect(workspaceMarkup(shot, 'motion-comic')).toContain('class="director-preview-kicker"');
  });
});

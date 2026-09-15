import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialState } from '../src/app/app-state';
import { WorkspaceNavigationProvider } from '../src/app/workspace-navigation';
import { VideoLabPage } from '../src/features/labs/VideoLabPage';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { StoryDreamProvider } from '../src/ui/StoryDreamProvider';

function renderWorkbench(config = initialState.config) {
  const api = {
    listVideoLabRecords: vi.fn(), generateVideoLab: vi.fn(), openVideoLabOutputDirectory: vi.fn(), selectLocalImage: vi.fn(),
  } as unknown as StoryDreamApi;
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, { theme: 'light', children:
    createElement(WorkspaceNavigationProvider, { children: createElement(VideoLabPage, {
      api, state: { ...initialState, config }, openSettings: vi.fn(),
    }) }),
  }));
  return { html, api };
}

describe('standalone video workbench initial UI', () => {
  it('renders an independent editor and blocks generation until the service is ready', () => {
    const { html, api } = renderWorkbench();
    expect(html).toContain('data-local-lab-workbench="video-lab"');
    expect(html).toContain('视频描述');
    expect(html).toContain('配置视频服务');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?生成视频<\/span><\/button>/u);
    expect(api.generateVideoLab).not.toHaveBeenCalled();
    expect(api.openVideoLabOutputDirectory).not.toHaveBeenCalled();
    expect(html).not.toContain('创建项目');
  });

  it('exposes reference controls only when the selected service supports them', () => {
    const config = structuredClone(initialState.config);
    const provider = config.video.providers[0];
    config.video.activeProviderId = provider.id;
    provider.capabilities = ['t2v'];
    expect(renderWorkbench(config).html).not.toContain('选择首帧');
    provider.capabilities = ['i2v', 'first-last-frame', 'reference-image'];
    const { html, api } = renderWorkbench(config);
    for (const label of ['选择首帧', '选择尾帧', '添加参考图']) expect(html).toContain(label);
    expect(api.selectLocalImage).not.toHaveBeenCalled();
  });
});

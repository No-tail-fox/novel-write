import { deferred, productionHandler, sourceText } from './helpers/source-handler';
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
    for (const model of ['MiniMax H3', 'MiniMax H3 Max', 'Seedance 2.0', 'Seedance 2.5']) expect(html).toContain(model);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?生成视频<\/span><\/button>/u);
    expect(api.generateVideoLab).not.toHaveBeenCalled();
    expect(api.openVideoLabOutputDirectory).not.toHaveBeenCalled();
    expect(html).not.toContain('创建项目');
  });

  it('keeps all upload modes available while capability validation remains provider-specific', () => {
    const config = structuredClone(initialState.config);
    const provider = config.video.providers[0];
    config.video.activeProviderId = provider.id;
    provider.capabilities = ['t2v'];
    const { html, api } = renderWorkbench(config);
    for (const label of ['文本', '首尾帧', '多模态参考', '分辨率', '生成同步声音']) expect(html).toContain(label);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?<span[^>]*>首尾帧<\/span>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?<span[^>]*>多模态参考<\/span>/u);
    expect(api.selectLocalImage).not.toHaveBeenCalled();
  });
});

describe('video and audio reference picker actions', () => {
  it.each([
    ['audio', 'selectLocalAudio', 'referenceAudioPaths', '添加音频'],
    ['video', 'selectLocalVideo', 'referenceVideoPaths', '添加视频'],
  ] as const)('%s picker routes to its own API and serializes double clicks', async (kind, method, field, label) => {
    const pending = deferred<string>(), api = { selectLocalAudio: vi.fn(() => pending.promise), selectLocalVideo: vi.fn(() => pending.promise) };
    const draft = { referenceAudioPaths: [] as string[], referenceVideoPaths: [] as string[] };
    const lock = { current: false }, setDraft = vi.fn((update: any) => Object.assign(draft, update(draft))), picking = vi.fn();
    const picker = productionHandler('src/features/labs/VideoLabPage.tsx', 'selectReferenceMedia', { imagePickerLock: lock, setPickingImage: picking, setSubmitError: vi.fn(), api, mounted: { current: true }, setDraft, referenceLimits: { audio: 3, videos: 3 }, errorMessage: (e: Error) => e.message });
    const first = picker(kind); await picker(kind); expect(api[method]).toHaveBeenCalledTimes(1);
    if (kind === 'audio') expect(api.selectLocalAudio).toHaveBeenCalledWith('video-reference');
    else expect(api.selectLocalAudio).not.toHaveBeenCalled();
    pending.resolve('C:/references/reference.media'); await first;
    expect(draft[field]).toEqual(['C:/references/reference.media']); expect(lock.current).toBe(false); expect(picking).toHaveBeenLastCalledWith(false);
    const line = sourceText('src/features/labs/VideoLabPage.tsx').split('\n').find(value => value.includes(`>${label}</Button>`));
    expect(line).toContain(`selectReferenceMedia('${kind}')`); expect(line).toContain(`disabled={pickingImage || draft.${field}.length >= referenceLimits.`);
  });
  it('keeps selected references on picker error, unlocks and ignores late completion after unmount', async () => {
    const pending = deferred<string>(), api = { selectLocalAudio: vi.fn(() => pending.promise) }, error = vi.fn(), update = vi.fn(), lock = { current: false }, mounted = { current: true };
    const picker = productionHandler('src/features/labs/VideoLabPage.tsx', 'selectReferenceMedia', { imagePickerLock: lock, setPickingImage: vi.fn(), setSubmitError: error, api, mounted, setDraft: update, referenceLimits: { audio: 3 }, errorMessage: (e: Error) => e.message });
    const first = picker('audio'); pending.reject(new Error('文件不可读')); await first;
    expect(error).toHaveBeenLastCalledWith('文件不可读'); expect(lock.current).toBe(false); expect(update).not.toHaveBeenCalled();
    api.selectLocalAudio.mockResolvedValue('late.wav'); mounted.current = false; await picker('audio'); expect(update).not.toHaveBeenCalled();
  });
});

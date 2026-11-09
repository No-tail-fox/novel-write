import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn(), factory: vi.fn(), statfs: vi.fn(async () => ({ bavail: 1024 * 1024, bsize: 4096 })), mkdir: vi.fn(async () => undefined), rm: vi.fn(async () => undefined), copyFile: vi.fn(async () => undefined) }));
vi.mock('node:fs/promises', () => ({ ...mocks, stat: vi.fn(async () => ({ isFile: () => true, size: 1024 })) }));
vi.mock('../electron/html-video-renderer', () => ({ createElectronHtmlVideoRenderer: (options: unknown) => { mocks.factory(options); return { render: mocks.render }; } }));
vi.mock('../src/shared/storybound-sidecar', () => ({ runStoryboundMediaSidecar: vi.fn(async () => ({ success: true, duration: 1, width: 1920, height: 1080, has_audio: true, has_video: true, has_nonblack_video: true })) }));
vi.mock('../electron/vox-animation-runtime', () => ({ prepareVoxHtml: vi.fn(async () => '<html/>'), readVoxAsset: vi.fn(async () => 'data:image/png;base64,eA==') }));
vi.mock('../electron/vox-render-assets', () => ({ stageVoxRenderAssets: vi.fn(async () => []), additionalVoxRenderAssetBytes: vi.fn(async () => 1024) }));
import { runStoryboundMediaSidecar as mockProbe } from '../src/shared/storybound-sidecar';
import * as preflight from '../electron/video-render-preflight';
import { renderDirectorVideo } from '../electron/director-renderer';
import { createVoxAnimation } from '../src/shared/vox-animation';

describe('director concurrent render staging', () => {
  beforeEach(() => vi.clearAllMocks());
  it('replaces inspection evidence when the capture window is recreated', async () => {
    const window = { webContents: { executeJavaScript: vi.fn().mockRejectedValueOnce(new Error('UnknownVizError')).mockRejectedValueOnce(new Error('second inspection failed')) } };
    mocks.render.mockImplementation(async input => {
      const options = mocks.factory.mock.calls.at(-1)![0];
      await options.inspectScene(window, input.scenes[0]);
      await options.inspectScene(window, input.scenes[0]);
      return { outputPath: input.outputPath };
    });
    const result = await renderDirectorVideo({
      workDir: 'E:/StoryDream-QA/inspection-recovery', projectTitle: 'Recovery', modeLabel: 'VOX', ratio: '16:9',
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers', layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' }],
    });
    expect(window.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(result.subtitleLayout?.scenes).toEqual([{ status: 'failed', shotId: 'shot', error: 'second inspection failed' }]);
  });
  it('budgets coalesced native stages and only deduplicates reusable native assets', async () => {
    const preflightSpy = vi.spyOn(preflight, 'preflightVideoRenderDisk');
    const twoSecondProbe = { success: true, duration: 2, width: 1920, height: 1080, has_audio: true, has_video: true, has_nonblack_video: true };
    vi.mocked(mockProbe).mockResolvedValueOnce(twoSecondProbe).mockResolvedValueOnce(twoSecondProbe);
    mocks.render.mockImplementation(async input => ({ outputPath: input.outputPath }));
    const base = { id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' };
    const input = { workDir: 'E:/StoryDream-QA/budget', projectTitle: 'Budget', modeLabel: 'VOX', ratio: '16:9' };
    try {
      await renderDirectorVideo({ ...input, scenes: [{ ...base, renderStrategy: 'deterministic-layers' }, { ...base, id: 'shot2', index: 2, renderStrategy: 'deterministic-layers' }] });
      expect(preflightSpy.mock.lastCall![1]).toMatchObject({ durations: [1, 1], stagedMediaBytes: 2048, streamFrames: true, consumeOwnedSegments: true });
      const animation = createVoxAnimation(); animation.code.engine = 'lemo-native';
      animation.native = { filmId: 'film', startMs: 0, durationMs: 1000, filmDurationMs: 2000, width: 1920, height: 1080, fps: 60, assetIds: ['image'] };
      const native = { ...base, renderStrategy: 'remotion' as const, animation, animationAssets: [{ id: 'image', kind: 'image' as const, path: 'E:/fixture.png' }] };
      await renderDirectorVideo({ ...input, scenes: [native, { ...native, id: 'shot2', index: 2, animation: { ...animation, native: { ...animation.native, startMs: 1000 } } }] });
      expect(preflightSpy.mock.lastCall![1]).toMatchObject({ durations: [2], stagedMediaBytes: 1024, fps: 60 });
    } finally { preflightSpy.mockRestore(); }
  });
  it('rejects low disk space before copying media or capturing frames', async () => {
    mocks.statfs.mockResolvedValueOnce({ bavail: 1, bsize: 1024 });
    await expect(renderDirectorVideo({
      workDir: 'E:/StoryDream-QA/render-project', projectTitle: 'Series', modeLabel: 'AI comic', ratio: '16:9',
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers', layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' }],
    })).rejects.toMatchObject({ code: 'DIRECTOR_RENDER_DISK_SPACE_LOW' });
    expect(mocks.copyFile).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it('uses a separate scratch volume while keeping the final artifact under the task', async () => {
    mocks.render.mockImplementation(async (input) => ({ outputPath: input.outputPath }));
    const result = await renderDirectorVideo({
      workDir: 'E:/StoryDream-QA/artifact-project', renderRootDir: 'I:/StoryDream-QA/render-scratch',
      projectTitle: 'Series', modeLabel: 'AI comic', ratio: '16:9',
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers',
        layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' }],
    });
    expect(mocks.statfs).toHaveBeenCalledWith('I:/StoryDream-QA/render-scratch');
    expect(result.outputPath).toMatch(/artifact-project[\\/]director-renders/);
    expect(mocks.render.mock.calls[0][0].workDir).toMatch(/render-scratch[\\/]director-renders/);
    expect(mocks.copyFile).toHaveBeenCalledWith(expect.stringMatching(/render-scratch[\\/]director-renders/), expect.stringMatching(/artifact-project[\\/]director-renders/));
  });
  it('preserves the original song gain when audio normalization is disabled', async () => {
    mocks.render.mockImplementation(async (input) => ({ outputPath: input.outputPath }));
    await renderDirectorVideo({
      workDir: 'E:/StoryDream-QA/mv-project', projectTitle: 'MV', modeLabel: 'Music MV', ratio: '16:9', normalizeAudio: false,
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers',
        animation: { ...createVoxAnimation(), authoring: { owner: 'creative-production', revision: 1, styleId: 'cel-anime-80s', upstreamRevision: 'test', status: 'reviewed', attempts: [] } }, layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' }],
    });
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ normalizeAudio: false }), expect.any(Object));
  });
  it('normalizes the final dialogue mix when requested by the comic workflow', async () => {
    mocks.render.mockImplementation(async (input) => ({ outputPath: input.outputPath }));
    await renderDirectorVideo({
      workDir: 'E:/StoryDream-QA/comic-project', projectTitle: 'Comic', modeLabel: 'AI comic', ratio: '16:9', normalizeAudio: true,
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers',
        layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [],
        audioPath: '', audioClips: [{ id: 'dialogue', assetVersionId: 'voice', path: 'E:/voice.wav', trackType: 'dialogue', startMs: 100, durationMs: 800, sourceStartMs: 0, gainDb: -2 }] }],
    });
    const [composition] = mocks.render.mock.calls[0];
    expect(composition.normalizeAudio).toBe(true);
    expect(composition.scenes[0].audioClips).toMatchObject([{ startMs: 100, durationMs: 800, gainDb: -2 }]);
  });
  it('isolates staging, capture and MP4 paths even at the same timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    mocks.render.mockImplementation(async (input) => ({ outputPath: input.outputPath }));
    const input = {
      workDir: 'E:/StoryDream-QA/render-project', projectTitle: 'Series', modeLabel: 'AI comic', ratio: '16:9',
      scenes: [{ id: 'shot', index: 1, title: 'Shot', caption: '', durationMs: 1000, renderStrategy: 'deterministic-layers' as const, layers: [{ id: 'image', label: 'Image', imagePath: 'E:/fixture.png', zIndex: 0, depth: 0, motion: [] }], camera: [], audioPath: 'E:/fixture.wav' }],
    };
    try {
      const [first, second] = await Promise.all([renderDirectorVideo(input), renderDirectorVideo(input)]);
      expect(first.outputPath).not.toBe(second.outputPath);
      const renderCalls = mocks.render.mock.calls as unknown as Array<[Record<string, unknown>]>;
      const firstCall = renderCalls[0][0];
      const secondCall = renderCalls[1][0];
      expect(firstCall.workDir).not.toBe(secondCall.workDir);
      expect(firstCall.workDir).toContain('director-renders');
      expect(secondCall.workDir).toContain('director-renders');
      const removed = (mocks.rm.mock.calls as unknown as Array<[string]>).map(([path]) => String(path));
      expect(removed.every((path) => path.includes('director-renders'))).toBe(true);
      expect(new Set((mocks.copyFile.mock.calls as unknown as Array<[string, string]>).map(([, path]) => path)).size).toBe(2);
    } finally { vi.restoreAllMocks(); }
  });
});

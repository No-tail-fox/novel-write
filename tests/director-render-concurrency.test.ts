import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ render: vi.fn(), statfs: vi.fn(async () => ({ bavail: 1024 * 1024, bsize: 4096 })), mkdir: vi.fn(async () => undefined), rm: vi.fn(async () => undefined), copyFile: vi.fn(async () => undefined) }));
vi.mock('node:fs/promises', () => ({ ...mocks, stat: vi.fn(async () => ({ isFile: () => true, size: 1024 })) }));
vi.mock('../electron/html-video-renderer', () => ({ createElectronHtmlVideoRenderer: () => ({ render: mocks.render }) }));
vi.mock('../src/shared/storybound-sidecar', () => ({ runStoryboundMediaSidecar: vi.fn(async () => ({ duration: 1, width: 1920, height: 1080, has_audio: true, has_video: true, has_nonblack_video: true })) }));
import { renderDirectorVideo } from '../electron/director-renderer';

describe('director concurrent render staging', () => {
  beforeEach(() => vi.clearAllMocks());
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

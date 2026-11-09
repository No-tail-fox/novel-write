import { describe, expect, it, vi } from 'vitest';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import { resolveDirectorOutputMediaUrl } from '../src/features/director-desk/director-output-media';

describe('director output media URL resolution', () => {
  it('passes the owning project and full nested export path to the media API', async () => {
    const getTaskMediaUrl = vi.fn(async () => 'storydream-media://task/project/director-renders/run/exports/final.mp4');
    const api = { getTaskMediaUrl } as unknown as Pick<StoryDreamApi, 'getTaskMediaUrl'>;
    const path = 'director-renders/run/exports/final.mp4';

    await expect(resolveDirectorOutputMediaUrl(api, 'project', path)).resolves.toBe('storydream-media://task/project/director-renders/run/exports/final.mp4');
    expect(getTaskMediaUrl).toHaveBeenCalledOnce();
    expect(getTaskMediaUrl).toHaveBeenCalledWith('project', path);
  });

  it('rejects missing project IDs and media paths without calling the API', async () => {
    const getTaskMediaUrl = vi.fn(async () => 'unused');
    const api = { getTaskMediaUrl } as unknown as Pick<StoryDreamApi, 'getTaskMediaUrl'>;

    await expect(resolveDirectorOutputMediaUrl(api, '  ', 'exports/final.mp4')).rejects.toThrow('当前项目尚未就绪');
    await expect(resolveDirectorOutputMediaUrl(api, 'project', '  ')).rejects.toThrow('成片文件路径缺失');
    expect(getTaskMediaUrl).not.toHaveBeenCalled();
  });

  it('preserves media API failures for the UI error state', async () => {
    const failure = new Error('media protocol unavailable');
    const getTaskMediaUrl = vi.fn(async () => { throw failure; });
    const api = { getTaskMediaUrl } as unknown as Pick<StoryDreamApi, 'getTaskMediaUrl'>;

    await expect(resolveDirectorOutputMediaUrl(api, 'project', 'exports/final.mp4')).rejects.toBe(failure);
  });
});

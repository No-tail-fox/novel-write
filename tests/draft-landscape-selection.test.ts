import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeFallbackApi } from '../src/app/browser-fallback';
import { draftTemplateGuides, draftTemplates, matchingDraftTemplateId, resolveDraftTemplateForRatio } from '@shared/templates';

afterEach(() => vi.unstubAllGlobals());

describe('landscape draft selection', () => {
  it('persists the selected frame ratio so repacking cannot fall back to the old portrait layout', async () => {
    const values = new Map<string, string>([['storydream-state', JSON.stringify({
      tasks: [{ id: 'ratio-switch', title: '画幅切换', inputText: '画幅切换测试', ratio: '9:16', templateId: 'default-portrait-9-16', status: 'paused' }],
    })]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const api = makeFallbackApi(() => undefined);
    const landscapes = draftTemplates.filter((template) => template.canvas.ratio === '16:9' && draftTemplateGuides[template.id]);
    expect(landscapes).toHaveLength(5);
    for (const template of landscapes) {
      await api.updateTaskTemplate('ratio-switch', template.id);
      const restored = await makeFallbackApi(() => undefined).getTaskDetail('ratio-switch');
      expect(restored).toMatchObject({ templateId: template.id, ratio: '16:9' });
      expect(matchingDraftTemplateId(draftTemplates, restored!.ratio, restored!.templateId)).toBe(template.id);
      expect(resolveDraftTemplateForRatio(template, restored!.ratio)).toEqual(template);
    }
    await expect(api.updateTaskTemplate('ratio-switch', 'missing')).rejects.toThrow('草稿模板不存在');
    expect(await api.getTaskDetail('ratio-switch')).toMatchObject({ ratio: '16:9', templateId: landscapes.at(-1)!.id });
    await api.updateTaskTemplate('ratio-switch', 'default-portrait-9-16');
    expect(await api.getTaskDetail('ratio-switch')).toMatchObject({ ratio: '9:16', templateId: 'default-portrait-9-16' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  createImageLabPromptTemplate,
  deleteImageLabPromptTemplate,
  IMAGE_LAB_PROMPT_TEMPLATES_STORAGE_KEY,
  IMAGE_LAB_WORKSPACE_STORAGE_KEY,
  imageLabTabForPromptMode,
  readImageLabPromptTemplates,
  readImageLabWorkspaceDraft,
  upsertImageLabPromptTemplate,
  writeImageLabPromptTemplates,
  writeImageLabWorkspaceDraft,
} from '../src/features/labs/image-lab-workspace';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    seed: (key: string, value: string) => values.set(key, value),
  };
}

describe('image lab workspace persistence', () => {
  it('round-trips the complete workbench state and normalizes stale collection values', () => {
    const storage = createMemoryStorage();
    writeImageLabWorkspaceDraft(storage, {
      version: 1,
      savedAt: '2026-08-05T00:00:00.000Z',
      tab: 'reference',
      smartMode: 'reference-edit',
      prompt: '延展参考图',
      selectedRatios: ['9:16', '9:16', '1:1'],
      selectedStyles: ['photo-real'],
      provider: 'custom',
      resolution: '2K',
      quality: 'high',
      referenceImagePath: 'D:/refs/a.png',
      outputCount: 4,
    });

    expect(readImageLabWorkspaceDraft(storage)).toEqual({
      version: 1,
      savedAt: '2026-08-05T00:00:00.000Z',
      tab: 'reference',
      smartMode: 'reference-edit',
      prompt: '延展参考图',
      selectedRatios: ['9:16', '1:1'],
      selectedStyles: ['photo-real'],
      provider: 'custom',
      resolution: '2K',
      quality: 'high',
      referenceImagePath: 'D:/refs/a.png',
      outputCount: 4,
    });
  });

  it('ignores corrupt or incompatible workspace snapshots', () => {
    const storage = createMemoryStorage();
    storage.seed(IMAGE_LAB_WORKSPACE_STORAGE_KEY, '{bad json');
    expect(readImageLabWorkspaceDraft(storage)).toBeNull();
    storage.seed(IMAGE_LAB_WORKSPACE_STORAGE_KEY, JSON.stringify({ version: 2, tab: 'smart' }));
    expect(readImageLabWorkspaceDraft(storage)).toBeNull();
  });
});

describe('image lab prompt templates', () => {
  it('persists mode and body while replacing duplicate names deterministically', () => {
    const storage = createMemoryStorage();
    const first = createImageLabPromptTemplate({
      id: 'template-1',
      name: '播客封面',
      mode: 'podcast-cover',
      body: '第一版提示词',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    const replacement = createImageLabPromptTemplate({
      id: 'template-2',
      name: ' 播客封面 ',
      mode: 'podcast-cover',
      body: '第二版提示词',
      updatedAt: '2026-08-05T01:00:00.000Z',
    });
    const templates = upsertImageLabPromptTemplate(upsertImageLabPromptTemplate([], first), replacement);
    writeImageLabPromptTemplates(storage, templates);

    expect(readImageLabPromptTemplates(storage)).toEqual([replacement]);
    expect(deleteImageLabPromptTemplate(templates, replacement.id)).toEqual([]);
    expect(imageLabTabForPromptMode('podcast-cover')).toBe('smart');
    expect(imageLabTabForPromptMode('text-to-image')).toBe('text');
    expect(imageLabTabForPromptMode('reference-edit')).toBe('reference');
  });

  it('drops malformed templates without losing valid neighbors', () => {
    const storage = createMemoryStorage();
    storage.seed(IMAGE_LAB_PROMPT_TEMPLATES_STORAGE_KEY, JSON.stringify({
      version: 1,
      templates: [
        { id: '', name: '', mode: 'bad', body: '' },
        { id: 'bad-time', name: '损坏时间', mode: 'cover', body: '不应恢复', createdAt: 'now', updatedAt: 'now' },
        { id: 'valid', name: '有效模板', mode: 'cover', body: '封面提示词', createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z' },
      ],
    }));
    expect(readImageLabPromptTemplates(storage).map((template) => template.id)).toEqual(['valid']);
  });
});

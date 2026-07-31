import { describe, expect, it } from 'vitest';
import {
  MAX_NEW_TASK_PRESETS,
  clearNewTaskDraft,
  createNewTaskPreset,
  deleteNewTaskPreset,
  readNewTaskDraft,
  readNewTaskPresets,
  upsertNewTaskPreset,
  writeNewTaskDraft,
  writeNewTaskPresets,
  type NewTaskDraftSnapshot,
} from '../src/features/tasks/new-task-draft';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('new task local draft', () => {
  it('round-trips staged values, manual override ownership, and selected source provenance', () => {
    const storage = memoryStorage();
    const draft: NewTaskDraftSnapshot = {
      version: 1,
      savedAt: '2026-07-23T00:00:00.000Z',
      activeStage: 'creative',
      values: {
        title: '武则天：从深宫才人到一代女皇',
        inputText: '正文',
        mode: 'ai',
        track: 'character-story',
        style: 'photo-real',
        ratio: '9:16',
        templateId: 'default-portrait-9-16',
        promptTemplateOverrideId: 'character-story',
        promptTemplateManuallyOverridden: true,
        styleManuallyOverridden: true,
        draftTemplateManuallyOverridden: true,
        ratioManuallyOverridden: true,
        selectedSearchSourceIds: ['source-1'],
        selectedSources: [{ source: 'web', title: '来源', url: 'https://example.com', content: '证据正文' }],
      },
    };

    writeNewTaskDraft(storage, draft);
    expect(readNewTaskDraft(storage)).toEqual(draft);
    clearNewTaskDraft(storage);
    expect(readNewTaskDraft(storage)).toBeNull();
  });

  it('rejects corrupt and unknown-version payloads', () => {
    const storage = memoryStorage();
    storage.setItem('storydream.new-task-draft.v1', '{broken');
    expect(readNewTaskDraft(storage)).toBeNull();
    storage.setItem('storydream.new-task-draft.v1', JSON.stringify({ version: 2, values: {} }));
    expect(readNewTaskDraft(storage)).toBeNull();
  });

  it('stores bounded named presets while stripping one-use manual-cover credentials', () => {
    const storage = memoryStorage();
    const snapshot: NewTaskDraftSnapshot = {
      version: 1,
      savedAt: '2026-07-31T00:00:00.000Z',
      activeStage: 'output',
      values: {
        title: '知识卡人物故事',
        inputText: '完整文案',
        track: 'character-story',
        ratio: '9:16',
        ttsProvider: 'volcengine',
        coverImageMode: 'manual',
        manualCoverAsset: {
          id: 'one-use-cover',
          originalName: 'cover.png',
          mimeType: 'image/png',
          sha256: 'a'.repeat(64),
          width: 1080,
          height: 1920,
          sizeBytes: 1024,
          ratio: '9:16',
          createdAt: '2026-07-31T00:00:00.000Z',
        },
      },
    };
    const preset = createNewTaskPreset({ id: 'knowledge-card', name: '知识卡人物', snapshot });

    expect(preset.name).toBe('知识卡人物');
    expect(preset.snapshot.values).toMatchObject({ track: 'character-story', ratio: '9:16', coverImageMode: 'manual' });
    expect(preset.snapshot.values.manualCoverAsset).toBeUndefined();

    writeNewTaskPresets(storage, [preset]);
    expect(readNewTaskPresets(storage)).toEqual([preset]);

    const replacement = createNewTaskPreset({ id: 'knowledge-card', name: '知识卡人物（更新）', snapshot: { ...snapshot, savedAt: '2026-07-31T01:00:00.000Z' } });
    expect(upsertNewTaskPreset([preset], replacement)).toEqual([replacement]);
    expect(deleteNewTaskPreset([replacement], replacement.id)).toEqual([]);

    const bounded = Array.from({ length: MAX_NEW_TASK_PRESETS + 1 }, (_, index) => createNewTaskPreset({
      id: `preset-${index}`,
      name: `预设 ${index}`,
      snapshot: { ...snapshot, savedAt: `2026-07-31T${String(index).padStart(2, '0')}:00:00.000Z` },
    })).reduce(upsertNewTaskPreset, []);
    expect(bounded).toHaveLength(MAX_NEW_TASK_PRESETS);
    expect(bounded.some((item) => item.id === 'preset-0')).toBe(false);
  });

  it('rejects corrupt preset collections and blank preset names', () => {
    const storage = memoryStorage();
    storage.setItem('storydream.new-task-presets.v1', JSON.stringify({ version: 2, presets: [] }));
    expect(readNewTaskPresets(storage)).toEqual([]);
    expect(() => createNewTaskPreset({
      id: 'invalid',
      name: '   ',
      snapshot: { version: 1, savedAt: '2026-07-31T00:00:00.000Z', activeStage: 'material', values: {} },
    })).toThrow('NEW_TASK_PRESET_NAME_INVALID');
  });
});

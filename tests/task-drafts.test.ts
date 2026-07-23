import { describe, expect, it } from 'vitest';
import {
  clearNewTaskDraft,
  readNewTaskDraft,
  writeNewTaskDraft,
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
});

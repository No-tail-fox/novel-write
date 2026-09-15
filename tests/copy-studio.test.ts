import { describe, expect, it } from 'vitest';
import type { AiSourceSection } from '../src/shared/types';
import { COPY_STUDIO_STORAGE_KEY, copySourceKey, createCopyRevision, handoffCopyToVideo, readCopyStudioDocument, writeCopyStudioDocument } from '../src/features/copy-studio/copy-studio';
import { NEW_TASK_DRAFT_STORAGE_KEY } from '../src/features/tasks/new-task-draft';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
}

const source: AiSourceSection = { source: '必应', provider: 'bing', title: '人物资料', url: 'https://example.com/a', content: '可核验事实。' };

describe('copy studio document', () => {
  it('keeps sources and every refinement revision in local storage', () => {
    const storage = memoryStorage();
    const revision = createCopyRevision({ kind: 'refine', label: '精修 1', instruction: '加强开头', text: '精修后的文案' }, new Date('2026-09-15T00:00:00.000Z'));
    writeCopyStudioDocument(storage, { version: 1, topic: '测试人物', requirements: '真实', track: 'character-story', sourceIds: [copySourceKey(source)], sources: [source], revisions: [revision], activeRevisionId: revision.id, updatedAt: revision.createdAt });
    expect(storage.getItem(COPY_STUDIO_STORAGE_KEY)).toContain('精修后的文案');
    expect(readCopyStudioDocument(storage)?.revisions).toEqual([revision]);
  });

  it('hands the final copy to video creation and maps skip review to direct copy', () => {
    const storage = memoryStorage();
    const snapshot = handoffCopyToVideo(storage, { title: '最终标题', copy: '最终定稿文案', topic: '主题', requirements: '要求', track: 'character-story', sources: [source], skipReview: true }, new Date('2026-09-15T01:00:00.000Z'));
    expect(snapshot.activeStage).toBe('creative');
    expect(snapshot.values).toMatchObject({ title: '最终标题', inputText: '最终定稿文案', mode: 'paste', publishMode: 'direct-copy', researchCopy: '最终定稿文案' });
    expect(snapshot.values.selectedSearchSourceIds).toEqual([copySourceKey(source)]);
    expect(storage.getItem(NEW_TASK_DRAFT_STORAGE_KEY)).toContain('direct-copy');
  });

  it('keeps review enabled when the author does not skip it', () => {
    const storage = memoryStorage();
    expect(handoffCopyToVideo(storage, { title: '', copy: '文案', topic: '主题', requirements: '', track: 'knowledge', sources: [], skipReview: false }).values.publishMode).toBe('review-rewrite');
  });
});

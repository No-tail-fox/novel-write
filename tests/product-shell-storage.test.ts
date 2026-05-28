import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';

describe('product shell storage', () => {
  it('migrates a database with complete shell defaults', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-shell-defaults-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const state = await db.getState();

      expect(state.promptTemplates.map((template) => template.name)).toContain('人物故事');
      expect(state.promptTemplates.filter((template) => template.type === 'task').map((template) => template.baseTrack)).toEqual(
        expect.arrayContaining(['character-story', 'health-book', 'culture-science', 'picture-book', 'ecommerce', 'mind-soup', 'folk-story', 'general-story', 'food-v2']),
      );
      expect(state.promptTemplates.map((template) => template.id)).toEqual(expect.arrayContaining(['builtin-review', 'builtin-rewrite', 'builtin-cover', 'builtin-storyboard', 'builtin-image-prompt']));
      expect(state.draftTemplates.map((template) => template.id)).toEqual(
        expect.arrayContaining(['default-portrait-9-16', 'builtin-portrait-4-3', 'builtin-landscape-16-9']),
      );
      expect(state.imageLabRecords).toEqual([]);
      expect(state.customStyles.map((style) => style.name)).toContain('写实彩色');
      expect(state.account.displayName).toBe('本地用户');
      expect(state.activation.plan).toBe('trial');
      expect(state.ui.activeView).toBe('new-task');

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('adds missing built-in prompt templates without overwriting existing user edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-shell-template-reconcile-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertPromptTemplate({
        id: 'system-character-story',
        name: '人物故事',
        type: 'task',
        content: '用户已经修改过的内置人物模板',
        isBuiltin: true,
        baseTrack: 'character-story',
      });
      (db as unknown as { db: { run: (sql: string, params?: unknown[]) => void } }).db.run('DELETE FROM prompt_templates WHERE id = ?', ['system-food-v2']);
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.promptTemplates.find((template) => template.id === 'system-character-story')?.content).toBe('用户已经修改过的内置人物模板');
      expect(state.promptTemplates.find((template) => template.id === 'system-food-v2')?.content).toContain('烟火气');

      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resets built-in prompt templates while preserving custom templates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-shell-template-reset-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertPromptTemplate({
        id: 'custom-local-template',
        name: '本地模板',
        type: 'task',
        content: '自定义模板内容',
        isBuiltin: false,
        baseTrack: 'general-story',
      });
      await db.upsertPromptTemplate({
        id: 'builtin-review',
        name: '预审整理',
        type: 'review',
        content: '临时覆盖预审模板',
        isBuiltin: true,
      });

      await db.resetPromptTemplates();
      const state = await db.getState();

      expect(state.promptTemplates.find((template) => template.id === 'custom-local-template')?.content).toBe('自定义模板内容');
      expect(state.promptTemplates.find((template) => template.id === 'builtin-review')?.content).not.toBe('临时覆盖预审模板');

      await db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('persists prompt templates, draft template edits, and image lab records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-shell-records-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      await db.upsertPromptTemplate({
        id: 'custom-rewrite-hook',
        name: '强钩子改写',
        type: 'rewrite',
        content: '先给出反差，再进入人物命运转折。',
        isBuiltin: false,
      });

      const draft = (await db.getState()).draftTemplates.find((template) => template.id === 'default-portrait-9-16');
      expect(draft).toBeDefined();
      await db.upsertDraftTemplate({
        ...draft!,
        name: '竖屏字幕加粗',
        caption: { ...draft!.caption, bold: true, fontSize: 14 },
      });

      await db.addImageLabRecord({
        prompt: '唐代宫殿中的武则天，电影级写实光影',
        ratio: '9:16',
        style: 'photo-real',
        provider: 'mock',
        imagePath: '',
      });
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();

      expect(state.promptTemplates.find((template) => template.id === 'custom-rewrite-hook')?.content).toContain('人物命运');
      expect(state.draftTemplates.find((template) => template.id === 'default-portrait-9-16')?.caption.bold).toBe(true);
      expect(state.imageLabRecords[0]).toMatchObject({
        prompt: '唐代宫殿中的武则天，电影级写实光影',
        ratio: '9:16',
        provider: 'mock',
      });

      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hydrates legacy draft templates with draggable canvas coordinates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-shell-draft-layout-'));
    const file = join(dir, 'app.db');

    try {
      const db = await FileDatabase.open(file);
      const draft = (await db.getState()).draftTemplates.find((template) => template.id === 'default-portrait-9-16');
      expect(draft).toBeDefined();
      const legacyTemplate = {
        ...draft!,
        title: { visible: true, text: 'Legacy Title', fontSize: 44, color: '#ffde00' },
        subtitle: { visible: true, fontSize: 22, color: '#ffffff' },
        caption: { ...draft!.caption, x: undefined as unknown as number },
        disclaimer: { visible: true, text: 'Legacy disclaimer' },
      } as unknown as typeof draft;
      await db.upsertDraftTemplate(legacyTemplate!);
      await db.close();

      const reopened = await FileDatabase.open(file);
      const state = await reopened.getState();
      const hydrated = state.draftTemplates.find((template) => template.id === 'default-portrait-9-16');

      expect(hydrated?.title).toMatchObject({ x: 0, y: -0.1 });
      expect(hydrated?.subtitle).toMatchObject({ x: 0, y: 0.02 });
      expect(hydrated?.caption).toMatchObject({ x: 0 });
      expect(typeof hydrated?.caption.y).toBe('number');
      expect(hydrated?.disclaimer).toMatchObject({ x: 0, y: 0.92 });

      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

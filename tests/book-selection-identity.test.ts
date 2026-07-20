import { rename, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileDatabase } from '@shared/storage';

const completeProduct = {
  name: '额尔古纳河右岸', author: '迟子建', category: '文学', keyword: '鄂温克族',
  sellPoint: '民族史诗', audience: '文学读者', persons: '迟子建', era: '现代',
  price: '39.8', url: 'https://example.com/book', note: '完整商品字段',
};

describe('book selection composite identity', () => {
  it('updates the same key and atomically renames a composite identity without losing product data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-book-identity-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      await db.upsertBookSelection({ theme: '文学', bookId: 'erguna', data: completeProduct });
      await db.upsertBookSelection({
        theme: '文学', bookId: 'erguna', previousIdentity: { theme: '文学', bookId: 'erguna' },
        data: { ...completeProduct, price: '42' },
      });
      expect(await db.listBookSelections()).toHaveLength(1);

      const renamed = await db.upsertBookSelection({
        theme: '历史文学', bookId: 'erguna-2026', previousIdentity: { theme: '文学', bookId: 'erguna' }, data: completeProduct,
      });
      expect(renamed).toMatchObject({ theme: '历史文学', bookId: 'erguna-2026', data: completeProduct });
      expect(await db.listBookSelections()).toEqual([renamed]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects stale previous identities and occupied destinations without changing rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-book-conflict-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      await db.upsertBookSelection({ theme: 'A', bookId: 'one', data: completeProduct });
      await db.upsertBookSelection({ theme: 'B', bookId: 'two', data: { ...completeProduct, name: '目标书' } });
      await expect(db.upsertBookSelection({
        theme: 'C', bookId: 'three', previousIdentity: { theme: 'missing', bookId: 'one' }, data: completeProduct,
      })).rejects.toThrow(/BOOK_SELECTION_STALE_IDENTITY/);
      await expect(db.upsertBookSelection({
        theme: 'B', bookId: 'two', previousIdentity: { theme: 'A', bookId: 'one' }, data: completeProduct,
      })).rejects.toThrow(/BOOK_SELECTION_DESTINATION_CONFLICT/);
      expect((await db.listBookSelections()).map((item) => [item.theme, item.bookId])).toEqual([['B', 'two'], ['A', 'one']]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rolls back the rename when atomic database publication fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-book-rollback-'));
    const file = join(dir, 'app.db');
    let rejectReplace = false;
    const db = await FileDatabase.open(file, {
      replaceFile: async (source, target) => {
        if (rejectReplace) throw new Error('injected book selection commit failure');
        await rename(source, target);
      },
    });
    try {
      await db.upsertBookSelection({ theme: 'A', bookId: 'one', data: completeProduct });
      rejectReplace = true;
      await expect(db.upsertBookSelection({
        theme: 'B', bookId: 'two', previousIdentity: { theme: 'A', bookId: 'one' }, data: completeProduct,
      })).rejects.toThrow('injected book selection commit failure');
      rejectReplace = false;
      expect((await db.listBookSelections()).map((item) => [item.theme, item.bookId])).toEqual([['A', 'one']]);
    } finally {
      rejectReplace = false;
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

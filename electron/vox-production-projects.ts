import type { FileDatabase } from '../src/shared/storage';

/** History categories separate music MVs; recovery still owns their Lemo journals. */
export async function listVoxProductionProjects(database: Pick<FileDatabase, 'listTaskSummaries'>): Promise<string[]> {
  const ids = new Set<string>();
  for (const taskType of ['editorial-collage', 'music-mv'] as const) {
    let cursor: string | null = null;
    do {
      const page = await database.listTaskSummaries({ taskType, cursor, limit: 100 });
      for (const task of page.items) if (task.taskType === 'editorial-collage') ids.add(task.id);
      cursor = page.nextCursor;
    } while (cursor);
  }
  return [...ids];
}

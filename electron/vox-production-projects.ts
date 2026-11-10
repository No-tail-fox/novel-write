import type { FileDatabase } from '../src/shared/storage';

/** History categories separate music MVs and 模板动画; recovery still owns all of their production journals. */
export async function listVoxProductionProjects(database: Pick<FileDatabase, 'listTaskSummaries'>): Promise<string[]> {
  const ids = new Set<string>();
  for (const taskType of ['editorial-collage', 'template-animation', 'music-mv'] as const) {
    let cursor: string | null = null;
    do {
      const page = await database.listTaskSummaries({ taskType, cursor, limit: 100 });
      for (const task of page.items) if (task.taskType === 'editorial-collage') ids.add(task.id);
      cursor = page.nextCursor;
    } while (cursor);
  }
  return [...ids];
}

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Agent Search creation UI', () => {
  it.each([
    ['ordinary video', '../src/features/tasks/NewTaskPage.tsx'],
    ['HTML video', '../src/features/html-video/HtmlVideoPage.tsx'],
  ])('shows backend status and backend-aware source attribution in %s', async (_name, file) => {
    const page = await readFile(new URL(file, import.meta.url), 'utf8');

    expect(page).toContain('searchContext.backendStatuses.map');
    expect(page).toContain('aria-label="搜索后端状态"');
    expect(page).toContain('formatWebSearchBackendStatus(status)');
    expect(page).toContain('formatWebSearchSourceLabel(source)');
  });
});

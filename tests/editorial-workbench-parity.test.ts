import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sidebarNavItems } from '../src/app/navigation';
import { SHELL_VIEWS } from '../src/shared/types';
import { HTML_VIDEO_CONTROL_FIELDS } from '../src/shared/html-video-control-manifest';
import {
  CUSTOM_COVER_TEMPLATE_FIELDS,
  IMAGE_LAB_SMART_MODE_CONTRACT,
  MINIMAX_CLONE_VOICE_FIELDS,
} from '../src/shared/editorial-data-contracts';
import { approvedConceptVisibleCopy, approvedEditorialInventories } from './fixtures/editorial-workbench-parity';

describe('editorial workbench functional parity inventory', () => {
  it('matches every independently approved value inventory exactly', async () => {
    const types = await readFile(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const createInput = types.slice(types.indexOf('export type CreateTaskInput'), types.indexOf('export interface TaskEvent'));
    const createFields = [...createInput.matchAll(/^\s*\| '([^']+)'/gmu)].map((match) => match[1]);
    const actual = {
      shellViews: [...SHELL_VIEWS],
      sidebarViews: sidebarNavItems.map((item) => item.view),
      createTaskInputFields: createFields,
      htmlVideoFields: [...HTML_VIDEO_CONTROL_FIELDS],
      imageSmartModes: Object.keys(IMAGE_LAB_SMART_MODE_CONTRACT),
      customCoverFields: Object.keys(CUSTOM_COVER_TEMPLATE_FIELDS),
      minimaxCloneVoiceFields: Object.keys(MINIMAX_CLONE_VOICE_FIELDS),
    };

    for (const [name, approved] of Object.entries(approvedEditorialInventories)) {
      expect(actual[name as keyof typeof actual], name).toEqual(approved.values);
      expect(new Set(approved.values).size, `${name} has no duplicates`).toBe(approved.values.length);
      expect(approved.owner.length, `${name} owner`).toBeGreaterThan(0);
      expect(approved.consumer.length, `${name} consumer`).toBeGreaterThan(0);
      expect(approved.test.length, `${name} test`).toBeGreaterThan(0);
    }
  });

  it('locks nine accepted concept capture ids and ordered visible copy', () => {
    const entries = Object.entries(approvedConceptVisibleCopy);
    expect(entries).toHaveLength(9);
    for (const [captureId, copy] of entries) {
      expect(captureId.split('/')).toHaveLength(4);
      expect(copy.length).toBeGreaterThan(0);
      expect(new Set(copy).size).toBe(copy.length);
    }
  });

  it('preserves the accepted task-history copy while adding other history families', async () => {
    const [history, css] = await Promise.all([
      readFile(new URL('../src/features/tasks/HistoryPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    ]);
    expect(history).toContain("placeholder={family === 'task' ? '搜索任务' : '搜索记录'}");
    expect(history).toContain("family === 'task' ? ['任务', '状态', '进度', '创建时间', '输出']");
    expect(history).toContain("['记录', '状态', '详情', '创建时间', '操作']");
    expect(history).toContain('className="panel full-panel history-page"');
    expect(css).toMatch(/\.history-page \.table-row,[\s\S]*?grid-template-columns:[\s\S]*?minmax\(190px, auto\)/u);
    expect(css).toMatch(/\.history-page \.row-actions[\s\S]*?flex-wrap:\s*nowrap/u);
  });
});

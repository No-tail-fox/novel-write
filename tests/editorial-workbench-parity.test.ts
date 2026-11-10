import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { sidebarNavItems } from '../src/app/navigation';
import { HistoryPage } from '../src/features/tasks/HistoryPage';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { HistoryFamily } from '../src/shared/types';
import { SHELL_VIEWS } from '../src/shared/types';
import { StoryDreamProvider } from '../src/ui/StoryDreamProvider';
import { HTML_VIDEO_CONTROL_FIELDS } from '../src/shared/html-video-control-manifest';
import {
  CUSTOM_COVER_TEMPLATE_FIELDS,
  IMAGE_LAB_SMART_MODE_CONTRACT,
  MINIMAX_CLONE_VOICE_FIELDS,
} from '../src/shared/editorial-data-contracts';
import { approvedConceptVisibleCopy, approvedEditorialInventories } from './fixtures/editorial-workbench-parity';

// HistoryPage starts on the task family and only switches families after a select change event, which
// server markup cannot dispatch. Seed the initial family state instead (all other state is untouched).
const historyFamilySeed = vi.hoisted(() => ({ family: undefined as string | undefined }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = ((initial: unknown) => actual.useState(initial === 'task' && historyFamilySeed.family ? historyFamilySeed.family : initial)) as typeof actual.useState;
  return { ...actual, default: { ...actual, useState }, useState };
});

function historyMarkup(family?: Exclude<HistoryFamily, 'task'>): string {
  const pending = () => new Promise<never>(() => {});
  const api = { listTasks: pending, listViralAnalyses: pending, listImageLabRecords: pending, listVoiceLabRecords: pending } as unknown as StoryDreamApi;
  historyFamilySeed.family = family;
  try {
    return renderToStaticMarkup(createElement(StoryDreamProvider, {
      theme: 'dark',
      children: createElement(HistoryPage, { api, applyState: () => {}, openTaskDetail: () => {}, isTombstoned: () => false, familyEpochs: {} }),
    }));
  } finally {
    historyFamilySeed.family = undefined;
  }
}

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

    // The approved createTaskInputFields order is the new-task stage order (locked by task-control-manifest.test.ts);
    // the CreateTaskInput Pick union declaration order carries no meaning, so compare that inventory by exact membership.
    const unorderedInventories = new Set(['createTaskInputFields']);
    for (const [name, approved] of Object.entries(approvedEditorialInventories)) {
      const actualValues = actual[name as keyof typeof actual];
      if (unorderedInventories.has(name)) {
        expect(actualValues, `${name} has no duplicates`).toHaveLength(new Set(actualValues).size);
        expect([...actualValues].sort(), name).toEqual([...approved.values].sort());
      } else {
        expect(actualValues, name).toEqual(approved.values);
      }
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
    const css = await readFile(new URL('../src/styles/features/task-operations.css', import.meta.url), 'utf8');
    const columns = (markup: string) => [...markup.matchAll(/<span role="columnheader">([^<]*)<\/span>/gu)].map((match) => match[1]);
    const searchPlaceholder = (markup: string) => markup.match(/<input\b[^>]*placeholder="([^"]*)"/u)?.[1];
    // Task family (the default view): accepted task copy and columns.
    const task = historyMarkup();
    expect(task).toMatch(/<section class="task-operations-view history-page" data-task-operations="history" data-history-family="task">/u);
    expect(searchPlaceholder(task)).toBe('搜索任务标题');
    expect(columns(task)).toEqual(['任务', '类型', '当前状态', '进度', '更新时间', '操作']);
    // Every other history family uses the generic record copy and columns.
    for (const family of ['viral-analysis', 'image-lab', 'voice-lab'] as const) {
      const markup = historyMarkup(family);
      expect(markup).toContain(`data-history-family="${family}"`);
      expect(markup).toContain('class="task-operations-view history-page"');
      expect(searchPlaceholder(markup)).toBe('搜索记录');
      expect(columns(markup)).toEqual(['记录', '状态', '详情', '创建时间', '操作']);
    }
    expect(css).toMatch(/\.history-page\[data-task-operations="history"\] \.table-head,[\s\S]*?grid-template-columns:[\s\S]*?minmax\(180px, auto\)/u);
    expect(css).toMatch(/\.history-page\[data-task-operations="history"\] \.row-actions[\s\S]*?flex-wrap:\s*nowrap/u);
  });
});

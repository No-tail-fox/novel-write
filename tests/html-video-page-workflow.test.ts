import { describe, expect, it, vi } from 'vitest';
import {
  HTML_VIDEO_SEARCH_PROVIDERS,
  composeHtmlVideoResearchCopy,
  listAllHtmlVideoTaskOptions,
  searchHtmlVideoResearchSources,
  synchronizedHtmlVideoTaskId,
} from '../src/features/html-video/html-video-page-workflow';
import type { AiSourceContext, ResearchCopyComposeResult, TaskSummary } from '../src/shared/types';

function taskSummary(id: string, createdAt: string, title = id): TaskSummary {
  return { id, createdAt, title, taskType: 'html-video' } as TaskSummary;
}

describe('HTML video creation page workflow', () => {
  it('searches every configured web source and composes only from selected page bodies', async () => {
    const order: string[] = [];
    const searchWebSources = vi.fn(async (): Promise<AiSourceContext> => {
      order.push('search');
      return {
        query: '钱学森回国',
        sections: [
          { source: 'web', provider: 'bing', title: '有效资料', content: '正文资料', url: 'https://example.com/a' },
          { source: 'web', provider: 'sogou', title: '空资料', content: '' },
        ],
        warnings: ['百度未返回精准结果'],
      };
    });
    const composeResearchCopy = vi.fn(async (): Promise<ResearchCopyComposeResult> => {
      order.push('compose');
      return { title: '钱学森回国', copy: ' 生成后的完整文案 ', raw: '{}', requestId: 'req-1' };
    });

    const context = await searchHtmlVideoResearchSources({ searchWebSources }, {
      keyword: ' 钱学森回国 ',
      providers: [...HTML_VIDEO_SEARCH_PROVIDERS],
    });
    order.push(`sources:${context.sections.length}`);
    const result = await composeHtmlVideoResearchCopy({ composeResearchCopy }, {
      keyword: ' 钱学森回国 ',
      extraRequirements: ' 500 字 ',
      selectedSources: context.sections,
      warnings: context.warnings,
    });

    expect(searchWebSources).toHaveBeenCalledWith({
      query: '钱学森回国',
      providers: [...HTML_VIDEO_SEARCH_PROVIDERS],
    });
    expect(composeResearchCopy).toHaveBeenCalledWith({
      keyword: '钱学森回国',
      extraRequirements: '500 字',
      selectedSources: [expect.objectContaining({ title: '有效资料' })],
    });
    expect(order).toEqual(['search', 'sources:1', 'compose']);
    expect(result).toMatchObject({ copy: '生成后的完整文案', selectedSources: [{ title: '有效资料' }] });
  });

  it('keeps empty search results visible and does not allow composing without a selected source', async () => {
    const composeResearchCopy = vi.fn();
    const context = await searchHtmlVideoResearchSources({
      searchWebSources: vi.fn(async (): Promise<AiSourceContext> => ({
        query: '无结果',
        sections: [],
        warnings: ['搜索服务暂不可用'],
        providerStatuses: [{ provider: 'bing', label: '必应', state: 'failed', count: 0, message: '连接失败' }],
      })),
    }, {
      keyword: '无结果',
      providers: ['bing'],
    });

    expect(context).toMatchObject({
      sections: [],
      warnings: ['搜索服务暂不可用'],
      providerStatuses: [{ provider: 'bing', state: 'failed' }],
    });
    await expect(composeHtmlVideoResearchCopy({ composeResearchCopy }, {
      keyword: '无结果',
      extraRequirements: '',
      selectedSources: context.sections,
    })).rejects.toThrow('请先检索并勾选至少 1 个网页来源');
    expect(composeResearchCopy).not.toHaveBeenCalled();
  });

  it('rejects an empty provider selection instead of falling back to direct model generation', async () => {
    const searchWebSources = vi.fn();
    await expect(searchHtmlVideoResearchSources({ searchWebSources }, {
      keyword: ' 无检索创作 ',
      providers: [],
    })).rejects.toThrow('请至少选择一个搜索渠道');
    expect(searchWebSources).not.toHaveBeenCalled();
  });

  it('loads every active HTML task page, removes duplicates, and keeps newest first', async () => {
    const listTasks = vi.fn()
      .mockResolvedValueOnce({
        family: 'task', totalCount: 3, hasMore: true, nextCursor: 'page-2',
        items: [taskSummary('older', '2026-08-01T00:00:00.000Z')],
      })
      .mockResolvedValueOnce({
        family: 'task', totalCount: 3, hasMore: false, nextCursor: null,
        items: [
          taskSummary('newer', '2026-08-03T00:00:00.000Z'),
          taskSummary('older', '2026-08-01T00:00:00.000Z', '重复项'),
        ],
      });

    const tasks = await listAllHtmlVideoTaskOptions({ listTasks });

    expect(listTasks).toHaveBeenNthCalledWith(1, {
      filter: 'active', taskType: 'html-video', cursor: undefined, limit: 100,
    });
    expect(listTasks).toHaveBeenNthCalledWith(2, {
      filter: 'active', taskType: 'html-video', cursor: 'page-2', limit: 100,
    });
    expect(tasks.map((task) => task.id)).toEqual(['newer', 'older']);
    expect(synchronizedHtmlVideoTaskId('older', tasks)).toBe('older');
    expect(synchronizedHtmlVideoTaskId('deleted', tasks)).toBe('newer');
    expect(synchronizedHtmlVideoTaskId('', [])).toBe('');
  });
});

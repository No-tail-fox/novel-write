import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AiSourceSection, Task, TaskSummary, WebSearchProvider } from '../../shared/types';

export const HTML_VIDEO_SEARCH_PROVIDERS: readonly WebSearchProvider[] = ['bing', 'baidu', 'sogou', 'toutiao'];

export interface HtmlVideoTaskOption {
  id: string;
  title: string;
  createdAt: string;
}

export interface HtmlVideoResearchResult {
  copy: string;
  title: string;
  selectedSources: AiSourceSection[];
  warnings: string[];
}

export async function createHtmlVideoResearchCopy(
  api: Pick<StoryDreamApi, 'searchWebSources' | 'composeResearchCopy'>,
  input: {
    keyword: string;
    extraRequirements: string;
    searchEnabled?: boolean;
    onSourcesReady?: (sources: readonly AiSourceSection[]) => void;
  },
): Promise<HtmlVideoResearchResult> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error('请先输入创作主题。');

  let selectedSources: AiSourceSection[] = [];
  let warnings: string[] = [];
  if (input.searchEnabled !== false) {
    const context = await api.searchWebSources({
      query: keyword,
      providers: [...HTML_VIDEO_SEARCH_PROVIDERS],
    });
    selectedSources = context.sections
      .filter((source) => Boolean((source.content || source.snippet || '').trim()))
      .slice(0, 10);
    warnings = context.warnings;
    if (selectedSources.length === 0) {
      const warning = warnings.filter(Boolean).join('；');
      throw new Error(warning ? `没有找到可用于创作的网页资料：${warning}` : '没有找到可用于创作的网页资料，请更换创作主题后重试。');
    }
    input.onSourcesReady?.(selectedSources);
  }

  const composed = await api.composeResearchCopy({
    keyword,
    extraRequirements: input.extraRequirements.trim(),
    selectedSources,
  });
  const copy = composed.copy.trim();
  if (!copy) throw new Error('AI 未返回可用文案，请重试。');
  return {
    copy,
    title: composed.title.trim() || keyword,
    selectedSources,
    warnings,
  };
}

export function htmlVideoTaskOptionsFromTasks(
  tasks: ReadonlyArray<Pick<Task | TaskSummary, 'id' | 'title' | 'createdAt' | 'taskType'>>,
): HtmlVideoTaskOption[] {
  return tasks
    .filter((task) => task.taskType === 'html-video')
    .map(({ id, title, createdAt }) => ({ id, title, createdAt }))
    .sort(compareHtmlVideoTaskOptions);
}

export async function listAllHtmlVideoTaskOptions(
  api: Pick<StoryDreamApi, 'listTasks'>,
): Promise<HtmlVideoTaskOption[]> {
  const byId = new Map<string, HtmlVideoTaskOption>();
  let cursor: string | null | undefined;
  const seenCursors = new Set<string>();

  do {
    const page = await api.listTasks({
      filter: 'active',
      taskType: 'html-video',
      cursor,
      limit: 100,
    });
    htmlVideoTaskOptionsFromTasks(page.items).forEach((task) => byId.set(task.id, task));
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) throw new Error('HTML 动画任务分页游标重复，无法完成同步。');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return [...byId.values()].sort(compareHtmlVideoTaskOptions);
}

export function synchronizedHtmlVideoTaskId(
  activeTaskId: string,
  tasks: readonly HtmlVideoTaskOption[],
): string {
  if (activeTaskId && tasks.some((task) => task.id === activeTaskId)) return activeTaskId;
  return tasks[0]?.id ?? '';
}

function compareHtmlVideoTaskOptions(left: HtmlVideoTaskOption, right: HtmlVideoTaskOption): number {
  const byCreatedAt = right.createdAt.localeCompare(left.createdAt);
  return byCreatedAt || right.id.localeCompare(left.id);
}

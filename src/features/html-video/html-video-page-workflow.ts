import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AiSourceContext, AiSourceSection, Task, TaskSummary, WebSearchProvider } from '../../shared/types';

export const HTML_VIDEO_SEARCH_PROVIDERS: readonly WebSearchProvider[] = ['bing', 'baidu', 'sogou', 'toutiao'];
export const HTML_VIDEO_SEARCH_PROVIDER_OPTIONS: ReadonlyArray<{ id: WebSearchProvider; label: string; domain: string }> = [
  { id: 'bing', label: '必应', domain: 'bing.com' },
  { id: 'baidu', label: '百度', domain: 'baidu.com' },
  { id: 'sogou', label: '搜狗', domain: 'sogou.com' },
  { id: 'toutiao', label: '头条', domain: 'toutiao.com' },
];

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

export async function searchHtmlVideoResearchSources(
  api: Pick<StoryDreamApi, 'searchWebSources'>,
  input: {
    keyword: string;
    providers: WebSearchProvider[];
  },
): Promise<AiSourceContext> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error('请先输入创作主题。');
  const providers = [...new Set(input.providers)].filter((provider) => HTML_VIDEO_SEARCH_PROVIDERS.includes(provider));
  if (providers.length === 0) throw new Error('请至少选择一个搜索渠道。');

  const context = await api.searchWebSources({ query: keyword, providers });
  return {
    ...context,
    query: context.query.trim() || keyword,
    sections: usableHtmlVideoResearchSources(context.sections),
    warnings: context.warnings.filter(Boolean),
  };
}

export async function composeHtmlVideoResearchCopy(
  api: Pick<StoryDreamApi, 'composeResearchCopy'>,
  input: {
    keyword: string;
    extraRequirements: string;
    selectedSources: AiSourceSection[];
    warnings?: string[];
  },
): Promise<HtmlVideoResearchResult> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error('请先输入创作主题。');
  const selectedSources = usableHtmlVideoResearchSources(input.selectedSources);
  if (selectedSources.length === 0) throw new Error('请先检索并勾选至少 1 个网页来源。');

  const composed = await api.composeResearchCopy({
    keyword,
    extraRequirements: input.extraRequirements.trim(),
    selectedSources,
    useBuiltinKnowledge: false,
  });
  const copy = composed.copy.trim();
  if (!copy) throw new Error('AI 未返回可用文案，请重试。');
  return {
    copy,
    title: composed.title.trim() || keyword,
    selectedSources,
    warnings: (input.warnings ?? []).filter(Boolean),
  };
}

export function htmlVideoSearchProviderLabel(provider: WebSearchProvider | undefined): string {
  return HTML_VIDEO_SEARCH_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? '网页';
}

function usableHtmlVideoResearchSources(sources: readonly AiSourceSection[]): AiSourceSection[] {
  return sources
    .filter((source) => Boolean((source.content || source.snippet || '').trim()))
    .slice(0, 10);
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

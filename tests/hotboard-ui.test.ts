import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('hot board workbench ui', () => {
  it('owns refresh, filters, source assessment, external links, and creation handoff', async () => {
    const [page, aiHot, archiveControl, css, aiHotCss, shellCss, routes, navigation, newTask] = await Promise.all([
      source('src/features/hotboard/HotBoardPage.tsx'),
      source('src/features/hotboard/AiHotSourceView.tsx'),
      source('src/features/hotboard/ArchiveDateControl.tsx'),
      source('src/styles/features/hot-board.css'),
      source('src/styles/features/aihot-source.css'),
      source('src/styles/shell.css'),
      source('src/app/AppRoutes.tsx'),
      source('src/app/navigation.ts'),
      source('src/features/tasks/NewTaskPage.tsx'),
    ]);

    expect(navigation).toContain("view: 'hot-board', label: '实时热榜'");
    expect(routes).toContain("activeView === 'hot-board'");
    expect(page).not.toContain('AUTO_REFRESH_MS');
    expect(page).not.toContain('setInterval');
    expect(page).toContain('AI 信息源');
    expect(page).toContain('<AiHotSourceView');
    expect(page).toContain('api.fetchHotBoard({ date: archiveDate, forceRefresh })');
    expect(page).toContain('api.openHotBoardUrl(url)');
    expect(archiveControl).toContain('归档日期');
    expect(archiveControl).toContain('已保存');
    expect(archiveControl).toContain("origin === 'cache' || origin === 'network'");
    expect(page).toContain('立即刷新');
    expect(page).toContain('搜索热榜');
    expect(page).toContain('候选源评估');
    expect(page).toContain('/ 10 已接入');
    expect(page).toContain('打开原文');
    expect(page).toContain('打开来源');
    expect(page).toContain('hot-board-column-head');
    expect(page).toContain('hot-board-source-catalog');
    expect(page).toContain('当前未取得实时热点');
    expect(page).toContain('snapshot.items.length > 0 && filteredItems.length === 0');
    expect(page).toContain("? 'preview'");
    expect(page).toContain("feedState === 'preview'");
    expect(page).toContain("? '预览受限'");
    expect(page).toContain('snapshot.warnings.length > 2');
    expect(page).toContain('disabled={openingUrl === item.url}');
    expect(page).toContain('disabled={openingUrl === source.url}');
    expect(aiHot).toContain('api.queryAiHot({ query: request, date: archiveDate, forceRefresh })');
    expect(aiHot).not.toContain('AUTO_REFRESH_MS');
    expect(aiHot).not.toContain('setInterval');
    expect(aiHot).toContain("mode: 'daily'");
    expect(aiHot).toContain("mode: 'selected'");
    expect(aiHot).toContain("mode: 'all'");
    expect(aiHot).toContain("mode: 'category'");
    expect(aiHot).toContain("mode: 'recent'");
    expect(aiHot).toContain("mode: 'search'");
    expect(aiHot).toContain('if (nextMode !== mode)');
    expect(aiHot).toContain('lastRequestRef.current = null');
    expect(aiHot).toContain("runtimeState === 'preview'");
    expect(aiHot).toContain("? '预览受限'");
    expect(aiHot).toContain('++requestIdRef.current');
    expect(aiHot).toContain('handleSearchQueryChange(event.target.value)');
    expect(aiHot).toContain("runtimeState === 'unavailable'");
    expect(aiHot).toContain('sourceHeaderLabel');
    expect(aiHot).toContain("role={errorMessage || openError ? 'alert' : 'status'}");
    expect(page).toContain('formatAppErrorMessage(normalizeAppError(error))');
    expect(aiHot).toContain('formatAppErrorMessage(normalizeAppError(error))');
    expect(css).toContain('.hot-board-warning > span');
    expect(css).toContain('62px 118px');
    expect(css).toContain('white-space: nowrap');
    expect(css).toContain('.hot-board-create-action');
    expect(aiHot).toContain('用途与授权条款');
    expect(aiHot).toContain('hotboard_topic');
    expect(page).toContain("sessionStorage.setItem('hotboard_topic'");
    expect(page).toContain("navigate('new-task')");
    expect(newTask).toContain("sessionStorage.getItem('hotboard_topic')");
    expect(newTask).toContain("setMode('ai')");
    expect(newTask).toContain('已带入热榜选题');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(260px, 310px)');
    expect(css).toContain('.hot-board-column-head');
    expect(css).toContain('.hot-board-source-catalog');
    expect(css).toMatch(/\.hot-board-view-tabs button[\s\S]*background:\s*transparent/u);
    expect(aiHotCss).toMatch(/\.aihot-mode-tabs button[\s\S]*background:\s*transparent/u);
    expect(shellCss).toContain(".content:has(.page-head .local-note)");
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container hot-board-workspace (max-width: 900px)');
    expect(css).toContain('@container hot-board-workspace (max-width: 640px)');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('option');
    expect(css).not.toContain('text-overflow: ellipsis');
    expect(aiHotCss).not.toContain('-webkit-line-clamp: 2');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(aiHotCss).toContain('.aihot-mode-tabs');
  });

  it('keeps source and platform failures visible without replacing successful rows', async () => {
    const page = await source('src/features/hotboard/HotBoardPage.tsx');
    expect(page).toContain("status.state === 'failed'");
    expect(page).toContain('部分来源可用');
    expect(page).toContain("snapshot.warnings.slice(0, 2).join('；')");
    expect(page).toContain('filteredItems.map((item) =>');
  });
});

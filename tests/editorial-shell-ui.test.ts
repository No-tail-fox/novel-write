import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { navigationItems, newTaskPrimaryAction, primaryNavGroups, primaryNavItems, productionNavItems, sidebarNavGroups, sidebarNavItems, utilityNavItems } from '../src/app/navigation';
import { routeLoaders } from '../src/app/route-registry';

describe('editorial workbench shell', () => {
  it('keeps creative animation and AI motion-comic in production without a duplicate launcher row', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    expect(shell).not.toContain('director-quick-launch');
    expect(productionNavItems.map(({ view, label }) => [view, label])).toEqual([
      ['editorial-collage', '创意动画'], ['motion-comic', 'AI 漫剧'],
      ['html-video', 'HTML 动画'], ['music-mv', '音乐 MV'],
    ]);
    expect(primaryNavGroups.find((group) => group.id === 'projects')?.items.slice(1)).toEqual(productionNavItems);
  });

  it('preserves the independent create action and every registered navigable route exactly once', () => {
    const views = navigationItems.map((item) => item.view);
    expect(views).toEqual([
      'new-task', 'projects', 'editorial-collage', 'motion-comic', 'html-video', 'music-mv',
      'person-assets', 'copy-studio', 'conversation-workbench',
      'image-lab', 'voice-lab', 'video-lab', 'music-lab',
      'hot-board', 'benchmark', 'book-selection', 'viral-analyzer',
      'prompt-templates', 'draft-templates', 'queue', 'history', 'settings', 'account', 'activation',
    ]);
    expect(new Set(views).size).toBe(views.length);
    expect([...views, 'task-detail'].sort()).toEqual(Object.keys(routeLoaders).sort());
    expect(sidebarNavItems).toEqual([...primaryNavItems, ...utilityNavItems]);
    expect(navigationItems).toEqual([newTaskPrimaryAction, ...sidebarNavItems]);
    expect(sidebarNavItems.some((item) => item.view === newTaskPrimaryAction.view)).toBe(false);
    expect(sidebarNavGroups).toBe(primaryNavGroups);
    expect(primaryNavGroups.map(({ label }) => label)).toEqual(['项目', '素材库', '灵感', '模板', '任务', '设置']);
    for (const group of primaryNavGroups) {
      expect(group.items.some((item) => item.view === group.defaultView)).toBe(true);
    }
  });

  it('keeps status, recent task, account, activation, and a real theme control in the shell', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    for (const value of ['最近任务', '工作区状态已同步', '剪映草稿目录', '软件授权', '积分明细', '账户中心']) {
      expect(shell).toContain(value);
    }
    expect(shell).toContain('toggleTheme');
    expect(shell).not.toContain('<Tooltip content={themeLabel}>');
    expect(shell).toContain('label={themeLabel}');
    expect(shell).toContain('title={`${item.label} · ${item.hint}`}');
    expect(shell).not.toContain('data-contextual-tools-trigger');
    expect(shell).not.toContain('更多工具');
    expect(shell).not.toContain('<Menu');
    expect(shell).toContain('data-nav-view={item.view}');
    expect(shell).toContain('data-nav-view="activation"');
    expect(shell.match(/data-nav-view="account"/gu)).toHaveLength(2);
  });

  it('defines a stable editorial desktop shell and 1080 icon rail', async () => {
    const css = await source('../src/styles/shell.css');
    expect(css).toContain('.app-shell[data-editorial-shell]');
    expect(css).toContain('grid-template-columns: var(--sd-sidebar-width) minmax(0, 1fr)');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('@media (max-width: 1120px)');
    expect(css).toContain('grid-template-columns: 64px minmax(0, 1fr)');
    expect(css).toContain('width: 46px');
    expect(css).toContain('min-height: 38px');
    expect(css).not.toMatch(/gradient|bokeh|orb/iu);
  });

  it('keeps announcements reachable from the shell and updates actionable on narrow windows', async () => {
    const [shell, dialog, css] = await Promise.all([
      source('../src/app/AppShell.tsx'),
      source('../src/app/AnnouncementsDialog.tsx'),
      source('../src/styles/shell.css'),
    ]);
    expect(shell).toContain('className="announcement-entry"');
    expect(shell).toContain('setAnnouncementsOpen(true)');
    expect(dialog).toContain("label: '更新公告'");
    expect(dialog).toContain("label: '问题公告'");
    expect(dialog).toContain("{category === 'update' ? <div className=\"announcement-update-action\">");
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain('announcement-unread-count');
  });
});

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

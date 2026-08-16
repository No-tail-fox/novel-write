import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('editorial workbench shell', () => {
  it('keeps six primary entries while preserving every contextual route', async () => {
    const navigation = await source('../src/app/navigation.ts');
    const views = [...navigation.matchAll(/\{ view: '([^']+)', label:/gu)].map((match) => match[1]);
    expect(views).toEqual([
      'new-task', 'hot-board', 'history', 'queue', 'person-assets', 'draft-templates', 'settings',
      'book-selection', 'benchmark', 'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer',
      'html-video', 'prompt-templates', 'account', 'activation',
    ]);
    expect(navigation).toContain('navigationItems: NavigationItem[] = [newTaskPrimaryAction, ...sidebarNavItems, ...contextualToolNavItems]');
    expect(navigation).toContain('export const sidebarNavGroups');
    expect(navigation).toContain('export const contextualToolNavItems');
    for (const label of ['创作生产', '素材与实验', '模板与系统']) expect(navigation).toContain(`label: '${label}'`);
  });

  it('keeps status, recent task, account, trial, and a real theme control in the shell', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    for (const value of ['最近任务', '所有改动已保存', '剪映草稿目录', '试用剩余', '积分明细', '账户中心']) {
      expect(shell).toContain(value);
    }
    expect(shell).toContain('toggleTheme');
    expect(shell).toContain('<Tooltip content={themeLabel}>');
    expect(shell).toContain('label={themeLabel}');
    expect(shell).toContain('title={`${item.label} · ${item.hint}`}');
    expect(shell).toContain('data-contextual-tools-trigger');
    expect(shell).toContain('更多工具');
    expect(shell).toContain('data-nav-view={item.view}');
    expect(shell).toContain('data-nav-view="activation"');
    expect(shell.match(/data-nav-view="account"/gu)).toHaveLength(2);
  });

  it('defines a stable editorial desktop shell and 1080 icon rail', async () => {
    const css = await source('../src/styles/shell.css');
    expect(css).toContain('.app-shell[data-editorial-shell]');
    expect(css).toContain('grid-template-columns: 236px minmax(0, 1fr)');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('@media (max-width: 1120px)');
    expect(css).toContain('grid-template-columns: 68px minmax(0, 1fr)');
    expect(css).toContain('width: 48px');
    expect(css).toContain('min-height: 30px');
    expect(css).not.toMatch(/gradient|bokeh|orb/iu);
  });
});

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('editorial workbench shell', () => {
  it('preserves the independent action and exact nineteen-entry navigation order', async () => {
    const navigation = await source('../src/app/navigation.ts');
    const views = [...navigation.matchAll(/\{ view: '([^']+)', label:/gu)].map((match) => match[1]);
    expect(views).toEqual([
      'new-task', 'hot-board', 'queue', 'history', 'book-selection', 'benchmark', 'person-assets',
      'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'editorial-collage', 'motion-comic', 'html-video',
      'prompt-templates', 'draft-templates', 'settings', 'account', 'activation',
    ]);
    expect(navigation).toContain('navigationItems: NavigationItem[] = [newTaskPrimaryAction, ...sidebarNavItems]');
    expect(navigation).toContain('export const sidebarNavGroups');
    expect(navigation).not.toContain('export const contextualToolNavItems');
    for (const label of ['创作生产', '素材与实验', '模板与系统']) expect(navigation).toContain(`label: '${label}'`);
  });

  it('keeps status, recent task, account, trial, and a real theme control in the shell', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    for (const value of ['最近任务', '所有改动已保存', '剪映草稿目录', '试用剩余', '积分明细', '账户中心']) {
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
    expect(css).toContain('grid-template-columns: 236px minmax(0, 1fr)');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('@media (max-width: 1120px)');
    expect(css).toContain('grid-template-columns: 68px minmax(0, 1fr)');
    expect(css).toContain('width: 48px');
    expect(css).toContain('min-height: 30px');
    expect(css).toMatch(/@media \(max-width: 1120px\)[\s\S]*?\.app-shell\[data-editorial-shell\] \.sidebar-bottom \{[\s\S]*?display: none;/u);
    expect(css).not.toMatch(/gradient|bokeh|orb/iu);
  });
});

function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

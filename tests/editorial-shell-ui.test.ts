import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('editorial workbench shell', () => {
  it('preserves the independent action and exact fifteen-entry navigation order', async () => {
    const navigation = await source('../src/app/navigation.ts');
    const views = [...navigation.matchAll(/\{ view: '([^']+)', label:/gu)].map((match) => match[1]);
    expect(views).toEqual([
      'new-task', 'book-selection', 'benchmark', 'person-assets', 'queue', 'history',
      'image-lab', 'voice-lab', 'music-mv', 'viral-analyzer', 'prompt-templates',
      'draft-templates', 'settings', 'account', 'activation', 'html-video',
    ]);
    expect(navigation).toContain('navigationItems: NavigationItem[] = [newTaskPrimaryAction, ...sidebarNavItems]');
  });

  it('keeps status, recent task, account, trial, and a real theme control in the shell', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    for (const value of ['最近任务', '所有改动已保存', '剪映草稿目录', '试用剩余', '积分明细', '账户中心']) {
      expect(shell).toContain(value);
    }
    expect(shell).toContain('toggleTheme');
    expect(shell).toContain('aria-label={themeLabel}');
    expect(shell).toContain('title={themeLabel}');
    expect(shell).toContain('title={`${item.label} · ${item.hint}`}');
    expect(shell).not.toContain('更多');
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

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('unified StoryDream task system', () => {
  it('keeps project creation in the main shell and offers the real task types', async () => {
    const [routes, page, picker, css] = await Promise.all([
      source('src/app/AppRoutes.tsx'),
      source('src/features/tasks/NewTaskPage.tsx'),
      source('src/features/tasks/TaskCreationTypePicker.tsx'),
      source('src/styles/features/new-task.css'),
    ]);

    expect(routes).toContain('navigate={navigate}');
    expect(page).toContain('<TaskCreationTypePicker');
    expect(page).toContain("activeType=\"smart-video\"");
    for (const type of ['smart-video', 'vox', 'motion-comic', 'html-video']) {
      expect(picker).toContain(`id: '${type}'`);
    }
    expect(picker).toContain("taskCreationTarget(type.id)");
    expect(css).toContain('.new-task-type-picker');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
  });

  it('removes duplicate global workflow shortcuts and preloads the actual recent-task workspace', async () => {
    const [shell, navigation] = await Promise.all([
      source('src/app/AppShell.tsx'),
      source('src/app/navigation.ts'),
    ]);

    expect(shell).not.toContain('director-quick-launch');
    expect(shell).toContain('preloadRouteIntent(taskWorkspaceView(task.taskType))');
    const production = navigation.slice(navigation.indexOf('export const productionNavItems'), navigation.indexOf('export const assetLabNavItems'));
    const labs = navigation.slice(navigation.indexOf('export const assetLabNavItems'), navigation.indexOf('export const templateSystemNavItems'));
    expect(production).toContain("view: 'editorial-collage'");
    expect(production).toContain("view: 'motion-comic'");
    expect(labs).not.toContain("view: 'editorial-collage'");
    expect(labs).not.toContain("view: 'motion-comic'");
  });

  it('retires the route-local project library and uses the unified task destinations', async () => {
    const [start, editorial, comic] = await Promise.all([
      source('src/features/director-desk/DirectorProjectStart.tsx'),
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/motion-comic/MotionComicPage.tsx'),
    ]);

    expect(start).not.toContain('DirectorProjectLibrary');
    expect(start).not.toContain('返回项目库');
    expect(start).toContain('DirectorProjectRecovery');
    for (const page of [editorial, comic]) {
      expect(page).not.toContain('DirectorProjectLibrary');
      expect(page).toContain('useState(() => !requestedTaskId)');
      expect(page).toContain('useState(() => requestedTaskId)');
      expect(page).toContain("onBack={() => navigate?.('new-task')}");
      expect(page).toContain("onReturnTasks={() => navigate?.('history')}");
      expect(page).toContain("onBackToTasks={() => navigate?.('history')}");
    }
  });

  it('enters immersive mode only for a real Director Desk workspace', async () => {
    const [workspace, css] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
    ]);

    expect(workspace).not.toContain('director-mode-switch');
    expect(workspace).toContain('label="返回全部任务"');
    expect(css).toContain(".app-shell[data-shell-view='editorial-collage']:has(.director-desk)");
    expect(css).toContain(".app-shell[data-shell-view='motion-comic']:has(.director-desk)");
    expect(css).not.toContain(".app-shell[data-shell-view='editorial-collage'] > .window-line");
    expect(css).not.toContain(".app-shell[data-shell-view='motion-comic'] > .window-line");
  });
});

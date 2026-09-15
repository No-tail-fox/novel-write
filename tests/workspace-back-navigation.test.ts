import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { navigationReturnLabel, shellBackView, taskWorkspaceView, workspaceReturnViewForNavigation } from '../src/app/navigation';
import { createWorkspaceNavigationController } from '../src/shared/workspace-navigation';
import type { ShellView } from '../src/shared/types';

describe('workspace back navigation', () => {
  it.each<ShellView>(['html-video', 'music-mv', 'editorial-collage', 'motion-comic'])('retains the entry point for %s', (view) => {
    for (const source of ['projects', 'new-task', 'history', 'queue'] as const) {
      expect(workspaceReturnViewForNavigation(source, view, 'projects')).toBe(source);
    }
    expect(workspaceReturnViewForNavigation('image-lab', view, 'history')).toBe('projects');
  });

  it('does not loop when switching creation modes or returning through settings', () => {
    const origin = workspaceReturnViewForNavigation('projects', 'html-video', 'history');
    expect(workspaceReturnViewForNavigation('html-video', 'music-mv', origin)).toBe('projects');
    expect(workspaceReturnViewForNavigation('music-mv', 'html-video', origin)).toBe('projects');
    expect(workspaceReturnViewForNavigation('html-video', 'settings', 'history')).toBe('history');
    expect(workspaceReturnViewForNavigation('settings', 'html-video', 'history')).toBe('history');
    expect(workspaceReturnViewForNavigation('html-video', 'new-task', 'history')).toBe('projects');
  });

  it.each<ShellView>(['html-video', 'music-mv', 'editorial-collage', 'motion-comic', 'task-detail'])('keeps the shared return available in every %s state', (view) => {
    expect(shellBackView(view, 'projects')).toBe('projects');
    expect(shellBackView(view, 'history')).toBe('history');
    expect(shellBackView(view, 'new-task')).toBe('new-task');
    expect(shellBackView(view, view)).toBe('projects');
  });

  it('does not add back buttons to root pages', () => {
    for (const view of ['projects', 'history', 'queue', 'settings'] as const) {
      expect(shellBackView(view, 'projects')).toBeNull();
    }
    expect(shellBackView('new-task', 'history')).toBe('projects');
    expect(taskWorkspaceView('music-mv')).toBe('task-detail');
    expect(navigationReturnLabel('projects')).toBe('返回项目');
    expect(navigationReturnLabel('history')).toBe('返回历史任务');
    expect(navigationReturnLabel('new-task')).toBe('返回新建任务');
    expect(navigationReturnLabel('queue')).toBe('返回自动化队列');
  });

  it.each<ShellView>(['html-video', 'music-mv', 'editorial-collage', 'motion-comic'])('guards %s back actions without losing the destination on cancel or failed save', async (view) => {
    const controller = createWorkspaceNavigationController();
    let active: ShellView = view;
    let saved = false;
    const origin = workspaceReturnViewForNavigation('projects', view, 'history');
    controller.register('draft', () => ({ id: 'draft', label: 'Draft', dirty: true, onSave: async () => saved, onDiscard: () => undefined }));
    const back = () => controller.requestLeave(() => { active = shellBackView(view, origin)!; });
    const cancelled = back();
    controller.cancel();
    expect(await cancelled).toBe(false);
    expect(active).toBe(view);
    const pending = back();
    await controller.confirm('save');
    expect(active).toBe(view);
    expect(controller.getSnapshot().pending).toBe(true);
    saved = true;
    await controller.confirm('save');
    expect(await pending).toBe(true);
    expect(active).toBe('projects');
  });

  it('connects the shell to guarded navigation and preserves the MV creation origin', async () => {
    const app = await readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
    const shell = await readFile(new URL('../src/app/AppShell.tsx', import.meta.url), 'utf8');
    const routes = await readFile(new URL('../src/app/AppRoutes.tsx', import.meta.url), 'utf8');
    expect(app).toContain('navigation.requestLeave(() => navigateNow(view))');
    expect(app).toContain('workspaceReturnViewForNavigation(from, view, current)');
    expect(app).toContain('openTaskDetailNow(entry.taskId, entry.taskReturnView)');
    expect(shell).toContain('onClick={() => navigate(backView)}');
    expect(shell).toContain('label={navigationReturnLabel(backView)}');
    expect(shell).toContain('<Tooltip content={navigationReturnLabel(backView)}>');
    expect(routes).toContain('openTaskDetail={(taskId) => openTaskDetail(taskId, taskDetailReturnView)}');
    expect(routes).toContain('const [projectHomeSession] = useState(createProjectHomeSession)');
  });

  it('keeps the HTML workspace mode toolbar visible for existing projects', async () => {
    const css = await readFile(new URL('../src/styles/features/html-video.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/\.hv-studio\[data-has-task="true"\] \.hv-studio-canvas-heading,[^{]*\{\s*display:\s*none/u);
    const authoring = await readFile(new URL('../src/features/html-video/HtmlVideoAuthoringWorkspace.tsx', import.meta.url), 'utf8');
    expect(authoring).toContain('setLoadError(normalizeAppError(error).message)');
  });

  it('uses only the shell return in director creation, loading and recovery states', async () => {
    const start = await readFile(new URL('../src/features/director-desk/DirectorProjectStart.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../src/styles/features/director-desk.css', import.meta.url), 'utf8');
    expect(start).not.toContain('返回新建任务');
    expect(start).not.toContain('返回全部任务');
    expect(start).not.toContain('onReturnTasks');
    expect(start).not.toContain('onBack');
    expect(css).toContain(".app-shell[data-shell-view='editorial-collage']:has(.director-desk) .page-head");
    expect(css).toContain(".app-shell[data-shell-view='motion-comic']:has(.director-desk) .page-head");
  });
});

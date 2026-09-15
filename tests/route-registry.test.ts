import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generationNavItems, navigationItemForView, navigationItems, navigationPrimaryView, newTaskPrimaryAction, primaryNavigationGroupForView, secondaryNavigationItems, sidebarNavGroups, sidebarNavItems, taskWorkspaceView } from '../src/app/navigation';

const expectedViews = [
  'projects',
  'conversation-workbench',
  'new-task',
  'hot-board',
  'queue',
  'history',
  'task-detail',
  'editorial-collage',
  'motion-comic',
  'html-video',
  'image-lab',
  'voice-lab',
  'video-lab',
  'music-mv',
  'book-selection',
  'benchmark',
  'person-assets',
  'copy-studio',
  'viral-analyzer',
  'prompt-templates',
  'draft-templates',
  'settings',
  'account',
  'activation',
] as const;

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8').catch(() => '');
}

function quotedValues(section: string): string[] {
  return [...section.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
}

function registryKeys(section: string): string[] {
  return [...section.matchAll(/^\s*'([^']+)':/gmu)].map((match) => match[1]);
}

describe('renderer route registry', () => {
  it('persists every registered route through the desktop preference boundary', async () => {
    const { ipcInputSchemas } = await import('../src/shared/ipc-contract');
    for (const activeView of expectedViews) {
      expect(ipcInputSchemas['ui:save-preferences'].parse({ activeView })).toEqual({ activeView });
    }
    expect(ipcInputSchemas['ui:save-preferences'].safeParse({ activeView: 'missing-workbench' }).success).toBe(false);
  });

  it('derives ShellView from one exact runtime tuple', async () => {
    const types = await source('src/shared/types.ts');
    const tuple = types.slice(types.indexOf('export const SHELL_VIEWS'), types.indexOf('export type ShellView'));

    expect(tuple.length).toBeGreaterThan(0);
    expect(quotedValues(tuple)).toEqual(expectedViews);
    expect(types).toContain('export type ShellView = (typeof SHELL_VIEWS)[number]');
  });

  it('owns one lazy loader, component, and preload path for every ShellView', async () => {
    const registry = await source('src/app/route-registry.ts');
    expect(registry.length).toBeGreaterThan(0);
    if (!registry) return;

    const loaderSection = registry.slice(registry.indexOf('export const routeLoaders'), registry.indexOf('export const routeComponents'));
    const componentSection = registry.slice(registry.indexOf('export const routeComponents'), registry.indexOf('export function preloadRoute'));
    expect(registryKeys(loaderSection)).toEqual(expectedViews);
    expect(registryKeys(componentSection)).toEqual(expectedViews);
    expect(registry.match(/lazy\(routeLoaders\['[^']+'\]\)/gu)).toHaveLength(expectedViews.length);
    expect(registry.match(/import\('\.\.\/features\//gu)).toHaveLength(expectedViews.length);
    expect(registry).toContain('export async function preloadRoute(view: ShellView)');
    expect(registry).not.toMatch(/^import \{ [A-Za-z0-9]+Page \} from '\.\.\/features\//gmu);
  });

  it('keeps new task separate, every workbench reachable, and task detail route-only', () => {
    expect(newTaskPrimaryAction.view).toBe('new-task');
    expect(sidebarNavGroups.map((group) => group.label)).toEqual(['项目', '素材库', '灵感', '模板', '任务', '设置']);
    expect(sidebarNavGroups.map((group) => group.items.length)).toEqual([5, 6, 4, 2, 2, 1]);
    expect(sidebarNavItems).toHaveLength(22);
    expect(new Set(sidebarNavItems.map((item) => item.view)).size).toBe(22);
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('new-task');
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('task-detail');
    expect(navigationItems).toHaveLength(23);
    expect(new Set([...navigationItems.map((item) => item.view), 'task-detail'])).toEqual(new Set(expectedViews));
  });

  it('keeps every workspace route under the correct visible primary entry', () => {
    expect(navigationPrimaryView('projects')).toBe('projects');
    expect(navigationPrimaryView('new-task')).toBe('projects');
    expect(navigationPrimaryView('task-detail')).toBe('projects');
    expect(navigationPrimaryView('editorial-collage')).toBe('projects');
    expect(navigationPrimaryView('motion-comic')).toBe('projects');
    expect(navigationPrimaryView('html-video')).toBe('projects');
    expect(navigationPrimaryView('music-mv')).toBe('projects');
    expect(navigationPrimaryView('person-assets')).toBe('person-assets');
    expect(navigationPrimaryView('conversation-workbench')).toBe('person-assets');
    expect(navigationPrimaryView('copy-studio')).toBe('person-assets');
    expect(navigationPrimaryView('image-lab')).toBe('person-assets');
    expect(navigationPrimaryView('voice-lab')).toBe('person-assets');
    expect(navigationPrimaryView('video-lab')).toBe('person-assets');
    expect(navigationPrimaryView('book-selection')).toBe('hot-board');
    expect(navigationPrimaryView('draft-templates')).toBe('prompt-templates');
    expect(navigationPrimaryView('history')).toBe('queue');
    expect(navigationPrimaryView('activation')).toBe('settings');
  });

  it('opens the asset library directly and keeps its workbenches in the secondary menu', () => {
    const group = sidebarNavGroups.find((item) => item.id === 'assets')!;
    expect(group.defaultView).toBe('person-assets');
    expect(group.items[0].view).toBe(group.defaultView);
    expect(group.items.map((item) => item.view)).toEqual(['person-assets', 'copy-studio', 'conversation-workbench', 'image-lab', 'voice-lab', 'video-lab']);
    expect(secondaryNavigationItems(group).map((item) => item.view)).toEqual(['copy-studio', 'conversation-workbench', ...generationNavItems.map((item) => item.view)]);
    expect(generationNavItems.map(({ view, label }) => ({ view, label }))).toEqual([
      { view: 'image-lab', label: '图片生成' },
      { view: 'voice-lab', label: '配音生成' },
      { view: 'video-lab', label: '视频生成' },
    ]);
    for (const item of generationNavItems) {
      expect(primaryNavigationGroupForView(item.view)).toBe(group);
      expect(navigationItemForView(item.view)).toBe(item);
    }
  });

  it('preloads on hover and focus while route state changes use transitions', async () => {
    const [shell, app, routes] = await Promise.all([
      source('src/app/AppShell.tsx'),
      source('src/app/App.tsx'),
      source('src/app/AppRoutes.tsx'),
    ]);

    expect(shell).toContain("from './route-registry'");
    expect(shell).toContain('onMouseEnter={() => preloadRouteIntent(');
    expect(shell).toContain('onFocus={() => preloadRouteIntent(');
    expect(app).toContain('startTransition(() => {');
    expect(routes).toContain("from './route-registry'");
    expect(routes).not.toMatch(/^const [A-Za-z0-9]+Page = lazy\(/gmu);
  });

  it('routes HTML tasks to their workspace and hands the selected task through once', async () => {
    expect(taskWorkspaceView('html-video')).toBe('html-video');
    expect(taskWorkspaceView('editorial-collage')).toBe('editorial-collage');
    expect(taskWorkspaceView('motion-comic')).toBe('motion-comic');
    expect(taskWorkspaceView('story')).toBe('task-detail');
    expect(taskWorkspaceView(undefined)).toBe('task-detail');

    const [app, routes, htmlVideo] = await Promise.all([
      source('src/app/App.tsx'),
      source('src/app/AppRoutes.tsx'),
      source('src/features/html-video/HtmlVideoPage.tsx'),
    ]);
    expect(app).toContain('const targetView = taskWorkspaceView(task.taskType);');
    expect(app).toContain("setRequestedHtmlTaskId(targetView === 'html-video' ? taskId : '')");
    expect(routes).toContain('requestedTaskId={requestedHtmlTaskId}');
    expect(htmlVideo).toContain('void openHtmlVideoTask(requestedTaskId).finally');
    expect(htmlVideo).toContain('onRequestedTaskHandled(requestedTaskId)');
  });
});

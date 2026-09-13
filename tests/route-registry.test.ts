import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { navigationItems, navigationPrimaryView, newTaskPrimaryAction, sidebarNavGroups, sidebarNavItems, taskWorkspaceView } from '../src/app/navigation';

const expectedViews = [
  'projects',
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
  'music-mv',
  'book-selection',
  'benchmark',
  'person-assets',
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
    expect(registry.match(/lazy\(routeLoaders\['[^']+'\]\)/gu)).toHaveLength(21);
    expect(registry.match(/import\('\.\.\/features\//gu)).toHaveLength(21);
    expect(registry).toContain('export async function preloadRoute(view: ShellView)');
    expect(registry).not.toMatch(/^import \{ [A-Za-z0-9]+Page \} from '\.\.\/features\//gmu);
  });

  it('keeps new task separate, nineteen sidebar entries, and task detail route-only', () => {
    expect(newTaskPrimaryAction.view).toBe('new-task');
    expect(sidebarNavGroups.map((group) => group.label)).toEqual(['项目', '素材库', '灵感', '模板', '任务', '设置']);
    expect(sidebarNavGroups.map((group) => group.items.length)).toEqual([5, 3, 4, 2, 2, 1]);
    expect(sidebarNavItems).toHaveLength(19);
    expect(new Set(sidebarNavItems.map((item) => item.view)).size).toBe(19);
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('new-task');
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('task-detail');
    expect(navigationItems).toHaveLength(20);
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
    expect(navigationPrimaryView('voice-lab')).toBe('image-lab');
    expect(navigationPrimaryView('book-selection')).toBe('hot-board');
    expect(navigationPrimaryView('draft-templates')).toBe('prompt-templates');
    expect(navigationPrimaryView('history')).toBe('queue');
    expect(navigationPrimaryView('activation')).toBe('settings');
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

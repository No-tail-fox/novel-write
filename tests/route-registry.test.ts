import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { navigationItems, newTaskPrimaryAction, sidebarNavGroups, sidebarNavItems, taskWorkspaceView } from '../src/app/navigation';

const expectedViews = [
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
    expect(registry.match(/lazy\(routeLoaders\['[^']+'\]\)/gu)).toHaveLength(20);
    expect(registry.match(/import\('\.\.\/features\//gu)).toHaveLength(20);
    expect(registry).toContain('export async function preloadRoute(view: ShellView)');
    expect(registry).not.toMatch(/^import \{ [A-Za-z0-9]+Page \} from '\.\.\/features\//gmu);
  });

  it('keeps new task separate, eighteen sidebar entries, and task detail route-only', () => {
    expect(newTaskPrimaryAction.view).toBe('new-task');
    expect(sidebarNavGroups.map((group) => group.label)).toEqual(['创作生产', '素材与实验', '模板与系统']);
    expect(sidebarNavGroups.map((group) => group.items.length)).toEqual([6, 7, 5]);
    expect(sidebarNavItems).toHaveLength(18);
    expect(new Set(sidebarNavItems.map((item) => item.view)).size).toBe(18);
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('new-task');
    expect(sidebarNavItems.map((item) => item.view)).not.toContain('task-detail');
    expect(navigationItems).toHaveLength(19);
    expect(new Set([...navigationItems.map((item) => item.view), 'task-detail'])).toEqual(new Set(expectedViews));
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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { TaskCreationTypePicker, taskCreationTarget } from '../src/features/tasks/TaskCreationTypePicker';

describe('new project entry selection', () => {
  it('does not preselect short video before the user chooses a route', () => {
    const html = renderToStaticMarkup(createElement(TaskCreationTypePicker, { navigate: vi.fn() }));
    expect(html.match(/data-task-creation-type=/g)).toHaveLength(6);
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toContain('短片生成');
  });
  it('retains explicit selection and route mappings for existing callers', () => {
    const html = renderToStaticMarkup(createElement(TaskCreationTypePicker, { activeType: 'smart-video', navigate: vi.fn() }));
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(taskCreationTarget('smart-video')).toBe('new-task');
    expect(taskCreationTarget('vox')).toBe('editorial-collage');
    expect(taskCreationTarget('music-mv')).toBe('music-mv');
  });
  it('keeps the compact workbench appearance without short-video actions in the entry', async () => {
    const source = await readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8');
    const entry = source.slice(source.indexOf('  if (choosingType) {'), source.indexOf('  return (', source.indexOf('  if (choosingType) {') + 30));
    expect(entry).toContain('new-task-stage-tabs');
    expect(entry).toContain('new-task-workbench');
    expect(entry).toContain('new-task-summary new-task-entry-guide');
    expect(entry).not.toContain('CreationPageHeader');
    expect(entry).not.toContain('activeType="smart-video"');
    expect(entry).not.toContain('创建并开始生成');
  });
  it('treats a repeated new-project navigation as a resettable entry action', async () => {
    const app = await readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
    const routes = await readFile(new URL('../src/app/AppRoutes.tsx', import.meta.url), 'utf8');
    expect(app).toContain('setNewProjectEntryRevision((revision) => revision + 1)');
    expect(app).toContain('newProjectEntryRevision={newProjectEntryRevision}');
    expect(routes).toContain('entryRevision={newProjectEntryRevision}');
  });
});

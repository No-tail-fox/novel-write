import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { NewTaskPage } from '../src/features/tasks/NewTaskPage';
import { shortVideoEditorStage } from '../src/features/tasks/new-task-entry';
import { defaultConfig } from '../src/shared/config';
import type { RendererAppState } from '../src/app/route-types';
import type { StoryDreamApi } from '../src/shared/storydream-api';

const source = () => readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8');

describe('short-video entry navigation', () => {
  it('renders a pure, unselected creation-type entry on first mount', () => {
    const state = {
      config: structuredClone(defaultConfig), draftTemplates: [], promptTemplates: [],
      customStyles: [], customCoverTemplates: [], minimaxCloneVoices: [],
    } as unknown as RendererAppState;
    const html = renderToStaticMarkup(createElement(NewTaskPage, {
      state, api: {} as StoryDreamApi, applyState: vi.fn(), openTaskDetail: vi.fn(),
      isBrowserPreview: true, navigate: vi.fn(), entryRevision: 4,
    }));
    expect(html).toContain('data-new-task-choosing-type');
    expect(html).toContain('<h2>制作类型</h2>');
    expect(html).toContain('new-task-stage-tabs');
    expect(html).toContain('new-task-entry-guide');
    expect(html.match(/data-task-creation-type=/g)).toHaveLength(6);
    expect(html).not.toContain('aria-pressed="true"');
    for (const hidden of ['data-new-task-summary', '创建并开始生成', '保存为预设', '任务标题']) {
      expect(html).not.toContain(hidden);
    }
  });

  it('maps old material snapshots to content without altering the persisted draft model', () => {
    expect(shortVideoEditorStage('material')).toBe('creative');
    expect(shortVideoEditorStage('creative')).toBe('creative');
    expect(shortVideoEditorStage('output')).toBe('output');
  });

  it('resets only entry navigation on revision and leaves automatic restore behind the type picker', async () => {
    const page = await source();
    expect(page).toMatch(/useEffect\(\(\) => \{\s*\/\/[^\n]*\n\s*setChoosingType\(true\);\s*\}, \[entryRevision\]\)/);
    const apply = page.slice(page.indexOf('function applyDraftSnapshot'), page.indexOf('function saveDraft'));
    expect(apply).not.toContain('setChoosingType');
    expect(apply).toContain('setActiveStage(shortVideoEditorStage(draft.activeStage))');
    const restore = page.slice(page.indexOf('function restoreDraft'), page.indexOf('function saveTaskPreset'));
    expect(restore).toContain("setChoosingType(draft.activeStage === 'material')");
    const picker = page.slice(page.indexOf('if (choosingType)'), page.indexOf('data-new-task-stage={activeStage}'));
    expect(picker).toContain('setChoosingType(false)');
    expect(picker).toContain("setActiveStage('creative')");
    expect(picker).toContain('navigate(taskCreationTarget(type))');
    expect(picker).not.toContain('onKeyDown');
    expect(page).toContain('>更换制作类型</Button>');
    expect(page).toContain("if (activeStage === 'output') setActiveStage('creative');\n              else setChoosingType(true);");
    expect(page).toContain("sessionStorage.getItem('book_product_info')");
    expect(page).toContain("sessionStorage.getItem('hotboard_topic')");
    expect(page).toContain('writeNewTaskDraft(window.localStorage, createDraftSnapshot())');
  });
});

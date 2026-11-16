import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProjectModelBar } from '../src/features/projects/ProjectModelFields';
import { defaultConfig } from '../src/shared/config';
import type { StoryDreamApi } from '../src/shared/storydream-api';
import type { Task } from '../src/shared/types';

const config = structuredClone(defaultConfig);
const task = { id: 'p1', title: '项目', status: 'completed', llmProfileId: config.llmProfiles[0]?.id ?? '' } as Pick<Task, 'id' | 'title' | 'status' | 'archivedAt' | 'llmProfileId' | 'projectModels'>;
const render = (overrides: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ProjectModelBar, { inline: true, task, config, api: {} as StoryDreamApi, onUpdated: vi.fn(), ...overrides }));

describe('inline project model selection', () => {
  it('renders three labelled selects directly, with no dialog trigger', () => {
    const html = render();
    expect(html).toContain('role="group" aria-label="项目模型"');
    for (const label of ['LLM模型', '生图模型', '视频模型']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('保存项目模型');
    expect(html).not.toContain('>项目模型</button>');
    expect(html).not.toMatch(/<select[^>]*disabled/);
  });

  it('is read-only while work is active or the project is archived', () => {
    for (const html of [render({ disabled: true }), render({ task: { ...task, status: 'running' } }), render({ task: { ...task, archivedAt: '2026-01-01' } })]) {
      expect(html.match(/<select[^>]*disabled/g)).toHaveLength(3);
      expect(html).toContain('当前仅可查看模型');
    }
  });

  it('allows comic model selection while background work is active', () => {
    const html = render({ disabled: true, task: { ...task, taskType: 'motion-comic', status: 'running', projectActivity: { status: 'running' } } });
    expect(html).not.toMatch(/<select[^>]*disabled/);
    expect(html).toContain('LLM');
    expect(html).not.toContain('>语言<');
  });

  it('keeps the dialog variant for other workspaces', () => {
    expect(render({ inline: false })).toContain('项目模型');
  });
});

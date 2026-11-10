import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recommendProductionRoute } from '../src/shared/model-capabilities';

describe('route recommendation from the model capability profile (U-6)', () => {
  it.each([
    ['claude-sonnet-4-5', 'lemo'],
    ['gemini-3.1-pro-preview', 'lemo'],
    ['gpt-5.5', 'lemo'],
    ['gemini-2.5-flash', 'html'],
    ['deepseek-chat', 'html'],
    ['totally-unknown-model', 'html'],
    ['gpt-4o-mini', 'template'],
    ['qwen2.5-7b-instruct', 'template'],
  ] as const)('%s → %s', (model, route) => {
    expect(recommendProductionRoute(model).recommended).toBe(route);
  });

  it('warns, never blocks, when the chosen route needs a stronger model', () => {
    const weak = recommendProductionRoute('gpt-4o-mini', 'lemo');
    expect(weak.downgradeTo).toBe('template');
    expect(weak.warning).toContain('创意动画需要 T1 级语言模型');
    expect(weak.warning).toContain('模板动画');
    expect(recommendProductionRoute('gemini-2.5-flash', 'html').warning).toBeUndefined();
    expect(recommendProductionRoute('gemini-2.5-flash', 'template').warning).toBeUndefined();
    expect(recommendProductionRoute('claude-opus-4-1', 'lemo').warning).toBeUndefined();
  });

  it('treats unknown models as T2: warned only for 创意动画', () => {
    expect(recommendProductionRoute('my-relay-model', 'html').warning).toBeUndefined();
    expect(recommendProductionRoute('my-relay-model', 'lemo').warning).toContain('未识别，按 T2 处理');
  });

  it('shows the hint in the create forms of every route', () => {
    const fields = readFileSync('src/features/projects/ProjectModelFields.tsx', 'utf8');
    expect(fields).toContain('recommendProductionRoute(model, route)');
    expect(fields).toContain('className="project-model-route-hint" role="note"');
    expect(readFileSync('src/features/editorial-collage/EditorialCollagePage.tsx', 'utf8')).toContain("route={route === 'template' ? 'template' : 'lemo'}");
    expect(readFileSync('src/features/html-video/HtmlVideoPage.tsx', 'utf8')).toContain('route="html"');
  });
});

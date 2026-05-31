import { describe, expect, it } from 'vitest';
import { defaultCustomStyles, defaultPromptTemplates } from '@shared/config';
import {
  buildImageTemplateStyleOptions,
  buildStoryTemplateTrackOptions,
  resolvePromptTemplateDefaultDraftTemplateId,
  renderPromptTemplate,
  resolvePromptTemplateDefaultStyleId,
  resolvePromptTemplateDefaultStyleIds,
  selectStepPromptTemplate,
  selectTaskPromptTemplate,
} from '@shared/prompt-templates';

describe('prompt template rendering', () => {
  it('renders allowed task context placeholders and removes missing values', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: '赛道 {{track}}，正文 {{inputText}}，缺失 {{missingValue}}，要求 {{extraRequirements}}。',
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        track: 'character-story',
        inputText: '武则天十四岁入宫。',
        extraRequirements: '强调命运转折',
      },
    });

    expect(rendered).toContain('赛道 character-story');
    expect(rendered).toContain('正文 武则天十四岁入宫。');
    expect(rendered).toContain('要求 强调命运转折');
    expect(rendered).not.toContain('{{missingValue}}');
  });

  it('renders Chinese placeholder aliases used by the template editor labels', () => {
    const template = {
      ...defaultPromptTemplates[0],
      content: '赛道 {{内容赛道}}，正文 {{原文素材}}，要求 {{额外要求}}，比例 {{画面比例}}。',
    };

    const rendered = renderPromptTemplate(template, {
      task: {
        track: 'character-story',
        inputText: '武则天十四岁入宫。',
        extraRequirements: '强调命运转折',
        ratio: '9:16',
      },
    });

    expect(rendered).toBe('赛道 character-story，正文 武则天十四岁入宫。，要求 强调命运转折，比例 9:16。');
    expect(rendered).not.toContain('{{');
  });

  it('selects an explicit task template before falling back to the task track', () => {
    const explicit = {
      ...defaultPromptTemplates[0],
      id: 'custom-explicit-task',
      name: '显式模板',
      baseTrack: 'ecommerce',
      isBuiltin: false,
    };

    expect(selectTaskPromptTemplate([...defaultPromptTemplates, explicit], { track: 'character-story', promptTemplateId: explicit.id })?.id).toBe(explicit.id);
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'food-v2' })?.id).toBe('system-food-v2');
    expect(selectTaskPromptTemplate(defaultPromptTemplates, { track: 'unknown-track' })?.id).toBe('system-general-story');
  });

  it('selects built-in step templates by template type', () => {
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'review')?.id).toBe('builtin-review');
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'storyboard')?.id).toBe('builtin-storyboard');
    expect(selectStepPromptTemplate(defaultPromptTemplates, 'image-prompt')?.id).toBe('builtin-image-prompt');
  });

  it('selects task-level AI step prompts before global step templates', () => {
    const taskTemplate = {
      ...defaultPromptTemplates[0],
      id: 'custom-task-with-step-prompts',
      stepPrompts: {
        rewrite: '只用于这个任务模板的改写规则：{{reviewedText}}',
      },
    };

    const selected = selectStepPromptTemplate(defaultPromptTemplates, 'rewrite', taskTemplate);

    expect(selected?.id).toBe('custom-task-with-step-prompts:rewrite');
    expect(renderPromptTemplate(selected!, { reviewedText: '事实简稿' })).toContain('只用于这个任务模板的改写规则：事实简稿');
  });

  it('normalizes story template default styles to stable image template ids', () => {
    const legacyTemplate = {
      ...defaultPromptTemplates[0],
      defaultStyles: ['写实彩色', '黑白摄影', 'unknown-style'],
    };

    expect(resolvePromptTemplateDefaultStyleIds(legacyTemplate)).toEqual(['photo-real', 'black-white']);
    expect(resolvePromptTemplateDefaultStyleId(legacyTemplate)).toBe('photo-real');
    expect(resolvePromptTemplateDefaultStyleId({ ...legacyTemplate, defaultStyles: [] })).toBe('photo-real');
  });

  it('resolves custom image template ids when the current style library is supplied', () => {
    const template = {
      ...defaultPromptTemplates[0],
      defaultStyles: ['cyber-rain'],
    };

    expect(resolvePromptTemplateDefaultStyleId(template, ['cyber-rain'])).toBe('cyber-rain');
    expect(resolvePromptTemplateDefaultStyleIds(template, ['cyber-rain'])).toEqual(['cyber-rain']);
  });

  it('ships the global default image templates from the template center', () => {
    const ids = defaultCustomStyles.map((style) => style.id);

    expect(ids).toEqual([
      'black-white',
      'photo-real',
      'oil-paint',
      'modern-film',
      'ancient-film',
      'retro-film',
      'watercolor',
      'magazine',
      'pixar-3d',
      'ink',
      'folk',
      'ghibli',
    ]);
  });

  it('binds each built-in story template to exactly one resolved default image template', () => {
    const taskTemplates = defaultPromptTemplates.filter((template) => template.type === 'task');

    expect(taskTemplates).toHaveLength(9);
    for (const template of taskTemplates) {
      expect(resolvePromptTemplateDefaultStyleIds(template), template.id).toHaveLength(1);
    }
  });

  it('builds new-task content track choices from story templates', () => {
    const custom = {
      ...defaultPromptTemplates[0],
      id: 'custom-urban-myth',
      name: '都市奇谈',
      description: '都市悬疑、反转、夜间氛围。',
      baseTrack: 'urban-myth',
      isBuiltin: false,
    };

    expect(buildStoryTemplateTrackOptions([...defaultPromptTemplates, custom])).toContainEqual(['urban-myth', '都市奇谈', '都市悬疑、反转、夜间氛围']);
  });

  it('builds new-task image style choices from image templates', () => {
    const customStyle = {
      ...defaultCustomStyles[0],
      id: 'cyber-rain',
      name: '赛博雨夜',
      tag: '霓虹街景',
      description: '适合科技悬疑和都市题材。',
    };

    expect(buildImageTemplateStyleOptions([...defaultCustomStyles, customStyle])).toContainEqual(['cyber-rain', '赛博雨夜', '霓虹街景']);
  });

  it('resolves a story template default draft template when available', () => {
    const template = {
      ...defaultPromptTemplates[0],
      defaultDraftTemplateId: 'builtin-landscape-16-9',
    };

    expect(resolvePromptTemplateDefaultDraftTemplateId(template, ['default-portrait-9-16', 'builtin-landscape-16-9'])).toBe('builtin-landscape-16-9');
    expect(resolvePromptTemplateDefaultDraftTemplateId(template, ['default-portrait-9-16'])).toBe('default-portrait-9-16');
  });
});

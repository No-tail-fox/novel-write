import { describe, expect, it } from 'vitest';
import { defaultPromptTemplates } from '@shared/config';
import {
  renderPromptTemplate,
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
});

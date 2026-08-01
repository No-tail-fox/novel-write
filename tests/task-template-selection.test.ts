import { describe, expect, it } from 'vitest';
import { resolveTaskTemplateSelection } from '../src/features/tasks/task-template-selection';

const templates = [
  { id: 'applied-template' },
  { id: 'candidate-template' },
];

describe('task draft-template selection', () => {
  it('keeps the persisted template applied until a valid different candidate is selected', () => {
    const initial = resolveTaskTemplateSelection(templates, 'applied-template', '');
    expect(initial).toMatchObject({
      appliedTemplateId: 'applied-template',
      candidateTemplateId: 'applied-template',
      appliedTemplateMissing: false,
      canApply: false,
    });

    const pending = resolveTaskTemplateSelection(templates, 'applied-template', 'candidate-template');
    expect(pending).toMatchObject({
      appliedTemplateId: 'applied-template',
      candidateTemplateId: 'candidate-template',
      appliedTemplate: { id: 'applied-template' },
      candidateTemplate: { id: 'candidate-template' },
      canApply: true,
    });
  });

  it('does not silently replace a missing applied template with the first list item', () => {
    const selection = resolveTaskTemplateSelection(templates, 'deleted-template', '');
    expect(selection).toMatchObject({
      appliedTemplateId: 'deleted-template',
      candidateTemplateId: 'deleted-template',
      appliedTemplate: null,
      candidateTemplate: null,
      appliedTemplateMissing: true,
      canApply: false,
    });
  });

  it('does not change the applied template when the template list is reordered', () => {
    const reordered = [...templates].reverse();
    expect(resolveTaskTemplateSelection(reordered, 'applied-template', '')).toMatchObject({
      appliedTemplateId: 'applied-template',
      candidateTemplateId: 'applied-template',
      canApply: false,
    });
  });
});
